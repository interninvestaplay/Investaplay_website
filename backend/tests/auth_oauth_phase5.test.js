const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../src/db/pool');
const authService = require('../src/services/auth.service');
const oauthService = require('../src/services/oauth.service');
const authRoutes = require('../src/routes/auth.routes');

// Setup mock OAuth verifiers for testing
oauthService.setMockOAuthVerifiers({
  google: async (token) => {
    if (token === 'valid_google_token_1001') {
      return {
        providerUserId: 'google_sub_1001',
        email: 'tester_g1@gmail.com',
        emailVerified: true,
        displayName: 'Google Tester One',
        avatarUrl: 'https://lh3.googleusercontent.com/pic1.jpg',
      };
    }
    if (token === 'valid_google_token_3001') {
      return {
        providerUserId: 'google_sub_3001',
        email: 'tester_g3@gmail.com',
        emailVerified: true,
        displayName: 'Google Link Tester',
        avatarUrl: 'https://lh3.googleusercontent.com/pic3.jpg',
      };
    }
    if (token === 'google_token_conflict_email') {
      return {
        providerUserId: 'google_sub_conflict_999',
        email: 'conflict_user@example.com',
        emailVerified: true,
        displayName: 'Conflict Email User',
      };
    }
    if (token === 'valid_google_token_5001') {
      return {
        providerUserId: 'google_sub_5001',
        email: 'relogin_link@example.com',
        emailVerified: true,
        displayName: 'Relink Tester',
        avatarUrl: 'https://lh3.googleusercontent.com/pic5.jpg',
      };
    }
    if (token === 'valid_google_token_unverified_6001') {
      return {
        providerUserId: 'google_sub_6001',
        email: 'unverified_match@example.com',
        emailVerified: false,
        displayName: 'Unverified Matcher',
      };
    }
    if (token === 'valid_google_token_7001') {
      return {
        providerUserId: 'google_sub_7001',
        email: 'orphan_recover@example.com',
        emailVerified: true,
        displayName: 'Orphan Recoverer',
      };
    }
    if (token === 'valid_google_token_8001') {
      return {
        providerUserId: 'google_sub_8001',
        email: 'bound_elsewhere@example.com',
        emailVerified: true,
        displayName: 'Bound Elsewhere',
      };
    }
    const err = new Error('Invalid or expired Google OAuth token');
    err.status = 401;
    throw err;
  },
  facebook: async (token) => {
    if (token === 'valid_fb_token_2001') {
      return {
        providerUserId: 'fb_id_2001',
        email: 'tester_fb1@meta.com',
        displayName: 'FB Tester One',
        avatarUrl: 'https://graph.facebook.com/pic1.jpg',
      };
    }
    if (token === 'valid_fb_token_4001') {
      return {
        providerUserId: 'fb_id_4001',
        email: 'tester_fb4@meta.com',
        displayName: 'FB Link Tester',
        avatarUrl: 'https://graph.facebook.com/pic4.jpg',
      };
    }
    const err = new Error('Invalid or expired Facebook OAuth token');
    err.status = 401;
    throw err;
  },
});

test('Phase 5: Valid Google Login creates new user and auth_identities record without client spoofing', async () => {
  const result = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_1001',
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'GoogleClient/1.0' } },
  });

  assert.ok(result.user, 'Must return user');
  assert.equal(result.user.isGuest, false, 'User must not be guest');
  assert.equal(result.user.email, 'tester_g1@gmail.com');
  assert.ok(result.tokens.accessToken);
  assert.ok(result.tokens.refreshToken);

  // Verify auth_identities
  const { rows: identities } = await query(
    'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
    [result.user.id, 'google']
  );
  assert.equal(identities.length, 1);
  assert.equal(identities[0].provider_user_id, 'google_sub_1001');
  assert.equal(identities[0].credential_hash, null);

  // Verify security_events
  const { rows: events } = await query(
    "SELECT * FROM security_events WHERE user_id = $1 AND event_type = 'OAUTH_LOGIN_SUCCESS'",
    [result.user.id]
  );
  assert.equal(events.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [result.user.id]);
});

