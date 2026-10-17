const express = require('express');
const { requireAuth } = require('../middleware/auth');
const challengeController = require('../controllers/challenge.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/me', challengeController.getMyInviteCode);
router.get('/suggestions', challengeController.getSuggestions);
router.get('/', challengeController.listChallenges);
router.post('/', challengeController.createChallenge);
router.post('/:challengeId/accept', challengeController.acceptChallenge);
router.post('/:challengeId/decline', challengeController.declineChallenge);
router.post('/:challengeId/cancel', challengeController.cancelChallenge);
router.post('/:challengeId/abort', challengeController.abortChallenge);
router.post('/:challengeId/join', challengeController.joinChallenge);
router.post('/:challengeId/complete', challengeController.completeChallenge);

module.exports = router;
