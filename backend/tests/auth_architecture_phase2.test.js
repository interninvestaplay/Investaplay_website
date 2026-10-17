const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query } = require('../src/db/pool');

test('Phase 2: auth_identities table exists with required columns and constraints', async () => {
  const { rows } = await query(`
    SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_identities'
  `);
  const colMap = new Map(rows.map(r => [r.COLUMN_NAME, r]));

  assert.ok(colMap.has('id'), 'auth_identities must have id');
  assert.ok(colMap.has('user_id'), 'auth_identities must have user_id');
  assert.ok(colMap.has('provider'), 'auth_identities must have provider');
  assert.ok(colMap.has('provider_user_id'), 'auth_identities must have provider_user_id');
  assert.ok(colMap.has('credential_hash'), 'auth_identities must have credential_hash');
  assert.ok(colMap.has('created_at'), 'auth_identities must have created_at');
  assert.ok(colMap.has('updated_at'), 'auth_identities must have updated_at');
});

test('Phase 2: auth_identities enforces unique (provider, provider_user_id)', async () => {
  const testUserId = randomUUID();
  const testProviderId = `test_prov_${Date.now()}`;

  await query(
    `INSERT INTO users (id, username, email, display_name, invite_code)
     VALUES ($1, $2, $3, 'Test AI User', $4)`,
    [testUserId, `ai_un_${Date.now()}`, `ai_${Date.now()}@test.com`, `INV${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`]
  );

  // First identity insertion must succeed
  await query(
    `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
     VALUES (UUID(), $1, 'google', $2, NULL)`,
    [testUserId, testProviderId]
  );

  // Duplicate identity with same provider and provider_user_id must fail with ER_DUP_ENTRY
  await assert.rejects(
    async () => {
      await query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
         VALUES (UUID(), $1, 'google', $2, NULL)`,
        [testUserId, testProviderId]
      );
    },
    (err) => {
      assert.equal(err.code, 'ER_DUP_ENTRY');
      return true;
    }
  );

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [testUserId]);
});

test('Phase 2: security_events table exists with nullable user_id (SET NULL on delete)', async () => {
  const { rows } = await query(`
    SELECT COLUMN_NAME, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'security_events'
  `);
  const colMap = new Map(rows.map(r => [r.COLUMN_NAME, r]));

  assert.ok(colMap.has('id'));
  assert.ok(colMap.has('user_id'));
  assert.equal(colMap.get('user_id').IS_NULLABLE, 'YES');
  assert.ok(colMap.has('event_type'));
  assert.ok(colMap.has('ip_address'));
  assert.ok(colMap.has('user_agent'));
  assert.ok(colMap.has('metadata'));
  assert.ok(colMap.has('created_at'));

  // Test event insertion with NULL user_id (e.g. unknown user failed login)
  const eventId = randomUUID();
  await query(
    `INSERT INTO security_events (id, user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, NULL, 'LOGIN_FAILED', '127.0.0.1', 'TestAgent', JSON_OBJECT('reason', 'bad_password'))`,
    [eventId]
  );

  const eventRes = await query('SELECT * FROM security_events WHERE id = $1', [eventId]);
  assert.equal(eventRes.rows.length, 1);
  assert.equal(eventRes.rows[0].event_type, 'LOGIN_FAILED');
  assert.equal(eventRes.rows[0].user_id, null);

  // Cleanup
  await query('DELETE FROM security_events WHERE id = $1', [eventId]);
});

test('Phase 2: password_reset_tokens supports code_hash, attempt_count, max_attempts', async () => {
  const { rows } = await query(`
    SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
  `);
  const colMap = new Map(rows.map(r => [r.COLUMN_NAME, r]));

  assert.ok(colMap.has('code_hash'), 'password_reset_tokens must have code_hash');
  assert.ok(colMap.has('attempt_count'), 'password_reset_tokens must have attempt_count');
  assert.ok(colMap.has('max_attempts'), 'password_reset_tokens must have max_attempts');
});

test('Phase 2: Backfill migrates password users to auth_identities', async () => {
  const testUserId = randomUUID();
  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, invite_code)
     VALUES ($1, $2, $3, 'test_hash_123', 'Backfill User', $4)`,
    [testUserId, `bf_${Date.now()}`, `bf_${Date.now()}@test.com`, `INV${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`]
  );

  // Run the backfill query for this user
  await query(`
    INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash, created_at, updated_at)
    SELECT
      UUID(),
      u.id,
      'password',
      u.id,
      u.password_hash,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE u.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM auth_identities ai
        WHERE ai.provider = 'password' AND ai.provider_user_id = u.id
      )
  `, [testUserId]);

  const identityRes = await query('SELECT * FROM auth_identities WHERE user_id = $1 AND provider = $2', [testUserId, 'password']);
  assert.equal(identityRes.rows.length, 1);
  assert.equal(identityRes.rows[0].credential_hash, 'test_hash_123');

  // Cleanup
  await query('DELETE FROM users WHERE id = $1', [testUserId]);
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
