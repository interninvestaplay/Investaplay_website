const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');
const {
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  abortChallenge,
  listChallenges,
  joinChallenge,
} = require('../src/services/challenge.service');
const {
  createRoom,
  joinRoom,
  togglePlayerReady,
  startRoomGame,
  getRoomSnapshot,
  cancelRoomBeforeStart,
} = require('../src/services/room.service');

// Helper to create test user
async function createTestUser(prefix = 'lobby_user') {
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

test('Multiplayer Lobby Cancellation: Client leaves before start -> cancelled with PLAYER_LEFT_BEFORE_START -> ABORT removes from pending', async () => {
  const userA = await createTestUser('host_a');
  const userB = await createTestUser('client_b');

  // 1. User A challenges User B
  const challenge = await createChallenge(userA, { targetUserId: userB.id });
  assert.equal(challenge.status, 'pending');

  // 2. User B accepts -> lobby created
  const acceptRes = await acceptChallenge(challenge.id, userB);
  assert.ok(acceptRes.roomId, 'Room ID should be created');
  assert.equal(acceptRes.challenge.status, 'accepted');

  const roomId = acceptRes.roomId;
  const snapshotBefore = await getRoomSnapshot(roomId);
  assert.equal(snapshotBefore.room.status, 'waiting');

  // Mock socket IO
  const emittedEvents = [];
  const mockIO = {
    to: (target) => ({
      emit: (event, payload) => {
        emittedEvents.push({ target, event, payload });
      },
    }),
  };

  // 3. User B (Client) leaves the lobby before quiz starts
  const cancelRes = await cancelRoomBeforeStart(roomId, userB.id, mockIO);
  assert.equal(cancelRes.cancelled, true);

  // Verify room is cancelled
  const snapshotAfter = await getRoomSnapshot(roomId);
  assert.equal(snapshotAfter.room.status, 'cancelled');

  // Verify challenge is cancelled with reason PLAYER_LEFT_BEFORE_START
  const { rows: chRows } = await query('SELECT * FROM challenges WHERE id = $1', [challenge.id]);
  assert.equal(chRows[0].status, 'cancelled');
  assert.equal(chRows[0].cancellation_reason, 'PLAYER_LEFT_BEFORE_START');

  // Verify socket event notifications were emitted to room and users
  const roomCancelledEvt = emittedEvents.find((e) => e.target === `room:${roomId}` && e.event === 'room:cancelled');
  assert.ok(roomCancelledEvt, 'room:cancelled should be emitted to room');
  assert.equal(roomCancelledEvt.payload.reason, 'PLAYER_LEFT_BEFORE_START');
  assert.equal(roomCancelledEvt.payload.message, 'Player left the lobby. Match cancelled.');

  const userCancelledEvt = emittedEvents.find((e) => e.target === `user:${userA.id}` && e.event === 'challenge:cancelled');
  assert.ok(userCancelledEvt, 'challenge:cancelled should be emitted to User A');

  const leaverCancelledEvt = emittedEvents.find((e) => e.target === `user:${userB.id}` && (e.event === 'challenge:cancelled' || e.event === 'room:cancelled'));
  assert.equal(leaverCancelledEvt, undefined, 'Neither room:cancelled nor challenge:cancelled should be emitted to leaving User B');

  // 4. Attempting to join cancelled challenge or room fails
  await assert.rejects(
    async () => joinChallenge(challenge.id, userA.id),
    (err) => err.status === 410,
    'joinChallenge on cancelled challenge must fail with 410'
  );
  await assert.rejects(
    async () => joinRoom(snapshotBefore.room.code, userA.id),
    (err) => err.status === 404,
    'joinRoom on cancelled room must fail'
  );

  // 5. In Pending Invites, User A sees the cancelled challenge
  const listForUserA = await listChallenges(userA.id);
  const foundInA = listForUserA.find((c) => c.id === challenge.id);
  assert.ok(foundInA, 'User A should see the cancelled challenge in Pending Invites');
  assert.equal(foundInA.status, 'cancelled');
  assert.equal(foundInA.cancellation_reason, 'PLAYER_LEFT_BEFORE_START');

  // 6. User A presses ABORT -> clears from Pending Invites
  const abortRes = await abortChallenge(challenge.id, userA.id);
  assert.equal(abortRes.aborted, true);

  const listAfterAbort = await listChallenges(userA.id);
  const foundAfterAbort = listAfterAbort.find((c) => c.id === challenge.id);
  assert.equal(foundAfterAbort, undefined, 'Aborted challenge must be cleared from User A pending invites');

  // 7. Operation is safe & idempotent if both leave or abort again
  const secondLeave = await cancelRoomBeforeStart(roomId, userA.id, mockIO);
  assert.equal(secondLeave.cancelled, false);
  assert.equal(secondLeave.reason, 'already_terminal');

  const secondAbort = await abortChallenge(challenge.id, userA.id);
  assert.equal(secondAbort.aborted, true);
});

test('Multiplayer Lobby Cancellation: Host leaves before start -> cancels lobby & challenge with PLAYER_LEFT_BEFORE_START', async () => {
  const userA = await createTestUser('host_x');
  const userB = await createTestUser('client_y');

  const challenge = await createChallenge(userA, { targetUserId: userB.id });
  const acceptRes = await acceptChallenge(challenge.id, userB);
  const roomId = acceptRes.roomId;

  // Host leaves before start
  const cancelRes = await cancelRoomBeforeStart(roomId, userA.id);
  assert.equal(cancelRes.cancelled, true);

  const snapshot = await getRoomSnapshot(roomId);
  assert.equal(snapshot.room.status, 'cancelled');

  const { rows } = await query('SELECT status, cancellation_reason FROM challenges WHERE id = $1', [challenge.id]);
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[0].cancellation_reason, 'PLAYER_LEFT_BEFORE_START');

  // Client (User B) sees "Player left the lobby" challenge in Pending Invites
  const listForUserB = await listChallenges(userB.id);
  const foundInB = listForUserB.find((c) => c.id === challenge.id);
  assert.ok(foundInB);
  assert.equal(foundInB.status, 'cancelled');
  assert.equal(foundInB.cancellation_reason, 'PLAYER_LEFT_BEFORE_START');

  // Client presses ABORT -> cleared
  await abortChallenge(challenge.id, userB.id);
  const listAfterAbortB = await listChallenges(userB.id);
  assert.equal(listAfterAbortB.find((c) => c.id === challenge.id), undefined);
});

