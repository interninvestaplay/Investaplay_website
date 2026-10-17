const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const env = require('../config/env');
const { query, connect } = require('../db/pool');
const {
  signAccessToken,
  signRefreshToken,
  hashToken,
  verifyRefreshToken,
} = require('../utils/tokens');
const { createUniqueInviteCode } = require('./invite.service');
const { recordSecurityEvent } = require('./security.service');
const oauthService = require('./oauth.service');

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    inviteCode: user.invite_code,
    avatarUrl: user.avatar_url,
    role: user.role,
    isGuest: Boolean(user.is_guest),
    xp: user.xp,
    level: user.level,
    coins: user.coins,
  };
}

const isDuplicateKey = (err) => err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;

async function inTransaction(work) {
  const client = await connect();
  try {
    await client.beginTransaction();
    const result = await work(client);
    await client.commit();
    return result;
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function createSession(user, req) {
  const tokenId = randomUUID();
  const accessToken = signAccessToken(user, tokenId);
  const refreshToken = signRefreshToken(user, tokenId);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip_address, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [tokenId, user.id, hashToken(refreshToken), req?.headers?.['user-agent'] || null, req?.ip || null, expiresAt]
  );

  await recordSecurityEvent({
    userId: user.id,
    eventType: 'SESSION_CREATED',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { sessionId: tokenId },
  });

  return { accessToken, refreshToken, expiresAt, sessionId: tokenId };
}

async function signup({ username, email, password, displayName, req }) {
  if (!username || !email || !password || password.length < 6) {
    const error = new Error('username, email, and password with 6+ characters are required');
    error.status = 400;
    throw error;
  }

  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).toLowerCase().trim();

  // Basic email syntax validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    const error = new Error('Please enter a valid email address');
    error.status = 400;
    throw error;
  }

  // Pre-emptive check for user-friendly error message
  const existing = await query(
    `SELECT id, username, email FROM users 
     WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2))
       AND deleted_at IS NULL
     LIMIT 1`,
    [cleanUsername, cleanEmail]
  );

  if (existing.rows.length > 0) {
    const match = existing.rows[0];
    const isEmailMatch = match.email && match.email.toLowerCase() === cleanEmail.toLowerCase();
    const isUsernameMatch = match.username && match.username.toLowerCase() === cleanUsername.toLowerCase();

    await recordSecurityEvent({
      userId: match.id,
      eventType: 'SIGNUP_FAILED_DUPLICATE',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { reason: isEmailMatch ? 'email_exists' : 'username_exists' },
    });

    const error = new Error(
      isUsernameMatch
        ? 'Username is already taken. Please choose a different username.'
        : isEmailMatch
          ? 'Email is already registered. Please login instead.'
          : 'An account with this username or email already exists.'
    );
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const userId = randomUUID();
  const inviteCode = await createUniqueInviteCode();

  try {
    // A user is only committed when its password identity is committed too.
    await inTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash, display_name, invite_code, coins)
         VALUES ($1, $2, $3, $4, $5, $6, 1000)`,
        [userId, cleanUsername, cleanEmail, passwordHash, displayName || cleanUsername, inviteCode]
      );
      await client.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
         VALUES ($1, $2, 'password', $3, $4)`,
        [randomUUID(), userId, userId, passwordHash]
      );
    });
  } catch (err) {
    // Handle concurrent duplicate-entry race conditions at the database level
    if (isDuplicateKey(err)) {
      await recordSecurityEvent({
        userId: null,
        eventType: 'SIGNUP_FAILED_RACE_DUPLICATE',
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
      });

      const msg = String(err.message || '').toLowerCase();
      let userMsg = 'An account with this username or email already exists.';
      if (msg.includes('email')) {
        userMsg = 'Email is already registered. Please login instead.';
      } else if (msg.includes('username')) {
        userMsg = 'Username is already taken. Please choose a different username.';
      }
      const error = new Error(userMsg);
      error.status = 409;
      throw error;
    }
    throw err;
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];

  await recordSecurityEvent({
    userId: user.id,
    eventType: 'SIGNUP_SUCCESS',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { username: cleanUsername, email: cleanEmail },
  });

  const tokens = await createSession(user, req);
  return { user: publicUser(user), tokens };
}

