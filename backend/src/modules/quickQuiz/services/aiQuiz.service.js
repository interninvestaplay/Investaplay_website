/**
 * AI Quiz Service — Provider-independent orchestrator for quiz generation.
 *
 * This is the ONLY entry point the rest of the application uses for AI quiz generation.
 * It delegates to the configured provider (currently Groq) and handles:
 *   - Prompt construction
 *   - AI response parsing & validation
 *   - Duplicate filtering
 *   - Question storage
 *   - Pool-first retrieval (generate once, serve many)
 *
 * Architecture:
 *   Quick Quiz Controller → aiQuiz.service.js → groq.provider.js → Groq API
 */

const { buildTopicPrompt, buildPdfPrompt } = require('../prompts/quizGeneration.prompt');
const { validateAiResponse } = require('../validators/quickQuiz.validator');
const { filterDuplicates, getUserSeenQuestionIds } = require('./duplicate.service');
const {
  storeQuestions,
  getPoolQuestions,
  countPoolQuestions,
  createSource,
  createSession,
  linkSessionQuestions,
} = require('./question.service');
const { extractTextFromPdf, chunkText, cleanupFile } = require('./pdf.service');

// Import the active provider — swap this line to change providers
const provider = require('../providers/groq.provider');

/**
 * Generate a topic-based Quick Quiz.
 *
 * Flow:
 * 1. Check pool for existing questions
 * 2. If pool has enough → serve from pool
 * 3. If pool is insufficient → generate via AI → validate → deduplicate → store → serve
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.topic
 * @param {string} params.difficulty
 * @param {number} params.questionCount
 * @returns {Promise<{ sessionId: string, questions: object[] }>}
 */
async function generateTopicQuiz({ userId, topic, difficulty, questionCount }) {
  const normalizedTopic = topic.trim();

  console.log(`[QuickQuiz] Topic quiz requested: topic="${normalizedTopic}", difficulty=${difficulty}, count=${questionCount}, user=${userId}`);

  // Check pool first (scalability: generate once, serve many)
  const seenIds = await getUserSeenQuestionIds(userId, 'topic', normalizedTopic);
  const poolCount = await countPoolQuestions({ sourceType: 'topic', topic: normalizedTopic, difficulty });

  let questionIds = [];

  if (poolCount >= questionCount) {
    // Serve from pool — no AI call needed
    console.log(`[QuickQuiz] Pool has ${poolCount} questions, serving ${questionCount} from pool`);
    const poolQuestions = await getPoolQuestions({
      userId,
      sourceType: 'topic',
      topic: normalizedTopic,
      sourceId: null,
      difficulty,
      count: questionCount,
      seenIds,
    });
    questionIds = poolQuestions.map(q => q.id);
  }

  if (questionIds.length < questionCount) {
    // Need to generate more questions via AI
    const needed = questionCount - questionIds.length;
    console.log(`[QuickQuiz] Pool insufficient (have ${questionIds.length}/${questionCount}), generating ${needed} via AI`);

    const existingConceptKeys = await getExistingConceptKeys('topic', normalizedTopic, null);
    const prompt = buildTopicPrompt({
      topic: normalizedTopic,
      difficulty,
      questionCount: needed + 3, // Request extras to account for validation/duplicate losses
      existingConceptKeys,
    });

    const rawResponse = await provider.generateCompletion(prompt);
    console.log(`[QuickQuiz] AI response received, validating...`);

    const validation = validateAiResponse(rawResponse, needed, 'topic');
    if (!validation.valid && validation.questions.length === 0) {
      throw Object.assign(
        new Error('AI failed to generate valid questions. Please try again.'),
        { code: 'AI_GENERATION_FAILED', validationErrors: validation.errors }
      );
    }
    if (validation.errors.length > 0) {
      console.log(`[QuickQuiz] Validation warnings: ${validation.errors.length} issues`);
    }

    // Duplicate filtering
    const { accepted, rejected } = await filterDuplicates(
      validation.questions, 'topic', normalizedTopic, null
    );
    console.log(`[QuickQuiz] Duplicate check: ${accepted.length} accepted, ${rejected.length} rejected`);

    if (accepted.length === 0) {
      throw Object.assign(
        new Error('All generated questions were duplicates. Please try a different topic or difficulty.'),
        { code: 'ALL_DUPLICATES' }
      );
    }

    // Store in pool
    const sourceId = await createSource({
      userId,
      sourceType: 'topic',
      topic: normalizedTopic,
    });

    const newIds = await storeQuestions(accepted, {
      sourceType: 'topic',
      topic: normalizedTopic,
      sourceId,
      difficulty,
    });

    questionIds = [...questionIds, ...newIds].slice(0, questionCount);
  }

  // Ensure we have exactly the requested count
  questionIds = questionIds.slice(0, questionCount);

  // Create session
  const sessionId = await createSession({
    userId,
    sourceType: 'topic',
    topic: normalizedTopic,
    difficulty,
    questionCount: questionIds.length,
  });

  await linkSessionQuestions(sessionId, questionIds);

  // Fetch full question data for the session
  const sessionData = await require('./question.service').getSessionWithQuestions(sessionId, userId);

  console.log(`[QuickQuiz] Topic quiz created: session=${sessionId}, questions=${sessionData.questions.length}`);

  return { sessionId, questions: sessionData.questions, session: sessionData.session };
}

