/**
 * Question pool service for Quick Quiz.
 *
 * Manages storing validated questions and retrieving from the pool.
 * Implements the "generate once, serve many" scalability pattern.
 */

const { randomUUID } = require('crypto');
const { query, connect } = require('../../../db/pool');
const { hashQuestion } = require('./duplicate.service');

/**
 * Store a batch of validated, de-duplicated questions into the question pool.
 * Uses a transaction to ensure atomicity.
 *
 * @param {object[]} questions - Validated question objects with _hash and _conceptKey
 * @param {object} source - Source metadata
 * @param {string} source.sourceType - 'topic' or 'pdf'
 * @param {string|null} source.topic
 * @param {string|null} source.sourceId
 * @param {string} source.difficulty
 * @returns {Promise<string[]>} Array of inserted question IDs
 */
/**
 * Shuffle 4 options randomly and re-map correctOption to letter A, B, C, or D.
 * Ensures an evenly distributed, unbiased answer key.
 */
function shuffleOptionsAndAssignLetter(q) {
  if (!Array.isArray(q.options) || q.options.length !== 4) return q;

  let correctIndex = -1;
  if (typeof q.correctOption === 'number') {
    correctIndex = q.correctOption;
  } else if (typeof q.correctOption === 'string') {
    const letters = ['A', 'B', 'C', 'D'];
    correctIndex = letters.indexOf(q.correctOption.toUpperCase());
    if (correctIndex < 0 && !isNaN(Number(q.correctOption))) {
      correctIndex = Number(q.correctOption);
    }
  }

  if (correctIndex < 0 || correctIndex >= q.options.length) {
    correctIndex = 0;
  }

  const correctAnswerText = q.options[correctIndex];

  // Fisher-Yates shuffle
  const shuffled = [...q.options];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const newIndex = shuffled.indexOf(correctAnswerText);
  const letters = ['A', 'B', 'C', 'D'];

  return {
    ...q,
    options: shuffled,
    correctOption: letters[newIndex] >= 'A' ? letters[newIndex] : 'A',
  };
}

