const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const gameController = require('../controllers/game.controller');

const router = express.Router();
router.use(requireAuth);
const gameMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `${req.user.id}:${req.params.gameId || 'new'}`,
  standardHeaders: true,
  legacyHeaders: false,
});
const answerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => `${req.user.id}:${req.params.gameId}`,
  standardHeaders: true,
  legacyHeaders: false,
});
const advanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `${req.user.id}:${req.params.gameId}`,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/ai', gameMutationLimiter, gameController.createAiGame);
router.get('/:gameId/current-question', gameController.getQuestion);
router.post('/:gameId/answers', answerLimiter, gameController.postAnswer);
router.post('/:gameId/ai-turn', gameMutationLimiter, gameController.postAiTurn);
router.post('/:gameId/advance', advanceLimiter, gameController.postAdvance);
router.post('/:gameId/finish', gameMutationLimiter, gameController.postFinish);
router.post('/:gameId/rejoin', gameMutationLimiter, gameController.postRejoinGame);
router.get('/:gameId/leaderboard', gameController.getGameLeaderboard);

module.exports = router;
