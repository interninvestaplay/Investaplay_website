const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { query, connect } = require('../src/db/pool');
const { registerSockets } = require('../src/sockets');
const { signAccessToken } = require('../src/utils/tokens');
const { createRoom, joinRoom, togglePlayerReady, startRoomGame } = require('../src/services/room.service');

// Helper to create test user in database
async function createTestUser(prefix = 'social_user') {
  const id = randomUUID();
  const tag = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  const inviteCode = `INV${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, invite_code, coins, level)
     VALUES ($1, $2, $3, 'hash', $4, $5, 1000, 1)`,
    [id, tag, `${tag}@test.com`, `Display_${tag}`, inviteCode]
  );
  return { id, username: tag, display_name: `Display_${tag}`, inviteCode };
}

// In-memory Mock Socket.IO harness connecting directly through registerSockets
function createMockServer() {
  const rooms = new Map(); // roomName -> Set<socket>
  const middlewares = [];
  const connectionListeners = [];

  const io = {
    rooms,
    middlewares,
    connectionListeners,
    use(fn) {
      middlewares.push(fn);
    },
    on(event, fn) {
      if (event === 'connection') {
        connectionListeners.push(fn);
      }
    },
    to(room) {
      return {
        emit(event, data) {
          const roomSockets = rooms.get(room) || new Set();
          for (const s of roomSockets) {
            s.emit(event, data);
          }
        },
        async fetchSockets() {
          const roomSockets = rooms.get(room) || new Set();
          return Array.from(roomSockets);
        },
      };
    },
  };
  io.in = io.to;

  registerSockets(io);

  async function connectClient(user, customToken = null) {
    const token = customToken !== null ? customToken : signAccessToken(user);
    const socketHandlers = new Map();
    const joinedRooms = new Set();
    const receivedEvents = [];

    const socket = {
      id: randomUUID(),
      user: null,
      data: {},
      handshake: { auth: { token }, headers: {} },
      receivedEvents,
      rooms: joinedRooms,
      join(r) {
        joinedRooms.add(r);
        if (!rooms.has(r)) rooms.set(r, new Set());
        rooms.get(r).add(socket);
      },
      leave(r) {
        joinedRooms.delete(r);
        if (rooms.has(r)) rooms.get(r).delete(socket);
      },
      emit(event, data) {
        receivedEvents.push({ event, data, timestamp: Date.now() });
      },
      on(event, fn) {
        if (!socketHandlers.has(event)) socketHandlers.set(event, []);
        socketHandlers.get(event).push(fn);
      },
      off(event, fn) {
        if (!socketHandlers.has(event)) return;
        if (!fn) {
          socketHandlers.delete(event);
        } else {
          const filtered = socketHandlers.get(event).filter((h) => h !== fn);
          socketHandlers.set(event, filtered);
        }
      },
      async trigger(event, payload) {
        const handlers = socketHandlers.get(event) || [];
        return new Promise((resolve) => {
          let hasReplied = false;
          const reply = (res) => {
            hasReplied = true;
            resolve(res);
          };
          for (const h of handlers) {
            h(payload, reply);
          }
          setTimeout(() => {
            if (!hasReplied) resolve(null);
          }, 60);
        });
      },
      disconnect() {
        // Trigger disconnect handlers and leave all rooms
        const handlers = socketHandlers.get('disconnect') || [];
        for (const h of handlers) {
          h();
        }
        for (const r of Array.from(joinedRooms)) {
          socket.leave(r);
        }
      },
    };

    // Run auth middleware
    for (const mw of middlewares) {
      await new Promise((resolve, reject) => {
        mw(socket, (err) => (err ? reject(err) : resolve()));
      });
    }

    // Run connection listeners
    for (const conn of connectionListeners) {
      conn(socket);
    }

    return socket;
  }

  return { io, connectClient };
}

