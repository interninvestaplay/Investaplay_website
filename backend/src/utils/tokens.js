const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

function signAccessToken(user, sessionId = null) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    isGuest: Boolean(user.is_guest),
    tokenVersion: user.token_version || 0,
  };
  if (sessionId) {
    payload.sessionId = sessionId;
  }
  return jwt.sign(
    payload,
    env.jwtAccessSecret,
    { expiresIn: env.accessTokenTtl }
  );
}

function signRefreshToken(user, tokenId) {
  return jwt.sign(
    {
      sub: user.id,
      jti: tokenId,
      tokenVersion: user.token_version || 0,
    },
    env.jwtRefreshSecret,
    { expiresIn: `${env.refreshTokenTtlDays}d` }
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken,
};
