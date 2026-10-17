const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const { verifyAccessToken } = require('../utils/tokens');
const { startGame, getCurrentQuestion, submitAnswer, advanceQuestion, getLeaderboard, usePlayerLifeline } = require('../services/game.service');
const { startRoomGame, getRoomSnapshot, togglePlayerReady, cancelRoomBeforeStart } = require('../services/room.service');
const { submitAiTurn, aiProfiles } = require('../services/ai.service');
const { recordPlayerDisconnection, getRejoinGameState, getGameParticipants } = require('../services/rejoin.service');
const { getGameStatistics } = require('../services/matchHistory.service');

let globalIO = null;

function getSocketIO() {
  return globalIO;
}

const scheduledQuestionAdvances = new Set();
const activeQuestionTimeouts = new Map();
const activeGameAdvanceLocks = new Set();
const onlineUsers = new Map(); // userId -> { user, socketCount, lastActive }

function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

function isUserOnline(userId) {
  if (!userId) return false;
  return onlineUsers.has(String(userId));
}

function getOnlineUsers() {
  return Array.from(onlineUsers.values()).map((entry) => entry.user);
}

async function assertRoomMember(roomId, userId) {
  const { rows } = await query('SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
  if (!rows[0]) throw new Error('Room membership required');
}

async function assertGameParticipant(gameId, userId) {
  const { rows } = await query(
    `SELECT g.id, g.room_id, g.status FROM games g
     WHERE g.id = $1 AND (g.created_by = $2
       OR EXISTS (SELECT 1 FROM game_scores WHERE game_id = g.id AND user_id = $2)
       OR EXISTS (SELECT 1 FROM room_players WHERE room_id = g.room_id AND user_id = $2)
       OR EXISTS (SELECT 1 FROM tournament_players WHERE tournament_id = g.tournament_id AND user_id = $2))`,
    [gameId, userId]
  );
  if (!rows[0]) throw new Error('Game participation required');
  return rows[0];
}

function startServerQuestionTimeout({ io = globalIO, gameId, roomId, questionId, durationSeconds = 15 }) {
  if (!roomId || !gameId || !questionId) return;
  const targetIO = io || globalIO;
  const key = `${gameId}:${questionId}`;
  if (activeQuestionTimeouts.has(key)) {
    clearTimeout(activeQuestionTimeouts.get(key));
    activeQuestionTimeouts.delete(key);
  }
  const timeoutMs = Math.max(2000, Number(durationSeconds || 15) * 1000);
  const timer = setTimeout(async () => {
    activeQuestionTimeouts.delete(key);
    try {
      const current = await getCurrentQuestion(gameId);
      if (!current || current.status !== 'active' || current.question_id !== questionId) {
        return;
      }
      await advanceServerGame({ io: targetIO, gameId, roomId, triggeredBy: 'timeout' });
    } catch (err) {
      console.error('[Socket Timer] Error advancing on question timeout:', err);
    }
  }, timeoutMs);
  activeQuestionTimeouts.set(key, timer);
}

async function advanceServerGame({ io = globalIO, gameId, roomId = null, triggeredBy = 'timer' }) {
  if (!gameId) return null;
  const targetIO = io || globalIO;

  // Resolve roomId if not provided
  if (!roomId) {
    const { rows } = await query('SELECT room_id FROM games WHERE id = $1', [gameId]);
    roomId = rows[0]?.room_id || null;
  }

  // Atomic lock per gameId to prevent race conditions (e.g. timeout vs all-players-answered vs REST)
  if (activeGameAdvanceLocks.has(gameId)) {
    return null;
  }
  activeGameAdvanceLocks.add(gameId);

  try {
    // Clear pending timeouts for this game
    for (const [key, timeoutId] of activeQuestionTimeouts.entries()) {
      if (key.startsWith(`${gameId}:`)) {
        clearTimeout(timeoutId);
        activeQuestionTimeouts.delete(key);
      }
    }

    const currentQ = await getCurrentQuestion(gameId);
    if (!currentQ || currentQ.status !== 'active') {
      return null;
    }
    const oldIndex = currentQ.current_question_index;

    const result = await advanceQuestion(gameId);
    const newIndexDisplay = result.finished
      ? 'FINISHED'
      : (result.question ? result.question.current_question_index : oldIndex + 1);
    console.log(`[QUESTION_ADVANCE] gameId: ${gameId} oldIndex: ${oldIndex} newIndex: ${newIndexDisplay} (triggeredBy: ${triggeredBy})`);
    console.log(`[QUESTION_ADVANCE]\ngameId=${gameId}\noldIndex=${oldIndex}\nnewIndex=${newIndexDisplay}\nnewQuestionId=${result.question ? result.question.question_id : 'FINISHED'}`);

    const channel = roomId ? `room:${roomId}` : `game:${gameId}`;

    if (result.finished) {
      const finalLeaderboard = await getLeaderboard(gameId);
      const gameStats = await getGameStatistics(gameId);

      const challengeResult = await query(
        "SELECT id FROM challenges WHERE (game_id = $1 OR (room_id IS NOT NULL AND room_id = $2)) AND status = 'accepted' LIMIT 1",
        [gameId, roomId || null]
      );
      if (challengeResult.rows[0]) {
        await query(
          "UPDATE challenges SET status = 'completed', winner_user_id = $2 WHERE id = $1",
          [challengeResult.rows[0].id, finalLeaderboard[0]?.user_id || null]
        );
      }

      if (targetIO) {
        targetIO.to(channel).emit('game:finished', {
          gameId,
          leaderboard: finalLeaderboard,
          statistics: gameStats,
        });
        if (roomId) {
          targetIO.to(`game:${gameId}`).emit('game:finished', {
            gameId,
            leaderboard: finalLeaderboard,
            statistics: gameStats,
          });
          const roomSnapshot = await getRoomSnapshot(roomId);
          targetIO.to(`room:${roomId}`).emit('room:updated', roomSnapshot);
        }
      }
      return { finished: true, leaderboard: finalLeaderboard, statistics: gameStats };
    }

    if (result.question) {
      if (targetIO) {
        targetIO.to(channel).emit('game:question', { gameId, question: result.question });
        if (roomId) {
          targetIO.to(`game:${gameId}`).emit('game:question', { gameId, question: result.question });
        }
        startServerQuestionTimeout({
          io: targetIO,
          gameId,
          roomId,
          questionId: result.question.question_id,
          durationSeconds: result.question.time_limit_seconds || 15,
        });
      }
      return { finished: false, question: result.question };
    }

    return result;
  } catch (error) {
    console.error(`[advanceServerGame Error] gameId: ${gameId}:`, error);
    throw error;
  } finally {
    activeGameAdvanceLocks.delete(gameId);
  }
}

async function loadSocketUser(token) {
  const payload = verifyAccessToken(token);
  const { rows } = await query(
    `SELECT id, username, display_name, role, is_guest, level
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [payload.sub]
  );
  return rows[0];
}

async function emitRoomState(io, roomId) {
  const snapshot = await getRoomSnapshot(roomId);
  io.to(`room:${roomId}`).emit('room:updated', snapshot);
}

async function tryScheduleQuestionAdvance({ io = globalIO, gameId, roomId, questionId = null }) {
  if (!roomId || !gameId) {
    return;
  }
  const targetIO = io || globalIO;

  // 1. Get current active question of the game
  const currentQ = await getCurrentQuestion(gameId);
  if (!currentQ || currentQ.status !== 'active') {
    return;
  }

  const activeQuestionId = currentQ.question_id;
  if (questionId && questionId !== activeQuestionId) {
    return;
  }

  const advanceKey = `${gameId}:${activeQuestionId}`;
  if (scheduledQuestionAdvances.has(advanceKey)) {
    return;
  }

  // 2. Fetch answers submitted for this active question
  const { rows: answerRows } = await query(
    'SELECT user_id FROM answers WHERE game_id = $1 AND question_id = $2',
    [gameId, activeQuestionId]
  );
  const answeredUserIds = new Set(answerRows.map((row) => String(row.user_id)));

  // 3. Fetch all active participants registered for this room (dynamically supports 2, 3, 4 players)
  const { rows: playerRows } = await query(
    `SELECT rp.user_id, COALESCE(gs.completion_status, 'active') as status
     FROM room_players rp
     LEFT JOIN game_scores gs ON gs.game_id = $2 AND gs.user_id = rp.user_id
     WHERE rp.room_id = $1`,
    [roomId, gameId]
  );
  const roomPlayerIds = playerRows.map((row) => String(row.user_id));
  if (roomPlayerIds.length === 0) {
    return;
  }

  // Only require answers from active (non-disconnected) players
  const activePlayerIds = playerRows
    .filter((row) => row.status !== 'disconnected')
    .map((row) => String(row.user_id));

  const targetPlayerIds = activePlayerIds.length > 0 ? activePlayerIds : roomPlayerIds;
  const allPlayersAnswered = targetPlayerIds.every((id) => answeredUserIds.has(id));
  if (!allPlayersAnswered) {
    return;
  }

  // Another answer handler may have scheduled this question while the DB reads above were pending.
  if (scheduledQuestionAdvances.has(advanceKey)) return;
  scheduledQuestionAdvances.add(advanceKey);

  // All players have answered! Clear the fallback timeout and schedule advance
  if (activeQuestionTimeouts.has(advanceKey)) {
    clearTimeout(activeQuestionTimeouts.get(advanceKey));
    activeQuestionTimeouts.delete(advanceKey);
  }

  // Short delay (800ms) to allow players to see answer feedback and animation

  setTimeout(async () => {
    try {
      const recheckQ = await getCurrentQuestion(gameId);
      if (!recheckQ || recheckQ.status !== 'active' || recheckQ.question_id !== activeQuestionId) {
        return;
      }
      if (!recheckQ || recheckQ.status !== 'active' || recheckQ.question_id !== activeQuestionId) {
        return;
      }
      await advanceServerGame({ io: targetIO, gameId, roomId, triggeredBy: 'all_players_answered' });

    } catch (error) {
      console.error('[tryScheduleQuestionAdvance Error]:', error);
    } finally {
      scheduledQuestionAdvances.delete(advanceKey);
    }
  }, 800);
}

function registerSockets(io) {
  globalIO = io;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('Missing socket auth token'));
      }
      socket.user = await loadSocketUser(token);
      if (!socket.user) {
        return next(new Error('User not found'));
      }
      return next();
    } catch (error) {
      return next(new Error('Socket authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.data = socket.data || {};
    socket.data.user = socket.user;
    socket.data.userId = socket.user?.id;
    socket.join(`user:${socket.user.id}`);
    socket.emit('socket:ready', { userId: socket.user.id });

    // Track online user
    if (socket.user?.id) {
      const uId = String(socket.user.id);
      const existing = onlineUsers.get(uId);
      if (existing) {
        existing.socketCount += 1;
        existing.user = socket.user;
        existing.lastActive = new Date();
      } else {
        onlineUsers.set(uId, {
          socketCount: 1,
          user: socket.user,
          lastActive: new Date(),
        });
      }
    }

    socket.on('room:join', async ({ roomId }, reply) => {
      try {
        await assertRoomMember(roomId, socket.user.id);
        const { rows: roomRows } = await query('SELECT status FROM rooms WHERE id = $1', [roomId]);
        if (roomRows[0] && (roomRows[0].status === 'cancelled' || roomRows[0].status === 'completed' || roomRows[0].status === 'closed')) {
          reply?.({ ok: false, error: 'Room is no longer active' });
          return;
        }
        socket.join(`room:${roomId}`);
        socket.data.userId = socket.user?.id;
        socket.data.roomId = roomId;
        console.log(`[ROOM_JOIN] userId: ${socket.user.id} roomId: ${roomId}`);
        await emitRoomState(io, roomId);
        reply?.({ ok: true });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('room:leave', async ({ roomId }, reply) => {
      try {
        await assertRoomMember(roomId, socket.user.id);
      } catch (error) {
        reply?.({ ok: false, error: error.message });
        return;
      }

      socket.leave(`room:${roomId}`);
      if (socket.data?.roomId === roomId) {
        delete socket.data.roomId;
      }

      // Check if room is waiting
      const { rows: roomRows } = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      const room = roomRows[0];
      if (room && room.status === 'waiting') {
        if (String(room.host_user_id) === String(socket.user.id)) {
          // If HOST leaves the waiting lobby, cancel the room
          await cancelRoomBeforeStart(roomId, socket.user.id, io);
        } else {
          // If a guest player leaves, simply remove them and broadcast updated room state
          await query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, socket.user.id]);
          await emitRoomState(io, roomId);
        }
      }

      console.log(`[ROOM_LEAVE] userId: ${socket.user.id} roomId: ${roomId}`);
      reply?.({ ok: true });

      // Check if leaving player allows an active game to advance
      try {
        const { rows: activeGames } = await query(
          `SELECT id FROM games WHERE room_id = $1 AND status = 'active' LIMIT 1`,
          [roomId]
        );
        if (activeGames.length > 0) {
          await tryScheduleQuestionAdvance({ io, gameId: activeGames[0].id, roomId });
        }
      } catch (error) {
        // Ignore background check error
      }
    });

    socket.on('room:ready', async ({ roomId, ready }, reply) => {
      try {
        const snapshot = await togglePlayerReady(roomId, socket.user.id, ready);
        io.to(`room:${roomId}`).emit('room:updated', snapshot);
        reply?.({ ok: true, snapshot });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('room:start', async ({ roomId }, reply) => {
      try {
        const game = await startRoomGame(roomId, socket.user.id);
        const question = await getCurrentQuestion(game.id);

        io.to(`room:${roomId}`).emit('game:starting', { gameId: game.id, roomId, question });
        io.to(`room:${roomId}`).emit('room:game_started', { gameId: game.id, roomId, question });

        const snapshot = await getRoomSnapshot(roomId);
        io.to(`room:${roomId}`).emit('room:updated', snapshot);

        if (question) {
          startServerQuestionTimeout({
            io,
            gameId: game.id,
            roomId,
            durationSeconds: question.timeLimit || 15,
          });
        }

        reply?.({ ok: true, gameId: game.id });
      } catch (error) {
        console.error('[ROOM_START] Error starting game:', error);
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:join', async ({ gameId, roomId }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        if (roomId && String(game.room_id) !== String(roomId)) throw new Error('Game does not belong to this room');
        socket.join(`game:${gameId}`);
        socket.data.userId = socket.user?.id;
        socket.data.gameId = gameId;
        if (roomId) socket.data.roomId = roomId;
        reply?.({ ok: true });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:leave', async ({ gameId, roomId }, reply) => {
      try {
        const targetGameId = gameId || socket.data?.gameId;
        const targetRoomId = roomId || socket.data?.roomId;
        console.log(`[GAME_LEAVE] userId: ${socket.user?.id} gameId: ${targetGameId} roomId: ${targetRoomId}`);

        if (targetGameId && socket.user?.id) {
          const { rows: gameRows } = await query(
            'SELECT id, status, room_id, current_question_index FROM games WHERE id = $1',
            [targetGameId]
          );
          const game = gameRows[0];
          if (game && game.status === 'active') {
            const resolvedRoomId = targetRoomId || game.room_id;
            await recordPlayerDisconnection(
              game.id,
              resolvedRoomId,
              socket.user.id,
              game.current_question_index
            );

            const disconnectPayload = {
              gameId: game.id,
              roomId: resolvedRoomId,
              userId: socket.user.id,
              username: socket.user.username,
              displayName: socket.user.display_name,
              status: 'disconnected',
            };

            io.to(`game:${game.id}`).emit('player:disconnected', disconnectPayload);
            if (resolvedRoomId) {
              io.to(`room:${resolvedRoomId}`).emit('player:disconnected', disconnectPayload);
            }

            const participants = await getGameParticipants(game.id);
            const channel = resolvedRoomId ? `room:${resolvedRoomId}` : `game:${game.id}`;
            io.to(channel).emit('game:participant-updated', {
              gameId: game.id,
              participants,
              disconnectedPlayerId: socket.user.id,
            });

            if (resolvedRoomId) {
              await tryScheduleQuestionAdvance({ io, gameId: game.id, roomId: resolvedRoomId });
            }
          }
        }

        if (targetGameId) socket.leave(`game:${targetGameId}`);
        if (targetRoomId) socket.leave(`room:${targetRoomId}`);

        reply?.({ ok: true });
      } catch (error) {
        console.error('Error handling game:leave:', error);
        reply?.({ ok: false, error: error.message });
      }
    });

    const handleSocialEvent = async ({ gameId, roomId, type, content }, reply) => {
      try {
        if (!gameId) throw new Error('Game required');
        const game = await assertGameParticipant(gameId, socket.user.id);
        if (roomId && game.room_id && String(game.room_id) !== String(roomId)) {
          throw new Error('Game does not belong to this room');
        }
        if (game.status !== 'active') {
          reply?.({ ok: false, error: 'Match is no longer active' });
          return;
        }

        if (!content || typeof content !== 'string') {
          reply?.({ ok: false, error: 'Content required' });
          return;
        }

        const trimmedContent = content.trim();
        if (!trimmedContent) {
          reply?.({ ok: false, error: 'Content cannot be empty' });
          return;
        }

        const rawType = String(type || 'EMOTE').toUpperCase();
        let normalizedType;
        let maxLength = 80;

        if (rawType === 'CHAT') {
          normalizedType = 'CHAT';
          maxLength = 100;
        } else if (rawType === 'QUICK_CHAT') {
          normalizedType = 'QUICK_CHAT';
          maxLength = 80;
        } else if (rawType === 'EMOTE') {
          normalizedType = 'EMOTE';
          maxLength = 10;
        } else if (rawType === 'REACTION') {
          normalizedType = 'REACTION';
          maxLength = 80;
        } else {
          reply?.({ ok: false, error: 'Invalid social event type' });
          return;
        }

        const safeContent = trimmedContent.slice(0, maxLength);

        // Rate limiting: 1.2s minimum interval & max 5 events per 10s sliding window
        const now = Date.now();
        const lastTime = socket.data?.lastSocialTime || 0;
        if (now - lastTime < 1200) {
          reply?.({ ok: false, error: 'Please wait before sending another message', retryAfterMs: 1200 - (now - lastTime) });
          return;
        }

        const history = (socket.data?.socialHistory || []).filter((t) => now - t < 10000);
        if (history.length >= 5) {
          reply?.({ ok: false, error: 'Message limit reached. Please wait a moment', retryAfterMs: 10000 - (now - history[0]) });
          return;
        }

        socket.data.lastSocialTime = now;
        history.push(now);
        socket.data.socialHistory = history;

        // Ensure sender socket is in the game channel
        socket.join(`game:${gameId}`);

        // Server strictly derives sender identity from socket.user
        const socialPayload = {
          id: randomUUID(),
          gameId,
          roomId: game.room_id || roomId || null,
          userId: socket.user.id,
          userName: socket.user.display_name || socket.user.username,
          type: normalizedType,
          content: safeContent,
          timestamp: now,
        };

        // Broadcast to all participants in this match (1v1 through 6v6)
        io.to(`game:${gameId}`).emit('game:social', socialPayload);
        // Also emit legacy game:reaction for backward compatibility
        io.to(`game:${gameId}`).emit('game:reaction', socialPayload);

        reply?.({ ok: true, event: socialPayload });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    };

    socket.on('game:social', handleSocialEvent);
    socket.on('game:reaction', handleSocialEvent);

    socket.on('game:start', async ({ roomId }, reply) => {
      try {
        const game = await startRoomGame(roomId, socket.user.id);
        socket.data.userId = socket.user?.id;
        socket.data.roomId = roomId;
        socket.data.gameId = game.id;
        const question = await getCurrentQuestion(game.id);

        io.to(`room:${roomId}`).emit('game:started', { game, question });
        const snapshot = await getRoomSnapshot(roomId);
        io.to(`room:${roomId}`).emit('room:updated', snapshot);

        if (question) {
          startServerQuestionTimeout({
            io,
            gameId: game.id,
            roomId,
            questionId: question.question_id,
            durationSeconds: question.time_limit_seconds || 15,
          });
        }
        reply?.({ ok: true, game });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:answer', async ({ gameId, roomId, questionId, selectedOption, answeredInMs }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        if (roomId && String(game.room_id) !== String(roomId)) throw new Error('Game does not belong to this room');
        console.log(`[ANSWER_SUBMIT] userId: ${socket.user.id} gameId: ${gameId} questionId: ${questionId}`);
        const answer = await submitAnswer({
          gameId,
          userId: socket.user.id,
          roomId,
          questionId,
          selectedOption,
          answeredInMs,
        });
        if (answer.duplicate) {
          reply?.({ ok: true, answer });
          return;
        }
        const leaderboard = await getLeaderboard(gameId);
        if (roomId) {
          io.to(`room:${roomId}`).emit('game:scoreboard', { gameId, leaderboard });
          io.to(`room:${roomId}`).emit('game:player-answered', {
            gameId,
            questionId,
            userId: socket.user.id,
            userName: socket.user.display_name || socket.user.username,
            isCorrect: answer.is_correct,
            scoreDelta: answer.score_delta,
            isFirst: answer.is_first,
            bonusCoins: answer.bonus_coins,
            totalCoins: answer.total_coins,
            speedPoints: answer.speed_points,
          });
        }
        io.to(`game:${gameId}`).emit('game:scoreboard', { gameId, leaderboard });

        // If this game belongs to a tournament, also broadcast to the tournament channel
        const gameRes = await query('SELECT tournament_id FROM games WHERE id = $1', [gameId]);
        const tourneyId = gameRes.rows[0]?.tournament_id;
        if (tourneyId) {
          io.to(`tournament:${tourneyId}`).emit('tournament:leaderboard-updated', {
            tournamentId: tourneyId,
            gameId,
            leaderboard,
          });
        }

        socket.emit('game:answer-result', {
          gameId,
          questionId,
          isCorrect: answer.is_correct,
          scoreDelta: answer.score_delta,
          correctOption: answer.correct_option,
          isFirst: answer.is_first,
          bonusCoins: answer.bonus_coins,
          totalCoins: answer.total_coins,
          speedPoints: answer.speed_points,
        });
        reply?.({ ok: true, answer });

        if (answer.advanceResult?.advanced) {
          const timeoutKey = `${gameId}:${questionId}`;
          if (activeQuestionTimeouts.has(timeoutKey)) {
            clearTimeout(activeQuestionTimeouts.get(timeoutKey));
            activeQuestionTimeouts.delete(timeoutKey);
          }

          const channel = roomId ? `room:${roomId}` : `game:${gameId}`;

          setTimeout(async () => {
            try {
              if (answer.advanceResult.finished) {
                const finalLeaderboard = await getLeaderboard(gameId);
                let gameStats = [];
                try { gameStats = await getGameStatistics(gameId); } catch (_) {}

                const challengeResult = await query(
                  "SELECT id FROM challenges WHERE (game_id = $1 OR (room_id IS NOT NULL AND room_id = $2)) AND status = 'accepted' LIMIT 1",
                  [gameId, roomId || null]
                );
                if (challengeResult.rows[0]) {
                  await query(
                    "UPDATE challenges SET status = 'completed', winner_user_id = $2 WHERE id = $1",
                    [challengeResult.rows[0].id, finalLeaderboard[0]?.user_id || null]
                  );
                }

                io.to(channel).emit('game:finished', {
                  gameId,
                  leaderboard: finalLeaderboard,
                  statistics: gameStats,
                });
                if (roomId) {
                  io.to(`game:${gameId}`).emit('game:finished', {
                    gameId,
                    leaderboard: finalLeaderboard,
                    statistics: gameStats,
                  });
                  const roomSnapshot = await getRoomSnapshot(roomId);
                  io.to(`room:${roomId}`).emit('room:updated', roomSnapshot);
                }
              } else if (answer.advanceResult.nextQuestion) {
                io.to(channel).emit('game:question', {
                  gameId,
                  question: answer.advanceResult.nextQuestion,
                });
                if (roomId) {
                  io.to(`game:${gameId}`).emit('game:question', {
                    gameId,
                    question: answer.advanceResult.nextQuestion,
                  });
                }
                startServerQuestionTimeout({
                  io,
                  gameId,
                  roomId,
                  questionId: answer.advanceResult.nextQuestion.question_id,
                  durationSeconds: answer.advanceResult.nextQuestion.time_limit_seconds || 15,
                });
              }
            } catch (broadcastErr) {
              console.error('[Socket Advance Broadcast Error]:', broadcastErr);
            }
          }, 600);
        } else if (roomId) {
          await tryScheduleQuestionAdvance({ io, gameId, roomId, questionId });
        }
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:lifeline', async ({ gameId, roomId, questionId, lifeline }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        if (roomId && String(game.room_id) !== String(roomId)) throw new Error('Game does not belong to this room');
        const result = await usePlayerLifeline({
          gameId,
          userId: socket.user.id,
          questionId,
          lifeline,
        });
        reply?.({ ok: true, ...result });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:next-question', async ({ gameId, roomId }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        if (game.room_id) throw new Error('Room questions advance automatically');
        const result = await advanceServerGame({ io, gameId, roomId, triggeredBy: 'client_request' });
        reply?.({ ok: true, result });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('ai:answer', async ({ gameId, aiUserId, botName = 'Nova' }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        const owner = await query('SELECT created_by, mode FROM games WHERE id = $1', [gameId]);
        if (owner.rows[0]?.mode !== 'ai' || owner.rows[0]?.created_by !== socket.user.id) throw new Error('AI game ownership required');
        const answer = await submitAiTurn(gameId, aiUserId, aiProfiles[botName] || aiProfiles.Nova);
        const leaderboard = await getLeaderboard(gameId);
        io.to(`game:${gameId}`).emit('game:scoreboard', { gameId, leaderboard });
        reply?.({ ok: true, answer });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    socket.on('game:watch', async ({ gameId }, reply) => {
      try {
        await assertGameParticipant(gameId, socket.user.id);
        socket.join(`game:${gameId}`);
        reply?.({ ok: true });
      } catch (error) { reply?.({ ok: false, error: error.message }); }
    });

    socket.on('tournament:watch', async ({ tournamentId }, reply) => {
      try {
        const participant = await query('SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND user_id = $2', [tournamentId, socket.user.id]);
        if (!participant.rows[0]) throw new Error('Tournament participation required');
        socket.join(`tournament:${tournamentId}`);
        reply?.({ ok: true });
      } catch (error) { reply?.({ ok: false, error: error.message }); }
    });

    // Handle player rejoin/reconnection
    socket.on('game:rejoin', async ({ gameId, roomId }, reply) => {
      try {
        const game = await assertGameParticipant(gameId, socket.user.id);
        const resolvedRoomId = roomId || game.room_id;
        if (resolvedRoomId && game.room_id && String(game.room_id) !== String(resolvedRoomId)) {
          throw new Error('Game does not belong to this room');
        }

        // Authoritative check: Game MUST be active
        const { rows: gameRows } = await query('SELECT id, status, room_id FROM games WHERE id = $1', [gameId]);
        if (!gameRows[0]) {
          reply?.({ ok: false, error: 'Game not found' });
          return;
        }
        if (gameRows[0].status !== 'active') {
          reply?.({ ok: false, error: 'Game already finished. Cannot rejoin.' });
          return;
        }

        socket.data.userId = socket.user?.id;
        socket.data.gameId = gameId;
        if (resolvedRoomId) socket.data.roomId = resolvedRoomId;
        console.log(`[PLAYER_RECONNECT] userId: ${socket.user.id} gameId: ${gameId}`);
        const rejoinState = await getRejoinGameState(gameId, socket.user.id);
        
        // Ensure socket is joined to room and game channels
        if (resolvedRoomId) {
          socket.join(`room:${resolvedRoomId}`);
        }
        socket.join(`game:${gameId}`);

        // Notify other players that this player has reconnected
        const rejoinPayload = {
          gameId,
          roomId: resolvedRoomId,
          userId: socket.user.id,
          username: socket.user.username,
          displayName: socket.user.display_name,
          status: 'active',
        };
        io.to(`game:${gameId}`).emit('player:rejoined', rejoinPayload);
        if (resolvedRoomId) {
          io.to(`room:${resolvedRoomId}`).emit('player:rejoined', rejoinPayload);
        }

        const participants = await getGameParticipants(gameId);
        const channel = resolvedRoomId ? `room:${resolvedRoomId}` : `game:${gameId}`;
        io.to(channel).emit('game:participant-updated', { 
          gameId, 
          participants,
          rejoinedPlayerId: socket.user.id 
        });

        reply?.({ ok: true, gameState: rejoinState });
      } catch (error) {
        reply?.({ ok: false, error: error.message });
      }
    });

    // Handle player disconnection
    socket.on('disconnect', async () => {
      try {
        if (socket.user?.id) {
          const uId = String(socket.user.id);
          const entry = onlineUsers.get(uId);
          if (entry) {
            entry.socketCount -= 1;
            if (entry.socketCount <= 0) {
              onlineUsers.delete(uId);
            }
          }
        }
        // A newer connection for the same user may already have rejoined.
        const otherConnections = await io.in(`user:${socket.user.id}`).fetchSockets();
        if (otherConnections.length > 0) return;
        console.log(`[PLAYER_DISCONNECT] userId: ${socket.user.id}`);
        // Find any active games the player is in
        const { rows: activeGames } = await query(
          `SELECT g.id, g.room_id, g.current_question_index, r.id as room_exists
           FROM games g
           LEFT JOIN rooms r ON r.id = g.room_id
           JOIN game_scores gs ON gs.game_id = g.id
           WHERE gs.user_id = $1 AND g.status = 'active'
           LIMIT 1`,
          [socket.user.id]
        );

        if (activeGames.length > 0) {
          const game = activeGames[0];
          const resolvedRoomId = socket.data?.roomId || game.room_id;
          if (resolvedRoomId && game.id && socket.user?.id) {
            await recordPlayerDisconnection(
              game.id,
              resolvedRoomId,
              socket.user.id,
              game.current_question_index
            );
          } else {
            console.log(`[REJOIN_SKIP] Disconnect without room_id: gameId=${game.id}, roomId=${resolvedRoomId}`);
          }

          // Notify other players about the disconnection
          if (game.room_exists && resolvedRoomId) {
            const channel = `room:${resolvedRoomId}`;
            const disconnectPayload = {
              gameId: game.id,
              roomId: resolvedRoomId,
              userId: socket.user.id,
              username: socket.user.username,
              displayName: socket.user.display_name,
              status: 'disconnected',
            };
            io.to(`game:${game.id}`).emit('player:disconnected', disconnectPayload);
            io.to(`room:${resolvedRoomId}`).emit('player:disconnected', disconnectPayload);

            const participants = await getGameParticipants(game.id);
            io.to(channel).emit('game:participant-updated', { 
              gameId: game.id, 
              participants,
              disconnectedPlayerId: socket.user.id 
            });

            // Recalculate and advance if all remaining eligible connected players have answered
            await tryScheduleQuestionAdvance({ io, gameId: game.id, roomId: resolvedRoomId });
          }
        } else {
          // Player disconnected while not in active game
          // Clean up socket state without destroying waiting rooms
          if (socket.data?.roomId) {
            delete socket.data.roomId;
          }
        }
      } catch (error) {
        console.error('Error handling player disconnection:', error);
      }
    });
  });
}

module.exports = {
  registerSockets,
  startServerQuestionTimeout,
  advanceServerGame,
  tryScheduleQuestionAdvance,
  getSocketIO,
  getOnlineUserIds,
  isUserOnline,
  getOnlineUsers,
};

