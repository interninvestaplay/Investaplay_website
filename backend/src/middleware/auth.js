const { query } = require('../db/pool');
const { verifyAccessToken } = require('../utils/tokens');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.split(' ');

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const payload = verifyAccessToken(token);
    const { rows } = await query(
      `SELECT id, username, email, display_name, invite_code, avatar_url, role, is_guest, xp, level, coins, token_version, status, status_reason
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [payload.sub]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (payload.tokenVersion !== undefined && rows[0].token_version !== undefined) {
      if (rows[0].token_version !== payload.tokenVersion) {
        return res.status(401).json({ error: 'Token has been revoked' });
      }
    }

    if (rows[0].role !== 'admin' && (rows[0].status === 'suspended' || rows[0].status === 'banned')) {
      return res.status(403).json({
        error: rows[0].status === 'banned' ? 'Account has been banned' : 'Account has been suspended',
        status: rows[0].status,
        reason: rows[0].status_reason || null,
      });
    }

    query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [rows[0].id]).catch(() => {});

    req.user = rows[0];
    req.sessionId = payload.sessionId || null;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
