const {
  getPlayerPerformanceDashboard,
  getPlayerSkillScore,
  compareSkillWithFriends,
  getGlobalLeaderboard,
} = require('../services/skillScore.service');
const {
  getGameStatistics,
  getRoomHistory,
  getUserMatchHistory,
} = require('../services/matchHistory.service');
const {
  getRejoinGameState,
  canPlayerRejoin,
  getGameParticipants,
  getActiveGameForUser,
  getCategoryProgressForUser,
} = require('../services/rejoin.service');
const asyncHandler = require('../utils/asyncHandler');

const getGlobalLeaderboardStats = asyncHandler(async (req, res) => {
  const leaderboard = await getGlobalLeaderboard(req.query.limit || 50);
  return res.json({ leaderboard });
});

const getProfileStats = asyncHandler(async (req, res) => {
  const dashboard = await getPlayerPerformanceDashboard(req.user.id);
  return res.json(dashboard);
});

const getSkillScore = asyncHandler(async (req, res) => {
  const skillScore = await getPlayerSkillScore(req.user.id);
  return res.json(skillScore);
});

const compareSkillFriends = asyncHandler(async (req, res) => {
  const comparison = await compareSkillWithFriends(req.user.id);
  return res.json(comparison);
});

const getGameStats = asyncHandler(async (req, res) => {
  const stats = await getGameStatistics(req.params.gameId);
  return res.json({ gameId: req.params.gameId, statistics: stats });
});

const getRoomMatchHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const history = await getRoomHistory(req.params.roomId, limit, offset);
  return res.json({
    roomId: req.params.roomId,
    matches: history,
    limit,
    offset,
  });
});

const getPlayerMatchHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const history = await getUserMatchHistory(req.user.id, limit, offset);
  return res.json({
    userId: req.user.id,
    matches: history,
    limit,
    offset,
  });
});

const getActiveRejoin = asyncHandler(async (req, res) => {
  const activeGame = await getActiveGameForUser(req.user.id);
  return res.json(activeGame);
});

const getCategoryProgress = asyncHandler(async (req, res) => {
  const categories = await getCategoryProgressForUser(req.user.id);
  return res.json({ categories });
});

const checkCanRejoin = asyncHandler(async (req, res) => {
  const canRejoin = await canPlayerRejoin(req.params.gameId, req.user.id);
  return res.json(canRejoin);
});

const getRejoinState = asyncHandler(async (req, res) => {
  const gameState = await getRejoinGameState(req.params.gameId, req.user.id);
  return res.json(gameState);
});

const getParticipants = asyncHandler(async (req, res) => {
  const participants = await getGameParticipants(req.params.gameId);
  return res.json({ gameId: req.params.gameId, participants });
});

module.exports = {
  getGlobalLeaderboardStats,
  getProfileStats,
  getSkillScore,
  compareSkillFriends,
  getGameStats,
  getRoomMatchHistory,
  getPlayerMatchHistory,
  getActiveRejoin,
  getCategoryProgress,
  checkCanRejoin,
  getRejoinState,
  getParticipants,
};