async function login({ identifier, password, req }) {
  if (!identifier || !password) {
    const error = new Error('Username/email and password are required');
    error.status = 400;
    throw error;
  }

  const cleanIdentifier = String(identifier).trim();

  // Query user and join auth_identities for provider = 'password'
  const { rows } = await query(
    `SELECT u.*, ai.id AS identity_id, ai.credential_hash AS identity_password_hash
     FROM users u
     LEFT JOIN auth_identities ai 
       ON ai.user_id = u.id AND ai.provider = 'password'
     WHERE (LOWER(u.email) = LOWER($1) OR LOWER(u.username) = LOWER($1))
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [cleanIdentifier]
  );

  const user = rows[0];
  const targetHash = user?.identity_password_hash || user?.password_hash;

  if (!user || !targetHash || !(await bcrypt.compare(String(password), targetHash))) {
    await recordSecurityEvent({
      userId: user?.id || null,
      eventType: 'LOGIN_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { identifier: cleanIdentifier },
    });

    const error = new Error('Invalid username/email or password');
    error.status = 401;
    throw error;
  }

  // Self-healing: if an older user had no auth_identities row, backfill it seamlessly.
  // Use ON DUPLICATE KEY UPDATE instead of INSERT IGNORE to avoid gap-lock deadlocks
  // that can occur when two concurrent logins for the same legacy user both enter this path.
  if (!user.identity_id) {
    try {
      await query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
         VALUES (UUID(), $1, 'password', $1, $2)
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [user.id, targetHash]
      );
    } catch (_) {
      // Best-effort backfill — login already succeeded regardless.
    }
  }

  await recordSecurityEvent({
    userId: user.id,
    eventType: 'LOGIN_SUCCESS',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
  });

  const tokens = await createSession(user, req);
  return { user: publicUser(user), tokens };
}

async function guestLogin({ nickname, guestCredential, req }) {
  // If guestCredential provided, attempt restore first
  if (guestCredential) {
    try {
      return await restoreGuest({ guestCredential, req });
    } catch (err) {
      if (err.status === 401) throw err;
    }
  }

  const cleanNickname = (nickname || '').trim();
  if (!cleanNickname) {
    const error = new Error('Please enter a nickname');
    error.status = 400;
    throw error;
  }

  const cleanNick = cleanNickname.replace(/[^a-zA-Z0-9_]/g, '');
  const username = `Guest_${cleanNick || 'Player'}_${randomUUID().slice(0, 6)}`;
  const userId = randomUUID();
  const inviteCode = await createUniqueInviteCode();

  // 1. Generate cryptographically secure random guest credential
  const guestId = randomUUID();
  const guestSecret = crypto.randomBytes(32).toString('hex');
  const fullGuestCredential = `${guestId}:${guestSecret}`;
  const credentialHash = await bcrypt.hash(guestSecret, env.bcryptRounds);

  // User and credential identity must either both exist or neither exists.
  try {
    await inTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, username, display_name, invite_code, is_guest, coins)
         VALUES ($1, $2, $3, $4, TRUE, 1000)`,
        [userId, username, cleanNickname, inviteCode]
      );
      await client.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
         VALUES ($1, $2, 'guest', $3, $4)`,
        [randomUUID(), userId, guestId, credentialHash]
      );
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const error = new Error('Unable to create guest account. Please try again.');
      error.status = 409;
      throw error;
    }
    throw err;
  }

  // 4. Record GUEST_CREATED in security_events (never log the secret or full credential)
  await recordSecurityEvent({
    userId,
    eventType: 'GUEST_CREATED',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { guestId },
  });

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  const tokens = await createSession(user, req);

  return {
    user: publicUser(user),
    tokens,
    guestCredential: fullGuestCredential,
  };
}

async function restoreGuest({ guestCredential, req }) {
  if (!guestCredential) {
    const error = new Error('Invalid guest credentials');
    error.status = 401;
    throw error;
  }

  const parts = String(guestCredential).trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    await recordSecurityEvent({
      eventType: 'GUEST_RESTORE_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { reason: 'malformed_credential' },
    });
    const error = new Error('Invalid guest credentials');
    error.status = 401;
    throw error;
  }

  const [guestId, guestSecret] = parts;

  // Query identity for provider = 'guest'
  const { rows: identities } = await query(
    `SELECT ai.*, u.id AS current_user_id, u.deleted_at
     FROM auth_identities ai
     JOIN users u ON u.id = ai.user_id
     WHERE ai.provider = 'guest'
       AND ai.provider_user_id = $1
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [guestId]
  );

  if (identities.length === 0) {
    await recordSecurityEvent({
      eventType: 'GUEST_RESTORE_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { reason: 'guest_not_found', guestId },
    });
    const error = new Error('Invalid guest credentials');
    error.status = 401;
    throw error;
  }

  const identity = identities[0];
  const isMatch = await bcrypt.compare(guestSecret, identity.credential_hash);
  if (!isMatch) {
    await recordSecurityEvent({
      userId: identity.user_id,
      eventType: 'GUEST_RESTORE_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { reason: 'credential_mismatch', guestId },
    });
    const error = new Error('Invalid guest credentials');
    error.status = 401;
    throw error;
  }

  // Fetch full user record
  const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [identity.user_id]);
  const user = users[0];

  await recordSecurityEvent({
    userId: user.id,
    eventType: 'GUEST_RESTORE_SUCCESS',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { guestId },
  });

  const tokens = await createSession(user, req);
  return {
    user: publicUser(user),
    tokens,
    guestCredential,
  };
}

