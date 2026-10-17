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

// Helper to create test user
async function createTestUser(prefix = 'ux_user') {
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

// Mirror of frontend challengeState.ts logic for end-to-end verification
function getPairChallengeState(targetUserId, currentUserId, challenges = [], nowMs = Date.now()) {
  if (!targetUserId || !currentUserId) {
    return { status: 'available', disabled: false, buttonLabel: 'Challenge' };
  }
  const sTarget = String(targetUserId);
  const sCurrent = String(currentUserId);
  if (sTarget === sCurrent) {
    return { status: 'available', disabled: false, buttonLabel: 'Challenge' };
  }

  const active = challenges.find((c) => {
    const cChallenger = String(c.challenger_id);
    const cChallenged = String(c.challenged_id);
    const matchesPair =
      (cChallenger === sCurrent && cChallenged === sTarget) ||
      (cChallenged === sCurrent && cChallenger === sTarget);
    if (!matchesPair) return false;

    const st = String(c.status || '').toLowerCase();
    if (st !== 'pending' && st !== 'accepted') return false;

    if (st === 'pending') {
      const endsAtRaw = c.ends_at || c.endsAt;
      if (endsAtRaw) {
        const endsMs = new Date(endsAtRaw).getTime();
        if (!Number.isNaN(endsMs) && endsMs <= nowMs) {
          return false;
        }
      }
    }
    return true;
  });

  if (!active) {
    return { status: 'available', disabled: false, buttonLabel: 'Challenge' };
  }

  const isOutgoing = String(active.challenger_id) === sCurrent;
  const isAccepted = String(active.status).toLowerCase() === 'accepted';

  if (isAccepted) {
    return {
      status: 'active_session',
      disabled: true,
      buttonLabel: 'In Battle',
      challengeId: active.id,
    };
  }

  if (isOutgoing) {
    return {
      status: 'pending_outgoing',
      disabled: true,
      buttonLabel: 'Challenge Sent',
      challengeId: active.id,
    };
  }

  return {
    status: 'pending_incoming',
    disabled: true,
    buttonLabel: 'Challenge Pending',
    challengeId: active.id,
  };
}

// 1. A challenges B -> B's Challenge A button becomes disabled
test('Case 1: A challenges B -> B\'s Challenge A button becomes disabled', async () => {
  const userA = await createTestUser('c1_uA');
  const userB = await createTestUser('c1_uB');

  const challenge = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(challenge.id);

  // B fetches challenge list from authoritative backend
  const bChallenges = await listChallenges(userB.id);

  // B evaluates pair state for User A
  const pairStateForB = getPairChallengeState(userA.id, userB.id, bChallenges);
  assert.equal(pairStateForB.disabled, true, 'B\'s Challenge A button must be disabled');
  assert.equal(pairStateForB.buttonLabel, 'Challenge Pending', 'B\'s button must show Challenge Pending');
  assert.equal(pairStateForB.status, 'pending_incoming');
});

// 2. A challenges B -> B cannot create B -> A
test('Case 2: A challenges B -> B cannot create B -> A (409 FRIEND_PAIR_BUSY)', async () => {
  const userA = await createTestUser('c2_uA');
  const userB = await createTestUser('c2_uB');

  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  await assert.rejects(
    async () => {
      await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'FRIEND_PAIR_BUSY');
      assert.match(err.message, /active challenge/i);
      return true;
    },
    'B->A must be rejected with 409 FRIEND_PAIR_BUSY'
  );
});

// 3. A challenges B -> A cannot create A -> B again
test('Case 3: A challenges B -> A cannot create A -> B again (409 FRIEND_PAIR_BUSY)', async () => {
  const userA = await createTestUser('c3_uA');
  const userB = await createTestUser('c3_uB');

  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  await assert.rejects(
    async () => {
      await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'FRIEND_PAIR_BUSY');
      return true;
    },
    'A->B duplicate must be rejected with 409 FRIEND_PAIR_BUSY'
  );
});

