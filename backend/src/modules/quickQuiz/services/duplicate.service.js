/**
 * Duplicate detection service for Quick Quiz questions.
 *
 * Level 1 — Exact duplicate detection via normalized hash.
 * Level 2 — Concept duplicate detection via concept_key.
 * Level 3 — User history tracking (has user seen this question before?).
 */

const crypto = require('crypto');
const { query } = require('../../../db/pool');

/**
 * Normalize a question string for consistent hashing.
 * Lowercase → trim → collapse whitespace → remove punctuation noise.
 */
function normalizeQuestion(text) {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, ' ')        // collapse whitespace
    .replace(/[''`]/g, "'")        // normalize quotes
    .replace(/[""]/g, '"')         // normalize double quotes
    .replace(/[^\w\s'"?.-]/g, '')  // remove non-essential punctuation
    .trim();
}

/**
 * Generate a SHA-256 hash of a normalized question.
 */
function hashQuestion(questionText) {
  const normalized = normalizeQuestion(questionText);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Check for exact duplicate questions in the database.
 * @param {string} questionHash
 * @returns {Promise<boolean>} true if duplicate exists
 */
async function isExactDuplicate(questionHash) {
  const { rows } = await query(
    'SELECT id FROM quick_quiz_questions WHERE question_hash = $1 LIMIT 1',
    [questionHash]
  );
  return rows.length > 0;
}

/**
 * Check if a concept key already exists for a given topic/source.
 * This prevents the AI from generating different questions that test the same concept.
 * @param {string} conceptKey
 * @param {string} sourceType - 'topic' or 'pdf'
 * @param {string|null} topic
 * @param {string|null} sourceId
 * @returns {Promise<boolean>} true if concept already exists
 */
async function isConceptDuplicate(conceptKey, sourceType, topic, sourceId) {
  const normalizedKey = (conceptKey || '').trim().toLowerCase();

  if (sourceType === 'topic' && topic) {
    const { rows } = await query(
      'SELECT id FROM quick_quiz_questions WHERE concept_key = $1 AND source_type = $2 AND topic = $3 LIMIT 1',
      [normalizedKey, 'topic', topic]
    );
    return rows.length > 0;
  }

  if (sourceType === 'pdf' && sourceId) {
    const { rows } = await query(
      'SELECT id FROM quick_quiz_questions WHERE concept_key = $1 AND source_id = $2 LIMIT 1',
      [normalizedKey, sourceId]
    );
    return rows.length > 0;
  }

  return false;
}

/**
 * Check if a user has already been served a specific question.
 * @param {string} userId
 * @param {string} questionId
 * @returns {Promise<boolean>}
 */
async function hasUserSeenQuestion(userId, questionId) {
  const { rows } = await query(
    'SELECT id FROM quick_quiz_user_history WHERE user_id = $1 AND question_id = $2 LIMIT 1',
    [userId, questionId]
  );
  return rows.length > 0;
}

/**
 * Get all question IDs a user has already seen for a given topic/source.
 * Used to prefer unseen questions from the pool.
 * @param {string} userId
 * @param {string} sourceType
 * @param {string|null} topic
 * @returns {Promise<Set<string>>}
 */
async function getUserSeenQuestionIds(userId, sourceType, topic) {
  let sql = `
    SELECT qquh.question_id
    FROM quick_quiz_user_history qquh
    JOIN quick_quiz_questions qqq ON qqq.id = qquh.question_id
    WHERE qquh.user_id = $1 AND qqq.source_type = $2
  `;
  const params = [userId, sourceType];

  if (topic) {
    sql += ' AND qqq.topic = $3';
    params.push(topic);
  }

  const { rows } = await query(sql, params);
  return new Set(rows.map(r => r.question_id));
}

/**
 * Record that a user has been served a question.
 * @param {string} userId
 * @param {string} questionId
 * @param {string} sessionId
 */
async function recordUserQuestion(userId, questionId, sessionId) {
  const { randomUUID } = require('crypto');
  try {
    await query(
      `INSERT IGNORE INTO quick_quiz_user_history (id, user_id, question_id, session_id, answered_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), userId, questionId, sessionId]
    );
  } catch {
    // Ignore duplicate inserts
  }
}

/**
 * Filter a batch of validated questions, removing duplicates.
 * Returns only questions that pass all duplicate checks.
 *
 * @param {object[]} questions - Validated question objects
 * @param {string} sourceType
 * @param {string|null} topic
 * @param {string|null} sourceId
 * @returns {Promise<{ accepted: object[], rejected: object[] }>}
 */
async function filterDuplicates(questions, sourceType, topic, sourceId) {
  const accepted = [];
  const rejected = [];
  const batchConceptKeys = new Set();

  for (const q of questions) {
    const hash = hashQuestion(q.question);
    const conceptKey = (q.conceptKey || '').trim().toLowerCase();

    // Level 1: Exact duplicate
    if (await isExactDuplicate(hash)) {
      rejected.push({ ...q, rejectReason: 'exact_duplicate' });
      continue;
    }

    // Level 2: Concept duplicate (database)
    if (await isConceptDuplicate(conceptKey, sourceType, topic, sourceId)) {
      rejected.push({ ...q, rejectReason: 'concept_duplicate_db' });
      continue;
    }

    // Level 2b: Concept duplicate (within this batch)
    if (batchConceptKeys.has(conceptKey)) {
      rejected.push({ ...q, rejectReason: 'concept_duplicate_batch' });
      continue;
    }

    batchConceptKeys.add(conceptKey);
    accepted.push({ ...q, _hash: hash, _conceptKey: conceptKey });
  }

  return { accepted, rejected };
}

module.exports = {
  normalizeQuestion,
  hashQuestion,
  isExactDuplicate,
  isConceptDuplicate,
  hasUserSeenQuestion,
  getUserSeenQuestionIds,
  recordUserQuestion,
  filterDuplicates,
};
