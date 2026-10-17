const { randomUUID } = require('crypto');
const { query, connect } = require('../db/pool');
const { createRoomCode } = require('../utils/roomCode');
const { getLeaderboard } = require('./game.service');
const { ensureInviteCode } = require('./invite.service');
const { notifyUser } = require('./notification.service');

async function challengeSnapshot(challengeId) {
  const { rows } = await query(
    `SELECT c.*,
            challenger.display_name AS challenger_name, challenger.level AS challenger_level, challenger.invite_code AS challenger_invite_code,
            challenged.display_name AS challenged_name, challenged.level AS challenged_level, challenged.invite_code AS challenged_invite_code
     FROM challenges c
     JOIN users challenger ON challenger.id = c.challenger_id
     JOIN users challenged ON challenged.id = c.challenged_id
     WHERE c.id = $1`,
    [challengeId]
  );
  return rows[0];
}

async function createUniqueRoomCode(client) {
  let code = createRoomCode();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await client.query('SELECT id FROM rooms WHERE code = $1', [code]);
    if (!existing.rows[0]) {
      return code;
    }
    code = createRoomCode();
  }
  return code;
}

async function getSuggestions(userId, userLevel = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const directSuggestions = () => query(
    `SELECT id, username, display_name, invite_code, level
     FROM users
     WHERE id <> $1
       AND deleted_at IS NULL
       AND role = 'player'
       AND NOT EXISTS (
         SELECT 1
         FROM challenges c
         WHERE c.status IN ('pending', 'accepted')
           AND (
             (c.challenger_id = $1 AND c.challenged_id = users.id)
             OR (c.challenger_id = users.id AND c.challenged_id = $1)
           )
       )
     ORDER BY ABS(level - $2), RAND()
     LIMIT 3`,
    [userId, userLevel]
  );

  let existing;
  try {
    existing = await query(
      `SELECT u.id, u.username, u.display_name, u.invite_code, u.level
       FROM daily_challenge_suggestions s
       JOIN users u ON u.id = s.suggested_user_id
       WHERE s.user_id = $1 AND s.suggestion_date = $2
         AND NOT EXISTS (
           SELECT 1
           FROM challenges c
           WHERE c.status IN ('pending', 'accepted')
             AND (
               (c.challenger_id = $1 AND c.challenged_id = u.id)
               OR (c.challenger_id = u.id AND c.challenged_id = $1)
             )
         )
       ORDER BY s.created_at ASC`,
      [userId, today]
    );
  } catch (error) {
    const fallback = await directSuggestions();
    return { suggestions: fallback.rows, uncached: true };
  }

  if (!existing.rows.length) {
    const candidates = await directSuggestions();
    for (const candidate of candidates.rows) {
      await query(
        `INSERT IGNORE INTO daily_challenge_suggestions (user_id, suggested_user_id, suggestion_date)
         VALUES ($1, $2, $3)`,
        [userId, candidate.id, today]
      );
    }
    existing = await query(
      `SELECT u.id, u.username, u.display_name, u.invite_code, u.level
       FROM daily_challenge_suggestions s
       JOIN users u ON u.id = s.suggested_user_id
       WHERE s.user_id = $1 AND s.suggestion_date = $2
         AND NOT EXISTS (
           SELECT 1
           FROM challenges c
           WHERE c.status IN ('pending', 'accepted')
             AND (
               (c.challenger_id = $1 AND c.challenged_id = u.id)
               OR (c.challenger_id = u.id AND c.challenged_id = $1)
             )
         )
       ORDER BY s.created_at ASC`,
      [userId, today]
    );
  }

  return { suggestions: existing.rows };
}

