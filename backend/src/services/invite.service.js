const { query } = require('../db/pool');
const { createInviteCode } = require('../utils/inviteCode');

let inviteColumnEnsured = false;

async function ensureInviteColumn() {
  if (inviteColumnEnsured) return;
  try {
    await query('ALTER TABLE users ADD COLUMN invite_code VARCHAR(12) NULL UNIQUE');
    inviteColumnEnsured = true;
  } catch (error) {
    const message = String(error.message || '');
    if (
      error.code === 'ER_DUP_FIELDNAME' ||
      error.errno === 1060 ||
      message.includes('Duplicate column') ||
      message.includes('already exists')
    ) {
      inviteColumnEnsured = true;
      return;
    }
    throw error;
  }
}

async function createUniqueInviteCode() {
  await ensureInviteColumn();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createInviteCode();
    let existing;
    try {
      existing = await query('SELECT id FROM users WHERE invite_code = $1', [code]);
    } catch (error) {
      if (error.code === 'ER_BAD_FIELD_ERROR' || error.errno === 1054) {
        await ensureInviteColumn();
        existing = await query('SELECT id FROM users WHERE invite_code = $1', [code]);
      } else {
        throw error;
      }
    }
    if (!existing.rows[0]) {
      return code;
    }
  }
  return createInviteCode(10);
}

async function ensureInviteCode(userId) {
  await ensureInviteColumn();
  const current = await query('SELECT invite_code FROM users WHERE id = $1', [userId]);
  if (current.rows[0]?.invite_code) {
    return current.rows[0].invite_code;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createInviteCode();
    try {
      await query('UPDATE users SET invite_code = $2 WHERE id = $1 AND invite_code IS NULL', [userId, code]);
      const updated = await query('SELECT invite_code FROM users WHERE id = $1', [userId]);
      if (updated.rows[0]?.invite_code) {
        return updated.rows[0].invite_code;
      }
    } catch (error) {
      if (!String(error.message || '').includes('Duplicate')) {
        throw error;
      }
    }
  }

  const fallback = createInviteCode(10);
  await query('UPDATE users SET invite_code = $2 WHERE id = $1', [userId, fallback]);
  return fallback;
}

module.exports = { createUniqueInviteCode, ensureInviteCode, ensureInviteColumn };