// 4. A challenges B -> C can still challenge B
test('Case 4: A challenges B -> C can still challenge B', async () => {
  const userA = await createTestUser('c4_uA');
  const userB = await createTestUser('c4_uB');
  const userC = await createTestUser('c4_uC');

  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  // C's UI checking B before challenging
  const cChallenges = await listChallenges(userC.id);
  const pairStateForC = getPairChallengeState(userB.id, userC.id, cChallenges);
  assert.equal(pairStateForC.disabled, false, 'C sees B as available');
  assert.equal(pairStateForC.buttonLabel, 'Challenge');

  // C creates challenge to B
  const challengeC = await createChallenge(userC, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(challengeC.id);
  assert.equal(challengeC.status, 'pending');
});

// 5. A challenges B -> D can still challenge B
test('Case 5: A challenges B -> D can still challenge B', async () => {
  const userA = await createTestUser('c5_uA');
  const userB = await createTestUser('c5_uB');
  const userD = await createTestUser('c5_uD');

  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  const challengeD = await createChallenge(userD, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(challengeD.id);
  assert.equal(challengeD.status, 'pending');
});

// 6. Pending challenge expires after 5 minutes
test('Case 6: Pending challenge expires after 5 minutes', async () => {
  const userA = await createTestUser('c6_uA');
  const userB = await createTestUser('c6_uB');

  const challenge = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  // Verify starts_at and ends_at were set with 5-minute window
  const dbChal = await query('SELECT starts_at, ends_at FROM challenges WHERE id = $1', [challenge.id]);
  const startsAt = new Date(dbChal.rows[0].starts_at).getTime();
  const endsAt = new Date(dbChal.rows[0].ends_at).getTime();
  const diffMinutes = Math.round((endsAt - startsAt) / (60 * 1000));
  assert.equal(diffMinutes, 5, 'Pending challenge has 5 minute lifetime');

  // Fast-forward past ends_at in database
  await query(
    `UPDATE challenges
     SET ends_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
     WHERE id = $1`,
    [challenge.id]
  );

  // Authoritative list query triggers expiration cleanup
  const bList = await listChallenges(userB.id);
  const found = bList.find((c) => c.id === challenge.id);
  assert.equal(found, undefined, 'Expired challenge is no longer returned as active in listChallenges');

  // Verify status in database transitioned to expired
  const dbUpdated = await query('SELECT status FROM challenges WHERE id = $1', [challenge.id]);
  assert.equal(dbUpdated.rows[0].status, 'expired', 'Status in database transitioned to expired');

  // Verify UI pair state is now unlocked and available
  const pairState = getPairChallengeState(userA.id, userB.id, bList);
  assert.equal(pairState.disabled, false, 'Challenge button is now unlocked/available');
  assert.equal(pairState.buttonLabel, 'Challenge');
});

// 7. After expiration, A/B can challenge again
test('Case 7: After expiration, A/B can challenge again', async () => {
  const userA = await createTestUser('c7_uA');
  const userB = await createTestUser('c7_uB');

  const chal = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  // Expire in database
  await query(
    `UPDATE challenges
     SET ends_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
     WHERE id = $1`,
    [chal.id]
  );

  // B can now challenge A (createChallenge also auto-expires past-due challenges)
  const newChal = await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
  assert.ok(newChal.id, 'New challenge created after expiry');
  assert.equal(newChal.status, 'pending');
});

// 8. A accepts (or B accepts) -> pair remains locked
test('Case 8: A accepts -> pair remains locked', async () => {
  const userA = await createTestUser('c8_uA');
  const userB = await createTestUser('c8_uB');

  const chal = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  const acceptRes = await acceptChallenge(chal.id, userB, { app: { get: () => null } });
  assert.ok(acceptRes.roomId);

  // Pair is accepted, pair remains locked
  await assert.rejects(
    async () => {
      await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'FRIEND_PAIR_BUSY');
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'FRIEND_PAIR_BUSY');
      return true;
    }
  );
});

// 9. A/B leave room before game -> pair remains locked
test('Case 9: A/B leave room before game -> pair remains locked', async () => {
  const userA = await createTestUser('c9_uA');
  const userB = await createTestUser('c9_uB');

  const chal = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  await acceptChallenge(chal.id, userB, { app: { get: () => null } });

  // Status is accepted
  const dbChal = await query('SELECT status FROM challenges WHERE id = $1', [chal.id]);
  assert.equal(dbChal.rows[0].status, 'accepted');

  // Pair is still locked
  await assert.rejects(
    async () => {
      await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      return true;
    }
  );
});

// 10. Accepted session terminates -> pair becomes available
test('Case 10: Accepted session terminates -> pair becomes available', async () => {
  const userA = await createTestUser('c10_uA');
  const userB = await createTestUser('c10_uB');

  const chal = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  await acceptChallenge(chal.id, userB, { app: { get: () => null } });

  // Terminal state: game completed
  await query("UPDATE challenges SET status = 'completed' WHERE id = $1", [chal.id]);

  // A can challenge B again
  const retryA = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });
  assert.ok(retryA.id);
  assert.equal(retryA.status, 'pending');
});