async function linkAccount({ userId, provider, email, password, username, token, idToken, accessToken, providerUserId, req }) {
  if (!userId) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  if (!provider || !['password', 'google', 'facebook'].includes(provider)) {
    const error = new Error("Valid provider ('password', 'google', 'facebook') is required");
    error.status = 400;
    throw error;
  }

  const { rows: users } = await query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (users.length === 0) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  const user = users[0];

  if (provider === 'password') {
    if (!email || !password || password.length < 6) {
      const error = new Error('email and password with 6+ characters are required');
      error.status = 400;
      throw error;
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      const error = new Error('Please enter a valid email address');
      error.status = 400;
      throw error;
    }

    // Check if email is already registered to another user
    const { rows: existingEmail } = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND deleted_at IS NULL LIMIT 1',
      [cleanEmail, userId]
    );
    if (existingEmail.length > 0) {
      await recordSecurityEvent({
        userId,
        eventType: 'ACCOUNT_LINK_FAILED',
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
        metadata: { provider: 'password', reason: 'email_already_registered' },
      });
      const error = new Error('Email is already registered to another account');
      error.status = 409;
      throw error;
    }

    // Check if user already has a password identity
    const { rows: existingIdentity } = await query(
      'SELECT id FROM auth_identities WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [userId, 'password']
    );
    if (existingIdentity.length > 0) {
      const error = new Error('Account is already linked with a password identity');
      error.status = 400;
      throw error;
    }

    let finalUsername = user.username;
    if (username && String(username).trim()) {
      const cleanUsername = String(username).trim();
      const { rows: existingUsername } = await query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2 AND deleted_at IS NULL LIMIT 1',
        [cleanUsername, userId]
      );
      if (existingUsername.length > 0) {
        const error = new Error('Username is already taken');
        error.status = 409;
        throw error;
      }
      finalUsername = cleanUsername;
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

    try {
      const identityId = randomUUID();
      await query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
         VALUES ($1, $2, 'password', $3, $4)`,
        [identityId, userId, userId, passwordHash]
      );

      await query(
        `UPDATE users
         SET email = $1, password_hash = $2, username = $3, is_guest = FALSE, updated_at = NOW()
         WHERE id = $4`,
        [cleanEmail, passwordHash, finalUsername, userId]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
        const error = new Error('Identity or email is already registered to another account');
        error.status = 409;
        throw error;
      }
      throw err;
    }

    await recordSecurityEvent({
      userId,
      eventType: 'ACCOUNT_LINK_SUCCESS',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { provider: 'password' },
    });

    const { rows: updatedRows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
    return { user: publicUser(updatedRows[0]) };
  }

  // Social provider: google or facebook
  let cleanProviderUserId = null;
  const rawToken = token || idToken || accessToken;
  let verifiedSocialProfile = null;

  if (!rawToken) {
    const error = new Error(`OAuth token is required to link ${provider}`);
    error.status = 400;
    throw error;
  }
  try {
    if (provider === 'google') verifiedSocialProfile = await oauthService.verifyGoogleToken(rawToken);
    else if (provider === 'facebook') verifiedSocialProfile = await oauthService.verifyFacebookToken(rawToken);
    cleanProviderUserId = verifiedSocialProfile?.providerUserId || null;
  } catch (_) {
    await recordSecurityEvent({
      userId, eventType: 'ACCOUNT_LINK_FAILED', ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null, metadata: { provider, reason: 'invalid_oauth_token' },
    });
    const error = new Error('Invalid or expired OAuth token'); error.status = 401; throw error;
  }

  if (!cleanProviderUserId) {
    const error = new Error(`OAuth token is required to link ${provider}`);
    error.status = 400;
    throw error;
  }

  // Check if providerUserId is already linked to another account
  const { rows: conflict } = await query(
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2 LIMIT 1',
    [provider, cleanProviderUserId]
  );
  if (conflict.length > 0) {
    await recordSecurityEvent({
      userId,
      eventType: 'ACCOUNT_LINK_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { provider, reason: 'provider_user_already_linked' },
    });
    const error = new Error(`This ${provider} account is already linked to another user`);
    error.status = 409;
    throw error;
  }

  // Check if user already has an identity for this provider
  const { rows: userIdentities } = await query(
    'SELECT id FROM auth_identities WHERE user_id = $1 AND provider = $2 LIMIT 1',
    [userId, provider]
  );
  if (userIdentities.length > 0) {
    const error = new Error(`Account is already linked with ${provider}`);
    error.status = 400;
    throw error;
  }

  try {
    const identityId = randomUUID();
    await query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
       VALUES ($1, $2, $3, $4, NULL)`,
      [identityId, userId, provider, cleanProviderUserId]
    );

    // Update is_guest = FALSE, and backfill email/avatar if available
    await query(
      `UPDATE users 
       SET is_guest = FALSE,
           email = COALESCE(email, $1),
           avatar_url = COALESCE(avatar_url, $2),
           updated_at = NOW() 
       WHERE id = $3`,
      [
        provider === 'google' && verifiedSocialProfile?.emailVerified !== true
          ? null
          : verifiedSocialProfile?.email || null,
        verifiedSocialProfile?.avatarUrl || null,
        userId,
      ]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      const error = new Error(`This ${provider} account is already linked to another user`);
      error.status = 409;
      throw error;
    }
    throw err;
  }

  await recordSecurityEvent({
    userId,
    eventType: 'ACCOUNT_LINK_SUCCESS',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { provider },
  });

  const { rows: updatedRows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return { user: publicUser(updatedRows[0]) };
}