async function listChallenges(userId, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  // 1. Authoritative DB cleanup: Expire any past-due pending challenges
  await query(
    `UPDATE challenges
     SET status = 'expired'
     WHERE status = 'pending'
       AND ends_at IS NOT NULL
       AND ends_at <= NOW()`
  );

  // 2. Return active challenges where user is either challenger or challenged,
  // or challenges cancelled before start that have not been dismissed/aborted by this user
  const { rows } = await query(
    `SELECT c.*,
            challenger.display_name AS challenger_name,
            challenger.username AS challenger_username,
            challenged.display_name AS challenged_name,
            challenged.username AS challenged_username
     FROM challenges c
     JOIN users challenger ON challenger.id = c.challenger_id
     JOIN users challenged ON challenged.id = c.challenged_id
     WHERE (
       (c.status IN ('pending', 'accepted') AND (c.challenger_id = $1 OR c.challenged_id = $1))
       OR
       (c.status = 'cancelled'
        AND c.cancellation_reason = 'PLAYER_LEFT_BEFORE_START'
        AND (
          (c.challenger_id = $1 AND (c.challenger_dismissed IS NULL OR c.challenger_dismissed = FALSE))
          OR
          (c.challenged_id = $1 AND (c.challenged_dismissed IS NULL OR c.challenged_dismissed = FALSE))
        )
       )
     )
     ORDER BY c.created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );

  return rows.map((r) => ({
    ...r,
    isPairActive: r.status === 'pending' || r.status === 'accepted',
    pairStatus: r.status,
    challengeId: r.id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    cancellation_reason: r.cancellation_reason || null,
    opponentId: r.challenger_id === userId ? r.challenged_id : r.challenger_id,
    opponentName: r.challenger_id === userId ? r.challenged_name : r.challenger_name,
    direction: r.challenger_id === userId ? 'outgoing' : 'incoming',
  }));
}

async function createChallenge(challengerUser, { inviteCode, targetUserId, quizType, topic, difficulty, questionCount, customQuestionIds, req }) {
  const cleanInvite = String(inviteCode || '').replace(/\s+/g, '').toUpperCase();
  const target = targetUserId
    ? await query('SELECT id, display_name FROM users WHERE id = $1 AND deleted_at IS NULL', [targetUserId])
    : await query('SELECT id, display_name FROM users WHERE invite_code = $1 AND deleted_at IS NULL', [cleanInvite]);

  const challenged = target.rows[0];
  if (!challenged) {
    const error = new Error('Challenge user not found');
    error.status = 404;
    throw error;
  }
  if (challenged.id === challengerUser.id) {
    const error = new Error('You cannot challenge yourself');
    error.status = 400;
    throw error;
  }

  const pairKey = challengerUser.id < challenged.id
    ? `${challengerUser.id}:${challenged.id}`
    : `${challenged.id}:${challengerUser.id}`;

  // 1. Authoritative DB cleanup: Expire any past-due pending challenge for this pair
  await query(
    `UPDATE challenges
     SET status = 'expired'
     WHERE pair_key = $1
       AND status = 'pending'
       AND ends_at IS NOT NULL
       AND ends_at <= NOW()`,
    [pairKey]
  );

  // 2. Strict active pair check: Only ONE active challenge/session may exist for the SAME pair
  // Regardless of direction (A->B or B->A).
  const activeExisting = await query(
    `SELECT id, challenger_id, challenged_id, status, ends_at
     FROM challenges
     WHERE pair_key = $1 AND status IN ('pending', 'accepted')
     LIMIT 1`,
    [pairKey]
  );

  if (activeExisting.rows[0]) {
    const error = new Error('An active challenge or match session already exists between these users');
    error.status = 409;
    error.code = 'FRIEND_PAIR_BUSY';
    throw error;
  }

  // 3. Insert new challenge with 5-minute lifetime and MySQL unique constraint protection
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 5 * 60 * 1000); // 5 minutes pending window

  let challengeId;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      challengeId = randomUUID();
      try {
        await query(
          `INSERT INTO challenges (id, challenger_id, challenged_id, status, starts_at, ends_at, quiz_type, topic, difficulty, question_limit, custom_question_ids)
           VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10)`,
          [
            challengeId,
            challengerUser.id,
            challenged.id,
            startsAt,
            endsAt,
            quizType || 'standard',
            topic || null,
            difficulty || null,
            questionCount ? Number(questionCount) : null,
            customQuestionIds ? (typeof customQuestionIds === 'string' ? customQuestionIds : JSON.stringify(customQuestionIds)) : null,
          ]
        );
      } catch (colErr) {
        if (colErr.code === 'ER_DUP_ENTRY' || colErr.errno === 1062) throw colErr;
        // Fallback for earlier schema if columns not yet added
        await query(
          `INSERT INTO challenges (id, challenger_id, challenged_id, status, starts_at, ends_at)
           VALUES ($1, $2, $3, 'pending', $4, $5)`,
          [challengeId, challengerUser.id, challenged.id, startsAt, endsAt]
        );
      }
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        // Race condition: another concurrent request already created an active challenge for this pair!
        const error = new Error('An active challenge or match session already exists between these users');
        error.status = 409;
        error.code = 'FRIEND_PAIR_BUSY';
        throw error;
      }
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < 4) {
        await new Promise((r) => setTimeout(r, Math.random() * 25 + 5));
        continue;
      }
      throw err;
    }
  }

  const challenge = await challengeSnapshot(challengeId);
  const isQuickQuiz = quizType === 'quick_quiz' || challenge?.quiz_type === 'quick_quiz';
  const notificationTitle = isQuickQuiz ? '⚡ Quick Quiz AI Challenge!' : 'New InvestaQuiz Challenge';
  const notificationBody = isQuickQuiz
    ? `${challengerUser.display_name} challenged you to a Quick Quiz AI battle${topic ? ` on "${topic}"` : ''}!`
    : `${challengerUser.display_name} challenged you.`;

  await notifyUser(req, challenged.id, 'challenge:received', {
    title: notificationTitle,
    body: notificationBody,
    data: {
      challengeId,
      quizType: quizType || challenge?.quiz_type || 'standard',
      topic: topic || challenge?.topic || null,
      difficulty: difficulty || challenge?.difficulty || null,
      questionCount: questionCount || challenge?.question_limit || null,
    },
    challenge: {
      ...challenge,
      quiz_type: quizType || challenge?.quiz_type || 'standard',
      topic: topic || challenge?.topic || null,
      difficulty: difficulty || challenge?.difficulty || null,
      question_limit: questionCount || challenge?.question_limit || null,
      custom_question_ids: customQuestionIds || challenge?.custom_question_ids || null,
    },
  });
  if (req) {
    const { emitToUser } = require('./notification.service');
    emitToUser(req, challengerUser.id, 'challenge:sent', {
      challengeId,
      challenge: {
        ...challenge,
        quiz_type: quizType || challenge?.quiz_type || 'standard',
        topic: topic || challenge?.topic || null,
        difficulty: difficulty || challenge?.difficulty || null,
        question_limit: questionCount || challenge?.question_limit || null,
      },
    });
  }

  return challenge;
}

async function acceptChallenge(challengeId, user, req) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge) {
    const error = new Error('Challenge not found');
    error.status = 404;
    throw error;
  }
  if (challenge.challenged_id !== user.id) {
    const error = new Error('Only the challenged user can accept this pending challenge');
    error.status = 403;
    throw error;
  }

  let roomId;
  let alreadyAccepted = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const client = await connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id, challenger_id, challenged_id, status, room_id 
         FROM challenges 
         WHERE id = $1 
         FOR UPDATE`,
        [challengeId]
      );
      const row = locked.rows[0];
      if (!row) {
        const error = new Error('Challenge not found');
        error.status = 404;
        throw error;
      }
      if (row.challenged_id !== user.id) {
        const error = new Error('Only the challenged user can accept this pending challenge');
        error.status = 403;
        throw error;
      }

      // Idempotency: If this challenge was already accepted by this user and has an active room, reuse it
      if (row.status === 'accepted' && row.room_id) {
        roomId = row.room_id;
        alreadyAccepted = true;
        await client.query('COMMIT');
        break;
      } else if (row.status !== 'pending') {
        const error = new Error('Challenge has already been handled');
        error.status = 409;
        throw error;
      } else {
        roomId = randomUUID();
        const code = await createUniqueRoomCode(client);
        const roomCategory = String(challenge.topic || challenge.category || 'General').slice(0, 80);
        const roomDifficulty = ['easy', 'medium', 'hard'].includes(String(challenge.difficulty).toLowerCase())
          ? String(challenge.difficulty).toLowerCase()
          : 'easy';
        const roomLimit = Number(challenge.question_limit) || 10;
        const customQIds = challenge.custom_question_ids
          ? (typeof challenge.custom_question_ids === 'string' ? challenge.custom_question_ids : JSON.stringify(challenge.custom_question_ids))
          : null;

        try {
          await client.query(
            `INSERT INTO rooms (id, code, host_user_id, mode, category, difficulty, question_limit, max_players, is_private, custom_question_ids)
             VALUES ($1, $2, $3, 'friends', $4, $5, $6, 2, TRUE, $7)`,
            [roomId, code, row.challenger_id, roomCategory, roomDifficulty, roomLimit, customQIds]
          );
        } catch (_) {
          await client.query(
            `INSERT INTO rooms (id, code, host_user_id, mode, category, difficulty, question_limit, max_players, is_private)
             VALUES ($1, $2, $3, 'friends', $4, $5, $6, 2, TRUE)`,
            [roomId, code, row.challenger_id, roomCategory, roomDifficulty, roomLimit]
          );
        }
        await client.query(
          `INSERT INTO room_players (room_id, user_id, role, ready)
           VALUES ($1, $2, 'host', TRUE), ($1, $3, 'player', FALSE)`,
          [roomId, row.challenger_id, row.challenged_id]
        );
        const endsAt = new Date(Date.now() + 10 * 60 * 1000);
        await client.query(
          `UPDATE challenges SET status = 'accepted', room_id = $2, starts_at = NOW(), ends_at = $3 WHERE id = $1`,
          [row.id, roomId, endsAt]
        );
        await client.query('COMMIT');
        break;
      }
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === 'ER_LOCK_DEADLOCK' && attempt < 4) {
        await new Promise((r) => setTimeout(r, Math.random() * 25 + 5));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  const updated = await challengeSnapshot(challengeId);
  if (!alreadyAccepted) {
    const { emitToUser } = require('./notification.service');
    await notifyUser(req, updated.challenger_id, 'challenge:accepted', {
      title: 'Challenge accepted',
      body: `${user.display_name} accepted your challenge.`,
      data: { challengeId: updated.id, roomId },
      challenge: updated,
    });
    if (req) {
      emitToUser(req, updated.challenged_id, 'challenge:accepted', {
        challengeId: updated.id,
        roomId,
        challenge: updated,
      });
    }
  }

  return { challenge: updated, roomId };
}

