const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const roomController = require('../controllers/room.controller');

const router = express.Router();
router.use(requireAuth);
const roomMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', roomMutationLimiter, roomController.createRoom);
router.get('/:roomId', roomController.getRoomSnapshot);
router.post('/join', roomMutationLimiter, roomController.joinRoom);
router.post('/join/:code', roomMutationLimiter, roomController.joinRoom);
router.patch('/:roomId/ready', roomMutationLimiter, roomController.toggleReady);
router.post('/:roomId/start', roomMutationLimiter, roomController.startGame);
router.post('/:roomId/leave', roomMutationLimiter, roomController.leaveRoom);

module.exports = router;