async function storeQuestions(questions, source) {
  if (!questions || questions.length === 0) return [];

  const conn = await connect();
  const insertedIds = [];

  try {
    await conn.beginTransaction();

    for (const rawQ of questions) {
      const q = shuffleOptionsAndAssignLetter(rawQ);
      const id = randomUUID();
      const hash = q._hash || hashQuestion(q.question);
      const conceptKey = q._conceptKey || (q.conceptKey || '').trim().toLowerCase();

      try {
        await conn.query(
          `INSERT INTO quick_quiz_questions
            (id, source_id, source_type, topic, question_text, question_hash, concept_key,
             difficulty, option_a, option_b, option_c, option_d, correct_option,
             explanation, hint, source_page, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
          [
            id,
            source.sourceId || null,
            source.sourceType,
            source.topic || null,
            q.question.trim(),
            hash,
            conceptKey,
            q.difficulty || source.difficulty,
            q.options[0],
            q.options[1],
            q.options[2],
            q.options[3],
            q.correctOption,
            q.explanation || null,
            q.hint || null,
            q.sourcePage || null,
          ]
        );

        // Mirror into primary questions table for multiplayer & room support
        try {
          const cat = String(source.topic || 'Quick Quiz AI').slice(0, 80);
          const diff = ['easy', 'medium', 'hard'].includes(String(q.difficulty || source.difficulty).toLowerCase())
            ? String(q.difficulty || source.difficulty).toLowerCase()
            : 'medium';
          await conn.query(
            `INSERT INTO questions
              (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds, created_at)
             VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 15, NOW())
             ON DUPLICATE KEY UPDATE prompt = VALUES(prompt)`,
            [
              id,
              cat,
              diff,
              q.question.trim(),
              JSON.stringify(q.options),
              q.correctOption,
              q.explanation || null,
            ]
          );
        } catch (mirrorErr) {
          // Non-critical mirror failure shouldn't abort pool insertion
        }

        insertedIds.push(id);
      } catch (err) {
        // Duplicate hash (unique constraint) — skip silently
        if (err.code === 'ER_DUP_ENTRY' || (err.errno && err.errno === 1062)) {
          console.log(`[QuickQuiz] Skipped duplicate question (hash collision): ${hash.slice(0, 12)}...`);
          continue;
        }
        throw err;
      }
    }

    await conn.commit();
    return insertedIds;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Retrieve questions from the pool for a quiz session.
 * Prefers unseen questions for the user, falls back to any matching question.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.sourceType
 * @param {string|null} params.topic
 * @param {string|null} params.sourceId
 * @param {string} params.difficulty
 * @param {number} params.count
 * @param {Set<string>} [params.seenIds] - Question IDs the user has already seen
 * @returns {Promise<object[]>}
 */
async function getPoolQuestions({ userId, sourceType, topic, sourceId, difficulty, count, seenIds }) {
  // Build WHERE clause dynamically
  let sql = `
    SELECT id, question_text, option_a, option_b, option_c, option_d,
           correct_option, explanation, difficulty, concept_key, source_page
    FROM quick_quiz_questions
    WHERE source_type = $1 AND difficulty = $2
  `;
  const params = [sourceType, difficulty];
  let paramIdx = 3;

  if (sourceType === 'topic' && topic) {
    sql += ` AND topic = $${paramIdx}`;
    params.push(topic);
    paramIdx++;
  }
  if (sourceType === 'pdf' && sourceId) {
    sql += ` AND source_id = $${paramIdx}`;
    params.push(sourceId);
    paramIdx++;
  }

  // Exclude seen questions if possible (prefer unseen)
  const seenArray = seenIds ? Array.from(seenIds) : [];

  if (seenArray.length > 0 && seenArray.length < 500) {
    // First try to get unseen questions
    const unseenSql = sql + ` AND id NOT IN (${seenArray.map((_, i) => `$${paramIdx + i}`).join(',')}) ORDER BY RAND() LIMIT $${paramIdx + seenArray.length}`;
    const unseenParams = [...params, ...seenArray, count];

    const { rows: unseenRows } = await query(unseenSql, unseenParams);

    if (unseenRows.length >= count) {
      return unseenRows.map(formatPoolQuestion);
    }

    // Not enough unseen — supplement with seen questions
    const remaining = count - unseenRows.length;
    const seenSql = sql + ` AND id IN (${seenArray.map((_, i) => `$${paramIdx + i}`).join(',')}) ORDER BY RAND() LIMIT $${paramIdx + seenArray.length}`;
    const seenParams = [...params, ...seenArray, remaining];
    const { rows: seenRows } = await query(seenSql, seenParams);

    return [...unseenRows, ...seenRows].map(formatPoolQuestion);
  }

  // No user history or simple case
  sql += ` ORDER BY RAND() LIMIT $${paramIdx}`;
  params.push(count);

  const { rows } = await query(sql, params);
  return rows.map(formatPoolQuestion);
}

/**
 * Count available questions in the pool for given criteria.
 */
async function countPoolQuestions({ sourceType, topic, sourceId, difficulty }) {
  let sql = 'SELECT COUNT(*) as cnt FROM quick_quiz_questions WHERE source_type = $1 AND difficulty = $2';
  const params = [sourceType, difficulty];
  let idx = 3;

  if (sourceType === 'topic' && topic) {
    sql += ` AND topic = $${idx}`;
    params.push(topic);
    idx++;
  }
  if (sourceType === 'pdf' && sourceId) {
    sql += ` AND source_id = $${idx}`;
    params.push(sourceId);
    idx++;
  }

  const { rows } = await query(sql, params);
  return Number(rows[0]?.cnt || 0);
}

/**
 * Create a Quick Quiz source record.
 */
async function createSource({ userId, sourceType, topic, fileName, filePath }) {
  const id = randomUUID();
  await query(
    `INSERT INTO quick_quiz_sources (id, user_id, source_type, topic, file_name, file_path, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [id, userId, sourceType, topic || null, fileName || null, filePath || null]
  );
  return id;
}

/**
 * Create a Quick Quiz session.
 */
async function createSession({ userId, sourceType, sourceId, topic, difficulty, questionCount }) {
  const id = randomUUID();
  await query(
    `INSERT INTO quick_quiz_sessions
      (id, user_id, source_type, source_id, topic, difficulty, question_count, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())`,
    [id, userId, sourceType, sourceId || null, topic || null, difficulty, questionCount]
  );
  return id;
}

/**
 * Link questions to a session (session_questions join table).
 */
async function linkSessionQuestions(sessionId, questionIds) {
  for (let i = 0; i < questionIds.length; i++) {
    const id = randomUUID();
    await query(
      `INSERT INTO quick_quiz_session_questions (id, session_id, question_id, question_order)
       VALUES ($1, $2, $3, $4)`,
      [id, sessionId, questionIds[i], i + 1]
    );
  }
}

/**
 * Get a session with its questions.
 */
async function getSessionWithQuestions(sessionId, userId) {
  const { rows: sessions } = await query(
    'SELECT * FROM quick_quiz_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId]
  );

  if (sessions.length === 0) return null;

  const session = sessions[0];
  const { rows: questions } = await query(
    `SELECT qqsq.question_order, qqq.*
     FROM quick_quiz_session_questions qqsq
     JOIN quick_quiz_questions qqq ON qqq.id = qqsq.question_id
     WHERE qqsq.session_id = $1
     ORDER BY qqsq.question_order ASC`,
    [sessionId]
  );

  return { session, questions: questions.map(formatPoolQuestion) };
}

/**
 * Complete a session and record results.
 */
async function completeSession(sessionId, userId, results) {
  const conn = await connect();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE quick_quiz_sessions SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );

    // Record user history for each question answered
    if (results && Array.isArray(results.answers)) {
      for (const answer of results.answers) {
        const histId = randomUUID();
        try {
          await conn.query(
            `INSERT IGNORE INTO quick_quiz_user_history (id, user_id, question_id, session_id, answered_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [histId, userId, answer.questionId, sessionId]
          );
        } catch {
          // ignore duplicates
        }
      }
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Format a pool question row into a client-friendly shape.
 */
function formatPoolQuestion(row) {
  return {
    id: row.id,
    question: row.question_text,
    options: [row.option_a, row.option_b, row.option_c, row.option_d],
    correctOption: row.correct_option,
    explanation: row.explanation,
    hint: row.hint || null,
    difficulty: row.difficulty,
    conceptKey: row.concept_key,
    sourcePage: row.source_page || null,
    order: row.question_order || undefined,
  };
}

/**
 * Ensure questions are mirrored into the primary questions table so rooms and matches can use them.
 */
async function syncQuestionsToMainTable(questions, defaultCategory = 'Quick Quiz AI') {
  if (!questions || !Array.isArray(questions) || questions.length === 0) return;
  for (const q of questions) {
    const cat = String(q.topic || defaultCategory).slice(0, 80);
    const diff = ['easy', 'medium', 'hard'].includes(String(q.difficulty).toLowerCase())
      ? String(q.difficulty).toLowerCase()
      : 'medium';
    const options = Array.isArray(q.options)
      ? q.options
      : [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
    const optionsJson = JSON.stringify(options);
    const prompt = (q.question || q.question_text || '').trim();
    const correctOpt = q.correctOption || q.correct_option || 'A';
    const explanation = q.explanation || null;

    try {
      await query(
        `INSERT INTO questions (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds, created_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 15, NOW())
         ON DUPLICATE KEY UPDATE prompt = VALUES(prompt)`,
        [q.id, cat, diff, prompt, optionsJson, correctOpt, explanation]
      );
    } catch (err) {
      // Non-critical
    }
  }
}

module.exports = {
  storeQuestions,
  getPoolQuestions,
  countPoolQuestions,
  createSource,
  createSession,
  linkSessionQuestions,
  getSessionWithQuestions,
  completeSession,
  syncQuestionsToMainTable,
};
