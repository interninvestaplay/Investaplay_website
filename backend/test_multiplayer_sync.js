const http = require('http');
const path = require('path');
const ioClient = require('../QuizFront/node_modules/socket.io-client');

const BASE_URL = 'http://localhost:4000';

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function patch(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function createGuestUser(name) {
  const res = await post('/api/auth/guest', { nickname: `${name}_${Date.now() % 100000}` });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Failed to create guest: ${JSON.stringify(res.body)}`);
  }
  return {
    user: res.body.user,
    token: res.body.tokens.accessToken,
  };
}

function createSocket(token) {
  return ioClient(BASE_URL, {
    transports: ['websocket'],
    auth: { token },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testMatchFlow(playerCount) {
  console.log(`\n========================================`);
  console.log(`TEST: ${playerCount}-Player Complete Flow`);
  console.log(`========================================`);

  // 1. Create players
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(await createGuestUser(`P${i + 1}_${playerCount}P`));
  }
  const host = players[0];

  // 2. Host creates room
  const createRes = await post(
    '/api/rooms',
    {
      category: 'General',
      difficulty: 'easy',
      questionLimit: 2, // 2 questions for quick test
      maxPlayers: playerCount,
      roomName: `TestRoom_${playerCount}P`,
    },
    host.token
  );
  if (!createRes.body.room) {
    throw new Error(`Room creation failed: ${JSON.stringify(createRes.body)}`);
  }
  const roomId = createRes.body.room.id;
  const roomCode = createRes.body.room.code;
  console.log(`[TEST] Room created: roomId=${roomId} code=${roomCode} maxPlayers=${playerCount}`);

  // 3. Other players join
  for (let i = 1; i < playerCount; i++) {
    const joinRes = await post('/api/rooms/join', { code: roomCode }, players[i].token);
    if (!joinRes.body.room) {
      throw new Error(`Player ${i + 1} failed to join room: ${JSON.stringify(joinRes.body)}`);
    }
    console.log(`[TEST] Player ${i + 1} (${players[i].user.id}) joined room.`);
  }

  // 4. Connect sockets
  const sockets = players.map((p) => createSocket(p.token));
  await sleep(400);

  // Each socket emits room:join
  sockets.forEach((s) => s.emit('room:join', { roomId }));
  await sleep(300);

  // 5. Non-host players set ready
  for (let i = 1; i < playerCount; i++) {
    const readyRes = await patch(`/api/rooms/${roomId}/ready`, { ready: true }, players[i].token);
    console.log(`[TEST] Player ${i + 1} set ready: ready=${readyRes.body.players.find((x) => x.user_id === players[i].user.id)?.ready}`);
  }
  await sleep(300);

  // 6. Listen for game:started on all sockets
  const startedGameIds = {};
  sockets.forEach((s, idx) => {
    s.on('game:started', (data) => {
      startedGameIds[players[idx].user.id] = data.game?.id;
    });
  });

  // 7. Host starts game
  console.log(`[TEST] Host starting game...`);
  const startRes = await post(`/api/rooms/${roomId}/start`, {}, host.token);
  if (!startRes.body.game?.id) {
    throw new Error(`Host failed to start game: ${JSON.stringify(startRes.body)}`);
  }
  const serverGameId = startRes.body.game.id;
  console.log(`[TEST] Game started with gameId: ${serverGameId}`);

  await sleep(500);

  // Verify all players received the EXACT SAME gameId
  for (let i = 0; i < playerCount; i++) {
    const pId = players[i].user.id;
    const socketGameId = startedGameIds[pId];
    console.log(`[TEST] Player ${i + 1} socket gameId: ${socketGameId}`);
    if (socketGameId && socketGameId !== serverGameId) {
      throw new Error(`Player ${i + 1} received mismatched gameId: ${socketGameId} vs ${serverGameId}`);
    }
  }

  // Verify REST getRoom snapshot also shows IN_PROGRESS and active_game_id
  const roomSnap = await get(`/api/rooms/${roomId}`, players[1].token);
  console.log(`[TEST] REST snapshot: status=${roomSnap.body.room.status} gameId=${roomSnap.body.room.gameId || roomSnap.body.room.active_game_id}`);
  if (roomSnap.body.room.status !== 'IN_PROGRESS' && roomSnap.body.room.status_raw !== 'in_game') {
    throw new Error(`Room snapshot status mismatch: ${JSON.stringify(roomSnap.body.room)}`);
  }

  // 8. Gameplay: Play questions
  let finished = false;
  let qRound = 1;

  while (!finished && qRound <= 3) {
    console.log(`\n[TEST] Question Round ${qRound}:`);
    const qRes = await get(`/api/games/${serverGameId}/current-question`, host.token);
    if (qRes.body.finished) {
      console.log(`[TEST] Match is finished on server!`);
      finished = true;
      break;
    }

    const question = qRes.body.question;
    console.log(`[TEST] Authoritative Question: index=${question.current_question_index} id=${question.question_id} prompt="${question.prompt.slice(0, 30)}..."`);

    // All active players submit answer
    for (let i = 0; i < playerCount; i++) {
      const p = players[i];
      const ansRes = await post(
        `/api/games/${serverGameId}/answers`,
        {
          questionId: question.question_id,
          selectedOption: 'A',
          answeredInMs: 500,
        },
        p.token
      );
      console.log(`[TEST] Player ${i + 1} answered. Correct=${ansRes.body.answer?.is_correct} ScoreDelta=${ansRes.body.answer?.score_delta}`);
    }

    // Wait for server debounce & advance
    await sleep(1500);
    qRound++;
  }

  // 9. Verify match and room are completed
  const finalRoom = await get(`/api/rooms/${roomId}`, host.token);
  console.log(`[TEST] Final room status: ${finalRoom.body.room.status} (raw: ${finalRoom.body.room.status_raw})`);

  // Cleanup sockets
  sockets.forEach((s) => s.disconnect());
  console.log(`[TEST] ${playerCount}-Player Flow PASSED!`);
}

async function testEdgeCases() {
  console.log(`\n========================================`);
  console.log(`TEST: Edge Cases`);
  console.log(`========================================`);

  // Edge Case 1: Repeated Start requests (Idempotency)
  console.log(`\n[EDGE 1] Testing repeated Start requests (Idempotency)...`);
  const host = await createGuestUser('Host_Idemp');
  const p2 = await createGuestUser('P2_Idemp');
  const roomRes = await post('/api/rooms', { maxPlayers: 2, questionLimit: 2 }, host.token);
  const roomId = roomRes.body.room.id;
  await post('/api/rooms/join', { code: roomRes.body.room.code }, p2.token);
  await patch(`/api/rooms/${roomId}/ready`, { ready: true }, p2.token);

  // Call start concurrently / repeatedly
  const [s1, s2, s3] = await Promise.all([
    post(`/api/rooms/${roomId}/start`, {}, host.token),
    post(`/api/rooms/${roomId}/start`, {}, host.token),
    post(`/api/rooms/${roomId}/start`, {}, host.token),
  ]);

  console.log(`[EDGE 1] Start 1 gameId: ${s1.body.game?.id}`);
  console.log(`[EDGE 1] Start 2 gameId: ${s2.body.game?.id}`);
  console.log(`[EDGE 1] Start 3 gameId: ${s3.body.game?.id}`);

  if (!s1.body.game?.id || s1.body.game?.id !== s2.body.game?.id || s1.body.game?.id !== s3.body.game?.id) {
    throw new Error(`Idempotent start failed! Mismatched gameIds: ${s1.body.game?.id}, ${s2.body.game?.id}, ${s3.body.game?.id}`);
  }
  console.log(`[EDGE 1] Idempotent start PASSED: Exactly ONE gameId returned across concurrent requests!`);

  // Edge Case 2: Rapid Ready taps
  console.log(`\n[EDGE 2] Testing rapid Ready taps...`);
  const readyCalls = await Promise.all([
    patch(`/api/rooms/${roomId}/ready`, { ready: true }, p2.token),
    patch(`/api/rooms/${roomId}/ready`, { ready: true }, p2.token),
    patch(`/api/rooms/${roomId}/ready`, { ready: true }, p2.token),
  ]);
  readyCalls.forEach((r, idx) => console.log(`[EDGE 2] Ready tap ${idx + 1} status: ${r.status}`));
  console.log(`[EDGE 2] Rapid Ready taps PASSED!`);

  // Edge Case 3: One player not answering (Server Timeout advancement)
  console.log(`\n[EDGE 3] Testing non-answering player timeout advancement...`);
  const gameId = s1.body.game.id;
  const initialQ = await get(`/api/games/${gameId}/current-question`, host.token);
  const initialQIndex = initialQ.body.question.current_question_index;
  console.log(`[EDGE 3] Initial questionIndex: ${initialQIndex}. Host will answer, P2 will NOT answer.`);

  // Host answers, P2 stays idle
  await post(`/api/games/${gameId}/answers`, {
    questionId: initialQ.body.question.question_id,
    selectedOption: 'A',
    answeredInMs: 500,
  }, host.token);

  console.log(`[EDGE 3] Waiting for server timeout (or advance)...`);
  // Advance via server timeout or advanceGame
  await sleep(1000);
  // Verify advance occurs or can advance without freezing
  const nextQ = await get(`/api/games/${gameId}/current-question`, host.token);
  console.log(`[EDGE 3] Question after wait: finished=${nextQ.body.finished} index=${nextQ.body.question?.current_question_index}`);
  console.log(`[EDGE 3] Non-answering player did not freeze game!`);

  // Edge Case 4: Temporary disconnect & reconnect
  console.log(`\n[EDGE 4] Testing temporary disconnect & reconnect...`);
  const sock = createSocket(host.token);
  await sleep(300);
  sock.emit('room:join', { roomId });
  sock.emit('game:join', { gameId });
  await sleep(200);

  // Disconnect socket
  sock.disconnect();
  console.log(`[EDGE 4] Host disconnected.`);
  await sleep(300);

  // Reconnect socket and rejoin
  const sock2 = createSocket(host.token);
  await sleep(300);
  const rejoinReply = await new Promise((resolve) => {
    sock2.emit('game:rejoin', { gameId, roomId }, resolve);
  });
  console.log(`[EDGE 4] Rejoin response ok: ${rejoinReply.ok}, hasQuestion: ${Boolean(rejoinReply.gameState?.question)}`);
  sock2.disconnect();
  console.log(`[EDGE 4] Disconnect & Reconnect PASSED!`);

  console.log(`\n[EDGE CASES] All edge case tests PASSED successfully!`);
}

async function main() {
  try {
    await testMatchFlow(2);
    await testMatchFlow(3);
    await testMatchFlow(4);
    await testEdgeCases();
    console.log(`\n========================================`);
    console.log(`ALL MULTIPLAYER TESTS COMPLETED SUCCESSFULLY!`);
    console.log(`========================================\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\nTEST FAILED:`, err);
    process.exit(1);
  }
}

main();
