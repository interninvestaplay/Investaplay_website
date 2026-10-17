const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const http = require('http');
const express = require('express');
const { query } = require('../src/db/pool');
const { autoMigrateDatabase } = require('../src/db/autoMigrate');
const authService = require('../src/services/auth.service');
const authRoutes = require('../src/routes/auth.routes');
const { signAccessToken } = require('../src/utils/tokens');

let server;
let baseUrl;

test.before(async () => {
  await autoMigrateDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    res.status(status).json({
      error: error.message || 'Internal server error',
      code: error.code || undefined,
    });
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      server.unref();
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch (_) {}
});

test('Phase 6: Multiple sessions for one user are tracked with distinct session IDs', async () => {
  const email = `phase6_multi_${Date.now()}@example.com`;
  const username = `p6_multi_${Date.now()}`;
  const password = 'Password123!';

  // 1. Create user via signup (Session 1)
  const signupRes = await authService.signup({
    username,
    email,
    password,
    displayName: 'Multi Device User',
    req: { ip: '192.168.1.10', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile' } },
  });
  const userId = signupRes.user.id;
  const session1 = signupRes.tokens;

  // 2. Login from Chrome Desktop (Session 2)
  const loginRes1 = await authService.login({
    identifier: email,
    password,
    req: { ip: '192.168.1.20', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' } },
  });
  const session2 = loginRes1.tokens;

  // 3. Login from Android Tablet (Session 3)
  const loginRes2 = await authService.login({
    identifier: username,
    password,
    req: { ip: '192.168.1.30', headers: { 'user-agent': 'QuizGame/1.0 (Android 14; Tablet)' } },
  });
  const session3 = loginRes2.tokens;

  assert.notEqual(session1.sessionId, session2.sessionId);
  assert.notEqual(session2.sessionId, session3.sessionId);

  // Verify all 3 sessions exist in DB
  const { rows: dbSessions } = await query(
    'SELECT id, user_agent, ip_address, revoked_at FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  assert.equal(dbSessions.length, 3, 'All 3 sessions must be active in DB');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: List sessions endpoint returns safe metadata and identifies current session', async () => {
  const email = `phase6_list_${Date.now()}@example.com`;
  const username = `p6_list_${Date.now()}`;
  const password = 'Password123!';

  const signupRes = await authService.signup({
    username,
    email,
    password,
    req: { ip: '10.0.0.1', headers: { 'user-agent': 'DeviceA_Agent' } },
  });
  const userId = signupRes.user.id;
  const tokenA = signupRes.tokens;

  const loginRes = await authService.login({
    identifier: email,
    password,
    req: { ip: '10.0.0.2', headers: { 'user-agent': 'DeviceB_Agent' } },
  });
  const tokenB = loginRes.tokens;

  // Query GET /api/auth/sessions using Token B
  const res = await fetch(`${baseUrl}/api/auth/sessions`, {
    headers: { Authorization: `Bearer ${tokenB.accessToken}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.sessions), 'Response must contain sessions array');
  assert.equal(data.sessions.length, 2);

  // Verify current session identification
  const currentSession = data.sessions.find((s) => s.isCurrent === true);
  const otherSession = data.sessions.find((s) => s.isCurrent === false);

  assert.ok(currentSession, 'Must identify current session');
  assert.equal(currentSession.id, tokenB.sessionId);
  assert.equal(currentSession.userAgent, 'DeviceB_Agent');
  assert.equal(currentSession.ipAddress, '10.0.0.2');
  assert.ok(currentSession.createdAt);
  assert.ok(currentSession.expiresAt);
  assert.ok(currentSession.lastUsedAt);

  assert.ok(otherSession, 'Must contain other active session');
  assert.equal(otherSession.id, tokenA.sessionId);
  assert.equal(otherSession.userAgent, 'DeviceA_Agent');

  // Verify security: NEVER leaks token_hash or raw token
  for (const s of data.sessions) {
    assert.equal(s.token_hash, undefined);
    assert.equal(s.tokenHash, undefined);
    assert.equal(s.refreshToken, undefined);
    assert.equal(s.token, undefined);
  }

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: Revoke single session revokes target device while preserving others', async () => {
  const email = `phase6_revoke1_${Date.now()}@example.com`;
  const username = `p6_revoke1_${Date.now()}`;
  const password = 'Password123!';

  const s1 = await authService.signup({
    username,
    email,
    password,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'Session1_Device' } },
  });
  const userId = s1.user.id;

  const s2 = await authService.login({
    identifier: email,
    password,
    req: { ip: '127.0.0.1', headers: { 'user-agent': 'Session2_Device' } },
  });

  // Call DELETE /api/auth/sessions/:sessionId to revoke session 1 using token from session 2
  const delRes = await fetch(`${baseUrl}/api/auth/sessions/${s1.tokens.sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${s2.tokens.accessToken}` },
  });

  assert.equal(delRes.status, 200);
  const delData = await delRes.json();
  assert.equal(delData.success, true);
  assert.equal(delData.sessionId, s1.tokens.sessionId);

  // Verify session 1 is revoked in DB
  const { rows: rows1 } = await query('SELECT revoked_at FROM refresh_tokens WHERE id = $1', [s1.tokens.sessionId]);
  assert.ok(rows1[0].revoked_at !== null, 'Session 1 must have revoked_at timestamp');

  // Verify session 2 remains unrevoked
  const { rows: rows2 } = await query('SELECT revoked_at FROM refresh_tokens WHERE id = $1', [s2.tokens.sessionId]);
  assert.equal(rows2[0].revoked_at, null, 'Session 2 must remain active');

  // Verify listing sessions only returns session 2
  const listRes = await fetch(`${baseUrl}/api/auth/sessions`, {
    headers: { Authorization: `Bearer ${s2.tokens.accessToken}` },
  });
  const listData = await listRes.json();
  assert.equal(listData.sessions.length, 1);
  assert.equal(listData.sessions[0].id, s2.tokens.sessionId);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: Revoked refresh token cannot refresh and triggers SESSION_REUSE_DETECTED', async () => {
  const email = `phase6_reuse_${Date.now()}@example.com`;
  const username = `p6_reuse_${Date.now()}`;
  const password = 'Password123!';

  const s = await authService.signup({
    username,
    email,
    password,
    req: { ip: '127.0.0.1' },
  });
  const userId = s.user.id;
  const refreshToken = s.tokens.refreshToken;
  const sessionId = s.tokens.sessionId;

  // Revoke the session
  await authService.revokeSessionById({
    userId,
    sessionId,
    req: { ip: '127.0.0.1' },
  });

  // Attempt to refresh using the revoked token via POST /api/auth/refresh
  const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  assert.equal(refreshRes.status, 401, 'Revoked token refresh must be rejected with 401');
  const errData = await refreshRes.json();
  assert.match(errData.error, /revoked|Invalid/i);

  // Verify SESSION_REUSE_DETECTED was recorded in security_events
  const { rows: events } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [userId, 'SESSION_REUSE_DETECTED']
  );
  assert.ok(events.length >= 1, 'Must record SESSION_REUSE_DETECTED audit event');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: Revoke-all invalidates all active refresh tokens and access tokens via token_version increment', async () => {
  const email = `phase6_revokeall_${Date.now()}@example.com`;
  const username = `p6_revokeall_${Date.now()}`;
  const password = 'Password123!';

  // Create 3 sessions
  const s1 = await authService.signup({ username, email, password, req: { ip: '127.0.0.1' } });
  const userId = s1.user.id;
  const s2 = await authService.login({ identifier: email, password, req: { ip: '127.0.0.1' } });
  const s3 = await authService.login({ identifier: username, password, req: { ip: '127.0.0.1' } });

  // Call POST /api/auth/sessions/revoke-all using session 3's access token
  const revokeAllRes = await fetch(`${baseUrl}/api/auth/sessions/revoke-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s3.tokens.accessToken}` },
  });

  assert.equal(revokeAllRes.status, 200);
  const revokeAllData = await revokeAllRes.json();
  assert.equal(revokeAllData.success, true);

  // 1. All refresh tokens in DB must be revoked
  const { rows: activeTokens } = await query(
    'SELECT * FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  assert.equal(activeTokens.length, 0, 'Zero active refresh tokens should remain');

  // 2. User token_version must have been incremented
  const { rows: userRows } = await query('SELECT token_version FROM users WHERE id = $1', [userId]);
  assert.ok(userRows[0].token_version > 0, 'token_version must be incremented');

  // 3. Existing access token from s1 must be immediately rejected on protected routes
  const protectedRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${s1.tokens.accessToken}` },
  });
  assert.equal(protectedRes.status, 401, 'Old access token must be rejected after revoke-all');

  // 4. Existing refresh token from s2 must be rejected
  const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: s2.tokens.refreshToken }),
  });
  assert.equal(refreshRes.status, 401, 'Old refresh token must be rejected after revoke-all');

  // 5. Verify ALL_SESSIONS_REVOKED in security_events
  const { rows: events } = await query(
    'SELECT * FROM security_events WHERE user_id = $1 AND event_type = $2',
    [userId, 'ALL_SESSIONS_REVOKED']
  );
  assert.equal(events.length, 1);

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: Refresh token rotation updates last_used_at and preserves single-use invariant', async () => {
  const email = `phase6_rotate_${Date.now()}@example.com`;
  const username = `p6_rotate_${Date.now()}`;
  const password = 'Password123!';

  const s = await authService.signup({ username, email, password, req: { ip: '127.0.0.1' } });
  const userId = s.user.id;
  const originalRefreshToken = s.tokens.refreshToken;
  const originalSessionId = s.tokens.sessionId;

  // Rotate token via /api/auth/refresh
  const res1 = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: originalRefreshToken }),
  });

  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.tokens.accessToken);
  assert.ok(data1.tokens.refreshToken);
  assert.notEqual(data1.tokens.refreshToken, originalRefreshToken, 'Must issue a new rotated refresh token');

  // Check DB: original session must be revoked with last_used_at populated
  const { rows: oldSessionRows } = await query('SELECT * FROM refresh_tokens WHERE id = $1', [originalSessionId]);
  assert.ok(oldSessionRows[0].revoked_at !== null, 'Original session must be revoked');
  assert.ok(oldSessionRows[0].last_used_at !== null, 'Original session must record last_used_at');

  // Reusing originalRefreshToken must be rejected
  const res2 = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: originalRefreshToken }),
  });
  assert.equal(res2.status, 401, 'Reused rotated token must be rejected');

  // The newly rotated refresh token CAN be refreshed again successfully
  const res3 = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: data1.tokens.refreshToken }),
  });
  assert.equal(res3.status, 200, 'Newly rotated token must refresh successfully');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});

