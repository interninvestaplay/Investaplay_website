const challengeService = require('../services/challenge.service');
const { ensureInviteCode } = require('../services/invite.service');
const asyncHandler = require('../utils/asyncHandler');

const getMyInviteCode = asyncHandler(async (req, res) => {
  const inviteCode = await ensureInviteCode(req.user.id);
  return res.json({ inviteCode });
});

const getSuggestions = asyncHandler(async (req, res) => {
  const result = await challengeService.getSuggestions(req.user.id, req.user.level || 1);
  return res.json(result);
});

const listChallenges = asyncHandler(async (req, res) => {
  const challenges = await challengeService.listChallenges(req.user.id);
  return res.json({ challenges });
});

const createChallenge = asyncHandler(async (req, res) => {
  const challenge = await challengeService.createChallenge(req.user, {
    inviteCode: req.body.inviteCode,
    targetUserId: req.body.userId,
    req,
  });
  return res.status(201).json({ challenge });
});

const acceptChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.acceptChallenge(req.params.challengeId, req.user, req);
  return res.json(result);
});

const declineChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.declineChallenge(req.params.challengeId, req.user, req);
  return res.json(result);
});

const cancelChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.cancelChallenge(req.params.challengeId, req.user.id, req);
  return res.json(result);
});

const abortChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.abortChallenge(req.params.challengeId, req.user.id);
  return res.json(result);
});

const joinChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.joinChallenge(req.params.challengeId, req.user.id);
  return res.json(result);
});

const completeChallenge = asyncHandler(async (req, res) => {
  const result = await challengeService.completeChallenge(req.params.challengeId);
  return res.json(result);
});

module.exports = {
  getMyInviteCode,
  getSuggestions,
  listChallenges,
  createChallenge,
  acceptChallenge,
  declineChallenge,
  cancelChallenge,
  abortChallenge,
  joinChallenge,
  completeChallenge,
};
