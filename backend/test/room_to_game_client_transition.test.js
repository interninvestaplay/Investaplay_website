const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');
const { getCurrentQuestion } = require('../src/services/game.service');
const { getRoomSnapshot, togglePlayerReady, startRoomGame } = require('../src/services/room.service');
const gameController = require('../src/controllers/game.controller');

function callGetQuestion(gameId, userId) {
  return new Promise((resolve, reject) => {
    let capturedCode = 200;
    const mockReq = { params: { gameId }, user: { id: userId } };
    const mockRes = {
      status(code) { capturedCode = code; return this; },
      json(body) { resolve({ statusCode: capturedCode, body }); return this; },
    };
    gameController.getQuestion(mockReq, mockRes, (err) => {
      if (err) resolve({ statusCode: err.status || 500, error: err.message, body: null });
      else reject(new Error('next called without error'));
    });
  });
}

test('Room to Game Transition: Host and Client transition to the same active game and fetch current question', async () => {
  const hostId = randomUUID();
  const clientId = randomUUID();
  const roomId = randomUUID();

  // Create users
  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, coins, level)
     VALUES ($1, $2, $3, 'hash', $4, 1000, 1),
            ($5, $6, $7, 'hash', $8, 1000, 1)`,
    [
      hostId, `host_${hostId.slice(0, 6)}`, `host_${hostId.slice(0, 6)}@test.com`, 'Host Player',
      clientId, `client_${clientId.slice(0, 6)}`, `client_${clientId.slice(0, 6)}@test.com`, 'Client Player',
    ]
  );

  // Insert general category questions if needed
  await query(
    `INSERT INTO questions (id, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
     VALUES ($1, 'General', 'easy', 'Transition Test Q1?', '["Opt A", "Opt B", "Opt C", "Opt D"]', 'Opt A', 'Exp', 15)
     ON DUPLICATE KEY UPDATE prompt=VALUES(prompt)`,
    [randomUUID()]
  );

  // Create room
  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players, category, difficulty, question_limit)
     VALUES ($1, $2, $3, 'Friend Quiz Room', 'waiting', 2, 'General', 'easy', 5)`,
    [roomId, `TR${hostId.slice(0, 4).toUpperCase()}`, hostId]
  );

  // Add players
  await query(
    `INSERT INTO room_players (room_id, user_id, role, ready)
     VALUES ($1, $2, 'host', 1),
            ($1, $3, 'player', 0)`,
    [roomId, hostId, clientId]
  );

  // 1. Client toggles ready
  const readySnapshot = await togglePlayerReady(roomId, clientId, true);
  assert.equal(Boolean(readySnapshot.players.find(p => p.user_id === clientId)?.ready), true);

  // 2. Host starts the game
  const startedGame = await startRoomGame(roomId, hostId);
  assert.ok(startedGame?.id);
  const targetGameId = startedGame.id;

  // 3. Client polls GET /api/rooms/:roomId
  const clientRoomSnapshot = await getRoomSnapshot(roomId, clientId);
  assert.equal(clientRoomSnapshot.room.status, 'IN_PROGRESS');
  assert.equal(clientRoomSnapshot.room.active_game_id, targetGameId);
  assert.equal(clientRoomSnapshot.room.gameId, targetGameId);

  // 4. Host requests GET /api/games/:gameId/current-question
  const hostQuestion = await callGetQuestion(targetGameId, hostId);
  assert.equal(hostQuestion.statusCode, 200);
  assert.ok(hostQuestion.body?.question?.prompt);

  // 5. Client requests GET /api/games/:gameId/current-question
  const clientQuestion = await callGetQuestion(targetGameId, clientId);
  assert.equal(clientQuestion.statusCode, 200);
  assert.ok(clientQuestion.body?.question?.prompt);

  // 6. Verify Host and Client receive the exact same question
  assert.equal(hostQuestion.body.question.question_id, clientQuestion.body.question.question_id);
  assert.equal(hostQuestion.body.question.prompt, clientQuestion.body.question.prompt);
  assert.equal(hostQuestion.body.question.current_question_index, clientQuestion.body.question.current_question_index);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
