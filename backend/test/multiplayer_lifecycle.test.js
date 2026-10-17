const test = require('node:test');
const assert = require('node:assert/strict');
const { query } = require('../src/db/pool');
const { randomUUID } = require('crypto');
const {
  recordPlayerDisconnection,
} = require('../src/services/rejoin.service');
const {
  togglePlayerReady,
  startRoomGame,
  getRoomSnapshot,
} = require('../src/services/room.service');
const {
  finishGame,
  getCurrentQuestion,
  startGame,
  advanceQuestion,
  submitAnswer,
} = require('../src/services/game.service');
const { getQuestion } = require('../src/controllers/game.controller');

test('Multiplayer Lifecycle: recordPlayerDisconnection handles null/missing roomId and inactive game without SQL errors', async () => {
  // Test 1: missing gameId or userId
  const res1 = await recordPlayerDisconnection(null, null, 'user-1', 0);
  assert.equal(res1.ok, false);
  assert.equal(res1.skipped, true);
  assert.equal(res1.reason, 'missing_ids');

  // Test 2: non-existent or inactive game
  const fakeGameId = randomUUID();
  const res2 = await recordPlayerDisconnection(fakeGameId, null, 'user-1', 0);
  assert.equal(res2.ok, false);
  assert.equal(res2.skipped, true);
  assert.equal(res2.reason, 'game_not_active');
});

test('Multiplayer Lifecycle: togglePlayerReady rejects in_game, completed, and closed rooms with status 400', async () => {
  const testRoomId = randomUUID();
  const testHostId = randomUUID();
  const testPlayerId = randomUUID();

  // Create users with required display_name
  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name)
     VALUES ($1, $2, $3, 'hash', 'Test Host'), ($4, $5, $6, 'hash', 'Test Player')`,
    [testHostId, `host_${Date.now()}`, `host_${Date.now()}@test.com`, testPlayerId, `p1_${Date.now()}`, `p1_${Date.now()}@test.com`]
  );

  // Test room in 'completed' state
  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players)
     VALUES ($1, $2, $3, 'Test Room', 'completed', 4)`,
    [testRoomId, `TC${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, testHostId]
  );
  await query(
    `INSERT INTO room_players (room_id, user_id, role, ready)
     VALUES ($1, $2, 'player', FALSE)`,
    [testRoomId, testPlayerId]
  );

  await assert.rejects(
    async () => {
      await togglePlayerReady(testRoomId, testPlayerId, true);
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Cannot change ready status when room is completed/);
      return true;
    }
  );

  // Test room in 'in_game' state
  await query('UPDATE rooms SET status = $1 WHERE id = $2', ['in_game', testRoomId]);
  await assert.rejects(
    async () => {
      await togglePlayerReady(testRoomId, testPlayerId, true);
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Cannot change ready status when room is (in_progress|in_game)/);
      return true;
    }
  );

  // Test room in 'cancelled' state
  await query('UPDATE rooms SET status = $1 WHERE id = $2', ['cancelled', testRoomId]);
  await assert.rejects(
    async () => {
      await togglePlayerReady(testRoomId, testPlayerId, true);
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Cannot change ready status when room is cancelled/);
      return true;
    }
  );
});

test('Multiplayer Lifecycle: finishGame is strictly idempotent and does not execute twice', async () => {
  const hostId = randomUUID();
  const playerId = randomUUID();
  const roomId = randomUUID();

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, coins)
     VALUES ($1, $2, $3, 'hash', 'Host User', 100), ($4, $5, $6, 'hash', 'Player User', 100)`,
    [hostId, `h_${Date.now()}`, `h_${Date.now()}@test.com`, playerId, `p_${Date.now()}`, `p_${Date.now()}@test.com`]
  );

  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players)
     VALUES ($1, $2, $3, 'Idempotent Room', 'waiting', 2)`,
    [roomId, `ID${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, hostId]
  );

  await query(
    `INSERT INTO room_players (room_id, user_id, role, ready)
     VALUES ($1, $2, 'host', TRUE), ($1, $3, 'player', TRUE)`,
    [roomId, hostId, playerId]
  );

  // Start game for this room
  const game = await startGame({
    roomId,
    mode: 'room',
    category: 'General',
    difficulty: 'easy',
    questionLimit: 2,
    createdBy: hostId,
  });

  // Verify game is active
  const beforeFinish = await query('SELECT status FROM games WHERE id = $1', [game.id]);
  assert.equal(beforeFinish.rows[0].status, 'active');

  // Call finishGame 1st time
  const lb1 = await finishGame(game.id);
  assert.ok(Array.isArray(lb1));

  const afterFinish1 = await query('SELECT status FROM games WHERE id = $1', [game.id]);
  assert.equal(afterFinish1.rows[0].status, 'completed');

  const roomAfterFinish1 = await query('SELECT status FROM rooms WHERE id = $1', [roomId]);
  assert.equal(roomAfterFinish1.rows[0].status, 'completed');

  // Record user stats/coins after first finish
  const userCoins1 = await query('SELECT coins FROM users WHERE id = $1', [hostId]);

  // Call finishGame 2nd time
  const lb2 = await finishGame(game.id);
  assert.ok(Array.isArray(lb2));

  // User coins must NOT have changed on duplicate finish!
  const userCoins2 = await query('SELECT coins FROM users WHERE id = $1', [hostId]);
  assert.equal(userCoins1.rows[0].coins, userCoins2.rows[0].coins);

  // Calling recordPlayerDisconnection on this now-completed game must skip safely
  const disconnectRes = await recordPlayerDisconnection(game.id, roomId, hostId, 0);
  assert.equal(disconnectRes.ok, false);
  assert.equal(disconnectRes.skipped, true);
  assert.equal(disconnectRes.reason, 'game_not_active');
});