async function socialLogin({ provider, token, idToken, accessToken, codeVerifier, redirectUri, req }) {
  if (!provider || !['google', 'facebook'].includes(provider)) {
    const error = new Error("Valid provider ('google', 'facebook') is required");
    error.status = 400;
    throw error;
  }

  const rawToken = token || idToken || accessToken;
  if (!rawToken || typeof rawToken !== 'string') {
    const error = new Error('OAuth token is required');
    error.status = 400;
    throw error;
  }

  let verifiedProfile;
  try {
    if (provider === 'google') {
      if (codeVerifier && redirectUri) {
        // Authorization Code + PKCE flow: exchange the code server-side using GOOGLE_CLIENT_SECRET
        verifiedProfile = await oauthService.exchangeGoogleCode(rawToken, codeVerifier, redirectUri);
      } else {
        // Direct token flow (id_token or access_token already obtained by client)
        verifiedProfile = await oauthService.verifyGoogleToken(rawToken);
      }
    } else if (provider === 'facebook') {
      verifiedProfile = await oauthService.verifyFacebookToken(rawToken);
    }
  } catch (err) {
    await recordSecurityEvent({
      eventType: 'OAUTH_LOGIN_FAILED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { provider, reason: err.message },
    });
    const error = new Error('Invalid or expired OAuth token');
    error.status = 401;
    throw error;
  }

  const providerUserId = verifiedProfile.providerUserId;

  // 1. Check if auth_identities already has this social identity
  const { rows: identities } = await query(
    `SELECT ai.*, u.id AS current_user_id
     FROM auth_identities ai
     JOIN users u ON u.id = ai.user_id
     WHERE ai.provider = $1
       AND ai.provider_user_id = $2
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [provider, providerUserId]
  );

  if (identities.length > 0) {
    const identity = identities[0];
    const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [identity.user_id]);
    const user = users[0];

    await recordSecurityEvent({
      userId: user.id,
      eventType: 'OAUTH_LOGIN_SUCCESS',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { provider, providerUserId },
    });

    const tokens = await createSession(user, req);
    return { user: publicUser(user), tokens };
  }

  // Never infer account ownership from matching email addresses. Google email is
  // only persisted when Google marks it verified; linking remains explicit and
  // authenticated through linkAccount.
  const trustedEmail = provider !== 'google' || verifiedProfile.emailVerified === true
    ? verifiedProfile.email
    : null;
  if (trustedEmail) {
    const { rows: collision } = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1',
      [trustedEmail.toLowerCase()]
    );
    if (collision[0]) {
      const error = new Error('An account with this email already exists. Please log in and link your social account in settings.');
      error.status = 409;
      throw error;
    }
  }

  // This pre-Phase-1 recovery branch is intentionally disabled: an email match
  // must never attach a provider identity, including for historical orphans.
  const allowLegacyEmailAutoLinking = false;
  if (allowLegacyEmailAutoLinking && verifiedProfile.email) {
    const { rows: emailMatches } = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1',
      [verifiedProfile.email.toLowerCase()]
    );
    if (emailMatches.length > 0) {
      const matchedUserId = emailMatches[0].id;

      // The matched account may already be bound to a DIFFERENT subject for this
      // provider (another Google account). Never re-point or duplicate those.
      const { rows: matchedIdentities } = await query(
        'SELECT provider, provider_user_id FROM auth_identities WHERE user_id = $1',
        [matchedUserId]
      );
      const matchedProviderIdentity = matchedIdentities.find((row) => row.provider === provider);
      const providerIdentityAvailable =
        !matchedProviderIdentity || matchedProviderIdentity.provider_user_id === providerUserId;

      // Only the provider's own email-verification claim (set server-side by
      // oauth.service) is trusted here — client-supplied email data never
      // reaches this code path.
      const providerVerifiedEmail = verifiedProfile.emailVerified === true;

      if (!providerVerifiedEmail || !providerIdentityAvailable) {
        await recordSecurityEvent({
          userId: matchedUserId,
          eventType: 'OAUTH_LOGIN_FAILED',
          ipAddress: req?.ip || null,
          userAgent: req?.headers?.['user-agent'] || null,
          metadata: { provider, reason: 'email_already_registered' },
        });
        const error = new Error('An account with this email already exists. Please log in with your password and link your social account in settings.');
        error.status = 409;
        throw error;
      }

      // Secure account linking: the provider verified that this email belongs to
      // the caller, so attach the social identity to the SAME account instead of
      // rejecting (locking the user out) or creating a duplicate account. Future
      // Google logins match the identity lookup above and need no password.
      try {
        await query(
          `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
           VALUES ($1, $2, $3, $4, NULL)`,
          [randomUUID(), matchedUserId, provider, providerUserId]
        );
      } catch (err) {
        const isDuplicate = err.code === 'ER_DUP_ENTRY' || err.errno === 1062;
        if (!isDuplicate) throw err;
        // Concurrent request may have linked it — confirm it landed on THIS account.
        const { rows: raced } = await query(
          'SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2 LIMIT 1',
          [provider, providerUserId]
        );
        if (!raced[0] || raced[0].user_id !== matchedUserId) {
          const error = new Error(`This ${provider} account is already linked to another user`);
          error.status = 409;
          throw error;
        }
      }

      await query(
        `UPDATE users
         SET is_guest = FALSE,
             avatar_url = COALESCE(avatar_url, $1),
             updated_at = NOW()
         WHERE id = $2`,
        [verifiedProfile.avatarUrl || null, matchedUserId]
      );

      await recordSecurityEvent({
        userId: matchedUserId,
        eventType: 'ACCOUNT_LINK_SUCCESS',
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
        metadata: { provider, providerUserId, via: 'verified_email_match' },
      });

      const { rows: linkedUsers } = await query('SELECT * FROM users WHERE id = $1', [matchedUserId]);
      const linkedUser = linkedUsers[0];

      await recordSecurityEvent({
        userId: linkedUser.id,
        eventType: 'OAUTH_LOGIN_SUCCESS',
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null,
        metadata: { provider, providerUserId, linkedExistingAccount: true },
      });

      const tokens = await createSession(linkedUser, req);
      return { user: publicUser(linkedUser), tokens };
    }
  }

  // 3. Create new user and auth_identities safely.
  //    Both inserts run in ONE transaction so a partial failure can never leave
  //    an email-bearing user without a provider identity behind — such orphans
  //    would be permanently blocked with a 409 on their next Google sign-in.
  const userId = randomUUID();
  const cleanName = (verifiedProfile.displayName || `${provider}_user`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const username = `${provider}_${cleanName || 'player'}_${randomUUID().slice(0, 6)}`;
  const inviteCode = await createUniqueInviteCode();

  const client = await connect();
  try {
    await client.beginTransaction();

    await client.query(
      `INSERT INTO users (id, username, email, display_name, avatar_url, invite_code, is_guest, coins)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 1000)`,
      [
        userId,
        username,
        trustedEmail ? trustedEmail.toLowerCase() : null,
        verifiedProfile.displayName || username,
        verifiedProfile.avatarUrl || null,
        inviteCode,
      ]
    );

    await client.query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash)
       VALUES ($1, $2, $3, $4, NULL)`,
      [randomUUID(), userId, provider, providerUserId]
    );

    await client.commit();
  } catch (err) {
    try {
      await client.rollback();
    } catch (_) {
      // rollback is best-effort — the original error is rethrown below
    }
    if (isDuplicateKey(err)) {
      const { rows: raced } = await query(
        `SELECT u.* FROM auth_identities ai JOIN users u ON u.id = ai.user_id
         WHERE ai.provider = $1 AND ai.provider_user_id = $2 AND u.deleted_at IS NULL LIMIT 1`,
        [provider, providerUserId]
      );
      if (raced[0]) {
        const tokens = await createSession(raced[0], req);
        return { user: publicUser(raced[0]), tokens };
      }
      const error = new Error('Social identity or email is already registered to another account');
      error.status = 409;
      throw error;
    }
    throw err;
  } finally {
    client.release();
  }

  await recordSecurityEvent({
    userId,
    eventType: 'OAUTH_LOGIN_SUCCESS',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { provider, providerUserId, isNewUser: true },
  });

  const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = users[0];
  const tokens = await createSession(user, req);

  return { user: publicUser(user), tokens };
}


