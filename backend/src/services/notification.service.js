const { query } = require('../db/pool');

async function savePushToken({ userId, token, platform }) {
  await query(
    `INSERT INTO user_push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON DUPLICATE KEY UPDATE platform = VALUES(platform), updated_at = NOW()`,
    [userId, token, platform || null]
  );
}

async function sendPushToUser(userId, payload) {
  const { rows } = await query('SELECT token FROM user_push_tokens WHERE user_id = $1', [userId]);
  if (!rows.length || typeof fetch !== 'function') {
    return;
  }

  await Promise.all(rows.map((row) => fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: row.token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
    }),
  }).catch(() => undefined)));
}

function emitToUser(req, userId, event, payload) {
  let io = req?.app?.get?.('io') || req?.io || (req?.to ? req : null);
  if (!io) {
    try {
      const { getSocketIO } = require('../sockets');
      io = getSocketIO();
    } catch (_) {}
  }
  console.log(`[Notification] Emitting '${event}' to user:${userId}`);
  io?.to(`user:${userId}`)?.emit?.(event, payload);
}

async function notifyUser(req, userId, event, payload) {
  emitToUser(req, userId, event, payload);
  await sendPushToUser(userId, {
    title: payload.title || 'InvestaQuiz Challenge',
    body: payload.body || 'You have a new challenge.',
    data: { event, ...(payload.data || {}) },
  });
}

module.exports = { savePushToken, notifyUser, emitToUser, sendPushToUser };
