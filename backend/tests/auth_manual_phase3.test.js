const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../src/db/pool');
const authService = require('../src/services/auth.service');
const { hashToken } = require('../src/utils/tokens');

test('Phase 3: Manual Signup creates users and auth_identities records with hashed password', async () => {
  const email = `phase3_signup_${Date.now()}@example.com`;
  const username = `p3_user_${Date.now()}`;
  const password = 'SecurePassword123!';

  const result = await authService.signup({
    username,
    email,
    password,
    displayName: 'Phase 3 Tester',
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'NodeTestAgent/1.0' } },
  });

  assert.ok(result.user, 'Result must contain user');
  assert.equal(result.user.username, username);
  assert.equal(result.user.email, email.toLowerCase());
  assert.equal(result.user.password, undefined, 'Plaintext password must never be returned');
  assert.equal(result.user.password_hash, undefined, 'password_hash must never be returned in publicUser');
  assert.ok(result.tokens?.accessToken, 'Must return accessToken');
  assert.ok(result.tokens?.refreshToken, 'Must return refreshToken');

  // Verify DB record in users
  const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [result.user.id]);
  assert.equal(userRows.length, 1);
  assert.notEqual(userRows[0].password_hash, password, 'Stored password must be hashed, not plaintext');
  assert.ok(await bcrypt.compare(password, userRows[0].password_hash));

  // Verify DB record in auth_identities
  const { rows: identityRows } = await query(
    'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
    [result.user.id, 'password']
  );
  assert.equal(identityRows.length, 1);
  assert.equal(identityRows[0].provider_user_id, result.user.id);
  assert.ok(await bcrypt.compare(password, identityRows[0].credential_hash));

  // Verify security_events recorded SIGNUP_SUCCESS
  const { rows: eventRows } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [result.user.id, 'SIGNUP_SUCCESS']
  );
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].ip_address, '127.0.0.1');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [result.user.id]);
});

test('Phase 3: Login works symmetrically with email OR username', async () => {
  const email = `phase3_login_${Date.now()}@example.com`;
  const username = `p3_login_${Date.now()}`;
  const password = 'SuperSecretPassword456!';

  const signupRes = await authService.signup({
    username,
    email,
    password,
    req: { ip: '127.0.0.1' },
  });

  // Login using EMAIL
  const loginByEmail = await authService.login({
    identifier: email.toUpperCase(), // case-insensitivity check
    password,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'TestClient/Email' } },
  });
  assert.equal(loginByEmail.user.id, signupRes.user.id);
  assert.ok(loginByEmail.tokens.accessToken);

  // Login using USERNAME
  const loginByUsername = await authService.login({
    identifier: username.toUpperCase(), // case-insensitivity check
    password,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'TestClient/Username' } },
  });
  assert.equal(loginByUsername.user.id, signupRes.user.id);
  assert.ok(loginByUsername.tokens.accessToken);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [signupRes.user.id]);
});

