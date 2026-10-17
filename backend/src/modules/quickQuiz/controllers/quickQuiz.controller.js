/**
 * Quick Quiz Controller — HTTP request handlers.
 *
 * All business logic is delegated to services.
 * This layer only handles request/response formatting and error translation.
 */

const { generateTopicQuiz, generatePdfQuiz } = require('../services/aiQuiz.service');
const { getSessionWithQuestions, completeSession, syncQuestionsToMainTable } = require('../services/question.service');
const { validateGenerateInput, validatePdfUpload } = require('../validators/quickQuiz.validator');
const challengeService = require('../../../services/challenge.service');
const { isUserOnline, getOnlineUsers } = require('../../../sockets/index');
const { query } = require('../../../db/pool');

/**
 * POST /api/quick-quiz/generate
 * Generate a topic-based Quick Quiz.
 */
async function generateQuiz(req, res) {
  try {
    const topic = req.body.topic;
    const difficulty = req.body.difficulty || 'medium';
    const questionCount = req.body.questionCount || 5;
    const sourceType = req.body.sourceType || 'topic';
    const userId = req.user.id;

    // Validate input
    const errors = validateGenerateInput({ sourceType, topic, difficulty, questionCount });
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid input', details: errors });
    }

    if (sourceType !== 'topic') {
      return res.status(400).json({ error: 'Use /api/quick-quiz/upload-pdf for PDF-based quizzes' });
    }

    const result = await generateTopicQuiz({
      userId,
      topic,
      difficulty,
      questionCount: Number(questionCount),
    });

    return res.status(200).json({
      sessionId: result.sessionId,
      session: result.session,
      questions: result.questions,
      questionCount: result.questions.length,
    });
  } catch (err) {
    return handleQuizError(err, res);
  }
}

/**
 * POST /api/quick-quiz/upload-pdf
 * Upload a PDF and generate a quiz from it.
 */
async function uploadPdfAndGenerate(req, res) {
  try {
    const userId = req.user.id;

    // Validate file
    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const fileErrors = validatePdfUpload(req.file);
    if (fileErrors.length > 0) {
      return res.status(400).json({ error: 'Invalid file', details: fileErrors });
    }

    const { difficulty, questionCount } = req.body;
    const inputErrors = validateGenerateInput({
      sourceType: 'pdf',
      difficulty,
      questionCount,
    });
    if (inputErrors.length > 0) {
      return res.status(400).json({ error: 'Invalid input', details: inputErrors });
    }

    const result = await generatePdfQuiz({
      userId,
      filePath: req.file.path,
      fileName: req.file.originalname,
      difficulty,
      questionCount: Number(questionCount),
    });

    return res.status(200).json({
      sessionId: result.sessionId,
      session: result.session,
      questions: result.questions,
      questionCount: result.questions.length,
    });
  } catch (err) {
    return handleQuizError(err, res);
  }
}

/**
 * GET /api/quick-quiz/session/:id
 * Get a Quick Quiz session with its questions.
 */
async function getSession(req, res) {
  try {
    const userId = req.user.id;
    const sessionId = req.params.id;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const data = await getSessionWithQuestions(sessionId, userId);
    if (!data) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.status(200).json({
      session: {
        id: data.session.id,
        sourceType: data.session.source_type,
        topic: data.session.topic,
        difficulty: data.session.difficulty,
        questionCount: data.session.question_count,
        status: data.session.status,
        createdAt: data.session.created_at,
        completedAt: data.session.completed_at,
      },
      questions: data.questions,
    });
  } catch (err) {
    console.error('[QuickQuiz] getSession error:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve session' });
  }
}

/**
 * POST /api/quick-quiz/session/:id/complete
 * Mark a session as completed and record results.
 */
async function completeQuizSession(req, res) {
  try {
    const userId = req.user.id;
    const sessionId = req.params.id;
    const { answers, score, correctCount, totalQuestions } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    await completeSession(sessionId, userId, {
      answers: answers || [],
      score,
      correctCount,
      totalQuestions,
    });

    return res.status(200).json({
      success: true,
      message: 'Quiz completed successfully',
    });
  } catch (err) {
    console.error('[QuickQuiz] completeSession error:', err.message);
    return res.status(500).json({ error: 'Failed to complete session' });
  }
}

/**
 * GET /api/quick-quiz/online-players
 * Retrieve online players and candidates for 1v1 Quick Quiz challenge.
 */
