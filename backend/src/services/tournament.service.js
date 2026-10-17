const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const { startGame, getLeaderboard } = require('./game.service');
const {
  autoStartScheduledTournaments,
  autoCompleteExpiredTournaments,
} = require('./tournamentScheduler.service');

async function listTournaments({ userId, status, io }) {
  if (io) {
    await autoStartScheduledTournaments(io);
    await autoCompleteExpiredTournaments(io);
  }

  const { rows } = await query(
    `SELECT t.*,
            COUNT(DISTINCT tp.user_id) AS players,
            MAX(CASE WHEN tp.user_id = $2 THEN 1 ELSE 0 END) AS is_registered,
            MAX(CASE WHEN tp.user_id = $2 AND tp.has_attempted = 1 THEN 1 ELSE 0 END) AS is_attempted
     FROM tournaments t
     LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
     WHERE ($1 IS NULL OR t.status = $1)
     GROUP BY t.id
     ORDER BY t.starts_at ASC`,
    [status || null, userId]
  );
  return rows;
}

async function getTournamentPlayers(tournamentId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.level, tp.joined_at, tp.has_attempted
     FROM tournament_players tp
     JOIN users u ON u.id = tp.user_id
     WHERE tp.tournament_id = $1
     ORDER BY tp.joined_at ASC`,
    [tournamentId]
  );
  return rows;
}

async function createTournament({
  title,
  description,
  category = 'General',
  difficulty = 'medium',
  questionLimit = 10,
  entryFeeCoins = 0,
  prizeCoins = 0,
  maxPlayers = 1000,
  startsAt,
  endsAt,
}) {
  if (!title || !startsAt) {
    const error = new Error('title and startsAt are required');
    error.status = 400;
    throw error;
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    const error = new Error('difficulty must be easy, medium, or hard');
    error.status = 400;
    throw error;
  }

  const id = randomUUID();
  await query(
    `INSERT INTO tournaments
       (id, title, description, category, difficulty, question_limit, entry_fee_coins, prize_coins, max_players, status, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11)`,
    [
      id,
      String(title).trim(),
      description || null,
      String(category || 'General').trim(),
      difficulty,
      Number(questionLimit) || 10,
      Number(entryFeeCoins) || 0,
      Number(prizeCoins) || 0,
      Number(maxPlayers) || 1000,
      new Date(startsAt),
      endsAt ? new Date(endsAt) : null,
    ]
  );

  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [id]);
  return rows[0];
}

async function getTournamentDetails(tournamentId, userId) {
  const tournament = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournament.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  const playerReg = await query(
    'SELECT has_attempted, completed_at FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
    [item.id, userId]
  );
  const isRegistered = Boolean(playerReg.rows[0]);
  const hasAttempted = Boolean(playerReg.rows[0]?.has_attempted);

  const leaderboard = item.active_game_id
    ? await getLeaderboard(item.active_game_id)
    : [];

  let userScore = 0;
  let userCorrect = 0;
  let userRank = null;
  if (leaderboard.length) {
    const userEntry = leaderboard.find((p) => p.user_id === userId);
    if (userEntry) {
      userScore = userEntry.score || 0;
      userCorrect = userEntry.correct_answers || 0;
      userRank = userEntry.rank || leaderboard.indexOf(userEntry) + 1;
    }
  }

  return {
    tournament: item,
    leaderboard,
    isRegistered,
    hasAttempted,
    userScore,
    userCorrect,
    userRank,
  };
}

async function joinTournament(tournamentId, userId) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  if (item.status === 'in_progress' || new Date(item.starts_at).getTime() <= Date.now()) {
    const error = new Error('Registration closed! Registration time for this tournament has ended.');
    error.status = 400;
    throw error;
  }
  if (item.status === 'completed') {
    const error = new Error('This tournament has already ended.');
    error.status = 400;
    throw error;
  }
  if (item.status === 'cancelled') {
    const error = new Error('This tournament has been cancelled.');
    error.status = 400;
    throw error;
  }

  const countResult = await query('SELECT COUNT(*) AS total FROM tournament_players WHERE tournament_id = $1', [item.id]);
  const currentCount = Number(countResult.rows[0]?.total || 0);
  if (currentCount >= Number(item.max_players || 1000)) {
    const error = new Error('Tournament is full');
    error.status = 400;
    throw error;
  }

  const existing = await query(
    'SELECT 1 FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
    [item.id, userId]
  );
  const alreadyJoined = Boolean(existing.rows[0]);

  if (!alreadyJoined) {
    const fee = Number(item.entry_fee_coins || 0);
    if (fee > 0) {
      const userRes = await query('SELECT coins FROM users WHERE id = $1', [userId]);
      const userCoins = Number(userRes.rows[0]?.coins || 0);
      if (userCoins < fee) {
        const error = new Error(`Insufficient coins (${userCoins}/${fee}) for tournament entry`);
        error.status = 400;
        throw error;
      }
      await query('UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1', [fee, userId]);
    }

    await query(
      `INSERT IGNORE INTO tournament_players (tournament_id, user_id)
       VALUES ($1, $2)`,
      [item.id, userId]
    );

    if (item.active_game_id) {
      await query(
        `INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers)
         VALUES ($1, $2, 0, 0)`,
        [item.active_game_id, userId]
      );
    }
  }

  return {
    joined: true,
    alreadyJoined,
    status: item.status,
    activeGameId: item.active_game_id || null,
  };
}

async function startTournament(tournamentId, adminUserId) {
  const tournament = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournament.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  if (item.status === 'in_progress' && item.active_game_id) {
    return { game: { id: item.active_game_id }, alreadyStarted: true };
  }

  const game = await startGame({
    tournamentId: item.id,
    mode: 'tournament',
    category: item.category,
    difficulty: item.difficulty,
    questionLimit: item.question_limit,
    createdBy: adminUserId,
  });

  const players = await query('SELECT user_id FROM tournament_players WHERE tournament_id = $1', [item.id]);
  for (const player of players.rows) {
    await query(
      `INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers)
       VALUES ($1, $2, 0, 0)`,
      [game.id, player.user_id]
    );
  }

  await query(
    `UPDATE tournaments SET status = 'in_progress', active_game_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [item.id, game.id]
  );

  return { game, alreadyStarted: false };
}

