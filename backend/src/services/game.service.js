const { query, connect } = require('../db/pool');
const { randomUUID } = require('crypto');
const { updateUserStatsAfterGame } = require('./achievement.service');
const { saveMatchStatistics } = require('./matchHistory.service');
const { applyWalletTransaction } = require('./wallet.service');

async function selectQuestions({ category = null, limit = 10, difficulty = null, level = 1, playerIds = [] }) {
  const cleanCategory = typeof category === 'string' ? category.trim() : null;
  const queryCategory = cleanCategory && cleanCategory !== 'All' && cleanCategory !== 'undefined' && cleanCategory !== 'null' ? cleanCategory : null;
  const targetLevel = Number(level) || 1;
  const targetLimit = Number(limit) || 10;
  const cleanDifficulty = difficulty ? String(difficulty).trim().toLowerCase() : null;
  if (cleanDifficulty && !['easy', 'medium', 'hard'].includes(cleanDifficulty)) {
    const error = new Error('difficulty must be easy, medium, or hard');
    error.status = 400;
    throw error;
  }

  // Keep a single authoritative set, but rank it for the people who will play.
  // Old questions remain eligible after unseen questions are exhausted.
  const participantIds = [...new Set(playerIds.filter(Boolean).map(String))];
  const filters = [];
  const params = [];
  if (queryCategory) {
    filters.push(`q.category = $${params.length + 1}`);
    params.push(queryCategory);
  }
  if (cleanDifficulty) {
    filters.push(`q.difficulty = $${params.length + 1}`);
    params.push(cleanDifficulty);
  }
  const seenSelect = participantIds.length
    ? `COALESCE(SUM(CASE WHEN a.user_id IN (${participantIds.map((_, i) => `$${params.length + i + 1}`).join(', ')}) THEN 1 ELSE 0 END), 0) AS seen_count`
    : '0 AS seen_count';
  params.push(...participantIds);
  const candidates = await query(
    `SELECT q.id, q.level, q.category, q.difficulty, q.prompt, q.options, q.time_limit_seconds,
            ${seenSelect}
     FROM questions q
     LEFT JOIN answers a ON a.question_id = q.id
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     GROUP BY q.id, q.level, q.category, q.difficulty, q.prompt, q.options, q.time_limit_seconds
     ORDER BY seen_count ASC, ABS(q.level - $${params.length + 1}) ASC, RAND()`,
    [...params, targetLevel]
  );

  if (candidates.rows.length < targetLimit) {
    const scope = queryCategory || 'the selected categories';
    const detail = cleanDifficulty ? ` at ${cleanDifficulty} difficulty` : '';
    console.log(`[QUESTION_SUPPLEMENT] Requested ${targetLimit} from ${scope}${detail}, found ${candidates.rows.length}. Supplementing from general pool.`);
    
    // Supplement from other questions so the match starts reliably
    const existingIds = candidates.rows.map(r => `'${r.id}'`);
    const notInClause = existingIds.length ? `WHERE q.id NOT IN (${existingIds.join(',')})` : '';
    const fallbackRes = await query(
      `SELECT q.id, q.level, q.category, q.difficulty, q.prompt, q.options, q.time_limit_seconds, 0 AS seen_count
       FROM questions q
       ${notInClause}
       ORDER BY RAND()
       LIMIT $1`,
      [targetLimit - candidates.rows.length]
    );
    candidates.rows.push(...fallbackRes.rows);
  }

  return candidates.rows.slice(0, targetLimit);
}

