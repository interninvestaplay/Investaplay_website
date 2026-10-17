const tournamentService = require('../services/tournament.service');
const asyncHandler = require('../utils/asyncHandler');

const listTournaments = asyncHandler(async (req, res) => {
  const io = req.app?.get('io');
  const { status } = req.query;
  const tournaments = await tournamentService.listTournaments({
    userId: req.user.id,
    status,
    io,
  });
  return res.json({ tournaments });
});

const getTournamentPlayers = asyncHandler(async (req, res) => {
  const players = await tournamentService.getTournamentPlayers(req.params.tournamentId);
  return res.json({ players });
});

const createTournament = asyncHandler(async (req, res) => {
  const tournament = await tournamentService.createTournament(req.body);
  return res.status(201).json({ tournament });
});

const getTournamentDetails = asyncHandler(async (req, res) => {
  const details = await tournamentService.getTournamentDetails(req.params.tournamentId, req.user.id);
  return res.json(details);
});

const joinTournament = asyncHandler(async (req, res) => {
  const result = await tournamentService.joinTournament(req.params.tournamentId, req.user.id);
  return res.status(201).json(result);
});

const startTournament = asyncHandler(async (req, res) => {
  const { game, alreadyStarted } = await tournamentService.startTournament(req.params.tournamentId, req.user.id);
  return res.status(alreadyStarted ? 200 : 201).json({ game });
});

const getTournamentLeaderboard = asyncHandler(async (req, res) => {
  const leaderboardData = await tournamentService.getTournamentLeaderboard(req.params.tournamentId);
  return res.json(leaderboardData);
});

const generateAiQuestions = asyncHandler(async (req, res) => {
  const result = await tournamentService.generateAiQuestions(req.body);
  return res.status(201).json(result);
});

const playTournament = asyncHandler(async (req, res) => {
  try {
    const result = await tournamentService.playTournament(req.params.tournamentId, req.user);
    return res.json(result);
  } catch (error) {
    if (error.extra) {
      return res.status(error.status || 400).json({
        error: error.message,
        ...error.extra,
      });
    }
    throw error;
  }
});

const completeTournamentAttempt = asyncHandler(async (req, res) => {
  const result = await tournamentService.completeTournamentAttempt(req.params.tournamentId, req.user.id);
  return res.json(result);
});

const endTournament = asyncHandler(async (req, res) => {
  const result = await tournamentService.endTournament(req.params.tournamentId);
  return res.json(result);
});

const cancelTournament = asyncHandler(async (req, res) => {
  const result = await tournamentService.cancelTournament(req.params.tournamentId);
  return res.json(result);
});

module.exports = {
  listTournaments,
  getTournamentPlayers,
  createTournament,
  getTournamentDetails,
  joinTournament,
  startTournament,
  getTournamentLeaderboard,
  generateAiQuestions,
  playTournament,
  completeTournamentAttempt,
  endTournament,
  cancelTournament,
};