test('Multiplayer In-Game Abandonment: In-game match does NOT use pre-game cancellation', async () => {
  const userA = await createTestUser('host_active');
  const userB = await createTestUser('client_active');

  const challenge = await createChallenge(userA, { targetUserId: userB.id });
  const acceptRes = await acceptChallenge(challenge.id, userB);
  const roomId = acceptRes.roomId;

  // Both ready and game started
  await togglePlayerReady(roomId, userB.id, true);
  const game = await startRoomGame(roomId, userA.id);
  assert.ok(game.id);

  // Calling cancelRoomBeforeStart on active game must be rejected (preserve in-game abandonment flow)
  const attemptCancel = await cancelRoomBeforeStart(roomId, userA.id);
  assert.equal(attemptCancel.cancelled, false);
  assert.equal(attemptCancel.reason, 'game_already_started');

  // Room status is still in_game / IN_PROGRESS
  const snapshot = await getRoomSnapshot(roomId);
  assert.equal(snapshot.room.status, 'IN_PROGRESS');
});

test('Multiplayer Normal Decline: Rejection of pending invite remains DECLINED, not cancelled', async () => {
  const userA = await createTestUser('host_decl');
  const userB = await createTestUser('client_decl');

  const challenge = await createChallenge(userA, { targetUserId: userB.id });
  const declineRes = await declineChallenge(challenge.id, userB);
  assert.equal(declineRes.declined, true);

  const { rows } = await query('SELECT status, cancellation_reason FROM challenges WHERE id = $1', [challenge.id]);
  assert.equal(rows[0].status, 'declined');
  assert.equal(rows[0].cancellation_reason, null);

  // Declined challenges do NOT show in pending list
  const listForUserA = await listChallenges(userA.id);
  assert.equal(listForUserA.find((c) => c.id === challenge.id), undefined);
  const listForUserB = await listChallenges(userB.id);
  assert.equal(listForUserB.find((c) => c.id === challenge.id), undefined);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});