async function cleanupExpiredSessions() {
  try {
    await query(
      `DELETE FROM refresh_tokens
       WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
          OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(), INTERVAL 30 DAY))`
    );
  } catch (_) {}
}

async function refreshUserSession({ refreshToken, req }) {
  if (!refreshToken) {
    const error = new Error('refreshToken is required');
    error.status = 400;
    throw error;
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    const error = new Error('Invalid or expired refresh token');
    error.status = 401;
    throw error;
  }

  const { rows } = await query(
    `SELECT rt.*, u.username, u.email, u.display_name, u.invite_code, u.avatar_url, u.role, u.is_guest, u.xp, u.level, u.coins, u.token_version
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.id = $1 AND rt.expires_at > NOW()`,
    [payload.jti]
  );

  const session = rows[0];
  if (!session || session.token_hash !== hashToken(refreshToken)) {
    const error = new Error('Invalid refresh token');
    error.status = 401;
    throw error;
  }

  // Token reuse detection: if already revoked
  if (session.revoked_at !== null) {
    await recordSecurityEvent({
      userId: session.user_id,
      eventType: 'SESSION_REUSE_DETECTED',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: { sessionId: session.id },
    });
    const error = new Error('Invalid or revoked refresh token');
    error.status = 401;
    throw error;
  }

  if (session.token_version !== payload.tokenVersion) {
    const error = new Error('Invalid refresh token');
    error.status = 401;
    throw error;
  }

  const user = {
    id: session.user_id,
    username: session.username,
    email: session.email,
    display_name: session.display_name,
    invite_code: session.invite_code,
    avatar_url: session.avatar_url,
    role: session.role,
    is_guest: session.is_guest,
    xp: session.xp,
    level: session.level,
    coins: session.coins,
    token_version: session.token_version,
  };

  // Mark previous session rotated, update last_used_at
  await query('UPDATE refresh_tokens SET revoked_at = NOW(), last_used_at = NOW() WHERE id = $1', [session.id]);
  const tokens = await createSession(user, req);

  await recordSecurityEvent({
    userId: user.id,
    eventType: 'SESSION_REFRESHED',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { oldSessionId: session.id, newSessionId: tokens.sessionId },
  });

  return { user: publicUser(user), tokens };
}

