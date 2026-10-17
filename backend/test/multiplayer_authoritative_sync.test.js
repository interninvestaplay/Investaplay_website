const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');
const { getCurrentQuestion, submitAnswer, calculateAnswerCorrectness } = require('../src/services/game.service');
const { togglePlayerReady, startRoomGame } = require('../src/services/room.service');
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

function callPostAnswer(gameId, userId, payload) {
  return new Promise((resolve, reject) => {
    let capturedCode = 200;
    const mockReq = { params: { gameId }, user: { id: userId }, body: payload };
    const mockRes = {
      status(code) { capturedCode = code; return this; },
      json(body) { resolve({ statusCode: capturedCode, body }); return this; },
    };
    gameController.postAnswer(mockReq, mockRes, (err) => {
      if (err) {
        console.error('DEBUG callPostAnswer err:', err.message, err.stack);
        resolve({ statusCode: err.status || 500, error: err.message, body: null });
      }
      else reject(new Error('next called without error'));
    });
  });
}

test('Multiplayer Authoritative Sync & Answer Validation Test Suite', async (t) => {
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

  // Ensure at least 5 questions in General category exist
  for (let i = 0; i < 5; i++) {
    await query(
      `INSERT INTO questions (id, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
       VALUES ($1, 'General', 'easy', $2, '["Option A", "Option B", "Option C", "Option D"]', 'Option A', 'Exp', 15)
       ON DUPLICATE KEY UPDATE prompt=VALUES(prompt)`,
      [randomUUID(), `Sync Question ${i + 1}?`]
    );
  }

  // Create room with category General
  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players, category, difficulty, question_limit)
     VALUES ($1, $2, $3, 'Sync Test Room', 'waiting', 2, 'General', 'easy', 5)`,
    [roomId, `SY${hostId.slice(0, 4).toUpperCase()}`, hostId]
  );

  await query(
    `INSERT INTO room_players (room_id, user_id, role, ready)
     VALUES ($1, $2, 'host', 1),
            ($1, $3, 'player', 0)`,
    [roomId, hostId, clientId]
  );

  // Ready and Start
  await togglePlayerReady(roomId, clientId, true);
  const startedGame = await startRoomGame(roomId, hostId);
  const gameId = startedGame.id;

  // Retrieve the questions generated for this game
  const { rows: gameQRows } = await query(
    'SELECT question_id, sort_order FROM game_questions WHERE game_id = $1 ORDER BY sort_order ASC',
    [gameId]
  );
  assert.ok(gameQRows.length >= 5, 'Should have at least 5 questions in the game');
  const qIds = gameQRows.map((r) => r.question_id);

  // Fetch the question details
  const { rows: qDetails } = await query(
    `SELECT id, prompt, options, correct_option FROM questions WHERE id IN (${qIds.map((_, i) => `$${i + 1}`).join(',')})`,
    qIds
  );
  const qMap = new Map(qDetails.map((q) => [q.id, q]));

  await t.test('1. Both players receive exactly the same Q1 with no correctAnswer leaked', async () => {
    const hostQ = await callGetQuestion(gameId, hostId);
    const clientQ = await callGetQuestion(gameId, clientId);

    assert.equal(hostQ.statusCode, 200);
    assert.equal(clientQ.statusCode, 200);

    // Identical questionId and questionIndex
    assert.equal(hostQ.body.questionIndex, 0);
    assert.equal(clientQ.body.questionIndex, 0);
    assert.equal(hostQ.body.questionId, qIds[0]);
    assert.equal(clientQ.body.questionId, qIds[0]);
    assert.equal(hostQ.body.question.question_id, clientQ.body.question.question_id);

    // Strict security check: correct_option is NOT exposed to clients during active question
    assert.equal(hostQ.body.question.correct_option, undefined);
    assert.equal(clientQ.body.question.correct_option, undefined);
    assert.equal(hostQ.body.question.correctOption, undefined);
    assert.equal(clientQ.body.question.correctOption, undefined);
  });

  await t.test('2 & 5. Simultaneous answers: Both select correct answer, atomic advance 0 -> 1 exactly once', async () => {
    const q1 = qMap.get(qIds[0]);
    const correctOpt = q1.correct_option;

    // Both players answer Q1 simultaneously with the correct option
    const [resHost, resClient] = await Promise.all([
      callPostAnswer(gameId, hostId, { questionId: qIds[0], selectedOption: correctOpt, answeredInMs: 1200 }),
      callPostAnswer(gameId, clientId, { questionId: qIds[0], selectedOption: correctOpt, answeredInMs: 1300 }),
    ]);

    assert.equal(resHost.statusCode, 201);
    assert.equal(resClient.statusCode, 201);

    // Both are recorded as correct
    assert.equal(resHost.body.answer.is_correct, true);
    assert.equal(resClient.body.answer.is_correct, true);

    // Exactly one of them triggered the advance
    const advanceFlags = [Boolean(resHost.body.answer.advanceResult?.advanced), Boolean(resClient.body.answer.advanceResult?.advanced)];
    assert.equal(advanceFlags.filter(Boolean).length, 1, 'Only one response should trigger the advance');

    // Current question in DB must be exactly index 1 (Q2)
    const currentQ = await getCurrentQuestion(gameId);
    assert.equal(currentQ.current_question_index, 1);
    assert.equal(currentQ.question_id, qIds[1]);
  });

  await t.test('3 & 6. Player A answers first, Player B after a delay; both wrong answers', async () => {
    const q2 = qMap.get(qIds[1]);
    const wrongOpt = 'Definite Wrong Answer';

    // Host answers first with wrong option
    const hostAns = await callPostAnswer(gameId, hostId, { questionId: qIds[1], selectedOption: wrongOpt, answeredInMs: 1500 });
    assert.equal(hostAns.statusCode, 201);
    assert.equal(hostAns.body.answer.is_correct, false);
    assert.equal(hostAns.body.answer.advanceResult?.advanced, undefined);

    // Game has NOT advanced yet (still on Q2)
    let midCheck = await getCurrentQuestion(gameId);
    assert.equal(midCheck.current_question_index, 1);

    // Client answers after delay with wrong option
    const clientAns = await callPostAnswer(gameId, clientId, { questionId: qIds[1], selectedOption: wrongOpt, answeredInMs: 2500 });
    assert.equal(clientAns.statusCode, 201);
    assert.equal(clientAns.body.answer.is_correct, false);
    assert.equal(clientAns.body.answer.advanceResult?.advanced, true);
    assert.equal(clientAns.body.answer.advanceResult?.newIndex, 2);

    // Game advanced to index 2 (Q3)
    const postCheck = await getCurrentQuestion(gameId);
    assert.equal(postCheck.current_question_index, 2);
    assert.equal(postCheck.question_id, qIds[2]);
  });

  await t.test('4 & 7. Player B answers first, Player A after delay; One correct + One wrong', async () => {
    const q3 = qMap.get(qIds[2]);
    const correctOpt = q3.correct_option;
    const wrongOpt = 'Another Wrong Option';

    // Client answers first with correct answer
    const clientAns = await callPostAnswer(gameId, clientId, { questionId: qIds[2], selectedOption: correctOpt, answeredInMs: 1100 });
    assert.equal(clientAns.statusCode, 201);
    assert.equal(clientAns.body.answer.is_correct, true);
    assert.equal(clientAns.body.answer.advanceResult?.advanced, undefined);

    // Host answers second with wrong answer
    const hostAns = await callPostAnswer(gameId, hostId, { questionId: qIds[2], selectedOption: wrongOpt, answeredInMs: 3000 });
    assert.equal(hostAns.statusCode, 201);
    assert.equal(hostAns.body.answer.is_correct, false);
    assert.equal(hostAns.body.answer.advanceResult?.advanced, true);
    assert.equal(hostAns.body.answer.advanceResult?.newIndex, 3);

    // Game advanced to index 3 (Q4)
    const postCheck = await getCurrentQuestion(gameId);
    assert.equal(postCheck.current_question_index, 3);
    assert.equal(postCheck.question_id, qIds[3]);
  });

  await t.test('8. Duplicate answer submission is idempotent', async () => {
    const q4 = qMap.get(qIds[3]);
    const correctOpt = q4.correct_option;

    // Host submits an answer
    const firstAns = await submitAnswer(gameId, hostId, { questionId: qIds[3], selectedOption: correctOpt, answeredInMs: 1500 });
    assert.equal(Boolean(firstAns.is_correct), true);

    // Host submits the EXACT same answer again
    const dupAns = await submitAnswer(gameId, hostId, { questionId: qIds[3], selectedOption: correctOpt, answeredInMs: 1500 });
    assert.equal(dupAns.duplicate, true);
    assert.equal(Boolean(dupAns.is_correct), true);

    // Verify it did NOT add duplicate answers to the database
    const { rows: ansRows } = await query(
      'SELECT COUNT(*) as count FROM answers WHERE game_id = $1 AND user_id = $2 AND question_id = $3',
      [gameId, hostId, qIds[3]]
    );
    assert.equal(Number(ansRows[0].count), 1);
  });

  await t.test('10 & 11. Sequential progression: Q1 -> Q2 -> Q3 -> Q4 -> Q5 with no skipped or duplicated questions', async () => {
    const q4 = qMap.get(qIds[3]);
    // Client answers Q4
    const clientAns = await submitAnswer(gameId, clientId, { questionId: qIds[3], selectedOption: q4.correct_option, answeredInMs: 2000 });
    assert.equal(clientAns.advanceResult?.advanced, true);
    assert.equal(clientAns.advanceResult?.newIndex, 4);

    // Both players request Q5
    const hostQ = await callGetQuestion(gameId, hostId);
    const clientQ = await callGetQuestion(gameId, clientId);

    assert.equal(hostQ.body.questionIndex, 4);
    assert.equal(clientQ.body.questionIndex, 4);
    assert.equal(hostQ.body.questionId, qIds[4]);
    assert.equal(clientQ.body.questionId, qIds[4]);
  });

  await t.test('12. Late answer for an expired question is rejected without changing current state', async () => {
    // Create a 3rd player in this game who never answered Q1
    const latePlayerId = randomUUID();
    await query(
      `INSERT INTO users (id, username, email, password_hash, display_name, coins, level)
       VALUES ($1, $2, $3, 'hash', 'Late Player', 1000, 1)`,
      [latePlayerId, `late_${latePlayerId.slice(0, 6)}`, `late_${latePlayerId.slice(0, 6)}@test.com`]
    );
    await query(
      `INSERT INTO room_players (room_id, user_id, role, ready) VALUES ($1, $2, 'player', 1)`,
      [roomId, latePlayerId]
    );

    // Late player submits an answer for Q1 after it has expired. The service
    // deliberately protects authoritative progression by rejecting it.
    const q1 = qMap.get(qIds[0]);
    await assert.rejects(
      () => submitAnswer(gameId, latePlayerId, {
        questionId: qIds[0], selectedOption: q1.correct_option, answeredInMs: 5000,
      }),
      /Question has expired or is not active/
    );

    // Crucially: late submission must NOT disrupt current question index (remains 4)
    const currentQ = await getCurrentQuestion(gameId);
    assert.equal(currentQ.current_question_index, 4);
  });

  await t.test('Answer correctness handles option text, letter, and index mappings symmetrically', async () => {
    const options = ['Paris', 'London', 'Berlin', 'Madrid'];

    // DB has option text 'Paris'
    assert.equal(calculateAnswerCorrectness(options, 'Paris', 'Paris'), true);
    assert.equal(calculateAnswerCorrectness(options, 'Paris', 'paris'), true);
    assert.equal(calculateAnswerCorrectness(options, 'Paris', 'A'), true);
    assert.equal(calculateAnswerCorrectness(options, 'Paris', '0'), true);
    assert.equal(calculateAnswerCorrectness(options, 'Paris', 'London'), false);
    assert.equal(calculateAnswerCorrectness(options, 'Paris', 'B'), false);

    // DB has letter 'B' (which corresponds to 'London')
    assert.equal(calculateAnswerCorrectness(options, 'B', 'London'), true);
    assert.equal(calculateAnswerCorrectness(options, 'B', 'london'), true);
    assert.equal(calculateAnswerCorrectness(options, 'B', 'B'), true);
    assert.equal(calculateAnswerCorrectness(options, 'B', 'b'), true);
    assert.equal(calculateAnswerCorrectness(options, 'B', '1'), true);
    assert.equal(calculateAnswerCorrectness(options, 'B', 'Paris'), false);

    // DB has index '2' (which corresponds to 'Berlin')
    assert.equal(calculateAnswerCorrectness(options, '2', 'Berlin'), true);
    assert.equal(calculateAnswerCorrectness(options, '2', 'C'), true);
    assert.equal(calculateAnswerCorrectness(options, '2', '2'), true);
    assert.equal(calculateAnswerCorrectness(options, '2', 'Madrid'), false);
  });
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
