const roomService = require('../services/room.service');
const { getCurrentQuestion } = require('../services/game.service');
const { startServerQuestionTimeout } = require('../sockets');
const asyncHandler = require('../utils/asyncHandler');

const createRoom = asyncHandler(async (req, res) => {
  const {
    roomName = 'Quiz Room',
    category = 'General',
    difficulty = 'easy',
    questionLimit = 5,
    maxPlayers = 4,
    isPrivate = true,
  } = req.body;

  const room = await roomService.createRoom({
    hostUserId: req.user.id,
    roomName,
    category,
    difficulty,
    questionLimit,
    maxPlayers,
    isPrivate,
  });
  return res.status(201).json(room);
});

const getRoomSnapshot = asyncHandler(async (req, res) => {
  const room = await roomService.getRoomSnapshot(req.params.roomId, req.user.id);
  res.set('Cache-Control', 'no-store');
  return res.json(room);
});

const joinRoom = asyncHandler(async (req, res) => {
  const code = req.params.code || req.body.code;
  const room = await roomService.joinRoom(code, req.user.id);
  req.app.get('io').to(`room:${room.room.id}`).emit('room:updated', room);
  return res.json(room);
});

const toggleReady = asyncHandler(async (req, res) => {
  const room = await roomService.togglePlayerReady(req.params.roomId, req.user.id, req.body.ready);
  req.app.get('io').to(`room:${req.params.roomId}`).emit('room:updated', room);
  return res.json(room);
});

const startGame = asyncHandler(async (req, res) => {
  const game = await roomService.startRoomGame(req.params.roomId, req.user.id);

  const io = req.app.get('io');
  if (io && game) {
    const question = await getCurrentQuestion(game.id);
    io.to(`room:${req.params.roomId}`).emit('game:started', { game, question });
    const snapshot = await roomService.getRoomSnapshot(req.params.roomId);
    io.to(`room:${req.params.roomId}`).emit('room:updated', snapshot);
    if (question) {
      startServerQuestionTimeout({
        io,
        gameId: game.id,
        roomId: req.params.roomId,
        questionId: question.question_id,
        durationSeconds: question.time_limit_seconds || 15,
      });
    }
  }

  return res.status(201).json({ game });
});

const leaveRoom = asyncHandler(async (req, res) => {
  const io = req.app.get('io');
  const result = await roomService.cancelRoomBeforeStart(req.params.roomId, req.user.id, io);
  return res.json(result);
});

module.exports = {
  createRoom,
  getRoomSnapshot,
  joinRoom,
  toggleReady,
  startGame,
  leaveRoom,
};
