const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const tournamentController = require('../controllers/tournament.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/', tournamentController.listTournaments);
router.get('/:tournamentId/players', tournamentController.getTournamentPlayers);
router.post('/', requireAdmin, tournamentController.createTournament);
router.post('/generate-ai-questions', requireAdmin, tournamentController.generateAiQuestions);

router.get('/:tournamentId', tournamentController.getTournamentDetails);
router.post('/:tournamentId/join', tournamentController.joinTournament);
router.post('/:tournamentId/start', requireAdmin, tournamentController.startTournament);
router.get('/:tournamentId/leaderboard', tournamentController.getTournamentLeaderboard);
router.post('/:tournamentId/play', tournamentController.playTournament);
router.post('/:tournamentId/complete', tournamentController.completeTournamentAttempt);
router.post('/:tournamentId/end', requireAdmin, tournamentController.endTournament);
router.post('/:tournamentId/cancel', requireAdmin, tournamentController.cancelTournament);

module.exports = router;