/**
 * Generate a PDF-based Quick Quiz.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.filePath - Path to uploaded PDF
 * @param {string} params.fileName - Original filename
 * @param {string} params.difficulty
 * @param {number} params.questionCount
 * @returns {Promise<{ sessionId: string, questions: object[] }>}
 */
async function generatePdfQuiz({ userId, filePath, fileName, difficulty, questionCount }) {
  console.log(`[QuickQuiz] PDF quiz requested: file="${fileName}", difficulty=${difficulty}, count=${questionCount}, user=${userId}`);

  try {
    // Extract text
    const { text, pageCount, metadata } = await extractTextFromPdf(filePath);
    console.log(`[QuickQuiz] PDF extracted: ${pageCount} pages, ${text.length} chars`);

    // Create source record
    const sourceId = await createSource({
      userId,
      sourceType: 'pdf',
      fileName,
      filePath: null, // Don't store actual path for security
    });

    // Check pool for this specific source
    const seenIds = await getUserSeenQuestionIds(userId, 'pdf', null);
    const poolCount = await countPoolQuestions({ sourceType: 'pdf', sourceId, difficulty });

    let questionIds = [];

    if (poolCount >= questionCount) {
      const poolQuestions = await getPoolQuestions({
        userId,
        sourceType: 'pdf',
        sourceId,
        difficulty,
        count: questionCount,
        seenIds,
      });
      questionIds = poolQuestions.map(q => q.id);
    }

    if (questionIds.length < questionCount) {
      const needed = questionCount - questionIds.length;
      const existingConceptKeys = await getExistingConceptKeys('pdf', null, sourceId);

      // Chunk if necessary
      const { chunks } = chunkText(text);
      const allText = chunks.length === 1 ? text : chunks.map(c => c.text).join('\n\n');

      const prompt = buildPdfPrompt({
        pdfText: allText,
        difficulty,
        questionCount: needed + 3,
        existingConceptKeys,
      });

      const rawResponse = await provider.generateCompletion(prompt, {
        maxTokens: 4096,
        timeoutMs: 90000, // PDFs may need more time
      });

      const validation = validateAiResponse(rawResponse, needed, 'pdf');
      if (!validation.valid && validation.questions.length === 0) {
        throw Object.assign(
          new Error('AI failed to generate valid questions from the PDF. The content may be unsuitable for quiz generation.'),
          { code: 'AI_GENERATION_FAILED' }
        );
      }

      const { accepted, rejected } = await filterDuplicates(
        validation.questions, 'pdf', null, sourceId
      );
      console.log(`[QuickQuiz] PDF duplicate check: ${accepted.length} accepted, ${rejected.length} rejected`);

      if (accepted.length === 0) {
        throw Object.assign(
          new Error('Could not generate unique questions from the PDF. Try a different document.'),
          { code: 'ALL_DUPLICATES' }
        );
      }

      const newIds = await storeQuestions(accepted, {
        sourceType: 'pdf',
        sourceId,
        difficulty,
      });

      questionIds = [...questionIds, ...newIds].slice(0, questionCount);
    }

    questionIds = questionIds.slice(0, questionCount);

    const sessionId = await createSession({
      userId,
      sourceType: 'pdf',
      sourceId,
      difficulty,
      questionCount: questionIds.length,
    });

    await linkSessionQuestions(sessionId, questionIds);
    const sessionData = await require('./question.service').getSessionWithQuestions(sessionId, userId);

    console.log(`[QuickQuiz] PDF quiz created: session=${sessionId}, questions=${sessionData.questions.length}`);

    return { sessionId, questions: sessionData.questions, session: sessionData.session };
  } finally {
    // Always cleanup the uploaded file
    cleanupFile(filePath);
  }
}

/**
 * Get existing concept keys for a topic/source to avoid duplicates.
 */
async function getExistingConceptKeys(sourceType, topic, sourceId) {
  const { query: dbQuery } = require('../../../db/pool');
  let sql = 'SELECT DISTINCT concept_key FROM quick_quiz_questions WHERE source_type = $1';
  const params = [sourceType];
  let idx = 2;

  if (topic) {
    sql += ` AND topic = $${idx}`;
    params.push(topic);
    idx++;
  }
  if (sourceId) {
    sql += ` AND source_id = $${idx}`;
    params.push(sourceId);
    idx++;
  }

  sql += ' LIMIT 200';

  const { rows } = await dbQuery(sql, params);
  return rows.map(r => r.concept_key).filter(Boolean);
}

/**
 * Get provider info (for diagnostics/logging).
 */
function getProviderInfo() {
  return provider.getProviderInfo();
}

module.exports = {
  generateTopicQuiz,
  generatePdfQuiz,
  getProviderInfo,
};
