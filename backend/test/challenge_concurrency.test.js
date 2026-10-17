const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');
const {
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  listChallenges,
} = require('../src/services/challenge.service');
const {
  togglePlayerReady,
  startRoomGame,
  getRoomSnapshot,
} = require('../src/services/room.service');

// Helper to create a test user
async function createTestUser(prefix = 'user') {
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

test('1. A->B then A->B again -> blocked', async () => {
  const userA = await createTestUser('t1_userA');
  const userB = await createTestUser('t1_userB');

  // A -> B creates active challenge
  const challenge = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(challenge.id);
  assert.equal(challenge.status, 'pending');

  // A -> B again must be BLOCKED
  await assert.rejects(
    async () => {
      await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /active challenge/i);
      return true;
    },
    'A->B again must be blocked with 409 Conflict'
  );
});

test('2. A->B then B->A -> blocked', async () => {
  const userA = await createTestUser('t2_userA');
  const userB = await createTestUser('t2_userB');

  // A -> B creates active challenge
  const challenge = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(challenge.id);
  assert.equal(challenge.status, 'pending');

  // B -> A must be BLOCKED (same canonical active pair)
  await assert.rejects(
    async () => {
      await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /active challenge/i);
      return true;
    },
    'B->A while active A->B exists must be blocked with 409 Conflict'
  );
});

test('3. A->B, C->B, D->B -> all allowed', async () => {
  const receiverB = await createTestUser('t3_receiverB');
  const userA = await createTestUser('t3_userA');
  const userC = await createTestUser('t3_userC');
  const userD = await createTestUser('t3_userD');

  const [chalA, chalC, chalD] = await Promise.all([
    createChallenge(userA, { targetUserId: receiverB.id, req: { app: { get: () => null } } }),
    createChallenge(userC, { targetUserId: receiverB.id, req: { app: { get: () => null } } }),
    createChallenge(userD, { targetUserId: receiverB.id, req: { app: { get: () => null } } }),
  ]);

  assert.ok(chalA.id);
  assert.ok(chalC.id);
  assert.ok(chalD.id);

  const distinctIds = new Set([chalA.id, chalC.id, chalD.id]);
  assert.equal(distinctIds.size, 3, 'All 3 incoming challenges are allowed as distinct records');

  // Receiver sees all 3 pending challenges
  const list = await listChallenges(receiverB.id);
  const pendingIds = list.filter((c) => c.status === 'pending').map((c) => c.id);
  assert.ok(pendingIds.includes(chalA.id));
  assert.ok(pendingIds.includes(chalC.id));
  assert.ok(pendingIds.includes(chalD.id));
});

test('4. B accepts A -> A=HOST, B=CLIENT (not sorted by user ID)', async () => {
  // Case A: Challenger ID > Receiver ID
  const lowUser = await createTestUser('t4_low');
  const highUser = await createTestUser('t4_high');
  const [userA1, userB1] = lowUser.id < highUser.id ? [highUser, lowUser] : [lowUser, highUser];
  assert.ok(userA1.id > userB1.id, 'userA1.id > userB1.id');

  const chal1 = await createChallenge(userA1, { targetUserId: userB1.id, req: { app: { get: () => null } } });
  const acceptRes1 = await acceptChallenge(chal1.id, userB1, { app: { get: () => null } });
  const snapshot1 = await getRoomSnapshot(acceptRes1.roomId);

  assert.equal(snapshot1.room.host_user_id, userA1.id, 'Original sender userA1 is HOST');
  const roleA1 = snapshot1.players.find((p) => p.user_id === userA1.id);
  const roleB1 = snapshot1.players.find((p) => p.user_id === userB1.id);
  assert.equal(roleA1.role, 'host', 'Original sender has role host');
  assert.equal(roleB1.role, 'player', 'Receiver has role player');

  // Case B: Challenger ID < Receiver ID (using fresh users for independent testing)
  const lowUser2 = await createTestUser('t4_low2');
  const highUser2 = await createTestUser('t4_high2');
  const [userA2, userB2] = lowUser2.id < highUser2.id ? [lowUser2, highUser2] : [highUser2, lowUser2];
  assert.ok(userA2.id < userB2.id, 'userA2.id < userB2.id');

  const chal2 = await createChallenge(userA2, { targetUserId: userB2.id, req: { app: { get: () => null } } });
  const acceptRes2 = await acceptChallenge(chal2.id, userB2, { app: { get: () => null } });
  const snapshot2 = await getRoomSnapshot(acceptRes2.roomId);

  assert.equal(snapshot2.room.host_user_id, userA2.id, 'Original sender userA2 is HOST');
  const roleA2 = snapshot2.players.find((p) => p.user_id === userA2.id);
  const roleB2 = snapshot2.players.find((p) => p.user_id === userB2.id);
  assert.equal(roleA2.role, 'host', 'Original sender has role host');
  assert.equal(roleB2.role, 'player', 'Receiver has role player');
});