async function revokeUserSession({ refreshToken, sessionId, userId, req }) {
  let targetSessionId = sessionId || null;
  let targetUserId = userId || null;

  if (refreshToken) {
    const hashed = hashToken(refreshToken);
    const { rows } = await query(
      'SELECT id, user_id FROM refresh_tokens WHERE token_hash = $1',
      [hashed]
    );
    if (rows[0]) {
      targetSessionId = rows[0].id;
      targetUserId = rows[0].user_id;
    }
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [hashed]);
  } else if (targetSessionId && targetUserId) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2', [targetSessionId, targetUserId]);
  }

  if (targetUserId) {
    await recordSecurityEvent({
      userId: targetUserId,
      eventType: 'LOGOUT',
      ipAddress: req?.ip || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata: targetSessionId ? { sessionId: targetSessionId } : null,
    });
  }
}

async function listUserSessions({ userId, currentSessionId }) {
  if (!userId) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  await cleanupExpiredSessions();

  const { rows } = await query(
    `SELECT id, user_agent, ip_address, expires_at, created_at, last_used_at
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    userAgent: row.user_agent || null,
    ipAddress: row.ip_address || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at || row.created_at,
    isCurrent: Boolean(currentSessionId && row.id === currentSessionId),
  }));
}

async function revokeSessionById({ userId, sessionId, req }) {
  if (!userId) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  if (!sessionId) {
    const error = new Error('sessionId is required');
    error.status = 400;
    throw error;
  }

  const { rows } = await query(
    `SELECT id, user_id, revoked_at FROM refresh_tokens WHERE id = $1`,
    [sessionId]
  );

  if (rows.length === 0) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  if (rows[0].user_id !== userId) {
    const error = new Error('You do not have permission to revoke this session');
    error.status = 403;
    throw error;
  }

  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  await recordSecurityEvent({
    userId,
    eventType: 'SESSION_REVOKED',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    metadata: { sessionId },
  });

  return { success: true, sessionId };
}

async function revokeAllUserSessions({ userId, req }) {
  if (!userId) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }

  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  await query(
    `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
    [userId]
  );

  await recordSecurityEvent({
    userId,
    eventType: 'ALL_SESSIONS_REVOKED',
    ipAddress: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
  });

  return { success: true, message: 'All sessions revoked successfully' };
}

