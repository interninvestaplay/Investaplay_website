const express = require('express');
const { requireAuth } = require('../middleware/auth');
const statisticsController = require('../controllers/statistics.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/global-leaderboard', statisticsController.getGlobalLeaderboardStats);
router.get('/profile/stats', statisticsController.getProfileStats);
router.get('/skill-score', statisticsController.getSkillScore);
router.get('/friends/compare-skill', statisticsController.compareSkillFriends);
router.get('/:gameId/stats', statisticsController.getGameStats);
router.get('/rooms/:roomId/history', statisticsController.getRoomMatchHistory);
router.get('/history/matches', statisticsController.getPlayerMatchHistory);
router.get('/category-progress', statisticsController.getCategoryProgress);
router.get('/rejoin/active', statisticsController.getActiveRejoin);
router.get('/:gameId/can-rejoin', statisticsController.checkCanRejoin);
router.get('/:gameId/rejoin-state', statisticsController.getRejoinState);
router.get('/:gameId/participants', statisticsController.getParticipants);

module.exports = router;
