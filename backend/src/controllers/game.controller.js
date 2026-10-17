const { query } = require('../db/pool');
const { createAiMatch, submitAiTurn, aiProfiles } = require('../services/ai.service');
const {
  getCurrentQuestion,
  submitAnswer,
  getLeaderboard,
  finishGame,
} = require('../services/game.service');
const { getGameStatistics } = require('../services/matchHistory.service');
const { advanceServerGame, tryScheduleQuestionAdvance } = require('../sockets');
const { rejoinGame, getGameParticipants } = require('../services/rejoin.service');
const asyncHandler = require('../utils/asyncHandler');

async function requireGameAccess(gameId, userId, allowRoomMutation = false) {
  const { rows } = await query(
    `SELECT g.id, g.room_id, g.mode FROM games g
     WHERE g.id = $1 AND (g.created_by = $2
       OR EXISTS (SELECT 1 FROM game_scores WHERE game_id = g.id AND user_id = $2)
       OR EXISTS (SELECT 1 FROM room_players WHERE room_id = g.room_id AND user_id = $2)
       OR EXISTS (SELECT 1 FROM tournament_players WHERE tournament_id = g.tournament_id AND user_id = $2))`,
    [gameId, userId]
  );
  if (!rows[0]) {
    const error = new Error('Game not found');
    error.status = 404;
    throw error;
  }
  if (!allowRoomMutation && rows[0].mode === 'room') {
    const error = new Error('Room matches advance automatically');
    error.status = 403;
    throw error;
  }
  return rows[0];
}

const createAiGame = asyncHandler(async (req, res) => {
  const match = await createAiMatch({
    userId: req.user.id,
    botName: req.body.botName || 'Nova',
    category: req.body.category || null,
    questionLimit: req.body.questionLimit || 5,
    level: req.body.level || 1,
  });
  return res.status(201).json({
    room: match.room,
    game: match.game,
    ai: {
      id: match.aiUser.id,
      name: match.aiUser.display_name,
      profile: match.profile,
    },
  });
});

const getQuestion = asyncHandler(async (req, res) => {
  await requireGameAccess(req.params.gameId, req.user.id, true);
  const gameRes = await query('SELECT id, status, room_id FROM games WHERE id = $1', [req.params.gameId]);
  const game = gameRes.rows[0];
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status === 'completed' || game.status === 'finished') {
    const leaderboard = await getLeaderboard(req.params.gameId);
    let statistics = [];
    try {
      statistics = await getGameStatistics(req.params.gameId);
    } catch (_) {}
    return res.json({
      finished: true,
      gameId: game.id,
      roomId: game.room_id,
      status: game.status,
      leaderboard,
      statistics,
    });
  }

  const question = await getCurrentQuestion(req.params.gameId, req.user.id);
  if (!question) {
    const leaderboard = await getLeaderboard(req.params.gameId);
    let statistics = [];
    try {
      statistics = await getGameStatistics(req.params.gameId);
    } catch (_) {}
    return res.json({
      finished: true,
      gameId: game.id,
      roomId: game.room_id,
      status: 'completed',
      leaderboard,
      statistics,
    });
  }

  const questionIndex = Number(question.current_question_index ?? question.sort_order ?? 0);
  const questionId = question.question_id;

  console.log(
    `[QUESTION_STATE]\ngameId=${game.id}\nquestionIndex=${questionIndex}\nquestionId=${questionId}`
  );

  const { correct_option, correctOption, ...sanitizedQuestion } = question;

  return res.json({
    finished: false,
    gameId: game.id,
    questionIndex,
    questionId,
    roomId: game.room_id,
    status: game.status,
    question: sanitizedQuestion,
  });
});

