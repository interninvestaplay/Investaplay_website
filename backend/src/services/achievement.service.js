const { query } = require('../db/pool');
const { randomUUID } = require('crypto');

const achievementRules = [
  {
    code: 'first_win',
    title: 'First Victory',
    description: 'Win your very first quiz match against an AI or player',
    category: 'combat',
    tier: 'bronze',
    icon: 'Trophy',
    metric: 'wins',
    target: 1,
    coinReward: 50,
    xpReward: 25,
  },
  {
    code: 'quiz_novice',
    title: 'Trivia Novice',
    description: 'Play 5 quiz matches to start your trivia journey',
    category: 'progression',
    tier: 'bronze',
    icon: 'BookOpen',
    metric: 'games_played',
    target: 5,
    coinReward: 50,
    xpReward: 25,
  },
  {
    code: 'quiz_veteran',
    title: 'Quiz Veteran',
    description: 'Play 25 quiz matches across any game modes',
    category: 'progression',
    tier: 'silver',
    icon: 'Award',
    metric: 'games_played',
    target: 25,
    coinReward: 150,
    xpReward: 75,
  },
  {
    code: 'quiz_master',
    title: 'Century Quizzer',
    description: 'Play 100 quiz matches and become a seasoned champion',
    category: 'progression',
    tier: 'gold',
    icon: 'Crown',
    metric: 'games_played',
    target: 100,
    coinReward: 500,
    xpReward: 250,
  },
  {
    code: 'speed_solver',
    title: 'Speed Demon',
    description: 'Answer 20 questions in under 5 seconds with precision',
    category: 'speed',
    tier: 'bronze',
    icon: 'Zap',
    metric: 'fast_answers',
    target: 20,
    coinReward: 100,
    xpReward: 50,
  },
  {
    code: 'lightning_reflexes',
    title: 'Lightning Reflexes',
    description: 'Answer 50 questions rapidly in under 5 seconds',
    category: 'speed',
    tier: 'silver',
    icon: 'Flame',
    metric: 'fast_answers',
    target: 50,
    coinReward: 250,
    xpReward: 100,
  },
  {
    code: 'sharpshooter',
    title: 'Sharp Mind',
    description: 'Correctly answer 50 total quiz questions',
    category: 'accuracy',
    tier: 'bronze',
    icon: 'Target',
    metric: 'correct_answers',
    target: 50,
    coinReward: 100,
    xpReward: 50,
  },
  {
    code: 'century_genius',
    title: 'Century Genius',
    description: 'Correctly answer 100 total quiz questions',
    category: 'accuracy',
    tier: 'silver',
    icon: 'Brain',
    metric: 'correct_answers',
    target: 100,
    coinReward: 250,
    xpReward: 125,
  },
  {
    code: 'room_champ',
    title: 'Room Gladiator',
    description: 'Win 5 multiplayer quiz battles against other players',
    category: 'combat',
    tier: 'bronze',
    icon: 'Users',
    metric: 'room_wins',
    target: 5,
    coinReward: 150,
    xpReward: 75,
  },
  {
    code: 'room_legend',
    title: 'Room Legend',
    description: 'Win 15 multiplayer quiz battles in custom rooms',
    category: 'combat',
    tier: 'gold',
    icon: 'Medal',
    metric: 'room_wins',
    target: 15,
    coinReward: 400,
    xpReward: 200,
  },
  {
    code: 'quiz_streak',
    title: '7-Day Streak',
    description: 'Maintain a 7-day daily quiz streak without breaking it',
    category: 'streak',
    tier: 'silver',
    icon: 'CalendarDays',
    metric: 'daily_streak',
    target: 7,
    coinReward: 200,
    xpReward: 100,
  },
  {
    code: 'ai_conqueror',
    title: 'AI Slayer',
    description: 'Defeat AI bots and unlock Level 3 or higher',
    category: 'combat',
    tier: 'silver',
    icon: 'Bot',
    metric: 'ai_levels',
    target: 3,
    coinReward: 200,
    xpReward: 100,
  },
  {
    code: 'tournament_hero',
    title: 'Tournament Hero',
    description: 'Score 500 or more points in a live tournament contest',
    category: 'tournament',
    tier: 'gold',
    icon: 'Sparkles',
    metric: 'tournament_score',
    target: 500,
    coinReward: 300,
    xpReward: 150,
  },
  {
    code: 'grandmaster',
    title: 'Quiz Grandmaster',
    description: 'Reach Player Level 5 or higher through knowledge and victories',
    category: 'mastery',
    tier: 'diamond',
    icon: 'Star',
    metric: 'player_level',
    target: 5,
    coinReward: 500,
    xpReward: 300,
  },
];

