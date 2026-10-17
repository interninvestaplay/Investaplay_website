const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');

function guestCookie(credential) {
  // Secure is required in production; HttpOnly prevents scripts from reading
  // the browser restoration credential.
  return `guest_credential=${encodeURIComponent(credential)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${env.isProduction ? '; Secure' : ''}`;
}

const signup = asyncHandler(async (req, res) => {
  const { username, email, password, displayName } = req.body;
  const result = await authService.signup({
    username,
    email,
    password,
    displayName,
    req,
  });
  return res.status(201).json({
    ...result,
    accessToken: result.tokens?.accessToken,
  });
});

const login = asyncHandler(async (req, res) => {
  const { identifier, username, email, password } = req.body;
  const result = await authService.login({
    identifier: identifier || username || email,
    password,
    req,
  });
  return res.json({
    ...result,
    accessToken: result.tokens?.accessToken,
  });
});

const guestLogin = asyncHandler(async (req, res) => {
  const nickname = req.body.nickname || req.body.displayName || `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
  const { guestCredential } = req.body;
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)guest_credential=([^;]+)/);
  const resolvedCredential = guestCredential || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  const result = await authService.guestLogin({
    nickname,
    guestCredential: resolvedCredential,
    req,
  });

  if (result.guestCredential) {
    res.setHeader('Set-Cookie', guestCookie(result.guestCredential));
  }

  return res.status(201).json({
    ...result,
    accessToken: result.tokens?.accessToken,
  });
});

const restoreGuest = asyncHandler(async (req, res) => {
  const { guestCredential } = req.body;
  const cookieHeader = req.headers.cookie || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)guest_credential=([^;]+)/);
  const resolvedCredential = guestCredential || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  const result = await authService.restoreGuest({
    guestCredential: resolvedCredential,
    req,
  });

  if (result.guestCredential) {
    res.setHeader('Set-Cookie', guestCookie(result.guestCredential));
  }

  return res.json(result);
});

const linkAccount = asyncHandler(async (req, res) => {
  const { provider, email, password, username, token, idToken, accessToken, providerUserId } = req.body;
  const result = await authService.linkAccount({
    userId: req.user.id,
    provider,
    email,
    password,
    username,
    token,
    idToken,
    accessToken,
    providerUserId,
    req,
  });
  return res.json(result);
});

const socialLogin = asyncHandler(async (req, res) => {
  const { provider, token, idToken, accessToken, codeVerifier, redirectUri } = req.body;
  const result = await authService.socialLogin({
    provider,
    token,
    idToken,
    accessToken,
    codeVerifier,
    redirectUri,
    req,
  });
  return res.json(result);
});


const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshUserSession({
    refreshToken,
    req,
  });
  return res.json(result);
});

const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.revokeUserSession({
    refreshToken,
    sessionId: req.sessionId,
    userId: req.user?.id,
    req,
  });
  return res.status(204).send();
});

const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listUserSessions({
    userId: req.user.id,
    currentSessionId: req.sessionId,
  });
  return res.json({ sessions });
});

const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const result = await authService.revokeSessionById({
    userId: req.user.id,
    sessionId,
    req,
  });
  return res.json(result);
});

const revokeAllSessions = asyncHandler(async (req, res) => {
  const result = await authService.revokeAllUserSessions({
    userId: req.user.id,
    req,
  });
  return res.json(result);
});

const getMe = asyncHandler(async (req, res) => {
  return res.json({ user: authService.publicUser(req.user) });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.requestPasswordReset({ email });
  return res.json(result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const result = await authService.resetPassword({ token, password });
  return res.json(result);
});

module.exports = {
  signup,
  login,
  guestLogin,
  restoreGuest,
  linkAccount,
  socialLogin,
  refreshToken,
  logout,
  listSessions,
  revokeSession,
  revokeAllSessions,
  getMe,
  forgotPassword,
  resetPassword,
};

