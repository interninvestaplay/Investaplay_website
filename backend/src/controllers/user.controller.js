const userService = require('../services/user.service');
const achievementService = require('../services/achievement.service');
const referralService = require('../services/referral.service');
const asyncHandler = require('../utils/asyncHandler');

const getSystemStats = asyncHandler(async (req, res) => {
  const stats = await userService.getSystemStats();
  return res.json(stats);
});

const getPlayerStatsAdmin = asyncHandler(async (req, res) => {
  const stats = await userService.getGlobalPlayerStats();
  return res.json(stats);
});

const listUsersAdmin = asyncHandler(async (req, res) => {
  const result = await userService.listUsersForAdmin({
    search: req.query.search,
    status: req.query.status,
    accountType: req.query.accountType,
    role: req.query.role,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return res.json(result);
});

const getPlayerDetailsAdmin = asyncHandler(async (req, res) => {
  const details = await userService.getPlayerDetailsAdmin(req.params.userId);
  return res.json(details);
});

const updateUserStatusAdmin = asyncHandler(async (req, res) => {
  const { status, reason } = req.body || {};
  const user = await userService.updateUserStatusAdmin(req.params.userId, { status, reason });
  return res.json({ success: true, user });
});

const adjustCoinsAdmin = asyncHandler(async (req, res) => {
  const { userId, amount, reason } = req.body;
  const result = await userService.adjustCoinsAdmin({ userId, amount, reason });
  return res.json({ success: true, transaction: result });
});

const updateUserAdmin = asyncHandler(async (req, res) => {
  const user = await userService.updateUserAdmin(req.params.userId, req.body || {});
  return res.json({ user });
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await userService.getUserProfile(req.user.id, req.user);
  return res.json(profile);
});

const getDailyBonus = asyncHandler(async (req, res) => {
  const status = await userService.getDailyBonusStatus(req.user.id);
  return res.json(status);
});

const claimDailyBonus = asyncHandler(async (req, res) => {
  const result = await userService.claimDailyBonus(req.user.id);
  return res.json(result);
});

const recoverDailyStreak = asyncHandler(async (req, res) => {
  const result = await userService.recoverDailyStreak(req.user.id, req.body || {});
  return res.json(result);
});

const getStreak = asyncHandler(async (req, res) => {
  const streak = await userService.getStreak(req.user.id);
  return res.json(streak);
});

const claimWeeklyStreakReward = asyncHandler(async (req, res) => {
  const result = await userService.claimWeeklyStreakReward(req.user.id);
  return res.json(result);
});

const getAiBestScore = asyncHandler(async (req, res) => {
  if (req.query.scope === 'overall') {
    const overall = await userService.getOverallAiBestScore(req.user.id);
    return res.json({ bestScore: { best_score: overall } });
  }

  const bestScore = await userService.getAiBestScore({
    userId: req.user.id,
    botName: req.query.botName || 'Nova',
    level: Number(req.query.level || 1),
  });
  return res.json({ bestScore });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { displayName, avatarUrl } = req.body;
  const user = await userService.updateProfile(req.user.id, { displayName, avatarUrl });
  return res.json({ user });
});

const savePushToken = asyncHandler(async (req, res) => {
  const { token, platform } = req.body;
  const result = await userService.registerPushToken(req.user.id, { token, platform });
  return res.status(201).json(result);
});

const searchUsers = asyncHandler(async (req, res) => {
  const term = req.query.q;
  const users = await userService.searchUsers(req.user.id, term);
  return res.json({ users });
});

const getFriends = asyncHandler(async (req, res) => {
  const friends = await userService.getFriends(req.user.id);
  return res.json({ friends });
});

const addFriend = asyncHandler(async (req, res) => {
  const { username, userId } = req.body;
  const { friendship, alreadyExists } = await userService.addFriend(req.user.id, { username, targetId: userId });
  return res.status(alreadyExists ? 200 : 201).json({ friendship });
});

const respondFriendRequest = asyncHandler(async (req, res) => {
  const action = req.body.action;
  const result = await userService.respondFriendRequest(req.user.id, req.params.friendshipId, action);
  return res.json(result);
});

const getAchievements = asyncHandler(async (req, res) => {
  const achievements = await achievementService.getUserAchievements(req.user.id);
  return res.json({ achievements });
});

const claimAchievement = asyncHandler(async (req, res) => {
  const result = await achievementService.claimAchievement(req.user.id, req.params.code);
  return res.json(result);
});

const getReferrals = asyncHandler(async (req, res) => {
  const summary = await referralService.getReferralSummary(req.user.id);
  return res.json(summary);
});

const redeemReferral = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  const result = await referralService.redeemReferralCode(req.user.id, inviteCode);
  return res.json(result);
});

module.exports = {
  getSystemStats,
  getPlayerStatsAdmin,
  listUsersAdmin,
  getPlayerDetailsAdmin,
  updateUserStatusAdmin,
  adjustCoinsAdmin,
  updateUserAdmin,
  getProfile,
  getDailyBonus,
  claimDailyBonus,
  recoverDailyStreak,
  getStreak,
  claimWeeklyStreakReward,
  getAiBestScore,
  updateProfile,
  savePushToken,
  searchUsers,
  getFriends,
  addFriend,
  respondFriendRequest,
  getAchievements,
  claimAchievement,
  getReferrals,
  redeemReferral,
};