test('Multiplayer Lifecycle: getRoomSnapshot synchronizes completed game and clears gameId', async () => {
  const hostId = randomUUID();
  const roomId = randomUUID();
  const gameId = randomUUID();

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name)
     VALUES ($1, $2, $3, 'hash', 'Snapshot Host')`,
    [hostId, `snap_${Date.now()}`, `snap_${Date.now()}@test.com`]
  );

  // Room marked in_game but with completed game
  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, active_game_id, max_players)
     VALUES ($1, $2, $3, 'Snapshot Room', 'in_game', $4, 2)`,
    [roomId, `SN${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, hostId, gameId]
  );
  await query(
    `INSERT INTO games (id, room_id, mode, status, created_by)
     VALUES ($1, $2, 'room', 'completed', $3)`,
    [gameId, roomId, hostId]
  );

  const snapshot = await getRoomSnapshot(roomId);
  assert.equal(snapshot.room.status, 'COMPLETED');
  assert.equal(snapshot.room.gameId, null);
  assert.equal(snapshot.room.active_game_id, null);
});

function callGetQuestion(gameId, userId) {
  return new Promise((resolve, reject) => {
    let capturedCode = 200;
    const mockReq = { params: { gameId }, user: { id: userId } };
    const mockRes = {
      status(code) { capturedCode = code; return this; },
      json(body) { resolve({ statusCode: capturedCode, body }); return this; },
    };
    getQuestion(mockReq, mockRes, reject);
  });
}

test('Multiplayer Lifecycle: REST getQuestion endpoint returns finished=true, leaderboard and statistics for completed game', async () => {
  const hostId = randomUUID();
  const playerId = randomUUID();
  const roomId = randomUUID();

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, coins)
     VALUES ($1, $2, $3, 'hash', 'REST Host', 100), ($4, $5, $6, 'hash', 'REST Client', 100)`,
    [hostId, `resth_${Date.now()}`, `resth_${Date.now()}@test.com`, playerId, `restc_${Date.now()}`, `restc_${Date.now()}@test.com`]
  );

  await query(
    `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players)
     VALUES ($1, $2, $3, 'REST Test Room', 'waiting', 2)`,
    [roomId, `RT${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, hostId]
  );

  await query(
    `INSERT INTO room_players (room_id, user_id, role, ready)
     VALUES ($1, $2, 'host', TRUE), ($1, $3, 'player', TRUE)`,
    [roomId, hostId, playerId]
  );

  const game = await startGame({
    roomId,
    mode: 'room',
    category: 'General',
    difficulty: 'easy',
    questionLimit: 1,
    createdBy: hostId,
  });

  // Finish the game
  await finishGame(game.id);

  // Simulate client requesting GET /api/games/:gameId/current-question
  const { statusCode, body } = await callGetQuestion(game.id, playerId);

  assert.equal(statusCode, 200);
  assert.ok(body !== null);
  assert.equal(body.finished, true);
  assert.equal(body.status, 'completed');
  assert.equal(body.gameId, game.id);
  assert.equal(body.roomId, roomId);
  assert.ok(Array.isArray(body.leaderboard));
  assert.ok(Array.isArray(body.statistics));
});

test('Multiplayer Lifecycle: 3-player and 4-player room games advance and complete synchronously', async () => {
  for (const playerCount of [3, 4]) {
    const hostId = randomUUID();
    const guestIds = Array.from({ length: playerCount - 1 }, () => randomUUID());
    const roomId = randomUUID();

    // Create users with coins for entry fee
    await query(
      `INSERT INTO users (id, username, email, password_hash, display_name, coins)
       VALUES ($1, $2, $3, 'hash', 'Multi Host', 500)`,
      [hostId, `mh_${playerCount}_${Date.now()}`, `mh_${playerCount}_${Date.now()}@test.com`]
    );

    for (let i = 0; i < guestIds.length; i++) {
      await query(
        `INSERT INTO users (id, username, email, password_hash, display_name, coins)
         VALUES ($1, $2, $3, 'hash', 'Guest ${i + 1}', 500)`,
        [guestIds[i], `mg_${playerCount}_${i}_${Date.now()}`, `mg_${playerCount}_${i}_${Date.now()}@test.com`]
      );
    }

    // Create room
    await query(
      `INSERT INTO rooms (id, code, host_user_id, room_name, status, max_players)
       VALUES ($1, $2, $3, '${playerCount}-Player Room', 'waiting', $4)`,
      [roomId, `MP${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, hostId, playerCount]
    );

    await query(
      `INSERT INTO room_players (room_id, user_id, role, ready)
       VALUES ($1, $2, 'host', TRUE)`,
      [roomId, hostId]
    );

    for (const gid of guestIds) {
      await query(
        `INSERT INTO room_players (room_id, user_id, role, ready)
         VALUES ($1, $2, 'player', TRUE)`,
        [roomId, gid]
      );
    }

    // Host starts room game
    const game = await startRoomGame(roomId, hostId);
    assert.ok(game.id);

    // Verify room snapshot for all players points to the same active game
    const initialSnapshot = await getRoomSnapshot(roomId);
    assert.equal(initialSnapshot.room.status, 'IN_PROGRESS');
    assert.equal(initialSnapshot.room.gameId, game.id);
    assert.equal(initialSnapshot.players.length, playerCount);

    // Advance to completion
    let currentAdv = await advanceQuestion(game.id);
    while (!currentAdv.finished) {
      currentAdv = await advanceQuestion(game.id);
    }

    assert.equal(currentAdv.finished, true);

    // Verify final state: room is completed, game is completed
    const finalSnapshot = await getRoomSnapshot(roomId);
    assert.equal(finalSnapshot.room.status, 'COMPLETED');
    assert.equal(finalSnapshot.room.gameId, null);

    // Verify REST current-question returns finished=true for any guest
    const { body: restResp } = await callGetQuestion(game.id, guestIds[0]);
    assert.equal(restResp.finished, true);
    assert.equal(restResp.status, 'completed');
    assert.equal(restResp.leaderboard.length, playerCount);
  }
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  await pool.end();
});
