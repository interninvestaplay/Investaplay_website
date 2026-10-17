const { randomUUID } = require('crypto');
const { query } = require('../db/pool');

/**
 * Record a security audit event in the security_events table.
 * Strips all sensitive credentials (passwords, tokens, secrets, reset codes) before persisting.
 *
 * @param {Object} options
 * @param {string|null} [options.userId=null]
 * @param {string} options.eventType
 * @param {string|null} [options.ipAddress=null]
 * @param {string|null} [options.userAgent=null]
 * @param {Object|null} [options.metadata=null]
 */
async function recordSecurityEvent({ userId = null, eventType, ipAddress = null, userAgent = null, metadata = null }) {
  try {
    const id = randomUUID();
    let sanitizedMetadata = null;

    if (metadata && typeof metadata === 'object') {
      const copy = { ...metadata };
      // Explicitly remove any potential credentials or secrets
      delete copy.password;
      delete copy.password_hash;
      delete copy.passwordHash;
      delete copy.credential_hash;
      delete copy.credentialHash;
      delete copy.token;
      delete copy.refreshToken;
      delete copy.accessToken;
      delete copy.secret;
      delete copy.code;
      delete copy.code_hash;
      delete copy.token_hash;
      delete copy.guestCredential;
      delete copy.guest_credential;
      delete copy.guestSecret;
      delete copy.credential;
      delete copy.idToken;
      delete copy.id_token;
      delete copy.access_token;
      delete copy.authCode;
      sanitizedMetadata = JSON.stringify(copy);
    }

    await query(
      `INSERT INTO security_events (id, user_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId || null, eventType, ipAddress || null, userAgent || null, sanitizedMetadata]
    );
  } catch (err) {
    // Non-blocking: warning only, never break the user flow if audit logging fails
    console.warn('[SecurityEvent Warning]:', err.message);
  }
}

module.exports = {
  recordSecurityEvent,
};
