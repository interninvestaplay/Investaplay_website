const { randomUUID } = require('crypto');
const { query, connect } = require('../db/pool');
const { createRoomCode } = require('../utils/roomCode');
const { startGame, getCurrentQuestion } = require('./game.service');

async function getRoomSnapshot(roomId, userId = null) {
  if (userId) {
    const membership = await query(
      'SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (!membership.rows[0]) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
  }
  const room = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
  const rawRoom = room.rows[0];
  if (!rawRoom) return { room: null, players: [] };

  const players = await query(
    `SELECT rp.user_id, rp.role, rp.ready, rp.joined_at, u.username, u.display_name, u.avatar_url, u.level
     FROM room_players rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = $1
     ORDER BY rp.joined_at ASC`,
    [roomId]
  );

  if (rawRoom.active_game_id) {
    const gameRes = await query('SELECT status FROM games WHERE id = $1', [rawRoom.active_game_id]);
    if (gameRes.rows[0]?.status === 'completed' || gameRes.rows[0]?.status === 'finished') {
      if (rawRoom.status !== 'completed' && rawRoom.status !== 'closed') {
        await query("UPDATE rooms SET status = 'completed', updated_at = NOW() WHERE id = $1", [roomId]);
        rawRoom.status = 'completed';
      }
    }
  }

  const isGameActive = rawRoom.status === 'in_game' || rawRoom.status === 'IN_PROGRESS';
  const isCompleted = rawRoom.status === 'completed' || rawRoom.status === 'COMPLETED' || rawRoom.status === 'closed';
  const normalizedStatus = isGameActive ? 'IN_PROGRESS' : (isCompleted ? 'COMPLETED' : rawRoom.status);
  const gameId = isCompleted ? null : (rawRoom.active_game_id || null);

  return {
    room: {
      ...rawRoom,
      status: normalizedStatus,
      status_raw: rawRoom.status,
      gameId,
      active_game_id: gameId,
    },
    players: players.rows,
  };
}

async function createRoom({
  hostUserId,
  roomName = 'Quiz Room',
  category = 'General',
  difficulty = 'easy',
  questionLimit = 5,
  maxPlayers = 4,
  isPrivate = true,
}) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    let code = createRoomCode();
    for (let attempts = 0; attempts < 4; attempts += 1) {
      const existing = await client.query('SELECT id FROM rooms WHERE code = $1', [code]);
      if (!existing.rows[0]) break;
      code = createRoomCode();
    }

    const roomId = randomUUID();
    await client.query(
      `INSERT INTO rooms (id, code, host_user_id, mode, room_name, category, difficulty, question_limit, max_players, is_private)
       VALUES ($1, $2, $3, 'friends', $4, $5, $6, $7, $8, $9)`,
      [roomId, code, hostUserId, roomName, category, difficulty, questionLimit, maxPlayers, isPrivate]
    );

    await client.query(
      `INSERT INTO room_players (room_id, user_id, role, ready)
       VALUES ($1, $2, 'host', TRUE)`,
      [roomId, hostUserId]
    );
    await client.query('COMMIT');

    console.log(`[ROOM_JOIN] userId: ${hostUserId} roomId: ${roomId} role: host`);
    return await getRoomSnapshot(roomId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function joinRoom(code, userId) {
  const cleanCode = String(code || '').replace(/\s+/g, '').toUpperCase();
  const client = await connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM rooms WHERE code = $1 AND status = $2 FOR UPDATE', [cleanCode, 'waiting']);
    const room = rows[0];
    if (!room) {
      const error = new Error('Waiting room not found');
      error.status = 404;
      throw error;
    }
    const existing = await client.query('SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2', [room.id, userId]);
    if (!existing.rows[0]) {
      const count = await client.query('SELECT COUNT(*) AS total FROM room_players WHERE room_id = $1', [room.id]);
      if (Number(count.rows[0].total || 0) >= Number(room.max_players || 0)) {
        const error = new Error('Room is full');
        error.status = 409;
        throw error;
      }
      await client.query(`INSERT INTO room_players (room_id, user_id, role) VALUES ($1, $2, 'player')`, [room.id, userId]);
    }
    await client.query('COMMIT');
    return await getRoomSnapshot(room.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function togglePlayerReady(roomId, userId, ready) {
  const { rows } = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
  const room = rows[0];
  if (!room) {
    const error = new Error('Room not found');
    error.status = 404;
    throw error;
  }
  const status = String(room.status || '').toLowerCase();
  if (status === 'in_game' || status === 'completed' || status === 'cancelled' || status === 'closed') {
    const error = new Error(`Cannot change ready status when room is ${room.status}`);
    error.status = 400;
    throw error;
  }
  await query(
    `UPDATE room_players SET ready = $3
     WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId, Boolean(ready)]
  );
  return await getRoomSnapshot(roomId);
}

const activeRoomStartLocks = new Map();

async function startRoomGame(roomId, hostUserId) {
  if (activeRoomStartLocks.has(roomId)) {
    return await activeRoomStartLocks.get(roomId);
  }

  const startPromise = (async () => {
    const { rows } = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
    const room = rows[0];
    if (!room) {
      const error = new Error('Room not found');
      error.status = 404;
      throw error;
    }
    if (room.status === 'completed' || room.status === 'cancelled' || room.status === 'closed') {
      const error = new Error(`Cannot start a ${room.status} room`);
      error.status = 400;
      throw error;
    }
    if (String(room.host_user_id) !== String(hostUserId)) {
      const error = new Error('Only the host can start the quiz');
      error.status = 403;
      throw error;
    }

    // Idempotency: If room is already in_game and has an active game, return the existing game!
    if ((room.status === 'in_game' || room.status === 'IN_PROGRESS') && room.active_game_id) {
      const existingGame = await query('SELECT * FROM games WHERE id = $1', [room.active_game_id]);
      if (existingGame.rows[0] && existingGame.rows[0].status === 'active') {
        console.log(`[ROOM_START] Idempotent start: reusing active game ${room.active_game_id} for room ${room.id}`);
        return existingGame.rows[0];
      }
    }

    const playersResult = await query(
      'SELECT user_id, ready FROM room_players WHERE room_id = $1',
      [room.id]
    );
    const nonHostPlayers = playersResult.rows.filter((p) => String(p.user_id) !== String(room.host_user_id));
    if (nonHostPlayers.length === 0) {
      const error = new Error('Please wait for at least one friend to join before starting the quiz!');
      error.status = 400;
      throw error;
    }
    const unreadyPlayers = nonHostPlayers.filter(
      (p) => !(p.ready === true || p.ready === 1 || p.ready === '1')
    );
    if (unreadyPlayers.length > 0) {
      const error = new Error('All friends in the room must be Ready before starting!');
      error.status = 400;
      throw error;
    }

    let game;
    try {
      let customQuestionIds = null;
      if (room.custom_question_ids) {
        try {
          customQuestionIds = typeof room.custom_question_ids === 'string'
            ? JSON.parse(room.custom_question_ids)
            : room.custom_question_ids;
        } catch (_) {
          customQuestionIds = null;
        }
      }
      game = await startGame({
        roomId: room.id,
        mode: 'room',
        category: room.category,
        difficulty: room.difficulty,
        questionLimit: room.question_limit,
        customQuestionIds,
        createdBy: hostUserId,
      });
    } catch (startErr) {
      if (startErr.status === 409 || startErr.message?.includes('already started')) {
        const checkRoom = await query('SELECT active_game_id FROM rooms WHERE id = $1', [room.id]);
        if (checkRoom.rows[0]?.active_game_id) {
          const existing = await query('SELECT * FROM games WHERE id = $1', [checkRoom.rows[0].active_game_id]);
          if (existing.rows[0]) {
            return existing.rows[0];
          }
        }
      }
      throw startErr;
    }

    console.log(`[ROOM_START] roomId: ${room.id} gameId: ${game.id}`);
    return game;
  })();

  activeRoomStartLocks.set(roomId, startPromise);
  try {
    return await startPromise;
  } finally {
    activeRoomStartLocks.delete(roomId);
  }
}

async function cancelRoomBeforeStart(roomId, leavingUserId = null, io = null) {
  if (!roomId) return { cancelled: false };

  if (!io) {
    try {
      const { getSocketIO } = require('../sockets');
      io = getSocketIO?.();
    } catch {}
  }

  // 1. Fetch room
  const { rows: roomRows } = await query('SELECT * FROM rooms WHERE id = $1', [roomId]);
  const room = roomRows[0];
  if (!room) {
    return { cancelled: false, reason: 'room_not_found' };
  }

  // 2. Safe & idempotent: if room is already terminal, return safely
  if (room.status === 'cancelled' || room.status === 'completed' || room.status === 'closed') {
    return { cancelled: false, reason: 'already_terminal' };
  }

  // 3. DO NOT use pre-game cancellation if quiz has already started!
  if (room.status === 'in_game' || room.active_game_id) {
    return { cancelled: false, reason: 'game_already_started' };
  }

  // 4. Mark room as cancelled
  await query("UPDATE rooms SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'waiting'", [roomId]);

  // 5. Mark associated challenge as cancelled with reason 'PLAYER_LEFT_BEFORE_START'
  const { rows: challengeRows } = await query(
    "SELECT * FROM challenges WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1",
    [roomId]
  );
  const challenge = challengeRows[0];
  if (challenge && challenge.status !== 'cancelled') {
    await query(
      "UPDATE challenges SET status = 'cancelled', cancellation_reason = 'PLAYER_LEFT_BEFORE_START', updated_at = NOW() WHERE id = $1",
      [challenge.id]
    );
  }

  // 6. Notify both players immediately through existing socket system
  const message = 'Player left the lobby. Match cancelled.';
  const payload = {
    roomId,
    challengeId: challenge?.id || null,
    reason: 'PLAYER_LEFT_BEFORE_START',
    leavingUserId: leavingUserId ? String(leavingUserId) : null,
    message,
  };

  if (io) {
    // Emit both events to room channel
    io.to(`room:${roomId}`).emit('room:cancelled', payload);
    io.to(`room:${roomId}`).emit('challenge:cancelled', payload);

    try {
      const snapshot = await getRoomSnapshot(roomId);
      io.to(`room:${roomId}`).emit('room:updated', snapshot);
    } catch {
      // snapshot error ignored
    }

    const notifyUserIds = new Set();
    if (room.host_user_id) {
      notifyUserIds.add(String(room.host_user_id));
    }
    if (challenge) {
      if (challenge.challenger_id) notifyUserIds.add(String(challenge.challenger_id));
      if (challenge.challenged_id) notifyUserIds.add(String(challenge.challenged_id));
    }
    const { rows: players } = await query('SELECT user_id FROM room_players WHERE room_id = $1', [roomId]);
    players.forEach((p) => notifyUserIds.add(String(p.user_id)));

    // Do NOT notify the user who is leaving (leavingUserId)
    if (leavingUserId) {
      notifyUserIds.delete(String(leavingUserId));
    }

    // Emit both events to each remaining participant's personal channel
    for (const uid of notifyUserIds) {
      io.to(`user:${uid}`).emit('room:cancelled', payload);
      io.to(`user:${uid}`).emit('challenge:cancelled', payload);
    }

    // Send push notification only to remaining player(s)
    const { sendPushToUser } = require('./notification.service');
    for (const uid of notifyUserIds) {
      sendPushToUser(uid, {
        title: 'Match Cancelled',
        body: message,
        data: {
          event: 'challenge:cancelled',
          challengeId: challenge?.id || null,
          roomId,
          reason: 'PLAYER_LEFT_BEFORE_START',
        },
      }).catch(() => undefined);
    }
  }

  return { cancelled: true, roomId, challengeId: challenge?.id || null };
}

module.exports = {
  getRoomSnapshot,
  createRoom,
  joinRoom,
  togglePlayerReady,
  startRoomGame,
  cancelRoomBeforeStart,
};