test('5. B accepts A twice concurrently -> same room returned', async () => {
  const challenger = await createTestUser('t5_chal');
  const receiver = await createTestUser('t5_rec');

  const challenge = await createChallenge(challenger, { targetUserId: receiver.id, req: { app: { get: () => null } } });

  // 10 concurrent accept requests simulating rapid double-clicks / network retries
  const acceptPromises = Array.from({ length: 10 }).map(() =>
    acceptChallenge(challenge.id, receiver, { app: { get: () => null } })
  );
  const results = await Promise.all(acceptPromises);

  const firstRoomId = results[0].roomId;
  assert.ok(firstRoomId);
  for (const r of results) {
    assert.equal(r.roomId, firstRoomId, 'All concurrent accept requests return the exact same roomId');
  }

  // Exactly 1 room created in MySQL
  const roomCount = await query('SELECT COUNT(*) AS total FROM rooms WHERE id = $1', [firstRoomId]);
  assert.equal(Number(roomCount.rows[0].total), 1);
});

test('6. A+B leave before game starts -> pair remains locked until session is properly terminated/expired', async () => {
  const userA = await createTestUser('t6_userA');
  const userB = await createTestUser('t6_userB');

  const challenge = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  const { roomId } = await acceptChallenge(challenge.id, userB, { app: { get: () => null } });
  assert.ok(roomId);

  // Both players leave room before game starts; challenge status is still 'accepted'
  await assert.rejects(
    async () => {
      await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /active challenge/i);
      return true;
    },
    'A cannot challenge B while accepted session is active'
  );

  await assert.rejects(
    async () => {
      await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /active challenge/i);
      return true;
    },
    'B cannot challenge A while accepted session is active'
  );
});

test('7. After terminal session state -> A and B can challenge again', async () => {
  // 7a: After declined
  const userA1 = await createTestUser('t7_uA1');
  const userB1 = await createTestUser('t7_uB1');
  const chal1 = await createChallenge(userA1, { targetUserId: userB1.id, req: { app: { get: () => null } } });
  await declineChallenge(chal1.id, userB1, { app: { get: () => null } });
  // B can now challenge A
  const retry1 = await createChallenge(userB1, { targetUserId: userA1.id, req: { app: { get: () => null } } });
  assert.ok(retry1.id);

  // 7b: After cancelled
  const userA2 = await createTestUser('t7_uA2');
  const userB2 = await createTestUser('t7_uB2');
  const chal2 = await createChallenge(userA2, { targetUserId: userB2.id, req: { app: { get: () => null } } });
  await cancelChallenge(chal2.id, userA2.id);
  // A can now challenge B again
  const retry2 = await createChallenge(userA2, { targetUserId: userB2.id, req: { app: { get: () => null } } });
  assert.ok(retry2.id);

  // 7c: After expired
  const userA3 = await createTestUser('t7_uA3');
  const userB3 = await createTestUser('t7_uB3');
  const chal3 = await createChallenge(userA3, { targetUserId: userB3.id, req: { app: { get: () => null } } });
  await query("UPDATE challenges SET status = 'expired' WHERE id = $1", [chal3.id]);
  // A can challenge B again
  const retry3 = await createChallenge(userA3, { targetUserId: userB3.id, req: { app: { get: () => null } } });
  assert.ok(retry3.id);

  // 7d: After completed
  const userA4 = await createTestUser('t7_uA4');
  const userB4 = await createTestUser('t7_uB4');
  const chal4 = await createChallenge(userA4, { targetUserId: userB4.id, req: { app: { get: () => null } } });
  await acceptChallenge(chal4.id, userB4, { app: { get: () => null } });
  await query("UPDATE challenges SET status = 'completed' WHERE id = $1", [chal4.id]);
  // B can challenge A again
  const retry4 = await createChallenge(userB4, { targetUserId: userA4.id, req: { app: { get: () => null } } });
  assert.ok(retry4.id);
});