async function ensureAchievementDefinitions() {
  for (const rule of achievementRules) {
    await query(
      `INSERT INTO achievements (id, code, title, description, target_value, category, tier, icon, coin_reward, xp_reward)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         description = VALUES(description),
         target_value = VALUES(target_value),
         category = VALUES(category),
         tier = VALUES(tier),
         icon = VALUES(icon),
         coin_reward = VALUES(coin_reward),
         xp_reward = VALUES(xp_reward)`,
      [
        randomUUID(),
        rule.code,
        rule.title,
        rule.description,
        rule.target,
        rule.category,
        rule.tier,
        rule.icon,
        rule.coinReward,
        rule.xpReward,
      ]
    );
  }
}

async function updateUserStatsAfterGame(userId, result) {
  const isAi = result.mode === 'ai';
  const won = typeof result.isWinner === 'boolean'
    ? result.isWinner
    : (isAi
        ? Number(result.correctAnswers || 0) >= 6
        : (result.rank === 1 && ((result.totalPlayers || 1) > 1 ? true : Number(result.correctAnswers || 0) >= 6)));

  // Aggregate verified stats directly from game_scores and user_match_history to ensure 100% real data
  const gsRes = await query(
    `SELECT 
       COUNT(DISTINCT gs.game_id) AS games_played,
       COALESCE(SUM(gs.score), 0) AS total_score,
       COALESCE(SUM(gs.correct_answers), 0) AS correct_answers,
       COALESCE(SUM(gs.fast_answers), 0) AS fast_answers
     FROM game_scores gs
     WHERE gs.user_id = $1`,
    [userId]
  );

  const winsRes = await query(
    `SELECT 
       COUNT(*) AS wins,
       SUM(CASE WHEN room_id IS NOT NULL THEN 1 ELSE 0 END) AS room_wins
     FROM user_match_history 
     WHERE user_id = $1 AND (is_winner = 1 OR is_winner = true OR \`rank\` = 1)`,
    [userId]
  );

  const gsStats = gsRes.rows[0] || {};
  const winStats = winsRes.rows[0] || {};

  const gamesPlayed = Math.max(1, Number(gsStats.games_played || 0));
  const totalScore = Number(gsStats.total_score || 0);
  const correctAnswers = Number(gsStats.correct_answers || 0);
  const fastAnswers = Number(gsStats.fast_answers || 0);
  const wins = Number(winStats.wins || (won ? 1 : 0));
  const roomWins = Number(winStats.room_wins || (won && result.mode === 'room' ? 1 : 0));

  await query(
    `INSERT INTO user_stats (user_id, games_played, wins, correct_answers, total_score, fast_answers, room_wins, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON DUPLICATE KEY UPDATE
       games_played = $2,
       wins = $3,
       correct_answers = $4,
       total_score = $5,
       fast_answers = $6,
       room_wins = $7,
       updated_at = NOW()`,
    [userId, gamesPlayed, wins, correctAnswers, totalScore, fastAnswers, roomWins]
  );

  const coinsEarned = typeof result.coins === 'number'
    ? result.coins
    : (won ? (isAi ? 50 : 100) : 10);

  // XP: 50 per game + 100 per win → level up every 1000 XP (balanced, slow progression)
  // Example: 10 games = 500 XP, 5 wins = 500 XP → Level 2 after ~10 games with good wins
  const verifiedXp = (gamesPlayed * 50) + (wins * 100);
  const verifiedLevel = Math.max(1, Math.floor(verifiedXp / 1000) + 1);

  await query(
    `UPDATE users
     SET xp = $2,
         coins = coins + $3,
         level = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, verifiedXp, coinsEarned, verifiedLevel]
  );

  await recalculateAchievements(userId);
}

async function recalculateAchievements(userId) {
  await ensureAchievementDefinitions();
  const { rows } = await query('SELECT * FROM user_stats WHERE user_id = $1', [userId]);
  const stats = rows[0] || {};

  // Auxiliary metrics
  const aiRes = await query(
    'SELECT COALESCE(MAX(unlocked_level), 1) AS max_level FROM user_ai_progress WHERE user_id = $1',
    [userId]
  ).catch(() => ({ rows: [{ max_level: 1 }] }));
  const aiMaxLevel = Number(aiRes.rows[0]?.max_level || 1);

  const tournRes = await query(
    `SELECT COALESCE(MAX(score), 0) AS max_tourn_score 
     FROM game_scores gs
     JOIN games g ON g.id = gs.game_id
     WHERE gs.user_id = $1 AND g.mode = 'tournament'`,
    [userId]
  ).catch(() => ({ rows: [{ max_tourn_score: 0 }] }));
  const maxTournScore = Number(tournRes.rows[0]?.max_tourn_score || 0);

  const userRes = await query(
    'SELECT level, xp, coins FROM users WHERE id = $1',
    [userId]
  ).catch(() => ({ rows: [{ level: 1 }] }));
  const userLevel = Number(userRes.rows[0]?.level || 1);

  for (const rule of achievementRules) {
    let currentVal = 0;
    if (rule.metric === 'ai_levels') {
      currentVal = aiMaxLevel;
    } else if (rule.metric === 'tournament_score') {
      currentVal = maxTournScore;
    } else if (rule.metric === 'player_level') {
      currentVal = userLevel;
    } else {
      currentVal = Number(stats[rule.metric] || 0);
    }

    const progress = Math.min(currentVal, rule.target);
    const completedAt = progress >= rule.target ? new Date() : null;

    await query(
      `INSERT INTO user_achievements (user_id, achievement_id, progress_value, completed_at)
       SELECT $1, id, $2, $3 FROM achievements WHERE code = $4
       ON DUPLICATE KEY UPDATE
         progress_value = VALUES(progress_value),
         completed_at = COALESCE(user_achievements.completed_at, VALUES(completed_at)),
         updated_at = NOW()`,
      [userId, progress, completedAt, rule.code]
    );
  }
}

async function getUserAchievements(userId) {
  await recalculateAchievements(userId);

  const { rows } = await query(
    `SELECT 
       a.id,
       a.code,
       a.title,
       a.description,
       COALESCE(a.category, 'general') AS category,
       COALESCE(a.tier, 'bronze') AS tier,
       COALESCE(a.icon, 'Award') AS icon,
       a.target_value,
       COALESCE(a.coin_reward, 50) AS coin_reward,
       COALESCE(a.xp_reward, 25) AS xp_reward,
       COALESCE(ua.progress_value, 0) AS progress_value,
       ua.completed_at,
       ua.claimed_at,
       CASE WHEN COALESCE(ua.progress_value, 0) >= a.target_value THEN 1 ELSE 0 END AS is_unlocked,
       CASE WHEN ua.claimed_at IS NOT NULL THEN 1 ELSE 0 END AS is_claimed
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
     ORDER BY 
       CASE a.tier 
         WHEN 'diamond' THEN 1 
         WHEN 'gold' THEN 2 
         WHEN 'silver' THEN 3 
         ELSE 4 
       END, 
       a.target_value ASC`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    category: r.category,
    tier: r.tier,
    icon: r.icon,
    target_value: Number(r.target_value),
    coin_reward: Number(r.coin_reward),
    xp_reward: Number(r.xp_reward),
    progress_value: Number(r.progress_value),
    completed_at: r.completed_at,
    claimed_at: r.claimed_at,
    is_unlocked: Boolean(r.is_unlocked),
    is_claimed: Boolean(r.is_claimed),
  }));
}

async function claimAchievement(userId, achievementCode) {
  if (!achievementCode) {
    throw new Error('Achievement code is required');
  }

  const { rows: achRows } = await query(
    `SELECT 
       a.id,
       a.code,
       a.title,
       a.coin_reward,
       a.xp_reward,
       a.target_value,
       COALESCE(ua.progress_value, 0) AS progress_value,
       ua.completed_at,
       ua.claimed_at
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
     WHERE a.code = $2`,
    [userId, achievementCode]
  );

  const achievement = achRows[0];
  if (!achievement) {
    throw new Error('Achievement not found');
  }

  if (Number(achievement.progress_value) < Number(achievement.target_value)) {
    throw new Error('Achievement is not unlocked yet');
  }

  if (achievement.claimed_at) {
    throw new Error('Achievement reward has already been claimed');
  }

  const { rows: userRows } = await query(
    'SELECT coins, xp, level FROM users WHERE id = $1',
    [userId]
  );
  const user = userRows[0] || { coins: 0, xp: 0, level: 1 };

  const coinReward = Number(achievement.coin_reward || 50);
  const xpReward = Number(achievement.xp_reward || 25);
  const newCoins = Number(user.coins || 0) + coinReward;
  const newXp = Number(user.xp || 0) + xpReward;
  const newLevel = Math.max(1, Math.floor(newXp / 500) + 1);

  // Update user's coin and XP balance
  await query(
    `UPDATE users 
     SET coins = $2, xp = $3, level = $4, updated_at = NOW() 
     WHERE id = $1`,
    [userId, newCoins, newXp, newLevel]
  );

  // Record wallet transaction
  const txId = randomUUID();
  await query(
    `INSERT INTO wallet_transactions (id, user_id, amount, balance_after, reason, reference_type, reference_id, created_at)
     VALUES ($1, $2, $3, $4, 'achievement_reward', 'achievement', $5, NOW())`,
    [txId, userId, coinReward, newCoins, achievement.id]
  ).catch(() => undefined);

  // Mark achievement as claimed
  await query(
    `UPDATE user_achievements 
     SET claimed_at = NOW(), 
         completed_at = COALESCE(completed_at, NOW()), 
         updated_at = NOW()
     WHERE user_id = $1 AND achievement_id = $2`,
    [userId, achievement.id]
  );

  return {
    claimed: true,
    code: achievement.code,
    title: achievement.title,
    coinReward,
    xpReward,
    newBalance: newCoins,
    newXp,
    newLevel,
  };
}

module.exports = {
  updateUserStatsAfterGame,
  recalculateAchievements,
  ensureAchievementDefinitions,
  getUserAchievements,
  claimAchievement,
};
