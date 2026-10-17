const { query, connect } = require('../db/pool');
const { randomUUID } = require('crypto');

/**
 * Player Rejoin/Reconnection Service
 * Handles player disconnections and reconnections during active games
 */

async function recordPlayerDisconnection(gameId, roomId, userId, currentQuestionIndex) {
  if (!gameId || !userId) {
    console.log(`[REJOIN_SKIP] Cannot record disconnection: missing gameId (${gameId}) or userId (${userId})`);
    return { ok: false, skipped: true, reason: 'missing_ids' };
  }

  // Authoritatively verify game is active and resolve roomId if missing
  const { rows: gameRows } = await query(
    'SELECT id, status, room_id FROM games WHERE id = $1',
    [gameId]
  );
  if (!gameRows[0] || gameRows[0].status !== 'active') {
    console.log(`[REJOIN_SKIP] Game ${gameId} is not active (status: ${gameRows[0]?.status}). Skipping rejoin record.`);
    return { ok: false, skipped: true, reason: 'game_not_active' };
  }

  const resolvedRoomId = roomId || gameRows[0].room_id;
  if (!resolvedRoomId) {
    console.log(`[REJOIN_SKIP] No valid roomId for game ${gameId}. Skipping.`);
    return { ok: false, skipped: true, reason: 'no_room_id' };
  }

  console.log(`[PLAYER_DISCONNECT] userId: ${userId} gameId: ${gameId} roomId: ${resolvedRoomId}`);
  const client = await connect();
  try {
    await client.query('BEGIN');

    // Record disconnection in rejoin sessions
    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO player_rejoin_sessions (
         id, game_id, room_id, user_id, current_question_index, is_active
       ) VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [sessionId, gameId, resolvedRoomId, userId, currentQuestionIndex ?? 0]
    );

    // Mark player as disconnected in game_scores if they had answered
    await client.query(
      `UPDATE game_scores 
       SET completion_status = 'disconnected'
       WHERE game_id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    await client.query('COMMIT');
    return { sessionId, ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function canPlayerRejoin(gameId, userId) {
  const { rows } = await query(
    `SELECT g.id, g.status, g.current_question_index, r.id as room_id, g.mode
     FROM games g
     LEFT JOIN rooms r ON r.id = g.room_id
     WHERE g.id = $1
       AND (g.mode IS NULL OR g.mode != 'ai')
       AND g.room_id IS NOT NULL`,
    [gameId]
  );

  if (rows.length === 0) {
    const { rows: anyGame } = await query('SELECT id, status FROM games WHERE id = $1', [gameId]);
    if (!anyGame[0]) {
      return {
        canRejoin: false,
        reason: 'Game not found',
        status: 404,
      };
    }
    if (anyGame[0].status !== 'active') {
      return {
        canRejoin: false,
        reason: 'Game already finished. Cannot rejoin.',
        status: 409,
      };
    }
    return {
      canRejoin: false,
      reason: 'Game not found, is not active, or is an AI single-player match',
      status: 400,
    };
  }

  const game = rows[0];
  if (game.status !== 'active') {
    return {
      canRejoin: false,
      reason: 'Game already finished. Cannot rejoin.',
      status: 409,
    };
  }

  // Check if player is part of this game
  const playerResult = await query(
    `SELECT 1 FROM game_scores WHERE game_id = $1 AND user_id = $2
     UNION
     SELECT 1 FROM room_players WHERE room_id = $3 AND user_id = $2`,
    [gameId, userId, game.room_id]
  );

  if (playerResult.rows.length === 0) {
    return {
      canRejoin: false,
      reason: 'Player not part of this game',
      status: 403,
    };
  }

  return {
    canRejoin: true,
    game: {
      gameId: game.id,
      status: game.status,
      currentQuestionIndex: game.current_question_index,
      roomId: game.room_id,
    },
  };
}

async function rejoinGame(gameId, userId) {
  const check = await canPlayerRejoin(gameId, userId);
  if (!check.canRejoin) {
    const error = new Error(check.reason || 'Cannot rejoin match');
    error.status = check.status || 409;
    throw error;
  }

  // Mark rejoin session as reconnected
  await query(
    `UPDATE player_rejoin_sessions 
     SET reconnected_at = NOW(), is_active = FALSE
     WHERE game_id = $1 AND user_id = $2 AND is_active = TRUE`,
    [gameId, userId]
  );

  // Restore game_scores from disconnected state
  await query(
    `UPDATE game_scores 
     SET completion_status = 'completed'
     WHERE game_id = $1 AND user_id = $2 AND completion_status = 'disconnected'`,
    [gameId, userId]
  );

  const gameState = await getRejoinGameState(gameId, userId);
  return { ok: true, gameState };
}

async function getRejoinGameState(gameId, userId) {
  console.log(`[PLAYER_RECONNECT] userId: ${userId} gameId: ${gameId}`);
  const { rows: gameRows } = await query(
    `SELECT id, status, current_question_index, room_id
     FROM games
     WHERE id = $1`,
    [gameId]
  );

  if (gameRows.length === 0) {
    const error = new Error('Game not found');
    error.status = 404;
    throw error;
  }

  const game = gameRows[0];
  if (game.status !== 'active') {
    const error = new Error('Game already finished. Cannot rejoin.');
    error.status = 409;
    throw error;
  }

  // Get current question with start timestamp
  const { rows: questionRows } = await query(
    `SELECT 
       g.id AS game_id,
       g.current_question_index,
       g.status,
       g.updated_at AS question_started_at,
       q.id AS question_id,
       q.prompt,
       q.options,
       q.category,
       q.difficulty,
       q.correct_option,
       q.explanation,
       q.time_limit_seconds,
       gq.sort_order
     FROM games g
     JOIN game_questions gq ON gq.game_id = g.id AND gq.sort_order = g.current_question_index
     JOIN questions q ON q.id = gq.question_id
     WHERE g.id = $1`,
    [gameId]
  );

  if (questionRows.length === 0) {
    throw new Error('No active question found');
  }

  const question = questionRows[0];
  const nowMs = Date.now();
  const startedAtMs = new Date(question.question_started_at || Date.now()).getTime();
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const timeLimitSeconds = Number(question.time_limit_seconds || 15);
  const remainingSeconds = Math.max(0, timeLimitSeconds - elapsedSeconds);

  // Get current leaderboard
  const { rows: leaderboardRows } = await query(
    `SELECT 
       gs.user_id,
       gs.score,
       gs.correct_answers,
       gs.fast_answers,
       u.username,
       u.display_name,
       u.avatar_url
     FROM game_scores gs
     JOIN users u ON u.id = gs.user_id
     WHERE gs.game_id = $1
     ORDER BY gs.score DESC`,
    [gameId]
  );

  // Get player's current answers (to help UI know what they've already answered)
  const { rows: answeredRows } = await query(
    `SELECT question_id FROM answers WHERE game_id = $1 AND user_id = $2`,
    [gameId, userId]
  );

  const answeredQuestionIds = new Set(answeredRows.map(row => row.question_id));

  // Mark rejoin session as reconnected
  await query(
    `UPDATE player_rejoin_sessions 
     SET reconnected_at = NOW(), is_active = FALSE
     WHERE game_id = $1 AND user_id = $2 AND is_active = TRUE`,
    [gameId, userId]
  );

  await query(
    `UPDATE game_scores 
     SET completion_status = 'completed'
     WHERE game_id = $1 AND user_id = $2 AND completion_status = 'disconnected'`,
    [gameId, userId]
  );

  return {
    game: {
      id: game.id,
      status: game.status,
      currentQuestionIndex: game.current_question_index,
      roomId: game.room_id,
    },
    question: (() => {
      const rawRejoinOpts = typeof question.options === 'string' ? JSON.parse(question.options) : (question.options || []);
      const dbRejoinCorrect = String(question.correct_option || '').trim();
      let correctRejoinText = rawRejoinOpts[0];
      if (dbRejoinCorrect.length === 1 && /^[A-D]$/i.test(dbRejoinCorrect)) {
        const idx = dbRejoinCorrect.toUpperCase().charCodeAt(0) - 65;
        if (rawRejoinOpts[idx]) correctRejoinText = rawRejoinOpts[idx];
      } else {
        const found = rawRejoinOpts.find((o) => String(o).trim().toLowerCase() === dbRejoinCorrect.toLowerCase());
        if (found) correctRejoinText = found;
      }
      const wrongRejoinOpts = rawRejoinOpts.filter((o) => o !== correctRejoinText);
      const randomRejoinWrong = wrongRejoinOpts.length > 0 ? wrongRejoinOpts[Math.floor(Math.random() * wrongRejoinOpts.length)] : null;
      const rejoinFiftyFifty = rawRejoinOpts.filter((o) => o === correctRejoinText || o === randomRejoinWrong);

      return {
        id: question.question_id,
        prompt: question.prompt,
        options: rawRejoinOpts,
        category: question.category,
        difficulty: question.difficulty,
        explanation: question.explanation,
        timeLimitSeconds: question.time_limit_seconds,
        remainingSeconds,
        serverTime: nowMs,
        startedAtMs,
        sortOrder: question.sort_order,
        fifty_fifty_options: rejoinFiftyFifty,
        fiftyFiftyOptions: rejoinFiftyFifty,
      };
    })(),
    leaderboard: leaderboardRows.map(row => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      score: row.score,
      correctAnswers: row.correct_answers,
      fastAnswers: row.fast_answers,
    })),
    answeredQuestionIds: Array.from(answeredQuestionIds),
  };
}

async function getPlayerRejoinSessions(gameId) {
  const { rows } = await query(
    `SELECT 
       prs.id,
       prs.user_id,
       prs.disconnected_at,
       prs.reconnected_at,
       prs.current_question_index,
       u.username,
       u.display_name
     FROM player_rejoin_sessions prs
     JOIN users u ON u.id = prs.user_id
     WHERE prs.game_id = $1 AND prs.is_active = TRUE
     ORDER BY prs.disconnected_at ASC`,
    [gameId]
  );

  return rows.map(row => ({
    sessionId: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    disconnectedAt: row.disconnected_at,
    reconnectedAt: row.reconnected_at,
    currentQuestionIndex: row.current_question_index,
    isActive: !row.reconnected_at,
  }));
}

async function getGameParticipants(gameId) {
  const { rows } = await query(
    `SELECT 
       gs.user_id,
       u.username,
       u.display_name,
       u.avatar_url,
       gs.score,
       gs.correct_answers,
       gs.completion_status,
       CASE 
         WHEN prs.is_active = TRUE THEN 'disconnected'
         WHEN prs.is_active = FALSE AND prs.reconnected_at IS NOT NULL THEN 'reconnected'
         ELSE 'active'
       END as connection_status
     FROM game_scores gs
     JOIN users u ON u.id = gs.user_id
     LEFT JOIN player_rejoin_sessions prs ON prs.game_id = gs.game_id AND prs.user_id = gs.user_id AND prs.is_active = TRUE
     WHERE gs.game_id = $1
     ORDER BY gs.score DESC`,
    [gameId]
  );

  return rows.map(row => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    score: row.score,
    correctAnswers: row.correct_answers,
    completionStatus: row.completion_status,
    connectionStatus: row.connection_status,
    status: row.connection_status === 'disconnected' ? 'disconnected' : 'active',
    isDisconnected: row.connection_status === 'disconnected',
  }));
}

async function handlePlayerTimeout(gameId, userId) {
  // If a player doesn't return within a certain time, mark their game as abandoned
  const client = await connect();
  try {
    await client.query('BEGIN');

    // Check if player already answered current question
    const { rows: gameRows } = await query(
      `SELECT current_question_index FROM games WHERE id = $1`,
      [gameId]
    );

    if (gameRows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const currentQuestionIndex = gameRows[0].current_question_index;

    // If player hasn't answered current question, mark it as incorrect
    const { rows: answerRows } = await query(
      `SELECT * FROM answers 
       WHERE game_id = $1 AND user_id = $2 AND question_id IN (
         SELECT question_id FROM game_questions WHERE game_id = $1 AND sort_order = $3
       )`,
      [gameId, userId, currentQuestionIndex]
    );

    if (answerRows.length === 0) {
      // Auto-submit an incorrect answer
      const { rows: questionRows } = await query(
        `SELECT question_id FROM game_questions WHERE game_id = $1 AND sort_order = $2`,
        [gameId, currentQuestionIndex]
      );

      if (questionRows.length > 0) {
        await client.query(
          `INSERT INTO answers (id, game_id, user_id, question_id, selected_option, is_correct, answered_in_ms)
           VALUES ($1, $2, $3, $4, $5, FALSE, 0)`,
          [randomUUID(), gameId, userId, questionRows[0].question_id, 'timeout']
        );
      }
    }

    // Mark rejoin session as closed
    await client.query(
      `UPDATE player_rejoin_sessions 
       SET is_active = FALSE
       WHERE game_id = $1 AND user_id = $2 AND is_active = TRUE`,
      [gameId, userId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getActiveGameForUser(userId) {
  const { rows } = await query(
    `SELECT g.id as game_id, g.status, g.mode, g.current_question_index, g.room_id,
            r.room_name, r.category AS room_category, r.difficulty,
            COALESCE((SELECT q.category
                      FROM game_questions gq
                      JOIN questions q ON q.id = gq.question_id
                      WHERE gq.game_id = g.id
                      ORDER BY gq.sort_order ASC
                      LIMIT 1), r.category, 'General') AS category,
            (SELECT COUNT(*) FROM game_questions gq WHERE gq.game_id = g.id) AS total_questions
     FROM games g
     LEFT JOIN rooms r ON r.id = g.room_id
     WHERE g.status = 'active'
       AND (g.created_by = $1 OR EXISTS (
         SELECT 1 FROM game_scores gs WHERE gs.game_id = g.id AND gs.user_id = $1
       ))
     ORDER BY g.created_at DESC
     LIMIT 10`,
    [userId]
  );

  if (rows.length === 0) {
    return { hasActiveGame: false };
  }

  const games = rows.map((active) => ({
    gameId: active.game_id,
    status: active.status,
    mode: active.mode || 'room',
    currentQuestionIndex: Number(active.current_question_index || 0),
    totalQuestions: Number(active.total_questions || 0),
    roomId: active.room_id,
    roomName: active.room_name || (active.mode === 'ai' ? 'AI Match' : 'Multiplayer Match'),
    category: active.category || active.room_category || 'General',
    difficulty: active.difficulty || 'medium',
  }));

  return {
    hasActiveGame: true,
    game: games[0],
    games,
  };
}

async function getCategoryProgressForUser(userId) {
  const { rows } = await query(
    `SELECT q.category,
            COUNT(DISTINCT q.id) AS total_questions,
            COUNT(DISTINCT a.question_id) AS completed_questions,
            MAX(a.answered_at) AS last_played_at,
            CASE WHEN MAX(g.mode = 'ai') = 1 THEN 'ai' ELSE 'friend' END AS mode
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     JOIN games g ON g.id = a.game_id
     WHERE a.user_id = $1
     GROUP BY q.category
     ORDER BY last_played_at DESC
     LIMIT 10`,
    [userId]
  );

  return rows.map((row) => ({
    category: row.category || 'General',
    totalQuestions: Number(row.total_questions || 0),
    completedQuestions: Number(row.completed_questions || 0),
    lastPlayedAt: row.last_played_at,
    mode: row.mode === 'ai' ? 'ai' : 'friend',
  }));
}

module.exports = {
  recordPlayerDisconnection,
  canPlayerRejoin,
  rejoinGame,
  getRejoinGameState,
  getPlayerRejoinSessions,
  getGameParticipants,
  handlePlayerTimeout,
  getActiveGameForUser,
  getCategoryProgressForUser,
};
