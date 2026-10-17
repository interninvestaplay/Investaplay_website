const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');
const {
  createRoom,
  joinRoom,
  togglePlayerReady,
  startRoomGame,
  getRoomSnapshot,
} = require('../src/services/room.service');
const {
  recordPlayerDisconnection,
  canPlayerRejoin,
  rejoinGame,
  getRejoinGameState,
  getGameParticipants,
} = require('../src/services/rejoin.service');
const { submitAnswer, advanceQuestion, finishGame } = require('../src/services/game.service');

async function createTestUser(prefix = 'rejoin_user') {
  const id = randomUUID();
  const tag = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  const inviteCode = `INV${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, invite_code, coins, level)
     VALUES ($1, $2, $3, 'hash', $4, $5, 1000, 1)`,
    [id, tag, `${tag}@test.com`, `Display ${tag}`, inviteCode]
  );
  return { id, username: tag, display_name: `Display ${tag}`, inviteCode };
}

test('Mid-Game Leave & Rejoin: Player leaves mid-game, is marked disconnected, game continues, player rejoins, and finished game rejoin is rejected', async () => {
  const userA = await createTestUser('p1');
  const userB = await createTestUser('p2');

  // 1. Create room and join
  const roomRes = await createRoom({
    hostUserId: userA.id,
    category: 'General',
    difficulty: 'medium',
    questionLimit: 3,
    roomName: 'MidGame Rejoin Room',
  });
  const roomId = roomRes.room.id;
  await joinRoom(roomRes.room.code, userB.id);

  // Both ready and start
  await togglePlayerReady(roomId, userA.id, true);
  await togglePlayerReady(roomId, userB.id, true);
  const startRes = await startRoomGame(roomId, userA.id);
  assert.ok(startRes.id, 'Game should have started');
  const gameId = startRes.id;

  // Verify game is active
  const { rows: initialGameRows } = await query('SELECT status FROM games WHERE id = $1', [gameId]);
  assert.equal(initialGameRows[0].status, 'active');

  // Initial participants
  const initialParticipants = await getGameParticipants(gameId);
  assert.equal(initialParticipants.length, 2);
  assert.equal(initialParticipants.find(p => p.userId === userB.id).status, 'active');

  // 2. User B leaves mid-game
  const disconnectRes = await recordPlayerDisconnection(gameId, roomId, userB.id, 0);
  assert.equal(disconnectRes.ok, true);

  // Verify User B is marked disconnected in game state
  const updatedParticipants = await getGameParticipants(gameId);
  const pB = updatedParticipants.find(p => p.userId === userB.id);
  assert.equal(pB.status, 'disconnected');
  assert.equal(pB.isDisconnected, true);

  // Verify game and room are NOT cancelled
  const { rows: activeGameRows } = await query('SELECT status FROM games WHERE id = $1', [gameId]);
  assert.equal(activeGameRows[0].status, 'active', 'Game must remain active when player leaves');

  const snapshotMidGame = await getRoomSnapshot(roomId);
  assert.equal(snapshotMidGame.room.status, 'IN_PROGRESS', 'Room must remain IN_PROGRESS');

  // 3. Remaining player (User A) continues normally
  // Check canPlayerRejoin for User B while game is active
  const canRejoinActive = await canPlayerRejoin(gameId, userB.id);
  assert.equal(canRejoinActive.canRejoin, true);

  // 4. User B rejoins successfully while game is active
  const rejoinResult = await rejoinGame(gameId, userB.id);
  assert.equal(rejoinResult.ok, true);
  assert.ok(rejoinResult.gameState);
  assert.equal(rejoinResult.gameState.game.status, 'active');

  // Verify User B is marked active again
  const rejoinedParticipants = await getGameParticipants(gameId);
  const pBRejoined = rejoinedParticipants.find(p => p.userId === userB.id);
  assert.equal(pBRejoined.status, 'active');
  assert.equal(pBRejoined.isDisconnected, false);

  // User B leaves again
  await recordPlayerDisconnection(gameId, roomId, userB.id, 0);
  const pBSecondLeave = (await getGameParticipants(gameId)).find(p => p.userId === userB.id);
  assert.equal(pBSecondLeave.status, 'disconnected');

  // 5. Complete the game (game finishes)
  await finishGame(gameId, userA.id);
  const { rows: finishedGameRows } = await query('SELECT status FROM games WHERE id = $1', [gameId]);
  assert.equal(finishedGameRows[0].status, 'completed');

  // 6. User B attempts to rejoin now that game is completed -> MUST BE REJECTED
  const canRejoinFinished = await canPlayerRejoin(gameId, userB.id);
  assert.equal(canRejoinFinished.canRejoin, false);
  assert.equal(canRejoinFinished.reason, 'Game already finished. Cannot rejoin.');

  await assert.rejects(
    async () => rejoinGame(gameId, userB.id),
    (err) => {
      assert.match(err.message, /Game already finished\. Cannot rejoin\./i);
      assert.equal(err.status, 409);
      return true;
    }
  );

  // Also verify getRejoinGameState rejects finished game
  await assert.rejects(
    async () => getRejoinGameState(gameId, userB.id),
    (err) => {
      assert.match(err.message, /Game already finished\. Cannot rejoin\./i);
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 7. Verify postRejoinGame REST controller rejects finished game
  const { postRejoinGame } = require('../src/controllers/game.controller');
  const mockReq = {
    params: { gameId },
    user: userB,
    app: { get: () => null },
  };
  let errorCaught = null;
  await new Promise((resolve) => {
    postRejoinGame(mockReq, {}, (err) => {
      errorCaught = err;
      resolve();
    });
  });
  assert.ok(errorCaught, 'postRejoinGame should pass error to next');
  assert.match(errorCaught.message, /Game already finished\. Cannot rejoin\./i);
  assert.equal(errorCaught.status, 409);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});