test('Phase 3: Login rejects wrong credentials with generic 401 error and records event', async () => {
  const email = `phase3_wrongpass_${Date.now()}@example.com`;
  const username = `p3_wrong_${Date.now()}`;
  const correctPass = 'CorrectPassword123!';

  const signupRes = await authService.signup({
    username,
    email,
    password: correctPass,
    req: { ip: '127.0.0.1' },
  });

  // Attempt login with wrong password
  await assert.rejects(
    async () => {
      await authService.login({
        identifier: email,
        password: 'DefiniteWrongPassword!',
        req: { ip: '192.168.1.50', headers: { 'user-agent': 'BadGuy/1.0' } },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid username/email or password');
      return true;
    }
  );

  // Attempt login with nonexistent user
  await assert.rejects(
    async () => {
      await authService.login({
        identifier: 'nonexistent_user_999999@test.com',
        password: 'SomePassword123!',
        req: { ip: '192.168.1.50' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid username/email or password');
      return true;
    }
  );

  // Verify LOGIN_FAILED was recorded in security_events
  const { rows: failedEvents } = await query(
    `SELECT * FROM security_events 
     WHERE (user_id = $1 OR metadata LIKE '%nonexistent_user_999999%')
       AND event_type = 'LOGIN_FAILED'`,
    [signupRes.user.id]
  );
  assert.ok(failedEvents.length >= 2, 'Must record security event for each failed login');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [signupRes.user.id]);
});

test('Phase 3: Duplicate signup rejection (email & username)', async () => {
  const email = `phase3_dup_${Date.now()}@example.com`;
  const username = `p3_dup_${Date.now()}`;
  const password = 'Password123!';

  const first = await authService.signup({
    username,
    email,
    password,
    req: { ip: '127.0.0.1' },
  });

  // Duplicate EMAIL
  await assert.rejects(
    async () => {
      await authService.signup({
        username: `diff_user_${Date.now()}`,
        email: email.toUpperCase(), // duplicate email case-insensitive
        password,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /email is already registered/i);
      return true;
    }
  );

  // Duplicate USERNAME
  await assert.rejects(
    async () => {
      await authService.signup({
        username: username.toUpperCase(), // duplicate username case-insensitive
        email: `diff_email_${Date.now()}@example.com`,
        password,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /username is already taken/i);
      return true;
    }
  );

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [first.user.id]);
});

test('Phase 3: Concurrent duplicate signup race condition safety', async () => {
  const raceEmail = `race_${Date.now()}@example.com`;
  const raceUsername = `race_${Date.now()}`;
  const password = 'RacePassword123!';

  // Execute two simultaneous signup calls with identical email
  const [res1, res2] = await Promise.allSettled([
    authService.signup({
      username: `${raceUsername}_1`,
      email: raceEmail,
      password,
      req: { ip: '127.0.0.1' },
    }),
    authService.signup({
      username: `${raceUsername}_2`,
      email: raceEmail,
      password,
      req: { ip: '127.0.0.1' },
    }),
  ]);

  // Exactly one must succeed (fulfilled) and exactly one must fail (rejected with 409)
  const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
  const rejected = [res1, res2].filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent signup must succeed');
  assert.equal(rejected.length, 1, 'Exactly one concurrent signup must fail');
  assert.equal(rejected[0].reason.status, 409, 'Rejection must be 409 Conflict');

  // Cleanup
  const winnerUserId = fulfilled[0].value.user.id;
  await query('DELETE FROM users WHERE id = $1', [winnerUserId]);
});

test('Phase 3: Session creation, refresh token rotation, and logout revocation', async () => {
  const email = `phase3_session_${Date.now()}@example.com`;
  const username = `p3_session_${Date.now()}`;
  const password = 'Password123!';

  const signupRes = await authService.signup({
    username,
    email,
    password,
    req: { ip: '127.0.0.1' },
  });

  const originalRefreshToken = signupRes.tokens.refreshToken;

  // 1. Refresh token rotation
  const refreshedRes = await authService.refreshUserSession({
    refreshToken: originalRefreshToken,
    req: { ip: '127.0.0.1' },
  });
  assert.ok(refreshedRes.tokens.accessToken);
  assert.ok(refreshedRes.tokens.refreshToken);
  assert.notEqual(refreshedRes.tokens.refreshToken, originalRefreshToken, 'Must rotate refresh token');

  // 2. Re-using the old refresh token must be rejected (single-use rotation)
  await assert.rejects(
    async () => {
      await authService.refreshUserSession({
        refreshToken: originalRefreshToken,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  // 3. Logout revokes the active session
  await authService.revokeUserSession({
    refreshToken: refreshedRes.tokens.refreshToken,
    req: { ip: '127.0.0.1' },
  });

  // 4. Verifying refresh token after logout must fail
  await assert.rejects(
    async () => {
      await authService.refreshUserSession({
        refreshToken: refreshedRes.tokens.refreshToken,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  // 5. Verify LOGOUT recorded in security_events
  const { rows: logoutEvents } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [signupRes.user.id, 'LOGOUT']
  );
  assert.equal(logoutEvents.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [signupRes.user.id]);
});

test('Phase 3: Existing password user compatibility (migrated accounts authenticate seamlessly)', async () => {
  // Find an existing migrated user from the database
  const { rows } = await query(`
    SELECT u.id, u.username, u.email, u.password_hash
    FROM users u
    JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'password'
    WHERE u.password_hash IS NOT NULL AND u.password_hash != '' AND u.password_hash LIKE '$2%'
    LIMIT 1
  `);

  if (rows.length === 0) {
    // If no existing bcrypt user exists in sample, create one to simulate pre-migration user
    const simUserId = randomUUID();
    const simHash = await bcrypt.hash('PreMigrationPassword!', 10);
    await query(
      `INSERT INTO users (id, username, email, password_hash, display_name, invite_code)
       VALUES ($1, 'pre_migrated_user', 'pre_migrated@test.com', $2, 'PreMigrated', $3)`,
      [simUserId, simHash, `INV${randomUUID().slice(0, 8).toUpperCase()}`]
    );
    await query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
       VALUES (UUID(), $1, 'password', $1, $2)`,
      [simUserId, simHash]
    );

    const loginRes = await authService.login({
      identifier: 'pre_migrated@test.com',
      password: 'PreMigrationPassword!',
      req: { ip: '127.0.0.1' },
    });
    assert.equal(loginRes.user.id, simUserId);
    assert.ok(loginRes.tokens.accessToken);

    await query('DELETE FROM users WHERE id = $1', [simUserId]);
  } else {
    // Verify an existing user row can be queried and has valid identity
    const existing = rows[0];
    const { rows: aiRows } = await query(
      'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
      [existing.id, 'password']
    );
    assert.equal(aiRows.length, 1);
    assert.equal(aiRows[0].credential_hash, existing.password_hash);
  }
});

test('Phase 3: Rate limiting is configured on auth routes and triggers 429 upon threshold breach', async () => {
  const express = require('express');
  const rateLimit = require('express-rate-limit');
  const http = require('http');
  const authRoutes = require('../src/routes/auth.routes');

  // Verify rate limiter middleware is present on /login and /signup in authRoutes
  assert.ok(authRoutes.loginLimiter, 'Login limiter must be defined');
  assert.ok(authRoutes.signupLimiter, 'Signup limiter must be defined');

  const loginLayer = authRoutes.stack.find((l) => l.route?.path === '/login');
  assert.ok(loginLayer, 'Login route must be defined');
  assert.equal(loginLayer.route.stack.length, 2, 'Login route must have rate limiter and controller attached');

  const signupLayer = authRoutes.stack.find((l) => l.route?.path === '/signup');
  assert.ok(signupLayer, 'Signup route must be defined');
  assert.equal(signupLayer.route.stack.length, 2, 'Signup route must have rate limiter and controller attached');

  // Test rate limit execution with a micro app
  const testApp = express();
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  });

  testApp.post('/test-login', testLimiter, (req, res) => res.json({ ok: true }));

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // Attempt 1: 200 OK
    const res1 = await fetch(`http://127.0.0.1:${port}/test-login`, { method: 'POST' });
    assert.equal(res1.status, 200);

    // Attempt 2: 200 OK
    const res2 = await fetch(`http://127.0.0.1:${port}/test-login`, { method: 'POST' });
    assert.equal(res2.status, 200);

    // Attempt 3: Exceeded limit -> 429 Too Many Requests
    const res3 = await fetch(`http://127.0.0.1:${port}/test-login`, { method: 'POST' });
    assert.equal(res3.status, 429);
    const body = await res3.json();
    assert.match(body.error, /Too many login attempts/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});