async function startGame({ roomId, tournamentId, mode, category, difficulty, questionLimit = 10, createdBy, level = 1, aiBotName = null, aiLevel = null, customQuestionIds = null }) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    if (roomId && mode === 'room') {
      const lockedRoom = await client.query('SELECT status, active_game_id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
      if (lockedRoom.rows[0]?.status !== 'waiting') {
        if (lockedRoom.rows[0]?.active_game_id) {
          const existing = await client.query('SELECT * FROM games WHERE id = $1', [lockedRoom.rows[0].active_game_id]);
          if (existing.rows[0]) {
            await client.query('COMMIT');
            return existing.rows[0];
          }
        }
        const error = new Error('Room game has already started');
        error.status = 409;
        throw error;
      }
      const readyPlayers = await client.query('SELECT user_id, ready FROM room_players WHERE room_id = $1', [roomId]);
      if (readyPlayers.rows.length < 2 || readyPlayers.rows.some((player) => !(player.ready === true || player.ready === 1 || player.ready === '1'))) {
        const error = new Error('All players must be ready before starting');
        error.status = 400;
        throw error;
      }
    }
    let participantIds = [createdBy].filter(Boolean);
    if (roomId) {
      const participants = await client.query('SELECT user_id FROM room_players WHERE room_id = $1', [roomId]);
      participantIds = participants.rows.map((row) => row.user_id);
    } else if (tournamentId) {
      const participants = await client.query('SELECT user_id FROM tournament_players WHERE tournament_id = $1', [tournamentId]);
      participantIds = participants.rows.map((row) => row.user_id);
    }

    let questions = [];
    if (customQuestionIds && Array.isArray(customQuestionIds) && customQuestionIds.length > 0) {
      try {
        const { rows } = await client.query(
          `SELECT q.id, q.level, q.category, q.difficulty, q.prompt, q.options, q.time_limit_seconds
           FROM questions q
           WHERE q.id IN (${customQuestionIds.map((_, i) => `$${i + 1}`).join(', ')})`,
          customQuestionIds
        );
        const idMap = new Map(rows.map((q) => [q.id, q]));
        questions = customQuestionIds.map((id) => idMap.get(id)).filter(Boolean);
      } catch (customErr) {
        console.warn('[GameService] Failed to load custom question IDs, falling back to selectQuestions:', customErr.message);
      }
    }

    if (!questions.length) {
      questions = await selectQuestions({ category, difficulty, limit: questionLimit, level, playerIds: participantIds });
    }
    if (!questions.length) {
      throw new Error(`No questions are available for the match.`);
    }
    const gameId = randomUUID();

    const entryFee = 100;
    let entryUsers = participantIds;

    if (roomId && mode !== 'ai') {
      const participants = await client.query(
        `SELECT user_id
         FROM room_players
         WHERE room_id = $1`,
        [roomId]
      );
      entryUsers = participants.rows.map((row) => row.user_id);
    }

    if (mode === 'ai') {
      // In AI mode, deduct fee only if user has sufficient coins, otherwise allow free practice
      for (const userId of entryUsers) {
        const userWallet = await client.query('SELECT coins FROM users WHERE id = $1', [userId]);
        const currentCoins = Number(userWallet.rows[0]?.coins || 0);
        if (currentCoins >= entryFee) {
          await applyWalletTransaction({
            client,
            userId,
            amount: -entryFee,
            reason: 'quiz_entry_fee',
            referenceType: 'game',
            referenceId: gameId,
          });
        }
      }
    } else if (mode === 'tournament') {
      // In tournament mode, entry fees are handled at tournament join/registration
    } else {
      for (const userId of entryUsers) {
        await applyWalletTransaction({
          client,
          userId,
          amount: -entryFee,
          reason: 'quiz_entry_fee',
          referenceType: 'game',
          referenceId: gameId,
        });
      }
    }

    try {
      await client.query(
        `INSERT INTO games (id, room_id, tournament_id, mode, status, current_question_index, created_by, ai_bot_name, ai_level)
         VALUES ($1, $2, $3, $4, 'active', 0, $5, $6, $7)`,
        [gameId, roomId || null, tournamentId || null, mode, createdBy, aiBotName || null, aiLevel || null]
      );
    } catch (insertErr) {
      if (insertErr.message && (insertErr.message.includes('ai_bot_name') || String(insertErr.code) === 'ER_BAD_FIELD_ERROR')) {
        try {
          await query('ALTER TABLE games ADD COLUMN ai_bot_name VARCHAR(100) NULL');
        } catch (_) {}
        try {
          await query('ALTER TABLE games ADD COLUMN ai_level INT NULL');
        } catch (_) {}
        try {
          await client.query(
            `INSERT INTO games (id, room_id, tournament_id, mode, status, current_question_index, created_by, ai_bot_name, ai_level)
             VALUES ($1, $2, $3, $4, 'active', 0, $5, $6, $7)`,
            [gameId, roomId || null, tournamentId || null, mode, createdBy, aiBotName || null, aiLevel || null]
          );
        } catch (retryErr) {
          await client.query(
            `INSERT INTO games (id, room_id, tournament_id, mode, status, current_question_index, created_by)
             VALUES ($1, $2, $3, $4, 'active', 0, $5)`,
            [gameId, roomId || null, tournamentId || null, mode, createdBy]
          );
        }
      } else {
        throw insertErr;
      }
    }

    for (let index = 0; index < questions.length; index += 1) {
      await client.query(
        `INSERT IGNORE INTO game_questions (game_id, question_id, sort_order)
         VALUES ($1, $2, $3)`,
        [gameId, questions[index].id, index]
      );
    }

    if (roomId) {
      // Give every room participant a score row before the first answer. This
      // lets a player who disconnects early be tracked and rejoin the match.
      await client.query(
        `INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers, fast_answers)
         SELECT $1, user_id, 0, 0, 0
         FROM room_players
         WHERE room_id = $2`,
        [gameId, roomId]
      );
      await client.query(
        `UPDATE rooms SET status = 'in_game', active_game_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [gameId, roomId]
      );
      await client.query(
        `UPDATE challenges SET game_id = $1 WHERE room_id = $2 AND status = 'accepted'`,
        [gameId, roomId]
      );
    }

    await client.query('COMMIT');
    const game = await query('SELECT * FROM games WHERE id = $1', [gameId]);
    return game.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getCurrentQuestion(gameId, userId = null) {
  const gameRes = await query('SELECT id, mode, status, current_question_index FROM games WHERE id = $1', [gameId]);
  const game = gameRes.rows[0];
  if (!game) return null;

  let targetIndex = Number(game.current_question_index || 0);
  if (game.mode === 'tournament' && userId) {
    const ansRes = await query(
      'SELECT COUNT(*) AS answered FROM answers WHERE game_id = $1 AND user_id = $2',
      [gameId, userId]
    );
    targetIndex = Number(ansRes.rows[0]?.answered || 0);
  }

  const { rows } = await query(
    `SELECT g.id AS game_id,
            $2 AS current_question_index,
            g.status,
            q.id AS question_id,
            q.prompt,
            q.options,
            q.correct_option,
            q.category,
            q.difficulty,
            q.explanation,
            q.time_limit_seconds,
            gq.sort_order
     FROM games g
     JOIN game_questions gq ON gq.game_id = g.id AND gq.sort_order = $2
     JOIN questions q ON q.id = gq.question_id
     WHERE g.id = $1`,
    [gameId, targetIndex]
  );
  const rawQ = rows[0];
  if (!rawQ) return null;

  // Safe server-side generation of 50:50 options:
  // Exactly 1 guaranteed correct option + 1 random wrong option (preserving original relative order)
  const rawOpts = Array.isArray(rawQ.options)
    ? rawQ.options
    : (typeof rawQ.options === 'string' ? JSON.parse(rawQ.options) : []);

  const dbCorrect = String(rawQ.correct_option || '').trim();
  let correctText = rawOpts[0];
  if (dbCorrect.length === 1 && /^[A-D]$/i.test(dbCorrect)) {
    const idx = dbCorrect.toUpperCase().charCodeAt(0) - 65;
    if (rawOpts[idx]) correctText = rawOpts[idx];
  } else {
    const found = rawOpts.find((o) => String(o).trim().toLowerCase() === dbCorrect.toLowerCase());
    if (found) correctText = found;
  }

  const wrongOpts = rawOpts.filter((o) => o !== correctText);
  const randomWrong = wrongOpts.length > 0
    ? wrongOpts[Math.floor(Math.random() * wrongOpts.length)]
    : null;

  const fiftyFiftyOptions = rawOpts.filter((o) => o === correctText || o === randomWrong);

  const { correct_option, ...sanitized } = rawQ;
  return {
    ...sanitized,
    fifty_fifty_options: fiftyFiftyOptions,
  };
}

const activeGameLifelines = new Map();

async function usePlayerLifeline({ gameId, userId, questionId, lifeline }) {
  if (lifeline === 'fiftyFifty') {
    const currentQ = await getCurrentQuestion(gameId, userId);
    if (!currentQ || currentQ.question_id !== questionId) {
      throw new Error('Question has expired or already changed');
    }
    return {
      ok: true,
      lifeline: 'fiftyFifty',
      remainingOptions: currentQ.fifty_fifty_options || [],
    };
  }

  if (lifeline !== 'extraTime') {
    return { ok: true, lifeline };
  }

  const { rows: gameRows } = await query(
    `SELECT id, status, current_question_index FROM games WHERE id = $1`,
    [gameId]
  );
  if (gameRows.length === 0 || gameRows[0].status !== 'active') {
    throw new Error('Game is not currently active');
  }

  const key = `${gameId}:${userId}:extraTime`;
  if (activeGameLifelines.has(key)) {
    throw new Error('Extra Time lifeline has already been used in this match');
  }

  const currentQ = await getCurrentQuestion(gameId);
  if (!currentQ || currentQ.question_id !== questionId) {
    throw new Error('Question has expired or already changed');
  }

  activeGameLifelines.set(key, { questionId, usedAt: Date.now() });

  return {
    ok: true,
    lifeline: 'extraTime',
    extraSeconds: 10,
    newTimeLimitSeconds: Number(currentQ.time_limit_seconds || 15) + 10,
  };
}

function calculateAnswerCorrectness(rawOptions, correctOptionRaw, selectedOptionRaw) {
  const dbCorrect = String(correctOptionRaw || '').trim();
  const userSelected = String(selectedOptionRaw || '').trim();

  let options = [];
  try {
    const parsed = Array.isArray(rawOptions) ? rawOptions : (typeof rawOptions === 'string' ? JSON.parse(rawOptions) : []);
    options = (Array.isArray(parsed) ? parsed : []).map((opt) => String(opt || '').trim());
  } catch (_) {
    options = [];
  }

  function resolveIdx(val) {
    if (/^[0-3]$/.test(val)) return parseInt(val, 10);
    if (/^[A-D]$/i.test(val)) return val.toUpperCase().charCodeAt(0) - 65;
    return options.findIndex((opt) => opt.toLowerCase() === val.toLowerCase());
  }

  const cIdx = resolveIdx(dbCorrect);
  const sIdx = resolveIdx(userSelected);

  if (cIdx !== -1 && sIdx !== -1) {
    return cIdx === sIdx;
  }
  return userSelected.toLowerCase() === dbCorrect.toLowerCase();
}

async function submitAnswer(arg1, arg2, arg3) {
  let gameId, userId, questionId, selectedOption, answeredInMs;
  if (typeof arg1 === 'object' && arg1 !== null && !arg2) {
    ({ gameId, userId, questionId, selectedOption, answeredInMs } = arg1);
  } else {
    gameId = arg1;
    userId = arg2;
    ({ questionId, selectedOption, answeredInMs } = arg3 || {});
  }
  const client = await connect();
  try {
    await client.beginTransaction();

    // 1. Atomically lock and read the game row
    const gameRes = await client.query(
      'SELECT id, room_id, tournament_id, mode, status, current_question_index FROM games WHERE id = $1 FOR UPDATE',
      [gameId]
    );
    const game = gameRes.rows[0];
    if (!game) {
      const error = new Error('Game not found');
      error.status = 404;
      throw error;
    }
    if (game.status !== 'active') {
      const error = new Error('Game is not active');
      error.status = 409;
      throw error;
    }

    // 2. Fetch the question being answered using the submitted questionId
    const qRes = await client.query(
      'SELECT id, prompt, options, correct_option, explanation, time_limit_seconds FROM questions WHERE id = $1',
      [questionId]
    );
    const questionRow = qRes.rows[0];
    if (!questionRow) {
      const error = new Error('Question not found');
      error.status = 404;
      throw error;
    }

    // 3. Idempotency check: did this user already answer this exact question in this game?
    const prevAnswerRes = await client.query(
      'SELECT a.*, q.correct_option FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.game_id = $1 AND a.user_id = $2 AND a.question_id = $3',
      [gameId, userId, questionId]
    );
    if (prevAnswerRes.rows[0]) {
      await client.commit();
      return {
        ...prevAnswerRes.rows[0],
        correct_option: questionRow.correct_option,
        is_first: false,
        bonus_coins: 0,
        total_coins: 0,
        speed_points: 0,
        duplicate: true,
      };
    }

    // The server owns progression. A client may only answer its current locked
    // question (tournaments progress independently per player). This is after
    // the duplicate check so a lost response can safely be retried.
    let expectedIndex = Number(game.current_question_index || 0);
    if (game.mode === 'tournament') {
      const answeredCount = await client.query(
        'SELECT COUNT(*) AS answered FROM answers WHERE game_id = $1 AND user_id = $2',
        [gameId, userId]
      );
      expectedIndex = Number(answeredCount.rows[0]?.answered || 0);
    }
    const expectedQuestion = await client.query(
      'SELECT question_id FROM game_questions WHERE game_id = $1 AND sort_order = $2',
      [gameId, expectedIndex]
    );
    if (!expectedQuestion.rows[0] || String(expectedQuestion.rows[0].question_id) !== String(questionId)) {
      const error = new Error('Question has expired or is not active');
      error.status = 409;
      throw error;
    }

    // 4. Validate correctness using exact question options & correct_option
    const rawOptions = questionRow.options;
    const isCorrect = calculateAnswerCorrectness(
      rawOptions,
      questionRow.correct_option,
      selectedOption
    );
    const canonicalCorrectOption = questionRow.correct_option;

    console.log(
      `[ANSWER_VALIDATE]\ngameId=${gameId}\nuserId=${userId}\nquestionId=${questionId}\nselectedOption=${selectedOption}\ncorrectOption=${canonicalCorrectOption}\nisCorrect=${isCorrect}`
    );

    // 5. Lifeline, timing & scoring calculations
    const extraTimeKey = `${gameId}:${userId}:extraTime`;
    const extraTimeUsage = activeGameLifelines.get(extraTimeKey);
    const hasExtraTime = extraTimeUsage && extraTimeUsage.questionId === questionId;
    const extraSeconds = hasExtraTime ? 10 : 0;
    const baseTimeLimitSeconds = Number(questionRow.time_limit_seconds || 15);
    const totalTimeLimitSeconds = baseTimeLimitSeconds + extraSeconds;
    const timeLimitMs = Math.max(1, totalTimeLimitSeconds * 1000);
    const elapsedMs = Math.max(0, Number(answeredInMs || timeLimitMs));
    const basePoints = 100;

    const playerCountRes = await client.query(
      'SELECT COUNT(DISTINCT user_id) AS total_players FROM game_scores WHERE game_id = $1',
      [gameId]
    );
    let totalPlayersInMatch = Number(playerCountRes.rows[0]?.total_players || 1);
    if (totalPlayersInMatch <= 1 && game.room_id) {
      const roomPlayerRes = await client.query(
        'SELECT COUNT(DISTINCT user_id) AS total_room_players FROM room_players WHERE room_id = $1',
        [game.room_id]
      );
      totalPlayersInMatch = Math.max(totalPlayersInMatch, Number(roomPlayerRes.rows[0]?.total_room_players || 1));
    }
    const isMultiplayer = totalPlayersInMatch >= 2 || ['room', '1v1', 'challenge', 'tournament', 'pvp'].includes(game.mode);

    let isFirstCorrect = false;
    let bonusCoins = 0;
    let extraSpeedPoints = 0;
    let speedBonus = 0;

    if (isCorrect) {
      speedBonus = Math.round(100 * Math.max(0, timeLimitMs - elapsedMs) / timeLimitMs);

      if (isMultiplayer) {
        const existingCorrectAnswers = await client.query(
          'SELECT COUNT(*) AS count FROM answers WHERE game_id = $1 AND question_id = $2 AND is_correct = TRUE AND user_id != $3',
          [gameId, questionId, userId]
        );
        isFirstCorrect = Number(existingCorrectAnswers.rows[0]?.count || 0) === 0;

        if (isFirstCorrect) {
          extraSpeedPoints += 50;
          bonusCoins += 10;
        }

        if (elapsedMs <= 3000) {
          extraSpeedPoints += 25;
          bonusCoins += 5;
        } else if (elapsedMs <= 6000) {
          extraSpeedPoints += 10;
          bonusCoins += 2;
        }
      }
    }

    const scoreDelta = isCorrect ? (basePoints + speedBonus + extraSpeedPoints) : 0;
    const totalCoinsAwarded = isCorrect ? (25 + bonusCoins) : 0;

    const answerId = randomUUID();
    await client.query(
      `INSERT INTO answers (id, game_id, user_id, question_id, selected_option, is_correct, answered_in_ms, score_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [answerId, gameId, userId, questionId, selectedOption, isCorrect, answeredInMs || null, scoreDelta]
    );

    await client.query(
      `INSERT INTO game_scores (game_id, user_id, score, correct_answers, fast_answers)
       VALUES ($1, $2, $3, $4, $5)
       ON DUPLICATE KEY UPDATE
         score = (
           SELECT COALESCE(SUM(score_delta), 0)
           FROM answers
           WHERE game_id = $1 AND user_id = $2
         ),
         correct_answers = (
           SELECT COUNT(*) FROM answers
           WHERE game_id = $1 AND user_id = $2 AND is_correct = TRUE
         ),
         fast_answers = (
           SELECT COUNT(*) FROM answers
           WHERE game_id = $1 AND user_id = $2 AND is_correct = TRUE AND answered_in_ms <= 5000
         ),
         updated_at = NOW()`,
      [gameId, userId, scoreDelta, isCorrect ? 1 : 0, isCorrect && answeredInMs <= 5000 ? 1 : 0]
    );

    if (isCorrect && totalCoinsAwarded > 0) {
      try {
        await applyWalletTransaction({
          client,
          userId,
          amount: totalCoinsAwarded,
          reason: bonusCoins > 0 ? 'fast_answer_bonus' : 'quiz_correct_answer',
          referenceType: 'answer',
          referenceId: answerId,
        });
      } catch (walletErr) {
        console.error('[submitAnswer walletErr]:', walletErr);
      }
    }

    // 6. Check whether all active players answered that exact question
    // and if so, advance exactly once.
    let advanceResult = null;

    const currentQRes = await client.query(
      `SELECT gq.question_id, gq.sort_order
       FROM game_questions gq
       WHERE gq.game_id = $1 AND gq.sort_order = $2`,
      [gameId, game.current_question_index]
    );
    const activeQuestionId = currentQRes.rows[0]?.question_id;

    if (activeQuestionId && String(activeQuestionId) === String(questionId) && (game.room_id || game.mode === 'room')) {
      let activePlayerIds = [];
      if (game.room_id) {
        const roomPlayersRes = await client.query(
          `SELECT rp.user_id FROM room_players rp
           LEFT JOIN game_scores gs ON gs.game_id = $1 AND gs.user_id = rp.user_id
           WHERE rp.room_id = $2 AND (gs.completion_status IS NULL OR gs.completion_status != 'abandoned')`,
          [gameId, game.room_id]
        );
        activePlayerIds = roomPlayersRes.rows.map((r) => String(r.user_id));
      }
      if (activePlayerIds.length === 0) {
        const scoresRes = await client.query(
          `SELECT user_id FROM game_scores WHERE game_id = $1 AND (completion_status IS NULL OR completion_status != 'abandoned')`,
          [gameId]
        );
        activePlayerIds = scoresRes.rows.map((r) => String(r.user_id));
      }

      const answersRes = await client.query(
        'SELECT DISTINCT user_id FROM answers WHERE game_id = $1 AND question_id = $2',
        [gameId, questionId]
      );
      const answeredUserIds = new Set(answersRes.rows.map((r) => String(r.user_id)));
      const allPlayersAnswered = activePlayerIds.length > 0 && activePlayerIds.every((id) => answeredUserIds.has(id));

      if (allPlayersAnswered) {
        const totalQRes = await client.query(
          'SELECT COUNT(*) AS total FROM game_questions WHERE game_id = $1',
          [gameId]
        );
        const totalQuestions = Number(totalQRes.rows[0]?.total || 0);
        const oldIndex = Number(game.current_question_index || 0);
        const nextIndex = oldIndex + 1;

        if (nextIndex >= totalQuestions) {
          await client.query(
            `UPDATE games SET status = 'completed', ended_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [gameId]
          );
          if (game.room_id) {
            await client.query(
              `UPDATE rooms SET status = 'completed', updated_at = NOW() WHERE id = $1`,
              [game.room_id]
            );
          }
          advanceResult = {
            advanced: true,
            finished: true,
            oldIndex,
            newIndex: 'FINISHED',
            nextQuestion: null,
          };
        } else {
          await client.query(
            `UPDATE games SET current_question_index = $2, updated_at = NOW() WHERE id = $1`,
            [gameId, nextIndex]
          );
          const nextQRes = await client.query(
            `SELECT q.id AS question_id, q.prompt, q.options, q.category, q.difficulty, q.explanation, q.time_limit_seconds, gq.sort_order
             FROM game_questions gq
             JOIN questions q ON q.id = gq.question_id
             WHERE gq.game_id = $1 AND gq.sort_order = $2`,
            [gameId, nextIndex]
          );
          const nextQ = nextQRes.rows[0];
          advanceResult = {
            advanced: true,
            finished: false,
            oldIndex,
            newIndex: nextIndex,
            nextQuestion: nextQ ? {
              question_id: nextQ.question_id,
              prompt: nextQ.prompt,
              options: nextQ.options,
              current_question_index: nextIndex,
              sort_order: nextIndex,
              time_limit_seconds: nextQ.time_limit_seconds,
              category: nextQ.category,
              difficulty: nextQ.difficulty,
              explanation: nextQ.explanation,
            } : null,
          };
        }
      }
    }

    await client.commit();

    if (advanceResult?.advanced) {
      console.log(
        `[QUESTION_ADVANCE]\ngameId=${gameId}\noldIndex=${advanceResult.oldIndex}\nnewIndex=${advanceResult.newIndex}\nnewQuestionId=${advanceResult.nextQuestion?.question_id || 'COMPLETED'}`
      );
    }

    return {
      id: answerId,
      game_id: gameId,
      user_id: userId,
      question_id: questionId,
      selected_option: selectedOption,
      is_correct: isCorrect,
      score_delta: scoreDelta,
      correct_option: canonicalCorrectOption,
      is_first: isFirstCorrect,
      bonus_coins: bonusCoins,
      total_coins: totalCoinsAwarded,
      speed_points: speedBonus + extraSpeedPoints,
      is_multiplayer: isMultiplayer,
      duplicate: false,
      advanceResult,
    };
  } catch (error) {
    await client.rollback();
    throw error;
  } finally {
    client.release();
  }
}

async function advanceQuestion(gameId, userId = null) {
  const gameRes = await query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = gameRes.rows[0];
  if (!game) return { finished: true };
  if (game.status !== 'active') return { finished: true, alreadyAdvanced: true };

  const totalRes = await query('SELECT COUNT(*) AS total FROM game_questions WHERE game_id = $1', [gameId]);
  const totalQuestions = Number(totalRes.rows[0]?.total || 0);

  if (game.mode === 'tournament' && userId) {
    const ansRes = await query(
      'SELECT COUNT(*) AS answered FROM answers WHERE game_id = $1 AND user_id = $2',
      [gameId, userId]
    );
    const answeredCount = Number(ansRes.rows[0]?.answered || 0);

    if (answeredCount >= totalQuestions) {
      if (game.tournament_id) {
        await query(
          'UPDATE tournament_players SET has_attempted = 1, completed_at = NOW() WHERE tournament_id = $1 AND user_id = $2',
          [game.tournament_id, userId]
        );
      }
      return { finished: true };
    }

    const nextQ = await getCurrentQuestion(gameId, userId);
    if (!nextQ) {
      if (game.tournament_id) {
        await query(
          'UPDATE tournament_players SET has_attempted = 1, completed_at = NOW() WHERE tournament_id = $1 AND user_id = $2',
          [game.tournament_id, userId]
        );
      }
      return { finished: true };
    }
    return { finished: false, question: nextQ };
  }

  const nextIndex = Number(game.current_question_index || 0) + 1;
  if (nextIndex >= totalQuestions) {
    const claim = await query(
      `UPDATE games SET status = 'completed', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'active' AND current_question_index = $2`,
      [gameId, game.current_question_index]
    );
    if (!claim.result?.affectedRows) return { finished: true, alreadyAdvanced: true };
    await finishGame(gameId, userId);
    return { finished: true };
  }

  const claim = await query(
    `UPDATE games
     SET current_question_index = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'active' AND current_question_index = $3`,
    [gameId, nextIndex, game.current_question_index]
  );
  if (!claim.result?.affectedRows) return { finished: false, alreadyAdvanced: true };

  return { finished: false, question: await getCurrentQuestion(gameId, userId) };
}

async function finishGame(gameId, userId = null) {
  for (const key of activeGameLifelines.keys()) {
    if (key.startsWith(`${gameId}:`)) {
      activeGameLifelines.delete(key);
    }
  }

  const gameRes = await query('SELECT * FROM games WHERE id = $1', [gameId]);
  const gameMeta = gameRes.rows[0];
  if (!gameMeta) return [];

  // Idempotency: If game was already completed, return existing leaderboard without duplicating rewards or stats
  if (gameMeta.status === 'completed') {
    return await getLeaderboard(gameId);
  }

  const isTournament = gameMeta.mode === 'tournament';

  if (!isTournament) {
    await query(
      `UPDATE games SET status = 'completed', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [gameId]
    );
    if (gameMeta.room_id && gameMeta.mode === 'room') {
      await query(
        `UPDATE rooms SET status = 'completed', updated_at = NOW()
         WHERE id = $1 AND active_game_id = $2`,
        [gameMeta.room_id, gameId]
      );
    } else if (gameMeta.room_id) {
      await query(
        `UPDATE rooms SET status = 'completed', updated_at = NOW()
         WHERE id = $1`,
        [gameMeta.room_id]
      );
      console.log(`[GAME_COMPLETE] gameId: ${gameId} roomId: ${gameMeta.room_id}`);
    }
    try {
      await query('UPDATE player_rejoin_sessions SET is_active = FALSE WHERE game_id = $1', [gameId]);
    } catch (_) {}

  } else if (gameMeta.tournament_id && userId) {
    await query(
      'UPDATE tournament_players SET has_attempted = 1, completed_at = NOW() WHERE tournament_id = $1 AND user_id = $2',
      [gameMeta.tournament_id, userId]
    );
  }

  const leaderboard = await getLeaderboard(gameId);

  // Mark associated challenge as completed (terminal state)
  try {
    const challengeResult = await query(
      "SELECT id FROM challenges WHERE (game_id = $1 OR (room_id IS NOT NULL AND room_id = $2)) AND status = 'accepted' LIMIT 1",
      [gameId, gameMeta.room_id || null]
    );
    if (challengeResult.rows[0]) {
      await query(
        "UPDATE challenges SET status = 'completed', winner_user_id = $2 WHERE id = $1",
        [challengeResult.rows[0].id, leaderboard[0]?.user_id || null]
      );
    }
  } catch (_) {}

  // Save match statistics
  try {
    await saveMatchStatistics(gameId);
  } catch (error) {
    console.error('Error saving match statistics:', error);
  }

  // Update user stats
  for (const player of leaderboard) {
    if (isTournament && userId && player.user_id !== userId) {
      continue; // Only update stats for the user finishing their attempt in tournament
    }
    const isAi = gameMeta.mode === 'ai';
    const passedLevel = Number(player.correct_answers) >= 6;
    const isWinner = isAi
      ? passedLevel
      : (player.rank === 1 && (leaderboard.length > 1 ? true : passedLevel));

    const matchScore = Math.max(0, Number(player.score || 0));
    await updateUserStatsAfterGame(player.user_id, {
      mode: gameMeta.mode || player.mode,
      rank: player.rank,
      totalPlayers: leaderboard.length,
      score: matchScore,
      correctAnswers: player.correct_answers,
      fastAnswers: player.fast_answers,
      isWinner,
      xp: matchScore > 0 ? matchScore + (isWinner ? 50 : 20) : (passedLevel ? 100 : 50),
      coins: isWinner ? (isAi ? 50 : 100) : 10,
    });
    if (gameMeta.mode === 'ai' && gameMeta.ai_bot_name && gameMeta.ai_level) {
      await updateAiBestScore({
        userId: player.user_id,
        botName: gameMeta.ai_bot_name,
        level: gameMeta.ai_level,
        score: player.score,
        correctAnswers: player.correct_answers,
      });
    }
  }

  return leaderboard;
}

async function updateAiBestScore({ userId, botName, level, score, correctAnswers }) {
  await query(
    `INSERT INTO user_ai_level_scores (user_id, bot_name, level, best_score, best_correct_answers, attempts)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON DUPLICATE KEY UPDATE
       best_score = GREATEST(best_score, VALUES(best_score)),
       best_correct_answers = GREATEST(best_correct_answers, VALUES(best_correct_answers)),
       attempts = attempts + 1,
       updated_at = NOW()`,
    [userId, botName, level, score || 0, correctAnswers || 0]
  );
}

async function getAiBestScore({ userId, botName, level }) {
  const { rows } = await query(
    `SELECT user_id, bot_name, level, best_score, best_correct_answers, attempts, updated_at
     FROM user_ai_level_scores
     WHERE user_id = $1 AND bot_name = $2 AND level = $3`,
    [userId, botName, level]
  );
  return rows[0] || {
    user_id: userId,
    bot_name: botName,
    level,
    best_score: 0,
    best_correct_answers: 0,
    attempts: 0,
  };
}

async function getOverallAiBestScore(userId) {
  const { rows } = await query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(best_score) FROM user_ai_level_scores WHERE user_id = $1), 0),
       COALESCE((
         SELECT MAX(gs.score)
         FROM game_scores gs
         JOIN games g ON g.id = gs.game_id
         WHERE gs.user_id = $1 AND g.mode = 'ai'
       ), 0)
     ) AS best_score`,
    [userId]
  );
  return Number(rows[0]?.best_score || 0);
}

async function getLeaderboard(gameId) {
  const { rows } = await query(
    `SELECT gs.game_id,
            gs.user_id,
            u.username,
            u.display_name,
            gs.score,
            gs.correct_answers,
            gs.fast_answers,
            g.mode,
            RANK() OVER (ORDER BY gs.score DESC, gs.updated_at ASC) AS player_rank
     FROM game_scores gs
     JOIN users u ON u.id = gs.user_id
     JOIN games g ON g.id = gs.game_id
     WHERE gs.game_id = $1
     ORDER BY player_rank ASC`,
    [gameId]
  );
  return rows.map((row) => ({ ...row, rank: row.player_rank }));
}

module.exports = {
  selectQuestions,
  startGame,
  getCurrentQuestion,
  submitAnswer,
  advanceQuestion,
  finishGame,
  getLeaderboard,
  getAiBestScore,
  getOverallAiBestScore,
  usePlayerLifeline,
  calculateAnswerCorrectness,
};