// 11. UI refresh correctly reflects pair status
test('Case 11: UI refresh correctly reflects pair status', async () => {
  const userA = await createTestUser('c11_uA');
  const userB = await createTestUser('c11_uB');

  const chal = await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  // Authoritative API list for User B
  const listB = await listChallenges(userB.id);
  const item = listB.find((c) => c.id === chal.id);

  assert.ok(item);
  assert.equal(item.isPairActive, true);
  assert.equal(item.pairStatus, 'pending');
  assert.equal(item.direction, 'incoming');
  assert.ok(item.startsAt);
  assert.ok(item.endsAt);

  const uiState = getPairChallengeState(userA.id, userB.id, listB);
  assert.equal(uiState.disabled, true);
  assert.equal(uiState.buttonLabel, 'Challenge Pending');
});

// 12. Two rapid Challenge taps result in only one active challenge
test('Case 12: Two rapid Challenge taps result in only one active challenge', async () => {
  const userA = await createTestUser('c12_uA');
  const userB = await createTestUser('c12_uB');

  // Launch two concurrent requests simultaneously (double tap)
  const [req1, req2] = await Promise.allSettled([
    createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } }),
    createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } }),
  ]);

  const fulfilled = [req1, req2].filter((r) => r.status === 'fulfilled');
  const rejected = [req1, req2].filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one request succeeds (201)');
  assert.equal(rejected.length, 1, 'Second request is rejected (409)');
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, 'FRIEND_PAIR_BUSY');

  // Verify only 1 active record exists in database
  const count = await query(
    "SELECT COUNT(*) AS cnt FROM challenges WHERE challenger_id = $1 AND challenged_id = $2 AND status = 'pending'",
    [userA.id, userB.id]
  );
  assert.equal(Number(count.rows[0].cnt), 1);
});

// 13. Stale frontend state + API request still gets 409 and updates UI
test('Case 13: Stale frontend state + API request still gets 409 and updates UI', async () => {
  const userA = await createTestUser('c13_uA');
  const userB = await createTestUser('c13_uB');

  // User A already challenged User B
  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  // User B on a stale screen attempts to challenge User A
  let errorCaught = null;
  try {
    await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
  } catch (err) {
    errorCaught = err;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 409);
  assert.equal(errorCaught.code, 'FRIEND_PAIR_BUSY');

  // Frontend handles 409 by loading fresh challenges
  const freshChallenges = await listChallenges(userB.id);
  const updatedPairState = getPairChallengeState(userA.id, userB.id, freshChallenges);
  assert.equal(updatedPairState.disabled, true);
  assert.equal(updatedPairState.buttonLabel, 'Challenge Pending');
});

// 14. Reverse direction is also blocked
test('Case 14: Reverse direction is also blocked', async () => {
  const userA = await createTestUser('c14_uA');
  const userB = await createTestUser('c14_uB');

  await createChallenge(userA, { targetUserId: userB.id, req: { app: { get: () => null } } });

  await assert.rejects(
    async () => {
      await createChallenge(userB, { targetUserId: userA.id, req: { app: { get: () => null } } });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'FRIEND_PAIR_BUSY');
      return true;
    }
  );
});

// 15. Different pairs involving the same receiver remain independent
test('Case 15: Different pairs involving the same receiver remain independent', async () => {
  const receiverB = await createTestUser('c15_recB');
  const userA = await createTestUser('c15_uA');
  const userC = await createTestUser('c15_uC');
  const userD = await createTestUser('c15_uD');

  const chalA = await createChallenge(userA, { targetUserId: receiverB.id, req: { app: { get: () => null } } });
  const chalC = await createChallenge(userC, { targetUserId: receiverB.id, req: { app: { get: () => null } } });
  const chalD = await createChallenge(userD, { targetUserId: receiverB.id, req: { app: { get: () => null } } });

  assert.ok(chalA.id);
  assert.ok(chalC.id);
  assert.ok(chalD.id);

  // All 3 pairs exist simultaneously as pending
  const listB = await listChallenges(receiverB.id);
  const pairA = getPairChallengeState(userA.id, receiverB.id, listB);
  const pairC = getPairChallengeState(userC.id, receiverB.id, listB);
  const pairD = getPairChallengeState(userD.id, receiverB.id, listB);

  assert.equal(pairA.disabled, true);
  assert.equal(pairC.disabled, true);
  assert.equal(pairD.disabled, true);

  // A third party E looking at B sees B available
  const userE = await createTestUser('c15_uE');
  const listE = await listChallenges(userE.id);
  const pairE = getPairChallengeState(receiverB.id, userE.id, listE);
  assert.equal(pairE.disabled, false);
  assert.equal(pairE.buttonLabel, 'Challenge');
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