async function getOnlinePlayers(req, res) {
  try {
    const currentUserId = req.user.id;
    const onlineSocketUsers = getOnlineUsers();
    const onlineUserMap = new Map();

    for (const u of onlineSocketUsers) {
      if (u && u.id && u.id !== currentUserId) {
        onlineUserMap.set(String(u.id), {
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.username,
          level: u.level || 1,
          score: (Number(u.level || 1) * 120 + 200),
          isOnline: true,
          avatarUrl: u.avatar_url || null,
        });
      }
    }

    // Also fetch players from DB so user always has players to challenge
    const { rows: dbUsers } = await query(
      `SELECT u.id, u.username, u.display_name, u.level, u.avatar_url,
              COALESCE(us.total_score, (u.level * 120 + 200)) AS score
       FROM users u
       LEFT JOIN user_stats us ON us.user_id = u.id
       WHERE u.id <> $1
         AND u.deleted_at IS NULL
         AND u.role = 'player'
       ORDER BY (CASE WHEN u.updated_at IS NOT NULL THEN u.updated_at ELSE u.created_at END) DESC
       LIMIT 25`,
      [currentUserId]
    );

    const candidates = [];
    const seenIds = new Set();

    // 1. First add real-time connected online users
    for (const onlinePlayer of onlineUserMap.values()) {
      candidates.push(onlinePlayer);
      seenIds.add(String(onlinePlayer.id));
    }

    // 2. Add DB players, marking isOnline based on socket presence
    for (const dbUser of dbUsers) {
      const sId = String(dbUser.id);
      if (!seenIds.has(sId)) {
        seenIds.add(sId);
        const online = isUserOnline(sId);
        candidates.push({
          id: dbUser.id,
          username: dbUser.username,
          displayName: dbUser.display_name || dbUser.username,
          level: dbUser.level || 1,
          score: Number(dbUser.score || 0),
          isOnline: online,
          avatarUrl: dbUser.avatar_url || null,
        });
      }
    }

    // Sort so online users are strictly on top
    candidates.sort((a, b) => {
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return (b.score || 0) - (a.score || 0);
    });

    return res.status(200).json({ players: candidates });
  } catch (err) {
    console.error('[QuickQuiz] getOnlinePlayers error:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve online players' });
  }
}

/**
 * POST /api/quick-quiz/challenge
 * Generate (or reuse) a Quick Quiz and challenge an online player with identical Play with Friend rules.
 */
async function createQuickQuizChallenge(req, res) {
  try {
    const currentUserId = req.user.id;
    const { targetUserId, sourceType = 'topic', topic, difficulty = 'medium', questionCount = 5, sessionId: existingSessionId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'Target player ID is required' });
    }
    if (String(targetUserId) === String(currentUserId)) {
      return res.status(400).json({ error: 'You cannot challenge yourself' });
    }

    let finalQuestions = [];
    let sessionId = existingSessionId;

    if (sessionId) {
      const data = await getSessionWithQuestions(sessionId, currentUserId);
      if (!data || !data.questions.length) {
        return res.status(404).json({ error: 'Quiz session not found' });
      }
      finalQuestions = data.questions;
      await syncQuestionsToMainTable(finalQuestions, topic || data.session.topic);
    } else {
      const cleanTopic = (topic || '').trim();
      if (!cleanTopic) {
        return res.status(400).json({ error: 'Topic is required to create a Quick Quiz challenge' });
      }
      const count = Number(questionCount) || 5;
      const result = await generateTopicQuiz({
        userId: currentUserId,
        topic: cleanTopic,
        difficulty,
        questionCount: count,
      });
      sessionId = result.sessionId;
      finalQuestions = result.questions;
      await syncQuestionsToMainTable(finalQuestions, cleanTopic);
    }

    const customQuestionIds = finalQuestions.map((q) => q.id);

    // Create 1v1 challenge with Play with Friend rules
    const challenge = await challengeService.createChallenge(req.user, {
      targetUserId,
      quizType: 'quick_quiz',
      topic: topic || 'Quick Quiz AI',
      difficulty,
      questionCount: finalQuestions.length,
      customQuestionIds,
      req,
    });

    return res.status(200).json({
      success: true,
      challenge,
      sessionId,
      questionCount: finalQuestions.length,
      questions: finalQuestions,
      message: 'Challenge created and sent successfully!',
    });
  } catch (err) {
    if (err.status === 409 || err.code === 'FRIEND_PAIR_BUSY') {
      return res.status(409).json({ error: err.message, code: 'FRIEND_PAIR_BUSY' });
    }
    return handleQuizError(err, res);
  }
}

/**
 * Translate service errors to user-friendly HTTP responses.
 */
function handleQuizError(err, res) {
  console.error(`[QuickQuiz] Error: ${err.message}`, err.code || '');

  const code = err.code || '';

  switch (code) {
    case 'RATE_LIMIT':
      return res.status(429).json({ error: err.message });
    case 'AUTH_FAILED':
    case 'PROVIDER_ERROR':
      return res.status(502).json({ error: 'AI service is temporarily unavailable. Please try again later.' });
    case 'TIMEOUT':
      return res.status(504).json({ error: err.message });
    case 'AI_GENERATION_FAILED':
    case 'ALL_DUPLICATES':
      return res.status(422).json({ error: err.message });
    case 'INSUFFICIENT_TEXT':
    case 'INVALID_PDF':
    case 'PDF_PARSE_ERROR':
    case 'FILE_NOT_FOUND':
      return res.status(400).json({ error: err.message });
    case 'PDF_PARSER_MISSING':
      return res.status(503).json({ error: 'PDF processing is temporarily unavailable.' });
    case 'NETWORK_ERROR':
    case 'EMPTY_RESPONSE':
      return res.status(502).json({ error: 'AI service communication error. Please try again.' });
    default:
      return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
}

module.exports = {
  generateQuiz,
  uploadPdfAndGenerate,
  getSession,
  completeQuizSession,
  getOnlinePlayers,
  createQuickQuizChallenge,
};