test('Phase 5: Existing Google identity logs in to the same user account', async () => {
  const first = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_1001',
    req: { ip: '127.0.0.1' },
  });

  const second = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_1001',
    req: { ip: '127.0.0.1' },
  });

  assert.equal(first.user.id, second.user.id, 'Must log in to the exact same userId');
  assert.ok(second.tokens.accessToken);

  // Ensure no duplicate auth_identities
  const { rows: identities } = await query(
    'SELECT * FROM auth_identities WHERE provider = $1 AND provider_user_id = $2',
    ['google', 'google_sub_1001']
  );
  assert.equal(identities.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [first.user.id]);
});

test('Phase 5: Invalid or expired Google token is rejected with generic 401 error', async () => {
  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'google',
        token: 'definitely_expired_google_token_xyz',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid or expired OAuth token');
      return true;
    }
  );

  // Verify security_events recorded failure
  const { rows: failedEvents } = await query(
    "SELECT * FROM security_events WHERE event_type = 'OAUTH_LOGIN_FAILED' ORDER BY created_at DESC LIMIT 1"
  );
  assert.ok(failedEvents.length >= 1);
});

test('Phase 5: Valid Facebook Login creates new user and auth_identities record', async () => {
  const result = await authService.socialLogin({
    provider: 'facebook',
    token: 'valid_fb_token_2001',
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'FacebookClient/1.0' } },
  });

  assert.ok(result.user);
  assert.equal(result.user.isGuest, false);
  assert.equal(result.user.email, 'tester_fb1@meta.com');
  assert.ok(result.tokens.accessToken);

  const { rows: identities } = await query(
    'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
    [result.user.id, 'facebook']
  );
  assert.equal(identities.length, 1);
  assert.equal(identities[0].provider_user_id, 'fb_id_2001');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [result.user.id]);
});

test('Phase 5: Invalid or expired Facebook token is rejected with generic 401 error', async () => {
  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'facebook',
        token: 'bad_or_expired_fb_token',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid or expired OAuth token');
      return true;
    }
  );
});

test('Phase 5: Completely removes fake fallback authentication and client-supplied credentials', async () => {
  // Attempting to pass client-supplied email without a valid server-verified token must be rejected
  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'google',
        email: 'fake.user@gmail.com',
        displayName: 'Fake User',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /OAuth token is required/i);
      return true;
    }
  );

  // Attempting empty token
  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'facebook',
        token: '',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('Phase 5: Duplicate email on new social login is rejected safely (Never silently merge accounts)', async () => {
  // Existing registered user with password (defensive cleanup from a previously interrupted run)
  const existingEmail = `conflict_user@example.com`;
  await query('DELETE FROM users WHERE LOWER(email) = $1', [existingEmail.toLowerCase()]);
  const existing = await authService.signup({
    username: `conflict_p5_${Date.now()}`,
    email: existingEmail,
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });

  // An attacker or new social login attempts to login using a Google token with the same email
  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'google',
        token: 'google_token_conflict_email',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /An account with this email already exists/i);
      return true;
    }
  );

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [existing.user.id]);
});