async function getTournamentLeaderboard(tournamentId) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  let leaderboard = [];
  if (item.active_game_id) {
    leaderboard = await getLeaderboard(item.active_game_id);
  } else {
    const { rows } = await query(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, u.level,
              0 AS score, 0 AS correct_answers
       FROM tournament_players tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.tournament_id = $1
       ORDER BY tp.joined_at ASC`,
      [item.id]
    );
    leaderboard = rows;
  }

  return {
    tournamentId: item.id,
    leaderboard,
    totalPlayers: leaderboard.length,
  };
}

async function generateAiQuestions({ category = 'General', difficulty = 'medium', count = 5, level = 1 }) {
  const numQuestions = Math.min(Math.max(1, Number(count) || 5), 20);

  const topicSeeds = {
    General: [
      { prompt: 'Which planet in our solar system has the most prominent rings?', options: ['Saturn', 'Jupiter', 'Uranus', 'Neptune'], correct: 'Saturn', exp: 'Saturn has the most extensive and visible ring system.' },
      { prompt: 'What is the capital city of Australia?', options: ['Canberra', 'Sydney', 'Melbourne', 'Brisbane'], correct: 'Canberra', exp: 'Canberra was chosen as the capital in 1908 as a compromise between Sydney and Melbourne.' },
      { prompt: 'Which element has the chemical symbol "Fe"?', options: ['Iron', 'Fluorine', 'Francium', 'Lead'], correct: 'Iron', exp: 'Fe comes from the Latin word "ferrum" meaning iron.' },
      { prompt: 'How many bones are in the adult human body?', options: ['206', '208', '212', '198'], correct: '206', exp: 'An adult human skeleton consists of 206 bones.' },
      { prompt: 'Which ocean is the largest on Earth?', options: ['Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean'], correct: 'Pacific Ocean', exp: 'The Pacific Ocean covers over 30% of the Earth surface.' },
      { prompt: 'Who painted the Mona Lisa?', options: ['Leonardo da Vinci', 'Pablo Picasso', 'Vincent van Gogh', 'Michelangelo'], correct: 'Leonardo da Vinci', exp: 'Leonardo da Vinci painted the Mona Lisa in the early 16th century.' },
      { prompt: 'What is the hardest natural substance on Earth?', options: ['Diamond', 'Titanium', 'Quartz', 'Graphene'], correct: 'Diamond', exp: 'Diamond ranks 10 on the Mohs hardness scale.' },
    ],
    Science: [
      { prompt: 'What is the powerhouse of the human cell?', options: ['Mitochondria', 'Nucleus', 'Ribosome', 'Golgi apparatus'], correct: 'Mitochondria', exp: 'Mitochondria generate most of the chemical energy needed to power the cell.' },
      { prompt: 'What is the speed of light in a vacuum approximately?', options: ['300,000 km/s', '150,000 km/s', '500,000 km/s', '1,000,000 km/s'], correct: '300,000 km/s', exp: 'Light travels at approximately 299,792 km per second.' },
      { prompt: 'Which gas do green plants absorb from the atmosphere during photosynthesis?', options: ['Carbon Dioxide', 'Oxygen', 'Nitrogen', 'Methane'], correct: 'Carbon Dioxide', exp: 'Plants take in carbon dioxide and release oxygen.' },
      { prompt: 'What part of the atom has a positive electric charge?', options: ['Proton', 'Electron', 'Neutron', 'Photon'], correct: 'Proton', exp: 'Protons carry a positive charge (+1e).' },
      { prompt: 'What is the pH level of pure distilled water at 25°C?', options: ['7 (Neutral)', '0 (Acidic)', '14 (Basic)', '5 (Slightly acidic)'], correct: '7 (Neutral)', exp: 'Pure water has a neutral pH of 7.' },
    ],
    Technology: [
      { prompt: 'What does "CPU" stand for in computing?', options: ['Central Processing Unit', 'Central Program Unit', 'Computer Power Unit', 'Core Processing Utility'], correct: 'Central Processing Unit', exp: 'The CPU performs instructions and processing for computers.' },
      { prompt: 'Which programming language is most commonly used for styling web pages?', options: ['CSS', 'HTML', 'Python', 'SQL'], correct: 'CSS', exp: 'Cascading Style Sheets (CSS) styles the presentation of web pages.' },
      { prompt: 'Who founded Microsoft alongside Bill Gates in 1975?', options: ['Paul Allen', 'Steve Ballmer', 'Steve Jobs', 'Satya Nadella'], correct: 'Paul Allen', exp: 'Bill Gates and Paul Allen founded Microsoft on April 4, 1975.' },
      { prompt: 'What does HTTP stand for in internet protocols?', options: ['HyperText Transfer Protocol', 'High Text Transmission Process', 'Hyper Transfer Terminal Packet', 'Home Text Transit Platform'], correct: 'HyperText Transfer Protocol', exp: 'HTTP is the foundational protocol for data exchange on the Web.' },
      { prompt: 'Which data structure follows the FIFO (First In, First Out) principle?', options: ['Queue', 'Stack', 'Tree', 'Graph'], correct: 'Queue', exp: 'A Queue processes items in the order they arrived (FIFO).' },
    ],
    Mathematics: [
      { prompt: 'What is the value of Pi rounded to two decimal places?', options: ['3.14', '3.16', '3.12', '3.18'], correct: '3.14', exp: 'Pi is approximately 3.14159...' },
      { prompt: 'What is the square root of 144?', options: ['12', '14', '16', '11'], correct: '12', exp: '12 x 12 = 144.' },
      { prompt: 'What is the sum of interior angles in a triangle?', options: ['180 degrees', '360 degrees', '90 degrees', '270 degrees'], correct: '180 degrees', exp: 'The interior angles of any Euclidean triangle always sum to 180 degrees.' },
      { prompt: 'What is the only even prime number?', options: ['2', '4', '0', '6'], correct: '2', exp: '2 is the only prime number divisible only by 1 and itself that is even.' },
      { prompt: 'What is 15% of 200?', options: ['30', '25', '35', '20'], correct: '30', exp: '0.15 x 200 = 30.' },
    ],
    Sports: [
      { prompt: 'How many players are on the field in a standard cricket team?', options: ['11', '10', '12', '9'], correct: '11', exp: 'A standard cricket team fields 11 players.' },
      { prompt: 'Which country won the first-ever FIFA World Cup in 1930?', options: ['Uruguay', 'Brazil', 'Argentina', 'Italy'], correct: 'Uruguay', exp: 'Uruguay hosted and won the inaugural 1930 World Cup.' },
      { prompt: 'In tennis, what term describes a score of zero?', options: ['Love', 'Fault', 'Deuce', 'Ace'], correct: 'Love', exp: '"Love" denotes zero points in tennis scoring.' },
      { prompt: 'How many rings make up the Olympic symbol?', options: ['5', '4', '6', '7'], correct: '5', exp: 'The five interlocking rings represent the five inhabited continents.' },
    ],
  };

  const pool = topicSeeds[category] || topicSeeds.General;
  const createdQuestions = [];

  for (let i = 0; i < numQuestions; i++) {
    const template = pool[i % pool.length];
    const qId = randomUUID();
    const prompt = numQuestions > pool.length ? `${template.prompt} (Set ${Math.floor(i / pool.length) + 1})` : template.prompt;

    await query(
      `INSERT INTO questions (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
       VALUES ($1, $2, $3, $4, $5, CAST($6 AS JSON), $7, $8, 15)
       ON DUPLICATE KEY UPDATE explanation = VALUES(explanation)`,
      [
        qId,
        Number(level) || 1,
        category,
        difficulty,
        prompt,
        JSON.stringify(template.options),
        template.correct,
        template.exp,
      ]
    );

    createdQuestions.push({
      id: qId,
      level: Number(level) || 1,
      category,
      difficulty,
      prompt,
      options: template.options,
      correctOption: template.correct,
      explanation: template.exp,
    });
  }

  return {
    generatedCount: createdQuestions.length,
    questions: createdQuestions,
    category,
    difficulty,
  };
}

async function playTournament(tournamentId, user) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  if (item.status === 'completed') {
    const error = new Error('This tournament has ended. Gameplay is closed.');
    error.status = 400;
    error.extra = {
      isCompleted: true,
      tournamentId: item.id,
      gameId: item.active_game_id,
    };
    throw error;
  }

  if (item.status === 'cancelled') {
    const error = new Error('This tournament has been cancelled.');
    error.status = 400;
    throw error;
  }

  const playerReg = await query(
    'SELECT has_attempted, completed_at FROM tournament_players WHERE tournament_id = $1 AND user_id = $2',
    [item.id, user.id]
  );

  if (playerReg.rows[0]?.has_attempted) {
    const error = new Error('You have already completed your single attempt for this tournament.');
    error.status = 403;
    error.extra = {
      alreadyAttempted: true,
      gameId: item.active_game_id,
      tournamentId: item.id,
    };
    throw error;
  }

  if (item.status === 'scheduled') {
    const isPastStartTime = new Date(item.starts_at).getTime() <= Date.now();
    const isAdmin = user.role === 'admin';
    if (isPastStartTime || isAdmin) {
      const game = await startGame({
        tournamentId: item.id,
        mode: 'tournament',
        category: item.category,
        difficulty: item.difficulty,
        questionLimit: item.question_limit,
        createdBy: user.id,
      });
      item.active_game_id = game.id;
      item.status = 'in_progress';
      await query("UPDATE tournaments SET status = 'in_progress', active_game_id = $2, updated_at = NOW() WHERE id = $1", [item.id, game.id]);
    } else {
      const error = new Error('Tournament has not started yet. Please wait for the scheduled start time.');
      error.status = 400;
      error.extra = { isScheduled: true };
      throw error;
    }
  }

  if (!playerReg.rows[0]) {
    if (user.role === 'admin') {
      await query('INSERT IGNORE INTO tournament_players (tournament_id, user_id) VALUES ($1, $2)', [item.id, user.id]);
    } else {
      const error = new Error('Registration closed. Only registered players can participate in this tournament.');
      error.status = 403;
      error.extra = { registrationClosed: true };
      throw error;
    }
  }

  let gameId = item.active_game_id;
  if (!gameId) {
    const game = await startGame({
      tournamentId: item.id,
      mode: 'tournament',
      category: item.category,
      difficulty: item.difficulty,
      questionLimit: item.question_limit,
      createdBy: user.id,
    });
    gameId = game.id;
    await query("UPDATE tournaments SET status = 'in_progress', active_game_id = $2, updated_at = NOW() WHERE id = $1", [item.id, gameId]);
  }

  await query('INSERT IGNORE INTO game_scores (game_id, user_id, score, correct_answers) VALUES ($1, $2, 0, 0)', [gameId, user.id]);

  return {
    gameId,
    status: 'in_progress',
    tournament: item,
    totalQuestions: item.question_limit || 10,
  };
}

async function completeTournamentAttempt(tournamentId, userId) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  await query(
    `UPDATE tournament_players
     SET has_attempted = 1, completed_at = NOW()
     WHERE tournament_id = $1 AND user_id = $2`,
    [item.id, userId]
  );

  return {
    completed: true,
    tournamentId: item.id,
  };
}

async function endTournament(tournamentId) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  await query("UPDATE tournaments SET status = 'completed', ends_at = NOW(), updated_at = NOW() WHERE id = $1", [item.id]);
  return { ok: true, status: 'completed', tournamentId: item.id };
}

async function cancelTournament(tournamentId) {
  const tournamentResult = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const item = tournamentResult.rows[0];
  if (!item) {
    const error = new Error('Tournament not found');
    error.status = 404;
    throw error;
  }

  await query("UPDATE tournaments SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [item.id]);
  return { ok: true, status: 'cancelled', tournamentId: item.id };
}

module.exports = {
  listTournaments,
  getTournamentPlayers,
  createTournament,
  getTournamentDetails,
  joinTournament,
  startTournament,
  getTournamentLeaderboard,
  generateAiQuestions,
  playTournament,
  completeTournamentAttempt,
  endTournament,
  cancelTournament,
};