async function declineChallenge(challengeId, user, req) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge) {
    const error = new Error('Challenge not found');
    error.status = 404;
    throw error;
  }
  if (challenge.challenged_id !== user.id) {
    const error = new Error('Only the challenged user can decline this pending challenge');
    error.status = 403;
    throw error;
  }

  const updated = await query("UPDATE challenges SET status = 'declined' WHERE id = $1 AND status = 'pending'", [challenge.id]);
  if (!updated.result?.affectedRows) {
    const check = await query('SELECT status FROM challenges WHERE id = $1', [challenge.id]);
    if (check.rows[0]?.status === 'declined') {
      return { declined: true };
    }
    const error = new Error('Challenge has already been handled');
    error.status = 409;
    throw error;
  }
  await notifyUser(req, challenge.challenger_id, 'challenge:declined', {
    title: 'Challenge declined',
    body: `${user.display_name} declined your challenge.`,
    data: { challengeId: challenge.id },
  });
  if (req) {
    const { emitToUser } = require('./notification.service');
    emitToUser(req, challenge.challenged_id, 'challenge:declined', {
      challengeId: challenge.id,
    });
  }

  return { declined: true };
}

async function joinChallenge(challengeId, userId) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge) {
    const error = new Error('Challenge not found');
    error.status = 404;
    throw error;
  }
  if (![challenge.challenger_id, challenge.challenged_id].includes(userId)) {
    const error = new Error('This challenge is private');
    error.status = 403;
    throw error;
  }
  if (challenge.status !== 'accepted') {
    const error = new Error('Challenge is not in an active accepted state');
    error.status = 410;
    throw error;
  }

  if (challenge.room_id) {
    const { rows: roomRows } = await query('SELECT status FROM rooms WHERE id = $1', [challenge.room_id]);
    if (roomRows[0] && (roomRows[0].status === 'cancelled' || roomRows[0].status === 'completed' || roomRows[0].status === 'closed')) {
      const error = new Error('This match has been cancelled');
      error.status = 410;
      throw error;
    }
  }

  return { challenge, roomId: challenge.room_id, gameId: challenge.game_id };
}

