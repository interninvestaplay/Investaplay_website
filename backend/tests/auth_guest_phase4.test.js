const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../src/db/pool');
const authService = require('../src/services/auth.service');
const authRoutes = require('../src/routes/auth.routes');

test('Phase 4: Guest creation creates guest user, auth_identities record, and returns secure credential', async () => {
  const nickname = `Player_${Date.now()}`;
  const res = await authService.guestLogin({
    nickname,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'TestAgent/Guest' } },
  });

  assert.ok(res.user, 'Result must contain user');
  assert.equal(res.user.isGuest, true, 'User must be marked isGuest');
  assert.ok(res.user.id, 'User must have valid id');
  assert.ok(res.tokens.accessToken, 'Tokens must include accessToken');
  assert.ok(res.tokens.refreshToken, 'Tokens must include refreshToken');
  assert.ok(res.guestCredential, 'Must return guestCredential');
  assert.match(res.guestCredential, /^[0-9a-f-]{36}:[0-9a-f]{64}$/i, 'Credential must be UUID:64hex');

  const [guestId, secret] = res.guestCredential.split(':');

  // Verify DB: users table does NOT store the secret
  const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [res.user.id]);
  assert.equal(userRows.length, 1);
  assert.equal(userRows[0].is_guest, 1);
  assert.equal(userRows[0].password_hash, null);

  // Verify DB: auth_identities stores ONLY bcrypt hash of secret
  const { rows: identityRows } = await query(
    'SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2',
    [res.user.id, 'guest']
  );
  assert.equal(identityRows.length, 1);
  assert.equal(identityRows[0].provider_user_id, guestId);
  assert.notEqual(identityRows[0].credential_hash, secret, 'Must never store raw secret');
  assert.ok(await bcrypt.compare(secret, identityRows[0].credential_hash), 'Hash must match bcrypt of secret');

  // Verify security_events logged GUEST_CREATED without secret
  const { rows: eventRows } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [res.user.id, 'GUEST_CREATED']
  );
  assert.doesNotMatch(JSON.stringify(eventRows[0].metadata || {}), new RegExp(secret), 'Metadata must never leak secret');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [res.user.id]);
});

test('Phase 4: Same guest restoration after logout restores the identical user_id', async () => {
  const res1 = await authService.guestLogin({
    nickname: `RestoreMe_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });
  const originalUserId = res1.user.id;
  const credential = res1.guestCredential;

  // Logout/revoke session
  await authService.revokeUserSession({
    refreshToken: res1.tokens.refreshToken,
    req: { ip: '127.0.0.1' },
  });

  // Restore guest
  const restoreRes = await authService.restoreGuest({
    guestCredential: credential,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'RestoredAgent' } },
  });

  assert.equal(restoreRes.user.id, originalUserId, 'Restored user.id must be identical to original');
  assert.equal(restoreRes.user.isGuest, true);
  assert.ok(restoreRes.tokens.accessToken);
  assert.ok(restoreRes.tokens.refreshToken);

  // Verify security_events logged GUEST_RESTORE_SUCCESS
  const { rows: eventRows } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [originalUserId, 'GUEST_RESTORE_SUCCESS']
  );
  assert.equal(eventRows.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [originalUserId]);
});

test('Phase 4: Invalid guest credential is rejected with generic authentication error', async () => {
  // Malformed credential
  await assert.rejects(
    async () => {
      await authService.restoreGuest({
        guestCredential: 'invalid_credential_without_colon',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid guest credentials');
      return true;
    }
  );

  // Non-existent guestId
  await assert.rejects(
    async () => {
      await authService.restoreGuest({
        guestCredential: `${randomUUID()}:${'0'.repeat(64)}`,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid guest credentials');
      return true;
    }
  );

  // Valid guestId with wrong secret
  const res = await authService.guestLogin({
    nickname: `FakeSecret_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });
  const [guestId] = res.guestCredential.split(':');

  await assert.rejects(
    async () => {
      await authService.restoreGuest({
        guestCredential: `${guestId}:${'f'.repeat(64)}`,
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.message, 'Invalid guest credentials');
      return true;
    }
  );

  // Verify GUEST_RESTORE_FAILED event logged
  const { rows: failedEvents } = await query(
    "SELECT * FROM security_events WHERE event_type = 'GUEST_RESTORE_FAILED' ORDER BY created_at DESC LIMIT 3"
  );
  assert.ok(failedEvents.length >= 3);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [res.user.id]);
});

test('Phase 4: Nickname alone cannot restore another account', async () => {
  const commonNickname = `TopPlayer_${Date.now()}`;

  // Guest 1 creates account
  const guest1 = await authService.guestLogin({
    nickname: commonNickname,
    req: { ip: '127.0.0.1' },
  });

  // Guest 2 requests guest login with the exact same nickname, without Guest 1's secret
  const guest2 = await authService.guestLogin({
    nickname: commonNickname,
    req: { ip: '127.0.0.1' },
  });

  // Must get a new unique account, never Guest 1's account
  assert.notEqual(guest1.user.id, guest2.user.id, 'Nickname must NEVER restore or hijack another account');
  assert.notEqual(guest1.guestCredential, guest2.guestCredential);

  // Cleanup
  await query('DELETE FROM users WHERE id IN ($1, $2)', [guest1.user.id, guest2.user.id]);
});