// 1. 1v1 Realtime Delivery
test('Social System 1: 1v1 realtime delivery, server stamped identity, and legacy reaction compatibility', async () => {
  const server = createMockServer();
  const userA = await createTestUser('p1v1_a');
  const userB = await createTestUser('p1v1_b');

  const roomRes = await createRoom({ hostUserId: userA.id, maxPlayers: 2, roomName: '1v1 Match' });
  const roomId = roomRes.room.id;
  await joinRoom(roomRes.room.code, userB.id);
  await togglePlayerReady(roomId, userA.id, true);
  await togglePlayerReady(roomId, userB.id, true);
  const startRes = await startRoomGame(roomId, userA.id);
  const gameId = startRes.id;

  const socketA = await server.connectClient(userA);
  const socketB = await server.connectClient(userB);

  await socketA.trigger('game:join', { gameId, roomId });
  await socketB.trigger('game:join', { gameId, roomId });

  // User A sends CHAT message
  const reply = await socketA.trigger('game:social', {
    gameId,
    roomId,
    type: 'CHAT',
    content: 'Good luck! ⚡',
  });

  assert.equal(reply.ok, true, 'Chat should be acknowledged');
  assert.equal(reply.event.userId, userA.id, 'Sender userId strictly derived from socket.user');
  assert.equal(reply.event.userName, userA.display_name, 'Sender userName strictly derived');
  assert.equal(reply.event.type, 'CHAT');
  assert.equal(reply.event.content, 'Good luck! ⚡');

  // Both sockets received game:social and legacy game:reaction
  const socialOnB = socketB.receivedEvents.find((e) => e.event === 'game:social');
  assert.ok(socialOnB, 'Receiver B must receive game:social');
  assert.equal(socialOnB.data.content, 'Good luck! ⚡');
  assert.equal(socialOnB.data.userId, userA.id);

  const reactionOnB = socketB.receivedEvents.find((e) => e.event === 'game:reaction');
  assert.ok(reactionOnB, 'Receiver B must also receive legacy game:reaction for backwards compatibility');

  const socialOnA = socketA.receivedEvents.find((e) => e.event === 'game:social');
  assert.ok(socialOnA, 'Sender A also receives broadcast to game room');
});

// 2. 2v2 Delivery (4 participants)
test('Social System 2: 2v2 delivery (all 4 participants receive broadcast)', async () => {
  const server = createMockServer();
  const users = await Promise.all([
    createTestUser('p2v2_1'),
    createTestUser('p2v2_2'),
    createTestUser('p2v2_3'),
    createTestUser('p2v2_4'),
  ]);

  const roomRes = await createRoom({ hostUserId: users[0].id, maxPlayers: 4, roomName: '2v2 Battle' });
  const roomId = roomRes.room.id;
  for (let i = 1; i < 4; i++) {
    await joinRoom(roomRes.room.code, users[i].id);
    await togglePlayerReady(roomId, users[i].id, true);
  }
  await togglePlayerReady(roomId, users[0].id, true);
  const startRes = await startRoomGame(roomId, users[0].id);
  const gameId = startRes.id;

  const sockets = await Promise.all(users.map((u) => server.connectClient(u)));
  for (const s of sockets) {
    await s.trigger('game:join', { gameId, roomId });
  }

  // User 2 sends QUICK_CHAT
  const reply = await sockets[1].trigger('game:social', {
    gameId,
    roomId,
    type: 'QUICK_CHAT',
    content: 'Think faster! ⚡',
  });
  assert.equal(reply.ok, true);

  // Verify all 4 players received the message
  for (let i = 0; i < 4; i++) {
    const received = sockets[i].receivedEvents.find(
      (e) => e.event === 'game:social' && e.data.content === 'Think faster! ⚡'
    );
    assert.ok(received, `Player ${i + 1} must receive the quick-chat event`);
    assert.equal(received.data.userId, users[1].id);
  }
});

