const crypto = require('crypto');
const env = require('../config/env');

let mockGoogleVerifier = null;
let mockFacebookVerifier = null;
let googleJwks = { keys: [], expiresAt: 0 };

function oauthError(message = 'Invalid or expired Google OAuth token', status = 401) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function setMockOAuthVerifiers({ google, facebook } = {}) {
  mockGoogleVerifier = google !== undefined ? google : mockGoogleVerifier;
  mockFacebookVerifier = facebook !== undefined ? facebook : mockFacebookVerifier;
}

function base64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (_) {
    throw oauthError();
  }
}

function allowedGoogleClientIds() {
  return [...new Set([
    ...String(env.googleClientIds || '').split(','),
    env.googleClientId,
  ].map((id) => String(id || '').trim()).filter(Boolean))];
}

async function fetchGoogleJwks(force = false) {
  if (!force && googleJwks.expiresAt > Date.now() && googleJwks.keys.length) return googleJwks.keys;
  let response;
  try {
    response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  } catch (_) {
    throw oauthError();
  }
  if (!response.ok) throw oauthError();
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw oauthError();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number((cacheControl.match(/max-age=(\d+)/) || [])[1]) || 3600;
  googleJwks = { keys: body.keys, expiresAt: Date.now() + maxAge * 1000 };
  return googleJwks.keys;
}

async function verifyGoogleIdToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw oauthError();
  const header = base64UrlJson(parts[0]);
  const claims = base64UrlJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw oauthError();

  let keys = await fetchGoogleJwks();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await fetchGoogleJwks(true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw oauthError();

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (_) {
    throw oauthError();
  }
  const validSignature = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  );
  if (!validSignature) throw oauthError();

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const allowedAudiences = allowedGoogleClientIds();
  if (!claims.sub || !claims.exp || claims.exp <= now ||
      (claims.nbf && claims.nbf > now) || (claims.iat && claims.iat > now + 300) ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      !allowedAudiences.length || !audience.some((aud) => allowedAudiences.includes(aud))) {
    throw oauthError();
  }

  return {
    providerUserId: String(claims.sub),
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    displayName: claims.name || claims.given_name || 'Google User',
    avatarUrl: claims.picture || null,
  };
}

/** Verify only signed Google OpenID Connect ID tokens. OAuth access tokens are not accepted here. */
async function verifyGoogleToken(token) {
  if (!token || typeof token !== 'string') throw oauthError('Google token is required', 400);
  if (mockGoogleVerifier) return mockGoogleVerifier(token);
  return verifyGoogleIdToken(token);
}

async function exchangeGoogleCode(code, codeVerifier, redirectUri) {
  if (!code || !codeVerifier || !redirectUri) throw oauthError('Invalid Google authorization request', 400);
  const clientId = env.googleClientId;
  const clientSecret = env.googleClientSecret;
  if (!clientId || !clientSecret) throw oauthError('Google OAuth is unavailable', 503);
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&grant_type=authorization_code&code=${encodeURIComponent(code)}&code_verifier=${encodeURIComponent(codeVerifier)}`,
    });
  } catch (_) { throw oauthError(); }
  if (!tokenRes.ok) throw oauthError();
  const tokenData = await tokenRes.json();
  if (!tokenData.id_token) throw oauthError();
  return verifyGoogleToken(tokenData.id_token);
}

async function verifyFacebookToken(token) {
  if (!token || typeof token !== 'string') {
    const error = new Error('Facebook token is required'); error.status = 400; throw error;
  }
  if (mockFacebookVerifier) return mockFacebookVerifier(token);
  try {
    const res = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.id) return { providerUserId: String(data.id), email: data.email || null, emailVerified: false, displayName: data.name || 'Facebook User', avatarUrl: data.picture?.data?.url || null };
    }
  } catch (_) {}
  const error = new Error('Invalid or expired Facebook OAuth token'); error.status = 401; throw error;
}

module.exports = { verifyGoogleToken, exchangeGoogleCode, verifyFacebookToken, setMockOAuthVerifiers };
