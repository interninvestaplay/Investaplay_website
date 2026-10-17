const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const authController = require('../controllers/auth.controller');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 15 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 10 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account creations. Please try again later.' },
});

const guestRestoreLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 10 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many guest restoration attempts. Please try again later.' },
});

const guestCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many guest account creations. Please try again later.' },
});

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OAuth authentication attempts. Please try again later.' },
});

router.post('/signup', signupLimiter, authController.signup);
router.post('/register', signupLimiter, authController.signup);
router.post('/login', loginLimiter, authController.login);
router.post('/guest', guestCreateLimiter, authController.guestLogin);
router.post('/guest/restore', guestRestoreLimiter, authController.restoreGuest);
router.post('/link-account', requireAuth, authController.linkAccount);
router.post('/social', oauthLimiter, authController.socialLogin);
router.post('/refresh', authController.refreshToken);
router.post('/logout', requireAuth, authController.logout);
router.get('/sessions', requireAuth, authController.listSessions);
router.post('/sessions/revoke-all', requireAuth, authController.revokeAllSessions);
router.delete('/sessions/:sessionId', requireAuth, authController.revokeSession);
router.get('/me', requireAuth, authController.getMe);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

router.loginLimiter = loginLimiter;
router.signupLimiter = signupLimiter;
router.guestRestoreLimiter = guestRestoreLimiter;
router.guestCreateLimiter = guestCreateLimiter;
router.oauthLimiter = oauthLimiter;

module.exports = router;



