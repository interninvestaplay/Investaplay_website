const { query, connect } = require('../db/pool');
const { randomUUID } = require('crypto');
const { startGame, submitAnswer, getCurrentQuestion } = require('./game.service');

const aiProfiles = {
  Nova: { difficulty: 'easy', accuracy: 0.62, minMs: 5000, maxMs: 12000 },
  Astra: { difficulty: 'medium', accuracy: 0.72, minMs: 3500, maxMs: 9000 },
  Orion: { difficulty: 'hard', accuracy: 0.82, minMs: 2500, maxMs: 7000 },
  Zphry: { difficulty: 'hard', accuracy: 0.9, minMs: 1500, maxMs: 5000 },
};

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createAiRoomCode() {
  // AI rooms are never entered by their code, so use a large random space.
  // The database unique constraint remains the final guard against collisions.
  return `AI${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

async function ensureAiUser(botName = 'Nova') {
  const username = `AI_${botName}`;
  await query(
    `INSERT INTO users (id, username, display_name, role, is_guest)
     VALUES ($1, $2, $3, 'ai', TRUE)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
    [randomUUID(), username, botName]
  );
  const { rows } = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return rows[0];
}

async function createAiMatch({ userId, botName = 'Nova', category = null, questionLimit = 5, level = 1 }) {
  const profile = aiProfiles[botName] || aiProfiles.Nova;
  const aiUser = await ensureAiUser(botName);

  const game = await startGame({
    roomId: null,
    mode: 'ai',
    category: category || null,
    difficulty: profile.difficulty,
    questionLimit,
    level,
    aiBotName: botName,
    aiLevel: level,
    createdBy: userId,
  });

  await query(
    `INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers, fast_answers)
     VALUES ($1, $2, 0, 0, 0), ($1, $3, 0, 0, 0)`,
    [game.id, userId, aiUser.id]
  );

  return { room: null, game, aiUser, profile };
}

async function submitAiTurn(gameId, aiUserId, profile) {
  const question = await getCurrentQuestion(gameId);
  if (!question) return null;

  const correctAnswer = await query('SELECT correct_option, options FROM questions WHERE id = $1', [question.question_id]);
  const options = typeof correctAnswer.rows[0].options === 'string'
    ? JSON.parse(correctAnswer.rows[0].options)
    : correctAnswer.rows[0].options;
  const isCorrect = Math.random() <= profile.accuracy;
  const selectedOption = isCorrect
    ? correctAnswer.rows[0].correct_option
    : options.find((option) => option !== correctAnswer.rows[0].correct_option) || options[0];

  return submitAnswer({
    gameId,
    userId: aiUserId,
    questionId: question.question_id,
    selectedOption,
    answeredInMs: randomBetween(profile.minMs, profile.maxMs),
  });
}

module.exports = {
  aiProfiles,
  createAiMatch,
  submitAiTurn,
};
