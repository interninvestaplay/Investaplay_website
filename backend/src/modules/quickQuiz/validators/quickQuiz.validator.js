/**
 * Quick Quiz input & AI output validators.
 *
 * Never trust AI-generated content directly.
 * Every question must pass strict validation before storage or delivery.
 */

const ALLOWED_DIFFICULTIES = ['easy', 'medium', 'hard'];
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 30;
const MAX_TOPIC_LENGTH = 200;
const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PDF_MIME_TYPES = [
  'application/pdf',
];

/**
 * Validate generate request input from the client.
 */
function validateGenerateInput({ sourceType = 'topic', topic, difficulty, questionCount }) {
  const errors = [];
  const type = sourceType || 'topic';

  if (!['topic', 'pdf'].includes(type)) {
    errors.push('sourceType must be "topic" or "pdf"');
  }

  if (sourceType === 'topic') {
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      errors.push('topic is required for topic-based quizzes');
    } else if (topic.trim().length > MAX_TOPIC_LENGTH) {
      errors.push(`topic must be ${MAX_TOPIC_LENGTH} characters or less`);
    }
  }

  if (!difficulty || !ALLOWED_DIFFICULTIES.includes(difficulty)) {
    errors.push(`difficulty must be one of: ${ALLOWED_DIFFICULTIES.join(', ')}`);
  }

  const count = Number(questionCount);
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    errors.push(`questionCount must be an integer between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}`);
  }

  return errors;
}

/**
 * Validate uploaded PDF file metadata.
 */
function validatePdfUpload(file) {
  const errors = [];

  if (!file) {
    errors.push('PDF file is required');
    return errors;
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    errors.push(`PDF must be smaller than ${MAX_PDF_SIZE_BYTES / (1024 * 1024)} MB`);
  }

  // Check both mimetype and extension
  const mimeOk = file.mimetype && ALLOWED_PDF_MIME_TYPES.includes(file.mimetype);
  const extOk = file.originalname && file.originalname.toLowerCase().endsWith('.pdf');

  if (!mimeOk && !extOk) {
    errors.push('Only PDF files are allowed');
  }

  return errors;
}

/**
 * Validate a single AI-generated question object.
 * Returns { valid: boolean, errors: string[] }
 */
function validateQuestion(q, index, sourceType = 'topic') {
  const errors = [];
  const prefix = `Question ${index + 1}`;

  // question text
  if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 5) {
    errors.push(`${prefix}: missing or too short question text`);
  }

  // options
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    errors.push(`${prefix}: must have exactly 4 options`);
  } else {
    // no empty options
    const emptyOpts = q.options.filter(o => !o || typeof o !== 'string' || o.trim().length === 0);
    if (emptyOpts.length > 0) {
      errors.push(`${prefix}: has empty option(s)`);
    }

    // no duplicate options (case-insensitive, trimmed)
    const normalized = q.options.map(o => (o || '').trim().toLowerCase());
    const unique = new Set(normalized);
    if (unique.size !== 4) {
      errors.push(`${prefix}: has duplicate options`);
    }
  }

  // correctOption
  if (typeof q.correctOption !== 'number' || !Number.isInteger(q.correctOption) || q.correctOption < 0 || q.correctOption > 3) {
    errors.push(`${prefix}: correctOption must be an integer 0-3`);
  }

  // correct answer must exist in options
  if (Array.isArray(q.options) && q.options.length === 4 && typeof q.correctOption === 'number') {
    if (!q.options[q.correctOption] || q.options[q.correctOption].trim().length === 0) {
      errors.push(`${prefix}: correct option is empty`);
    }
  }

  // explanation
  if (!q.explanation || typeof q.explanation !== 'string' || q.explanation.trim().length < 3) {
    errors.push(`${prefix}: missing or too short explanation`);
  }

  // difficulty
  if (!q.difficulty || !ALLOWED_DIFFICULTIES.includes(q.difficulty)) {
    errors.push(`${prefix}: invalid difficulty "${q.difficulty}"`);
  }

  // conceptKey
  if (!q.conceptKey || typeof q.conceptKey !== 'string' || q.conceptKey.trim().length < 2) {
    errors.push(`${prefix}: missing conceptKey`);
  }

  // Graceful hint fallback
  if (!q.hint && q.explanation) {
    q.hint = 'Key clue: ' + (q.conceptKey ? q.conceptKey.replace(/_/g, ' ') : 'Focus on the core concept');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the complete AI response JSON structure.
 * Returns { valid: boolean, questions: object[], errors: string[] }
 */
function validateAiResponse(responseText, expectedCount, sourceType = 'topic') {
  const errors = [];
  let parsed;

  // Try to parse JSON
  try {
    // Strip markdown code fences if AI includes them despite instructions
    let cleaned = responseText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return { valid: false, questions: [], errors: ['AI response is not valid JSON'] };
  }

  // Must have questions array
  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    return { valid: false, questions: [], errors: ['AI response missing "questions" array'] };
  }

  const validQuestions = [];

  for (let i = 0; i < parsed.questions.length; i++) {
    const result = validateQuestion(parsed.questions[i], i, sourceType);
    if (result.valid) {
      validQuestions.push(parsed.questions[i]);
    } else {
      errors.push(...result.errors);
    }
  }

  // Check for duplicate conceptKeys within the batch
  const conceptKeys = validQuestions.map(q => q.conceptKey.trim().toLowerCase());
  const conceptSet = new Set();
  const dedupedQuestions = [];
  for (let i = 0; i < validQuestions.length; i++) {
    const key = conceptKeys[i];
    if (!conceptSet.has(key)) {
      conceptSet.add(key);
      dedupedQuestions.push(validQuestions[i]);
    } else {
      errors.push(`Duplicate conceptKey "${key}" removed from batch`);
    }
  }

  return {
    valid: dedupedQuestions.length >= Math.max(1, Math.floor(expectedCount * 0.5)),
    questions: dedupedQuestions,
    errors,
  };
}

module.exports = {
  validateGenerateInput,
  validatePdfUpload,
  validateQuestion,
  validateAiResponse,
  ALLOWED_DIFFICULTIES,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  MAX_PDF_SIZE_BYTES,
};