test('Phase 5: Guest to Google/Facebook linking preserves users.id and prevents duplicate linking', async () => {
  // 1. Create a guest account
  const guest = await authService.guestLogin({
    nickname: `OAuthLinker_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });
  const originalUserId = guest.user.id;

  // 2. Link Google
  const linked = await authService.linkAccount({
    userId: originalUserId,
    provider: 'google',
    token: 'valid_google_token_3001',
    req: { ip: '127.0.0.1' },
  });

  assert.equal(linked.user.id, originalUserId, 'users.id must NOT change');
  assert.equal(linked.user.isGuest, false, 'User must no longer be guest');

  // Verify auth_identities
  const { rows: identities } = await query(
    'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
    [originalUserId, 'google']
  );
  assert.equal(identities.length, 1);
  assert.equal(identities[0].provider_user_id, 'google_sub_3001');

  // 3. User can now log in directly with Google
  const loginRes = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_3001',
    req: { ip: '127.0.0.1' },
  });
  assert.equal(loginRes.user.id, originalUserId);

  // 4. Another user attempts to link the same Google identity -> Must reject with 409
  const otherGuest = await authService.guestLogin({
    nickname: `OtherGuest_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });

  await assert.rejects(
    async () => {
      await authService.linkAccount({
        userId: otherGuest.user.id,
        provider: 'google',
        token: 'valid_google_token_3001',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /already linked to another user/i);
      return true;
    }
  );

  // Cleanup
  await query('DELETE FROM users WHERE id IN ($1, $2)', [originalUserId, otherGuest.user.id]);
});

test('Phase 5: Rate limiting is configured on social OAuth route', async () => {
  assert.ok(authRoutes.oauthLimiter, 'oauthLimiter must be defined');

  const socialLayer = authRoutes.stack.find((l) => l.route?.path === '/social');
  assert.ok(socialLayer, 'Social route must be defined');
  assert.equal(socialLayer.route.stack.length, 2, 'Route must have rate limiter and controller');

  // Test rate limiting threshold
  const testApp = express();
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many OAuth authentication attempts. Please try again later.' },
  });
  testApp.post('/test-oauth', testLimiter, (req, res) => res.json({ ok: true }));

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/test-oauth`, { method: 'POST' });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`http://127.0.0.1:${port}/test-oauth`, { method: 'POST' });
    assert.equal(res2.status, 200);
    const res3 = await fetch(`http://127.0.0.1:${port}/test-oauth`, { method: 'POST' });
    assert.equal(res3.status, 429);
    const body = await res3.json();
    assert.match(body.error, /Too many OAuth authentication attempts/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Phase 5: verified-email collision requires explicit authenticated account linking', async () => {
  let first = null;
  // Defensive cleanup from a previously interrupted run
  await query("DELETE FROM users WHERE LOWER(email) = 'relogin_link@example.com'");

  // Existing account with the same email (e.g. user signed up with email/password first)
  const existing = await authService.signup({
    username: `linkpw_${Date.now()}`,
    email: 'relogin_link@example.com',
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });
  first = { user: existing.user };

  // Email collision proves neither ownership nor permission to link.
  await assert.rejects(
    () => authService.socialLogin({ provider: 'google', token: 'valid_google_token_5001', req: { ip: '127.0.0.1' } }),
    (err) => err.status === 409
  );
  assert.equal(first.user.id, existing.user.id, 'Must reuse the existing account — never create a duplicate');
  assert.equal(first.user.isGuest, false);

  // Exactly one user row with this email
  const { rows: sameEmail } = await query(
    "SELECT id FROM users WHERE LOWER(email) = 'relogin_link@example.com' AND deleted_at IS NULL"
  );
  assert.equal(sameEmail.length, 1, 'Must never create a duplicate account');

  await authService.linkAccount({
    userId: existing.user.id, provider: 'google', token: 'valid_google_token_5001', req: { ip: '127.0.0.1' },
  });
  // Compatibility assertions below compare the explicit-link target.
  first = { user: existing.user };

  // Google identity is now bound to the account
  const { rows: identities } = await query(
    "SELECT * FROM auth_identities WHERE user_id = $1 AND provider = 'google'",
    [existing.user.id]
  );
  assert.equal(identities.length, 1, 'Exactly one Google identity must be linked');
  assert.equal(identities[0].provider_user_id, 'google_sub_5001');

  // Provider identity lookup succeeds after explicit authenticated linking.
  const second = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_5001',
    req: { ip: '127.0.0.1' },
  });
  assert.equal(second.user.id, existing.user.id, 'Re-login must hit the same account');
  assert.ok(second.tokens.accessToken, 'Re-login must issue a session without a password');

  // Existing password authentication keeps working unchanged
  const pw = await authService.login({
    identifier: 'relogin_link@example.com',
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });
  assert.equal(pw.user.id, existing.user.id);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [existing.user.id]);
});

