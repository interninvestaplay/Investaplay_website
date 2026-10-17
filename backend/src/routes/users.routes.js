const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const userController = require('../controllers/user.controller');
const statisticsController = require('../controllers/statistics.controller');

const router = express.Router();

// Public leaderboard endpoint
router.get('/leaderboard', statisticsController.getGlobalLeaderboardStats);

router.use(requireAuth);

// Admin endpoints
router.get('/admin/system-stats', requireAdmin, userController.getSystemStats);
router.get('/admin/player-stats', requireAdmin, userController.getPlayerStatsAdmin);
router.get('/admin/users', requireAdmin, userController.listUsersAdmin);
router.get('/admin/users/:userId/details', requireAdmin, userController.getPlayerDetailsAdmin);
router.post('/admin/users/:userId/status', requireAdmin, userController.updateUserStatusAdmin);
router.patch('/admin/users/:userId/status', requireAdmin, userController.updateUserStatusAdmin);
router.post('/admin/adjust-coins', requireAdmin, userController.adjustCoinsAdmin);
router.patch('/admin/users/:userId', requireAdmin, userController.updateUserAdmin);

// Profile, bonuses, streak
router.get('/me/profile', userController.getProfile);
router.patch('/me/profile', userController.updateProfile);
router.get('/me/daily-bonus', userController.getDailyBonus);
router.post('/me/daily-bonus', userController.claimDailyBonus);
router.post('/daily-streak/claim', userController.claimDailyBonus);
router.post('/me/daily-bonus/recover', userController.recoverDailyStreak);
router.get('/me/streak', userController.getStreak);
router.post('/me/streak/claim-weekly', userController.claimWeeklyStreakReward);
router.get('/me/ai-best-score', userController.getAiBestScore);
router.get('/me/achievements', userController.getAchievements);
router.post('/me/achievements/:code/claim', userController.claimAchievement);
router.get('/me/referrals', userController.getReferrals);
router.post('/me/referrals/redeem', userController.redeemReferral);
router.post('/me/push-token', userController.savePushToken);

// Friends and search
router.get('/search', userController.searchUsers);
router.get('/friends/search', userController.searchUsers);
router.get('/friends', userController.getFriends);
router.post('/friends', userController.addFriend);
router.patch('/friends/:friendshipId', userController.respondFriendRequest);

module.exports = router;