test('Phase 4: Concurrent guest creation generates unique identities without collisions', async () => {
  const baseName = `Speedy_${Date.now()}`;
  const promises = [];
  for (let i = 0; i < 8; i++) {
    promises.push(
      authService.guestLogin({
        nickname: `${baseName}_${i}`,
        req: { ip: '127.0.0.1' },
      })
    );
  }

  const results = await Promise.all(promises);
  const userIds = new Set(results.map((r) => r.user.id));
  const credentials = new Set(results.map((r) => r.guestCredential));

  assert.equal(userIds.size, 8, 'All 8 user IDs must be unique');
  assert.equal(credentials.size, 8, 'All 8 credentials must be unique');

  // Cleanup
  for (const r of results) {
    await query('DELETE FROM users WHERE id = $1', [r.user.id]);
  }
});

test('Phase 4: Guest -> Password linking preserves users.id and allows email/password login', async () => {
  const guest = await authService.guestLogin({
    nickname: `ConvertMe_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });
  const originalUserId = guest.user.id;

  // Add some coins/xp to simulate existing gameplay data
  await query('UPDATE users SET coins = 2500, xp = 450 WHERE id = $1', [originalUserId]);

  const email = `converted_${Date.now()}@example.com`;
  const password = 'NewStrongPassword123!';

  // Link account to password
  const linked = await authService.linkAccount({
    userId: originalUserId,
    provider: 'password',
    email,
    password,
    username: `conv_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });

  assert.equal(linked.user.id, originalUserId, 'users.id must NOT change after linking');
  assert.equal(linked.user.email, email.toLowerCase());
  assert.equal(linked.user.isGuest, false, 'User must no longer be guest');
  assert.equal(linked.user.coins, 2500, 'Coins must remain intact');
  assert.equal(linked.user.xp, 450, 'XP must remain intact');

  // Verify user can now log in via standard email/password login
  const loginRes = await authService.login({
    identifier: email,
    password,
    req: { ip: '127.0.0.1' },
  });
  assert.equal(loginRes.user.id, originalUserId, 'Login must resolve to the original userId');

  // Verify security_events logged ACCOUNT_LINK_SUCCESS
  const { rows: events } = await query(
    "SELECT * FROM security_events WHERE user_id = $1 AND event_type = 'ACCOUNT_LINK_SUCCESS'",
    [originalUserId]
  );
  assert.equal(events.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [originalUserId]);
});

test('Phase 4: Duplicate identity linking is safely rejected without merging accounts', async () => {
  // Existing registered user A
  const existingUser = await authService.signup({
    username: `exist_${Date.now()}`,
    email: `taken_${Date.now()}@example.com`,
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });

  // Guest user B
  const guest = await authService.guestLogin({
    nickname: `GuestB_${Date.now()}`,
    req: { ip: '127.0.0.1' },
  });

  // Guest B attempts to link using existingUser's email
  await assert.rejects(
    async () => {
      await authService.linkAccount({
        userId: guest.user.id,
        provider: 'password',
        email: existingUser.user.email,
        password: 'Password456!',
        req: { ip: '127.0.0.1' },
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /already registered/i);
      return true;
    }
  );

  // Verify Guest B's account is still guest and intact
  const { rows: guestRows } = await query('SELECT * FROM users WHERE id = $1', [guest.user.id]);
  assert.equal(guestRows[0].is_guest, 1);
  assert.equal(guestRows[0].email, null);

  // Cleanup
  await query('DELETE FROM users WHERE id IN ($1, $2)', [existingUser.user.id, guest.user.id]);
});

test('Phase 4: Rate limiting is configured on guest restore route', async () => {
  assert.ok(authRoutes.guestRestoreLimiter, 'guestRestoreLimiter must be defined');

  const restoreLayer = authRoutes.stack.find((l) => l.route?.path === '/guest/restore');
  assert.ok(restoreLayer, 'Guest restore route must be defined');
  assert.equal(restoreLayer.route.stack.length, 2, 'Route must have rate limiter and controller');

  // Test rate limiting threshold
  const testApp = express();
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many guest restoration attempts. Please try again later.' },
  });
  testApp.post('/test-restore', testLimiter, (req, res) => res.json({ ok: true }));

  const server = http.createServer(testApp);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/test-restore`, { method: 'POST' });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`http://127.0.0.1:${port}/test-restore`, { method: 'POST' });
    assert.equal(res2.status, 200);
    const res3 = await fetch(`http://127.0.0.1:${port}/test-restore`, { method: 'POST' });
    assert.equal(res3.status, 429);
    const body = await res3.json();
    assert.match(body.error, /Too many guest restoration attempts/i);
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