test('Phase 6: Unauthorized access to sessions endpoint and cross-user revocation are blocked', async () => {
  // 1. Missing Authorization header on GET /api/auth/sessions
  const unauthList = await fetch(`${baseUrl}/api/auth/sessions`);
  assert.equal(unauthList.status, 401);

  // 2. Missing Authorization header on POST /api/auth/sessions/revoke-all
  const unauthRevokeAll = await fetch(`${baseUrl}/api/auth/sessions/revoke-all`, { method: 'POST' });
  assert.equal(unauthRevokeAll.status, 401);

  // 3. User A trying to revoke User B's session
  const userA = await authService.signup({
    username: `userA_${Date.now()}`,
    email: `userA_${Date.now()}@example.com`,
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });
  const userB = await authService.signup({
    username: `userB_${Date.now()}`,
    email: `userB_${Date.now()}@example.com`,
    password: 'Password123!',
    req: { ip: '127.0.0.1' },
  });

  const crossRevokeRes = await fetch(`${baseUrl}/api/auth/sessions/${userB.tokens.sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
  });

  assert.equal(crossRevokeRes.status, 403, 'Cross-user session revocation must be rejected with 403 Forbidden');

  // 4. Revoking a non-existent session
  const notFoundRes = await fetch(`${baseUrl}/api/auth/sessions/${randomUUID()}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${userA.tokens.accessToken}` },
  });
  assert.equal(notFoundRes.status, 404, 'Revoking non-existent session must return 404');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userA.user.id]);
  await query('DELETE FROM users WHERE id = $1', [userB.user.id]);
});

test('Phase 6: Expired tokens are rejected by refresh endpoint and excluded from session listing', async () => {
  const email = `phase6_expired_${Date.now()}@example.com`;
  const username = `p6_expired_${Date.now()}`;
  const password = 'Password123!';

  const s = await authService.signup({ username, email, password, req: { ip: '127.0.0.1' } });
  const userId = s.user.id;
  const expiredSessionId = s.tokens.sessionId;
  const expiredRefreshToken = s.tokens.refreshToken;

  // Force session expiry in database to the past
  await query(
    'UPDATE refresh_tokens SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = $1',
    [expiredSessionId]
  );

  // Refresh must fail with 401
  const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: expiredRefreshToken }),
  });
  assert.equal(refreshRes.status, 401, 'Expired refresh token must be rejected');

  // Create a new fresh session for this user to call /sessions
  const loginRes = await authService.login({ identifier: email, password, req: { ip: '127.0.0.1' } });

  const listRes = await fetch(`${baseUrl}/api/auth/sessions`, {
    headers: { Authorization: `Bearer ${loginRes.tokens.accessToken}` },
  });
  const listData = await listRes.json();

  // Expired session must NOT be listed
  const expiredFound = listData.sessions.find((sess) => sess.id === expiredSessionId);
  assert.equal(expiredFound, undefined, 'Expired session must not appear in active sessions list');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [userId]);
});