// 3. 6v6 Delivery (12 participants)
test('Social System 3: 6v6 delivery (all 12 participants dynamically receive event)', async () => {
  const server = createMockServer();
  const users = [];
  for (let i = 0; i < 12; i++) {
    users.push(await createTestUser(`p6v6_${i + 1}`));
  }

  const roomRes = await createRoom({ hostUserId: users[0].id, maxPlayers: 12, roomName: '6v6 Arena' });
  const roomId = roomRes.room.id;
  for (let i = 1; i < 12; i++) {
    await joinRoom(roomRes.room.code, users[i].id);
    await togglePlayerReady(roomId, users[i].id, true);
  }
  await togglePlayerReady(roomId, users[0].id, true);
  const startRes = await startRoomGame(roomId, users[0].id);
  const gameId = startRes.id;

  const sockets = await Promise.all(users.map((u) => server.connectClient(u)));
  for (const s of sockets) {
    await s.trigger('game:join', { gameId, roomId });
  }

  // Player 7 sends EMOTE
  const reply = await sockets[6].trigger('game:social', {
    gameId,
    roomId,
    type: 'EMOTE',
    content: '🔥',
  });
  assert.equal(reply.ok, true);

  // All 12 participants must receive the emote
  for (let i = 0; i < 12; i++) {
    const found = sockets[i].receivedEvents.find(
      (e) => e.event === 'game:social' && e.data.content === '🔥'
    );
    assert.ok(found, `Participant ${i + 1} of 12 must receive the emote`);
    assert.equal(found.data.userId, users[6].id);
    assert.equal(found.data.type, 'EMOTE');
  }
});

// 4. Match Isolation
test('Social System 4: Match isolation (Game 1 events never leak to Game 2)', async () => {
  const server = createMockServer();
  const user1A = await createTestUser('iso_1a');
  const user1B = await createTestUser('iso_1b');
  const user2A = await createTestUser('iso_2a');
  const user2B = await createTestUser('iso_2b');

  // Match 1
  const room1 = await createRoom({ hostUserId: user1A.id, maxPlayers: 2, roomName: 'Room 1' });
  await joinRoom(room1.room.code, user1B.id);
  await togglePlayerReady(room1.room.id, user1A.id, true);
  await togglePlayerReady(room1.room.id, user1B.id, true);
  const game1 = await startRoomGame(room1.room.id, user1A.id);

  // Match 2
  const room2 = await createRoom({ hostUserId: user2A.id, maxPlayers: 2, roomName: 'Room 2' });
  await joinRoom(room2.room.code, user2B.id);
  await togglePlayerReady(room2.room.id, user2A.id, true);
  await togglePlayerReady(room2.room.id, user2B.id, true);
  const game2 = await startRoomGame(room2.room.id, user2A.id);

  const socket1A = await server.connectClient(user1A);
  const socket1B = await server.connectClient(user1B);
  const socket2A = await server.connectClient(user2A);
  const socket2B = await server.connectClient(user2B);

  await socket1A.trigger('game:join', { gameId: game1.id, roomId: room1.room.id });
  await socket1B.trigger('game:join', { gameId: game1.id, roomId: room1.room.id });
  await socket2A.trigger('game:join', { gameId: game2.id, roomId: room2.room.id });
  await socket2B.trigger('game:join', { gameId: game2.id, roomId: room2.room.id });

  // User 1A sends message in Game 1
  await socket1A.trigger('game:social', {
    gameId: game1.id,
    roomId: room1.room.id,
    type: 'CHAT',
    content: 'Secret match 1 message',
  });

  // Game 1 participants receive it
  assert.ok(socket1B.receivedEvents.find((e) => e.data?.content === 'Secret match 1 message'));

  // Game 2 participants must NOT receive it
  assert.equal(
    socket2A.receivedEvents.find((e) => e.data?.content === 'Secret match 1 message'),
    undefined,
    'Game 2 player A must not receive Game 1 messages'
  );
  assert.equal(
    socket2B.receivedEvents.find((e) => e.data?.content === 'Secret match 1 message'),
    undefined,
    'Game 2 player B must not receive Game 1 messages'
  );
});