test('8. 1,000 concurrent challenge requests -> no duplicate active pair sessions', async () => {
  const receiver = await createTestUser('mega_receiver');
  const numChallengers = 50;
  const challengers = [];
  for (let i = 0; i < numChallengers; i += 1) {
    challengers.push(await createTestUser(`mega_chal_${i}`));
  }

  // 1,000 total concurrent requests: 20 concurrent duplicate requests per challenger across 50 challengers
  const totalRequests = [];
  for (const challenger of challengers) {
    for (let r = 0; r < 20; r += 1) {
      totalRequests.push(
        createChallenge(challenger, { targetUserId: receiver.id, req: { app: { get: () => null } } })
          .then((res) => ({ status: 'fulfilled', value: res }))
          .catch((err) => ({ status: 'rejected', reason: err }))
      );
    }
  }

  assert.equal(totalRequests.length, 1000, 'Total of 1000 concurrent requests launched');
  const results = await Promise.all(totalRequests);

  // For each of the 50 challengers, exactly 1 request succeeded in creating the challenge, and 19 were blocked
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, numChallengers, 'Exactly 50 unique challenges succeeded');
  assert.equal(rejected.length, 1000 - numChallengers, '950 duplicate requests were blocked');

  // Verify at database level: exactly 50 pending challenges for receiver
  const inDb = await query(
    "SELECT COUNT(*) AS total FROM challenges WHERE challenged_id = $1 AND status = 'pending'",
    [receiver.id]
  );
  assert.equal(Number(inDb.rows[0].total), numChallengers);

  // Verify at database level: ZERO duplicate active pair sessions across the entire database!
  const dupCheck = await query(
    `SELECT pair_key, COUNT(*) AS cnt
     FROM challenges
     WHERE status IN ('pending', 'accepted')
     GROUP BY pair_key
     HAVING cnt > 1`
  );
  assert.equal(dupCheck.rows.length, 0, 'Zero duplicate active pair sessions in the database');
});

test('Game Start Concurrency: Multiple concurrent startRoomGame calls create exactly ONE active game', async () => {
  const host = await createTestUser('host_gamestart');
  const player = await createTestUser('player_gamestart');

  const challenge = await createChallenge(host, { targetUserId: player.id, req: { app: { get: () => null } } });
  const { roomId } = await acceptChallenge(challenge.id, player, { app: { get: () => null } });

  // Player sets ready
  await togglePlayerReady(roomId, player.id, true);

  // Simulate 10 simultaneous game start triggers (multiple tabs, double click, multi-server instance)
  const startCalls = Array.from({ length: 10 }).map(() => startRoomGame(roomId, host.id));
  const games = await Promise.all(startCalls);

  const gameIds = new Set(games.map((g) => g.id));
  assert.equal(gameIds.size, 1, 'Exactly one game created across all concurrent requests');

  // Verify room has this single active_game_id
  const checkRoom = await query('SELECT status, active_game_id FROM rooms WHERE id = $1', [roomId]);
  assert.equal(checkRoom.rows[0].status, 'in_game');
  assert.equal(checkRoom.rows[0].active_game_id, games[0].id);

  // Verify challenge was updated with game_id
  const checkChallenge = await query('SELECT game_id FROM challenges WHERE id = $1', [challenge.id]);
  assert.equal(checkChallenge.rows[0].game_id, games[0].id);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