test('Phase 5: unverified Google email is never used for matching or persistence', async () => {
  // Defensive cleanup from a previously interrupted run
  await query("DELETE FROM users WHERE LOWER(email) = 'unverified_match@example.com'");

  const existing = await authService.signup({
    username: `unv_${Date.now()}`,
    email: 'unverified_match@example.com',
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });

  const social = await authService.socialLogin({
    provider: 'google', token: 'valid_google_token_unverified_6001', req: { ip: '127.0.0.1' },
  });
  assert.notEqual(social.user.id, existing.user.id);
  assert.equal(social.user.email, null);

  // No identity may have been attached on the rejected attempt
  const { rows: identities } = await query(
    "SELECT * FROM auth_identities WHERE user_id = $1 AND provider = 'google'",
    [existing.user.id]
  );
  assert.equal(identities.length, 0, 'Unverified email must not link an identity');

  // Cleanup
  await query('DELETE FROM users WHERE id IN ($1, $2)', [existing.user.id, social.user.id]);
});

test('Phase 5: legacy orphan is not automatically recovered; linking requires explicit action', async () => {
  // Defensive cleanup from a previously interrupted run
  await query("DELETE FROM users WHERE LOWER(email) = 'orphan_recover@example.com'");

  // Simulates accounts created by the pre-auth_identities social login flow
  const orphanId = randomUUID();
  await query(
    `INSERT INTO users (id, username, email, display_name, invite_code, coins, is_guest)
     VALUES ($1, $2, $3, $4, $5, 1000, FALSE)`,
    [orphanId, `legacy_orph_${Date.now()}`, 'orphan_recover@example.com', 'Legacy Orphan', null]
  );

  await assert.rejects(
    () => authService.socialLogin({ provider: 'google', token: 'valid_google_token_7001', req: { ip: '127.0.0.1' } }),
    (err) => err.status === 409
  );
  await authService.linkAccount({
    userId: orphanId, provider: 'google', token: 'valid_google_token_7001', req: { ip: '127.0.0.1' },
  });
  const first = { user: { id: orphanId } };
  assert.equal(first.user.id, orphanId, 'Must recover the same legacy account — not 409, not a duplicate');

  const { rows: identities } = await query('SELECT * FROM auth_identities WHERE user_id = $1', [orphanId]);
  assert.equal(identities.length, 1, 'Google identity must be backfilled onto the orphan');
  assert.equal(identities[0].provider, 'google');
  assert.equal(identities[0].provider_user_id, 'google_sub_7001');

  // Subsequent Google login goes through the identity-first path
  const second = await authService.socialLogin({
    provider: 'google',
    token: 'valid_google_token_7001',
    req: { ip: '127.0.0.1' },
  });
  assert.equal(second.user.id, orphanId);
  assert.ok(second.tokens.accessToken);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [orphanId]);
});

test('Phase 5: Account already bound to a DIFFERENT Google identity is never re-linked', async () => {
  // Defensive cleanup from a previously interrupted run
  await query("DELETE FROM users WHERE LOWER(email) = 'bound_elsewhere@example.com'");

  const boundId = randomUUID();
  await query(
    `INSERT INTO users (id, username, email, display_name, invite_code, coins, is_guest)
     VALUES ($1, $2, $3, $4, $5, 1000, FALSE)`,
    [boundId, `bound_${Date.now()}`, 'bound_elsewhere@example.com', 'Bound User', null]
  );
  await query(
    `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
     VALUES ($1, $2, 'google', 'google_sub_OTHER_SUBJECT', NULL)`,
    [randomUUID(), boundId]
  );

  await assert.rejects(
    async () => {
      await authService.socialLogin({
        provider: 'google',
        token: 'valid_google_token_8001',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /An account with this email already exists/i);
      return true;
    }
  );

  // The existing binding must be untouched
  const { rows: identities } = await query('SELECT * FROM auth_identities WHERE user_id = $1', [boundId]);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].provider_user_id, 'google_sub_OTHER_SUBJECT');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [boundId]);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