// 5. Invalid / Non-Participant Rejection
test('Social System 5: Invalid inputs and non-participants are rejected', async () => {
  const server = createMockServer();
  const host = await createTestUser('auth_host');
  const player = await createTestUser('auth_player');
  const outsider = await createTestUser('auth_outsider');

  const roomRes = await createRoom({ hostUserId: host.id, maxPlayers: 2, roomName: 'Auth Room' });
  await joinRoom(roomRes.room.code, player.id);
  await togglePlayerReady(roomRes.room.id, host.id, true);
  await togglePlayerReady(roomRes.room.id, player.id, true);
  const game = await startRoomGame(roomRes.room.id, host.id);

  const socketHost = await server.connectClient(host);
  const socketOutsider = await server.connectClient(outsider);

  // 1. Non-participant attempts to send social event
  const outsiderReply = await socketOutsider.trigger('game:social', {
    gameId: game.id,
    type: 'CHAT',
    content: 'I am not invited!',
  });
  assert.equal(outsiderReply.ok, false);
  assert.match(outsiderReply.error, /participation required/i);

  // 2. Empty content
  const emptyReply = await socketHost.trigger('game:social', {
    gameId: game.id,
    type: 'CHAT',
    content: '    ',
  });
  assert.equal(emptyReply.ok, false);
  assert.match(emptyReply.error, /empty/i);

  // 3. Invalid social type
  const badTypeReply = await socketHost.trigger('game:social', {
    gameId: game.id,
    type: 'INJECTION_ATTACK',
    content: 'hello',
  });
  assert.equal(badTypeReply.ok, false);
  assert.match(badTypeReply.error, /invalid social event type/i);

  // 4. Missing gameId
  const noGameReply = await socketHost.trigger('game:social', {
    type: 'CHAT',
    content: 'hello',
  });
  assert.equal(noGameReply.ok, false);
  assert.match(noGameReply.error, /game required/i);
});

// 6. Spam / Rate Limiting (1.2s minimum interval & max 5 events per 10s)
test('Social System 6: Spam and rate limiting enforcement', async () => {
  const server = createMockServer();
  const host = await createTestUser('rate_host');
  const player = await createTestUser('rate_player');

  const roomRes = await createRoom({ hostUserId: host.id, maxPlayers: 2, roomName: 'Rate Room' });
  await joinRoom(roomRes.room.code, player.id);
  await togglePlayerReady(roomRes.room.id, host.id, true);
  await togglePlayerReady(roomRes.room.id, player.id, true);
  const game = await startRoomGame(roomRes.room.id, host.id);

  const socketHost = await server.connectClient(host);
  await socketHost.trigger('game:join', { gameId: game.id });

  // Event 1: allowed
  const r1 = await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '😎' });
  assert.equal(r1.ok, true);

  // Event 2: immediately within 1.2s -> REJECTED
  const r2 = await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '⚡' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /wait before sending/i);
  assert.ok(r2.retryAfterMs > 0);

  // Fast-forward cooldown by modifying socket data
  socketHost.data.lastSocialTime = Date.now() - 1300;

  // Event 2 after cooldown: allowed
  const r2After = await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '⚡' });
  assert.equal(r2After.ok, true);

  // Simulate 3 more rapid events up to 5 allowed within 10s
  socketHost.data.lastSocialTime = Date.now() - 1300;
  await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '🔥' });
  socketHost.data.lastSocialTime = Date.now() - 1300;
  await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '🧠' });
  socketHost.data.lastSocialTime = Date.now() - 1300;
  await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '👏' });

  // 6th event within 10s sliding window -> REJECTED by 5-event cap
  socketHost.data.lastSocialTime = Date.now() - 1300;
  const r6 = await socketHost.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '🎉' });
  assert.equal(r6.ok, false);
  assert.match(r6.error, /limit reached/i);
});

// 7. Completed-Game Rejection
test('Social System 7: Completed/finished game rejects social events', async () => {
  const server = createMockServer();
  const host = await createTestUser('fin_host');
  const player = await createTestUser('fin_player');

  const roomRes = await createRoom({ hostUserId: host.id, maxPlayers: 2, roomName: 'Finish Room' });
  await joinRoom(roomRes.room.code, player.id);
  await togglePlayerReady(roomRes.room.id, host.id, true);
  await togglePlayerReady(roomRes.room.id, player.id, true);
  const game = await startRoomGame(roomRes.room.id, host.id);

  const socketHost = await server.connectClient(host);
  await socketHost.trigger('game:join', { gameId: game.id });

  // Mark game as completed in database
  await query("UPDATE games SET status = 'completed' WHERE id = $1", [game.id]);

  const reply = await socketHost.trigger('game:social', {
    gameId: game.id,
    type: 'CHAT',
    content: 'GG after finish',
  });

  assert.equal(reply.ok, false);
  assert.match(reply.error, /no longer active/i);
});