const postAnswer = asyncHandler(async (req, res) => {
  const game = await requireGameAccess(req.params.gameId, req.user.id, true);
  const answer = await submitAnswer({
    gameId: req.params.gameId,
    userId: req.user.id,
    questionId: req.body.questionId,
    selectedOption: req.body.selectedOption,
    answeredInMs: req.body.answeredInMs,
  });
  const io = req.app?.get ? req.app.get('io') : null;
  const gameRes = await query('SELECT room_id FROM games WHERE id = $1', [req.params.gameId]);
  const roomId = gameRes.rows[0]?.room_id;
  if (roomId && !answer.duplicate) {
    const leaderboard = await getLeaderboard(req.params.gameId);
    if (io) {
      io.to(`room:${roomId}`).emit('game:scoreboard', { gameId: req.params.gameId, leaderboard });
      io.to(`game:${req.params.gameId}`).emit('game:scoreboard', { gameId: req.params.gameId, leaderboard });
    }
    if (answer.advanceResult?.advanced && io) {
      const channel = `room:${roomId}`;
      if (answer.advanceResult.finished) {
        const finalLeaderboard = await getLeaderboard(req.params.gameId);
        let gameStats = [];
        try { gameStats = await getGameStatistics(req.params.gameId); } catch (_) {}
        io.to(channel).emit('game:finished', {
          gameId: req.params.gameId,
          leaderboard: finalLeaderboard,
          statistics: gameStats,
        });
        io.to(`game:${req.params.gameId}`).emit('game:finished', {
          gameId: req.params.gameId,
          leaderboard: finalLeaderboard,
          statistics: gameStats,
        });
      } else if (answer.advanceResult.nextQuestion) {
        io.to(channel).emit('game:question', {
          gameId: req.params.gameId,
          question: answer.advanceResult.nextQuestion,
        });
        io.to(`game:${req.params.gameId}`).emit('game:question', {
          gameId: req.params.gameId,
          question: answer.advanceResult.nextQuestion,
        });
      }
    }
  }

  return res.status(201).json({
    answer: {
      ...answer,
      // Keep existing snake_case consumers working while providing the
      // explicit result contract used by secure tournament gameplay.
      isCorrect: answer.is_correct,
      correctOption: answer.correct_option,
      scoreDelta: answer.score_delta,
    },
  });
});

const postAiTurn = asyncHandler(async (req, res) => {
  const game = await requireGameAccess(req.params.gameId, req.user.id);
  if (game.mode !== 'ai') return res.status(403).json({ error: 'AI turn is only available in AI games' });
  const profile = aiProfiles[req.body.botName || 'Nova'] || aiProfiles.Nova;
  const answer = await submitAiTurn(req.params.gameId, req.body.aiUserId, profile);
  return res.json({ answer });
});

const postAdvance = asyncHandler(async (req, res) => {
  await requireGameAccess(req.params.gameId, req.user.id);
  const io = req.app.get('io');
  const result = await advanceServerGame({ io, gameId: req.params.gameId, triggeredBy: 'rest_post_advance' });
  return res.json(result || { finished: true });

});

const postFinish = asyncHandler(async (req, res) => {
  await requireGameAccess(req.params.gameId, req.user.id);
  const leaderboard = await finishGame(req.params.gameId, req.user.id);
  const user = await query(
    'SELECT id, username, display_name, role, is_guest, level, xp, coins FROM users WHERE id = $1',
    [req.user.id]
  );
  return res.json({ leaderboard, user: user.rows[0] || null });
});

const getGameLeaderboard = asyncHandler(async (req, res) => {
  await requireGameAccess(req.params.gameId, req.user.id, true);
  const leaderboard = await getLeaderboard(req.params.gameId);
  return res.json({ leaderboard });
});

const postRejoinGame = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const userId = req.user.id;

  const result = await rejoinGame(gameId, userId);
  const io = req.app?.get ? req.app.get('io') : null;
  if (io && result.gameState?.game) {
    const roomId = result.gameState.game.roomId;
    const rejoinPayload = {
      gameId,
      roomId,
      userId,
      username: req.user.username,
      displayName: req.user.display_name,
      status: 'active',
    };
    io.to(`game:${gameId}`).emit('player:rejoined', rejoinPayload);
    if (roomId) {
      io.to(`room:${roomId}`).emit('player:rejoined', rejoinPayload);
    }
    const participants = await getGameParticipants(gameId);
    const channel = roomId ? `room:${roomId}` : `game:${gameId}`;
    io.to(channel).emit('game:participant-updated', {
      gameId,
      participants,
      rejoinedPlayerId: userId,
    });
  }

  return res.status(200).json(result);
});

module.exports = {
  createAiGame,
  getQuestion,
  postAnswer,
  postAiTurn,
  postAdvance,
  postFinish,
  getGameLeaderboard,
  postRejoinGame,
};