async function completeChallenge(challengeId) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge?.game_id) {
    const error = new Error('Challenge game not found');
    error.status = 404;
    throw error;
  }

  const leaderboard = await getLeaderboard(challenge.game_id);
  const winner = leaderboard[0]?.user_id || null;
  await query(
    `UPDATE challenges
     SET status = 'completed', winner_user_id = $2
     WHERE id = $1`,
    [challenge.id, winner]
  );

  return { leaderboard, winnerUserId: winner };
}

async function cancelChallenge(challengeId, userId, req = null) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge) {
    const error = new Error('Challenge not found');
    error.status = 404;
    throw error;
  }
  if (![challenge.challenger_id, challenge.challenged_id].includes(userId)) {
    const error = new Error('Only participants can cancel this challenge');
    error.status = 403;
    throw error;
  }
  if (!['pending', 'accepted'].includes(challenge.status)) {
    const error = new Error('Challenge has already reached a terminal state');
    error.status = 409;
    throw error;
  }

  // If this challenge was accepted and has an associated room before game start:
  if (challenge.status === 'accepted' && challenge.room_id) {
    const { cancelRoomBeforeStart } = require('./room.service');
    const io = req?.app?.get('io');
    await cancelRoomBeforeStart(challenge.room_id, userId, io);
    return { cancelled: true };
  }

  await query("UPDATE challenges SET status = 'cancelled' WHERE id = $1", [challenge.id]);
  if (challenge.room_id) {
    await query("UPDATE rooms SET status = 'cancelled' WHERE id = $1 AND status = 'waiting'", [challenge.room_id]);
  }

  if (req) {
    const { emitToUser } = require('./notification.service');
    const otherUserId = challenge.challenger_id === userId ? challenge.challenged_id : challenge.challenger_id;
    await notifyUser(req, otherUserId, 'challenge:cancelled', {
      title: 'Challenge cancelled',
      body: 'The challenge was cancelled.',
      data: { challengeId: challenge.id },
    });
    emitToUser(req, userId, 'challenge:cancelled', { challengeId: challenge.id });
  }

  return { cancelled: true };
}

async function abortChallenge(challengeId, userId) {
  const challenge = await challengeSnapshot(challengeId);
  if (!challenge) {
    return { aborted: true }; // safe/idempotent
  }
  if (![challenge.challenger_id, challenge.challenged_id].includes(userId)) {
    const error = new Error('Only participants can abort this challenge');
    error.status = 403;
    throw error;
  }

  // Mark as dismissed for the requesting user
  if (challenge.challenger_id === userId) {
    await query('UPDATE challenges SET challenger_dismissed = TRUE WHERE id = $1', [challenge.id]);
  }
  if (challenge.challenged_id === userId) {
    await query('UPDATE challenges SET challenged_dismissed = TRUE WHERE id = $1', [challenge.id]);
  }

  const { rows } = await query('SELECT challenger_dismissed, challenged_dismissed FROM challenges WHERE id = $1', [challenge.id]);
  if (rows[0]?.challenger_dismissed && rows[0]?.challenged_dismissed) {
    await query('DELETE FROM challenges WHERE id = $1', [challenge.id]);
  }

  return { aborted: true };
}

module.exports = {
  challengeSnapshot,
  getSuggestions,
  listChallenges,
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  abortChallenge,
  joinChallenge,
  completeChallenge,
};