async function requestPasswordReset({ email }) {
  if (!email) {
    const error = new Error('email is required');
    error.status = 400;
    throw error;
  }

  const { rows } = await query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL AND is_guest = FALSE`,
    [email.trim()]
  );

  // Always respond the same to avoid user enumeration
  if (!rows[0]) {
    return { sent: true };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), rows[0].id, tokenHash, expiresAt]
  );

  if (env.nodeEnv !== 'production') {
    console.log(`[Dev] Password reset token for ${email}: ${rawToken}`);
  }

  return {
    sent: true,
    ...(env.nodeEnv !== 'production' && { resetToken: rawToken }),
  };
}

async function resetPassword({ token, password }) {
  if (!token || !password || password.length < 6) {
    const error = new Error('token and password (6+ chars) are required');
    error.status = 400;
    throw error;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const { rows } = await query(
    `SELECT prt.id, prt.user_id
     FROM password_reset_tokens prt
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > NOW()`,
    [tokenHash]
  );

  if (!rows[0]) {
    const error = new Error('Invalid or expired reset token');
    error.status = 400;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

  await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [passwordHash, rows[0].user_id]);
  await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [rows[0].id]);
  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].user_id]);

  return { reset: true };
}

module.exports = {
  publicUser,
  createSession,
  signup,
  login,
  guestLogin,
  restoreGuest,
  linkAccount,
  socialLogin,
  refreshUserSession,
  revokeUserSession,
  listUserSessions,
  revokeSessionById,
  revokeAllUserSessions,
  cleanupExpiredSessions,
  requestPasswordReset,
  resetPassword,
};