// 8. Simultaneous Reactions
test('Social System 8: Simultaneous reactions from multiple players are delivered with unique IDs', async () => {
  const server = createMockServer();
  const userA = await createTestUser('sim_a');
  const userB = await createTestUser('sim_b');

  const roomRes = await createRoom({ hostUserId: userA.id, maxPlayers: 2, roomName: 'Sim Room' });
  await joinRoom(roomRes.room.code, userB.id);
  await togglePlayerReady(roomRes.room.id, userA.id, true);
  await togglePlayerReady(roomRes.room.id, userB.id, true);
  const game = await startRoomGame(roomRes.room.id, userA.id);

  const socketA = await server.connectClient(userA);
  const socketB = await server.connectClient(userB);

  await socketA.trigger('game:join', { gameId: game.id });
  await socketB.trigger('game:join', { gameId: game.id });

  // Trigger simultaneous reactions from User A and User B concurrently
  const [resA, resB] = await Promise.all([
    socketA.trigger('game:social', { gameId: game.id, type: 'EMOTE', content: '👑' }),
    socketB.trigger('game:social', { gameId: game.id, type: 'QUICK_CHAT', content: 'GG Well Played! 🤝' }),
  ]);

  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  assert.notEqual(resA.event.id, resB.event.id, 'Events must have distinct IDs');

  // Both sockets must have received both events
  const socketAEevents = socketA.receivedEvents.filter((e) => e.event === 'game:social');
  const socketBEevents = socketB.receivedEvents.filter((e) => e.event === 'game:social');

  assert.equal(socketAEevents.length, 2, 'Socket A received both simultaneous events');
  assert.equal(socketBEevents.length, 2, 'Socket B received both simultaneous events');
});

// 9. Reconnect / Listener Cleanup
test('Social System 9: Disconnect and reconnect cleanly cleans up rooms and allows re-joining', async () => {
  const server = createMockServer();
  const userA = await createTestUser('recon_a');
  const userB = await createTestUser('recon_b');

  const roomRes = await createRoom({ hostUserId: userA.id, maxPlayers: 2, roomName: 'Recon Room' });
  await joinRoom(roomRes.room.code, userB.id);
  await togglePlayerReady(roomRes.room.id, userA.id, true);
  await togglePlayerReady(roomRes.room.id, userB.id, true);
  const game = await startRoomGame(roomRes.room.id, userA.id);

  const socketA = await server.connectClient(userA);
  const socketB = await server.connectClient(userB);

  await socketA.trigger('game:join', { gameId: game.id });
  await socketB.trigger('game:join', { gameId: game.id });

  // Player A disconnects
  socketA.disconnect();

  // Verify Player A was removed from game room
  const gameSockets = server.io.rooms.get(`game:${game.id}`) || new Set();
  assert.equal(gameSockets.has(socketA), false, 'Disconnected socket should no longer be in game room');

  // Player A reconnects with a fresh socket connection
  const newSocketA = await server.connectClient(userA);
  await newSocketA.trigger('game:join', { gameId: game.id });

  // New socket sends a message
  const reply = await newSocketA.trigger('game:social', {
    gameId: game.id,
    type: 'CHAT',
    content: 'I am back!',
  });

  assert.equal(reply.ok, true);
  assert.equal(reply.event.content, 'I am back!');

  // Player B receives the message from reconnected Player A
  const msgOnB = socketB.receivedEvents.find((e) => e.data?.content === 'I am back!');
  assert.ok(msgOnB, 'Player B must receive message from reconnected Player A');
});

test.after(async () => {
  const { pool } = require('../src/db/pool');
  try {
    await pool.end();
  } catch {}
});
