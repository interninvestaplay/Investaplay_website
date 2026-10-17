const { randomUUID } = require('crypto');
const { query, connect } = require('../db/pool');
const { ensureInviteCode } = require('./invite.service');
const { applyWalletTransaction } = require('./wallet.service');
const { savePushToken } = require('./notification.service');
const { getAiBestScore, getOverallAiBestScore } = require('./game.service');
const { recalculateAchievements } = require('./achievement.service');

const dailyStreakRewards = [
  { day: 1, coins: 50, xp: 25, title: 'Day 1 Starter' },
  { day: 2, coins: 100, xp: 50, title: 'Day 2 Streak' },
  { day: 3, coins: 150, xp: 75, title: 'Day 3 Flame' },
  { day: 4, coins: 200, xp: 100, title: 'Day 4 Momentum' },
  { day: 5, coins: 300, xp: 150, title: 'Day 5 Power' },
  { day: 6, coins: 450, xp: 200, title: 'Day 6 Champion' },
  { day: 7, coins: 750, xp: 350, title: 'Day 7 MEGA REWARD' },
];

/**
 * Global player statistics across the entire database.
 * Business Policy:
 * - Excludes admin ('admin') and AI system accounts ('ai') from player counts.
 * - Counts active players by status definition (status = 'active' OR status IS NULL).
 * - Soft-deleted accounts (deleted_at IS NOT NULL) are excluded per standard platform policy.
 * - Double-counting coins from joins is prevented by aggregating directly from the users table.
 */
async function getGlobalPlayerStats() {
  const result = await query(
    `SELECT
       COUNT(CASE WHEN (role = 'player' OR role IS NULL) THEN 1 END) AS total_players,
       COUNT(CASE WHEN (role = 'player' OR role IS NULL) AND (status = 'active' OR status IS NULL) THEN 1 END) AS active_players,
       COUNT(CASE WHEN (role = 'player' OR role IS NULL) AND is_guest = TRUE THEN 1 END) AS guest_players,
       COALESCE(SUM(CASE WHEN (role = 'player' OR role IS NULL) THEN coins ELSE 0 END), 0) AS total_coins
     FROM users
     WHERE deleted_at IS NULL`
  );

  const row = result.rows[0] || {};
  return {
    totalPlayers: Number(row.total_players || 0),
    activePlayers: Number(row.active_players || 0),
    guestPlayers: Number(row.guest_players || 0),
    totalCoins: Number(row.total_coins || 0),
  };
}

async function getSystemStats() {
  const [usersCount, questionsCount, categoriesCount, tournamentsCount, gamesCount, playerStats] = await Promise.all([
    query('SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL'),
    query('SELECT COUNT(*) AS total FROM questions'),
    query('SELECT COUNT(DISTINCT category) AS total FROM questions'),
    query('SELECT COUNT(*) AS total FROM tournaments'),
    query('SELECT COUNT(*) AS total FROM games'),
    getGlobalPlayerStats(),
  ]);

  const recentUsers = await query(
    'SELECT id, username, email, role, coins, xp, level, is_guest, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5'
  );

  const playerActivity = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS count
     FROM users WHERE deleted_at IS NULL AND created_at >= UTC_DATE() - INTERVAL 29 DAY
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY date`
  );

  return {
    totalUsers: Number(usersCount.rows[0]?.total || 0),
    totalQuestions: Number(questionsCount.rows[0]?.total || 0),
    totalCategories: Number(categoriesCount.rows[0]?.total || 0),
    totalTournaments: Number(tournamentsCount.rows[0]?.total || 0),
    totalGames: Number(gamesCount.rows[0]?.total || 0),
    recentUsers: recentUsers.rows,
    playerActivity: playerActivity.rows.map(row => ({ date: row.date, count: Number(row.count) })),
    totalPlayers: playerStats.totalPlayers,
    activePlayers: playerStats.activePlayers,
    guestPlayers: playerStats.guestPlayers,
    totalCoins: playerStats.totalCoins,
    playerStats,
  };
}

async function listUsersForAdmin({ search, status, accountType, role, limit = 30, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const params = [];
  const where = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  const cleanStatus = String(status || 'all').toLowerCase();

  // Deleted users are excluded unless the administrator explicitly requests them.
  where.push(cleanStatus === 'deleted' ? 'u.deleted_at IS NOT NULL' : 'u.deleted_at IS NULL');

  const cleanSearch = String(search || '').trim().slice(0, 120);
  if (cleanSearch) {
    const escaped = cleanSearch.toLowerCase().replace(/[\\%_]/g, '\\$&');
    const placeholder = add(`%${escaped}%`);
    where.push(`(LOWER(u.username) LIKE ${placeholder} ESCAPE '\\\\' OR LOWER(u.email) LIKE ${placeholder} ESCAPE '\\\\' OR LOWER(u.display_name) LIKE ${placeholder} ESCAPE '\\\\')`);
  }

  if (['active', 'suspended', 'banned'].includes(cleanStatus)) {
    where.push(cleanStatus === 'active' ? "(u.status = 'active' OR u.status IS NULL)" : `u.status = ${add(cleanStatus)}`);
  }

  const cleanRole = String(role || 'all').toLowerCase();
  if (['player', 'admin', 'ai'].includes(cleanRole)) where.push(`u.role = ${add(cleanRole)}`);

  const cleanType = String(accountType || 'all').toLowerCase();
  if (cleanType === 'guest') where.push('u.is_guest = TRUE');
  if (cleanType === 'google') where.push("EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider = 'google')");
  if (cleanType === 'password') where.push("EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider = 'password')");
  if (['legacy', 'unknown'].includes(cleanType)) where.push('u.is_guest = FALSE AND NOT EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id)');

  const filterSql = `WHERE ${where.join(' AND ')}`;
  const accountTypeSql = `CASE
    WHEN u.is_guest THEN 'guest'
    WHEN EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider = 'google') THEN 'google'
    WHEN EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id AND ai.provider = 'password') THEN 'password'
    ELSE 'legacy'
  END AS account_type`;
  const paginationParams = [...params, safeLimit, safeOffset];
  const [list, count] = await Promise.all([
    query(
      `SELECT u.id, u.username, u.email, u.display_name, u.role, u.coins, u.xp, u.level, u.is_guest,
              u.equipped_avatar, u.status, u.status_reason, u.last_active_at, u.created_at, ${accountTypeSql}
       FROM users u ${filterSql}
       ORDER BY u.created_at DESC, u.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      paginationParams
    ),
    query(`SELECT COUNT(*) AS total FROM users u ${filterSql}`, params),
  ]);
  const total = Number(count.rows[0]?.total || 0);
  return { users: list.rows, total, limit: safeLimit, offset: safeOffset, hasMore: safeOffset + list.rows.length < total };
}

async function updateUserStatusAdmin(userId, { status, reason }) {
  const cleanStatus = String(status || '').toLowerCase().trim();
  if (!['active', 'suspended', 'banned'].includes(cleanStatus)) {
    const error = new Error('Invalid status. Must be active, suspended, or banned');
    error.status = 400;
    throw error;
  }

  const existing = await query('SELECT id, role, token_version FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!existing.rows[0]) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (existing.rows[0].role === 'admin') {
    const error = new Error('Cannot change status of an administrator account');
    error.status = 403;
    throw error;
  }

  const tokenVersionBump = (cleanStatus === 'suspended' || cleanStatus === 'banned') ? 1 : 0;

  await query(
    `UPDATE users 
     SET status = $1, 
         status_reason = $2, 
         token_version = token_version + $3,
         updated_at = NOW() 
     WHERE id = $4`,
    [cleanStatus, reason ? String(reason).trim().slice(0, 255) : null, tokenVersionBump, userId]
  );

  if (cleanStatus === 'suspended' || cleanStatus === 'banned') {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [userId]).catch(() => {});
  }

  const updated = await query(
    'SELECT id, username, email, display_name, role, coins, xp, level, is_guest, equipped_avatar, status, status_reason, last_active_at, created_at FROM users WHERE id = $1',
    [userId]
  );
  return updated.rows[0];
}

async function getPlayerDetailsAdmin(userId) {
  if (!userId) {
    const error = new Error('userId is required');
    error.status = 400;
    throw error;
  }

  const userRes = await query(
    `SELECT u.id, u.username, u.email, u.display_name, u.role, u.level, u.xp, u.coins, u.is_guest,
            u.equipped_avatar, u.avatar_url, COALESCE(u.status, 'active') AS status, u.status_reason,
            COALESCE(u.last_active_at, u.updated_at, u.created_at) AS last_active_at, u.created_at,
            COALESCE(si.name, 'Adventure Scholar') AS equipped_avatar_name,
            COALESCE(si.badge_text, 'Common') AS equipped_avatar_badge,
            si.preview_asset AS equipped_avatar_asset
     FROM users u
     LEFT JOIN shop_items si ON si.id = u.equipped_avatar AND si.category = 'avatar'
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );

  if (!userRes.rows[0]) {
    const error = new Error('Player not found');
    error.status = 404;
    throw error;
  }

  const player = userRes.rows[0];

  const statsRes = await query(
    `SELECT 
       COALESCE(us.games_played, (SELECT COUNT(DISTINCT game_id) FROM game_scores WHERE user_id = $1), 0) AS games_played,
       COALESCE(us.wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = $1 AND is_winner = 1), 0) AS wins,
       COALESCE(us.correct_answers, (SELECT COALESCE(SUM(correct_answers), 0) FROM game_scores WHERE user_id = $1), 0) AS correct_answers,
       COALESCE(us.total_score, (SELECT COALESCE(SUM(score), 0) FROM game_scores WHERE user_id = $1), 0) AS total_score,
       COALESCE(us.fast_answers, (SELECT COALESCE(SUM(fast_answers), 0) FROM game_scores WHERE user_id = $1), 0) AS fast_answers,
       COALESCE(us.room_wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = $1 AND is_winner = 1 AND room_id IS NOT NULL), 0) AS room_wins,
       COALESCE((SELECT MAX(score) FROM game_scores WHERE user_id = $1), 0) AS best_score,
       COALESCE((SELECT AVG(score) FROM game_scores WHERE user_id = $1), 0) AS avg_score,
       COALESCE((SELECT SUM(incorrect_answers) FROM game_scores WHERE user_id = $1), 0) AS incorrect_answers,
       COALESCE((SELECT COUNT(*) FROM tournament_players WHERE user_id = $1), 0) AS tournaments_joined
     FROM users u
     LEFT JOIN user_stats us ON us.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const s = statsRes.rows[0] || {};
  const gamesPlayed = Number(s.games_played || 0);
  const wins = Number(s.wins || 0);
  const losses = Math.max(0, gamesPlayed - wins);
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  const correctAnswers = Number(s.correct_answers || 0);
  const incorrectAnswers = Number(s.incorrect_answers || 0);
  const totalAnswers = correctAnswers + incorrectAnswers;
  const accuracyPercentage = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

  const [aiProgressRes, recentMatchesRes, transactionsRes, tournamentHistoryRes] = await Promise.all([
    query('SELECT bot_name, unlocked_level FROM user_ai_progress WHERE user_id = $1 ORDER BY bot_name ASC', [userId]),
    query(
      `SELECT id, game_id, category, difficulty, score, \`rank\`, is_winner, correct_answers, accuracy_percentage, created_at
       FROM user_match_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    ),
    query(
      `SELECT id, amount, balance_after, reason, reference_type, reference_id, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    ),
    query(
      `SELECT t.id, t.title, t.category, t.difficulty, t.status, t.entry_fee, t.prize_pool, t.starts_at,
              tp.joined_at, tp.has_attempted, tp.completed_at,
              gs.score, gs.rank, gs.correct_answers,
              COALESCE(wt.amount, 0) AS reward_coins
       FROM tournament_players tp
       JOIN tournaments t ON t.id = tp.tournament_id
       LEFT JOIN game_scores gs ON gs.game_id = t.active_game_id AND gs.user_id = tp.user_id
       LEFT JOIN wallet_transactions wt ON wt.user_id = tp.user_id AND wt.reference_id = t.id AND wt.amount > 0
       WHERE tp.user_id = $1
       ORDER BY tp.joined_at DESC
       LIMIT 50`,
      [userId]
    ),
  ]);

  const currentLevel = Number(player.level || 1);
  const currentXp = Number(player.xp || 0);
  const nextLevelXp = Math.max(100, currentLevel * 100);
  const xpProgressPercent = Math.min(100, Math.max(0, Math.round((currentXp / nextLevelXp) * 100)));

  const recentActivities = [];

  for (const m of (recentMatchesRes.rows || [])) {
    recentActivities.push({
      id: `match_${m.id}`,
      type: 'quiz',
      title: m.is_winner ? 'Won a Quiz' : 'Played a Quiz',
      subtitle: m.category ? `${m.category}` : 'General Knowledge',
      timestamp: m.created_at,
    });
  }

  for (const t of (tournamentHistoryRes.rows || []).slice(0, 5)) {
    recentActivities.push({
      id: `tourn_${t.id}_${t.joined_at}`,
      type: 'tournament',
      title: 'Joined Tournament',
      subtitle: t.title || 'Tournament Challenge',
      timestamp: t.joined_at,
    });
  }

  for (const tx of (transactionsRes.rows || []).slice(0, 5)) {
    const amountVal = Number(tx.amount || 0);
    const isGain = amountVal > 0;
    let formattedReason = tx.reason;
    if (tx.reason === 'admin_adjustment' || tx.reason === 'admin_gift') formattedReason = 'Admin Bonus';
    else if (tx.reason === 'tournament_reward') formattedReason = 'Tournament Reward';
    else if (tx.reason === 'daily_streak' || tx.reason === 'daily_bonus') formattedReason = 'Daily Bonus';
    else if (tx.reason === 'match_reward') formattedReason = 'Match Reward';
    else if (tx.reason === 'shop_purchase') formattedReason = 'Shop Purchase';
    else if (tx.reason) formattedReason = String(tx.reason).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    recentActivities.push({
      id: `tx_${tx.id}`,
      type: 'coin',
      title: isGain ? `Won ${amountVal.toLocaleString()} Coins` : `Spent ${Math.abs(amountVal).toLocaleString()} Coins`,
      subtitle: formattedReason,
      timestamp: tx.created_at,
    });
  }

  recentActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const topActivities = recentActivities.slice(0, 10);

  return {
    player: {
      ...player,
      status: player.status || 'active',
      equipped_avatar_name: player.equipped_avatar_name || 'Adventure Scholar',
      equipped_avatar_badge: player.equipped_avatar_badge || 'Common',
    },
    overview: {
      level: currentLevel,
      xp: currentXp,
      nextLevelXp,
      xpProgressPercent,
      coins: Number(player.coins || 0),
      recentActivity: topActivities,
    },
    gameProgress: {
      level: currentLevel,
      xp: currentXp,
      nextLevelXp,
      xpProgressPercent,
      quizzesCompleted: gamesPlayed,
      wins,
      losses,
      winRate,
      aiProgress: aiProgressRes.rows || [],
      recentMatches: recentMatchesRes.rows || [],
    },
    statistics: {
      gamesPlayed,
      totalScore: Number(s.total_score || 0),
      avgScore: Number(Number(s.avg_score || 0).toFixed(1)),
      bestScore: Number(s.best_score || 0),
      correctAnswers,
      incorrectAnswers,
      accuracyPercentage,
      fastAnswers: Number(s.fast_answers || 0),
      roomWins: Number(s.room_wins || 0),
      tournamentsJoined: Number(s.tournaments_joined || 0),
    },
    transactions: (transactionsRes.rows || []).map(tx => ({
      id: tx.id,
      amount: Number(tx.amount),
      type: Number(tx.amount) >= 0 ? 'Credit' : 'Debit',
      balance_after: Number(tx.balance_after),
      reason: tx.reason,
      reference_type: tx.reference_type,
      reference_id: tx.reference_id,
      created_at: tx.created_at,
    })),
    tournamentHistory: (tournamentHistoryRes.rows || []).map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      difficulty: t.difficulty,
      status: t.status,
      entry_fee: Number(t.entry_fee || 0),
      prize_pool: Number(t.prize_pool || 0),
      joined_at: t.joined_at,
      has_attempted: Boolean(t.has_attempted),
      completed_at: t.completed_at,
      rank: t.rank !== null ? Number(t.rank) : null,
      score: t.score !== null ? Number(t.score) : 0,
      reward_coins: Number(t.reward_coins || 0),
    })),
  };
}

async function updateUserAdmin(userId, input) {
  const existing = await query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (!existing.rows[0]) { const error = new Error('User not found'); error.status = 404; throw error; }
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if (Object.prototype.hasOwnProperty.call(input, 'displayName')) add('display_name', String(input.displayName || '').trim().slice(0, 80));
  if (Object.prototype.hasOwnProperty.call(input, 'level')) add('level', Math.max(1, Number(input.level) || 1));
  if (Object.prototype.hasOwnProperty.call(input, 'xp')) add('xp', Math.max(0, Number(input.xp) || 0));
  if (Object.prototype.hasOwnProperty.call(input, 'equippedAvatar')) {
    const avatarId = String(input.equippedAvatar || 'avatar_01');
    const avatar = await query(`SELECT id, preview_asset FROM shop_items WHERE id = $1 AND category = 'avatar' AND is_active = TRUE`, [avatarId]);
    if (!avatar.rows[0]) { const error = new Error('Selected avatar is not available'); error.status = 400; throw error; }
    add('equipped_avatar', avatarId);
    add('avatar_url', avatar.rows[0].preview_asset || null);
  }
  if (!fields.length) { const error = new Error('No profile changes supplied'); error.status = 400; throw error; }
  values.push(userId);
  await query(`UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
  const result = await query('SELECT id, username, email, display_name, role, coins, xp, level, is_guest, equipped_avatar, created_at FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

async function adjustCoinsAdmin({ userId, amount, reason }) {
  if (!userId || amount === undefined || isNaN(Number(amount))) {
    const error = new Error('userId and valid numeric amount are required');
    error.status = 400;
    throw error;
  }

  const client = await connect();
  try {
    await client.query('BEGIN');
    const result = await applyWalletTransaction({
      client,
      userId,
      amount: Number(amount),
      reason: reason || 'admin_adjustment',
      referenceType: 'admin_action',
      referenceId: randomUUID(),
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getUserProfile(userId, fallbackUser) {
  const inviteCode = await ensureInviteCode(userId);
  const userRes = await query(
    'SELECT id, username, display_name, email, role, level, xp, coins, is_guest, avatar_url, equipped_avatar, equipped_frame, equipped_title, lifeline_fifty_fifty, lifeline_skip, lifeline_time_freeze FROM users WHERE id = $1',
    [userId]
  );
  const freshUser = userRes.rows[0] || fallbackUser;

  const stats = await query(
    `SELECT 
       COALESCE(us.games_played, (SELECT COUNT(DISTINCT game_id) FROM game_scores WHERE user_id = $1), 0) AS games_played,
       COALESCE(us.wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = $1 AND is_winner = 1), 0) AS wins,
       COALESCE(us.correct_answers, (SELECT COALESCE(SUM(correct_answers), 0) FROM game_scores WHERE user_id = $1), 0) AS correct_answers,
       COALESCE(us.total_score, (SELECT COALESCE(SUM(score), 0) FROM game_scores WHERE user_id = $1), 0) AS total_score,
       COALESCE(us.fast_answers, (SELECT COALESCE(SUM(fast_answers), 0) FROM game_scores WHERE user_id = $1), 0) AS fast_answers,
       COALESCE(us.room_wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = $1 AND is_winner = 1 AND room_id IS NOT NULL), 0) AS room_wins,
       COALESCE((SELECT MAX(score) FROM game_scores WHERE user_id = $1), 0) AS best_score,
       COALESCE((SELECT AVG(score) FROM game_scores WHERE user_id = $1), 0) AS avg_score
     FROM users u
     LEFT JOIN user_stats us ON us.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  const achievements = await query(
    `SELECT 
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
     LEFT JOIN user_achievements ua
       ON ua.achievement_id = a.id AND ua.user_id = $1
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

  const history = await query(
    `SELECT g.id AS game_id, g.mode, g.ended_at, gs.score, gs.correct_answers
     FROM game_scores gs
     JOIN games g ON g.id = gs.game_id
     WHERE gs.user_id = $1
     ORDER BY COALESCE(g.ended_at, g.created_at) DESC
     LIMIT 20`,
    [userId]
  );

  const createdRooms = await query(
    `SELECT r.id AS room_id, r.room_name, r.code, r.category, r.difficulty, r.max_players, r.status, r.created_at
     FROM rooms r
     WHERE r.host_user_id = $1
       AND (r.mode IS NULL OR r.mode != 'ai')
     ORDER BY r.created_at DESC
     LIMIT 20`,
    [userId]
  );

  return {
    user: { ...freshUser, invite_code: inviteCode },
    stats: stats.rows[0] || null,
    achievements: achievements.rows,
    history: history.rows,
    rooms: createdRooms.rows,
  };
}

const CLAIM_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const STREAK_RESET_MS = 48 * 60 * 60 * 1000;

async function getDailyBonusStatus(userId) {
  const [existingRes, statsRes, userRes] = await Promise.all([
    query(
      `SELECT balance_after, created_at
       FROM wallet_transactions
       WHERE user_id = $1
         AND reason = 'daily_bonus'
         AND reference_type = 'daily_bonus'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    ),
    query(
      'SELECT daily_streak FROM user_stats WHERE user_id = $1',
      [userId]
    ),
    query(
      'SELECT coins, xp, level FROM users WHERE id = $1',
      [userId]
    ),
  ]);

  const existing = existingRes.rows[0];
  const user = userRes.rows[0] || {};
  const currentBalance = Number(user.coins || 0);
  const storedStreak = Number(statsRes.rows[0]?.daily_streak || 0);

  if (!existing) {
    const reward = dailyStreakRewards[0];
    return {
      available: true,
      canClaim: true,
      claimedToday: false,
      currentDay: 1,
      currentStreak: 0,
      remainingSeconds: 0,
      balance: currentBalance,
      bonusCoins: reward.coins,
      bonusXp: reward.xp,
      schedule: dailyStreakRewards,
    };
  }

  const claimedAt = new Date(existing.created_at).getTime();
  const timeSinceClaim = Date.now() - claimedAt;

  if (timeSinceClaim < CLAIM_COOLDOWN_MS) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((claimedAt + CLAIM_COOLDOWN_MS - Date.now()) / 1000)
    );
    const claimedDay = storedStreak > 0 ? ((storedStreak - 1) % 7) + 1 : 1;
    const reward = dailyStreakRewards[claimedDay - 1] || dailyStreakRewards[0];

    return {
      available: false,
      canClaim: false,
      claimedToday: true,
      currentDay: claimedDay,
      currentStreak: storedStreak,
      remainingSeconds,
      balance: currentBalance,
      bonusCoins: reward.coins,
      bonusXp: reward.xp,
      schedule: dailyStreakRewards,
    };
  }

  if (timeSinceClaim <= STREAK_RESET_MS) {
    const nextDay = (storedStreak % 7) + 1;
    const reward = dailyStreakRewards[nextDay - 1] || dailyStreakRewards[0];

    return {
      available: true,
      canClaim: true,
      claimedToday: false,
      currentDay: nextDay,
      currentStreak: storedStreak,
      remainingSeconds: 0,
      balance: currentBalance,
      bonusCoins: reward.coins,
      bonusXp: reward.xp,
      schedule: dailyStreakRewards,
    };
  }

  // Missed window (> 48 hours) -> Streak reset to Day 1, can recover previous streak
  const reward = dailyStreakRewards[0];
  const missedDay = storedStreak > 0 ? ((storedStreak - 1) % 7) + 1 : 1;
  return {
    available: true,
    canClaim: true,
    claimedToday: false,
    currentDay: 1,
    currentStreak: 0,
    remainingSeconds: 0,
    balance: currentBalance,
    bonusCoins: reward.coins,
    bonusXp: reward.xp,
    schedule: dailyStreakRewards,
    canRecoverMissed: storedStreak > 0,
    missedStreak: storedStreak,
    missedDay,
    recoveryCost: 50,
  };
}

async function claimDailyBonus(userId) {
  const [existingRes, statsRes] = await Promise.all([
    query(
      `SELECT balance_after, created_at
       FROM wallet_transactions
       WHERE user_id = $1
         AND reason = 'daily_bonus'
         AND reference_type = 'daily_bonus'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    ),
    query(
      'SELECT daily_streak FROM user_stats WHERE user_id = $1',
      [userId]
    ),
  ]);

  const existing = existingRes.rows[0];
  const storedStreak = Number(statsRes.rows[0]?.daily_streak || 0);

  if (existing) {
    const claimedAt = new Date(existing.created_at).getTime();
    const timeSinceClaim = Date.now() - claimedAt;

    if (timeSinceClaim < CLAIM_COOLDOWN_MS) {
      const remainingSeconds = Math.max(
        0,
        Math.ceil((claimedAt + CLAIM_COOLDOWN_MS - Date.now()) / 1000)
      );
      const claimedDay = storedStreak > 0 ? ((storedStreak - 1) % 7) + 1 : 1;
      const reward = dailyStreakRewards[claimedDay - 1] || dailyStreakRewards[0];

      return {
        claimed: false,
        alreadyClaimed: true,
        bonusCoins: 0,
        bonusXp: 0,
        balance: Number(existing.balance_after),
        remainingSeconds,
        currentDay: claimedDay,
        currentStreak: storedStreak,
        schedule: dailyStreakRewards,
      };
    }
  }

  let newStreak = 1;
  if (existing) {
    const claimedAt = new Date(existing.created_at).getTime();
    const timeSinceClaim = Date.now() - claimedAt;
    if (timeSinceClaim <= STREAK_RESET_MS) {
      newStreak = storedStreak + 1;
    } else {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  const currentDay = ((newStreak - 1) % 7) + 1;
  const reward = dailyStreakRewards[currentDay - 1] || dailyStreakRewards[0];

  const transaction = await applyWalletTransaction({
    client: {
      query: (...args) => query(...args),
    },
    userId,
    amount: reward.coins,
    reason: 'daily_bonus',
    referenceType: 'daily_bonus',
    referenceId: randomUUID(),
  });

  const userRes = await query('SELECT xp, level FROM users WHERE id = $1', [userId]);
  const currentXp = Number(userRes.rows[0]?.xp || 0);
  const newXp = currentXp + reward.xp;
  const newLevel = Math.max(1, Math.floor(newXp / 500) + 1);

  await query(
    'UPDATE users SET xp = $1, level = $2, updated_at = NOW() WHERE id = $3',
    [newXp, newLevel, userId]
  );

  await query(
    `INSERT INTO user_stats (user_id, daily_streak, updated_at)
     VALUES ($1, $2, NOW())
     ON DUPLICATE KEY UPDATE
       daily_streak = $2,
       updated_at = NOW()`,
    [userId, newStreak]
  );

  try {
    await recalculateAchievements(userId);
  } catch (err) {
    console.error('Failed to recalculate achievements for streak:', err);
  }

  return {
    claimed: transaction.applied,
    alreadyClaimed: false,
    bonusCoins: reward.coins,
    bonusXp: reward.xp,
    balance: Number(transaction.balanceAfter),
    remainingSeconds: Math.round(CLAIM_COOLDOWN_MS / 1000),
    currentDay,
    currentStreak: newStreak,
    newXp,
    newLevel,
    schedule: dailyStreakRewards,
  };
}

async function recoverDailyStreak(userId, { method = 'coins' } = {}) {
  const [existingRes, statsRes, userRes] = await Promise.all([
    query(
      `SELECT balance_after, created_at
       FROM wallet_transactions
       WHERE user_id = $1
         AND reason = 'daily_bonus'
         AND reference_type = 'daily_bonus'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    ),
    query(
      'SELECT daily_streak FROM user_stats WHERE user_id = $1',
      [userId]
    ),
    query(
      'SELECT coins, xp, level FROM users WHERE id = $1',
      [userId]
    ),
  ]);

  const existing = existingRes.rows[0];
  const storedStreak = Number(statsRes.rows[0]?.daily_streak || 0);
  const user = userRes.rows[0] || {};
  const currentCoins = Number(user.coins || 0);

  if (existing) {
    const claimedAt = new Date(existing.created_at).getTime();
    const timeSinceClaim = Date.now() - claimedAt;
    if (timeSinceClaim < CLAIM_COOLDOWN_MS) {
      const error = new Error('Daily bonus already claimed for today');
      error.status = 400;
      throw error;
    }
  }

  const RECOVERY_COST = 50;

  if (method === 'coins') {
    if (currentCoins < RECOVERY_COST) {
      const error = new Error('Not enough coins to recover streak');
      error.status = 400;
      throw error;
    }
    await applyWalletTransaction({
      client: { query: (...args) => query(...args) },
      userId,
      amount: -RECOVERY_COST,
      reason: 'streak_recovery_cost',
      referenceType: 'streak_recovery',
      referenceId: randomUUID(),
    });
  }

  const newStreak = storedStreak + 1;
  const currentDay = ((newStreak - 1) % 7) + 1;
  const reward = dailyStreakRewards[currentDay - 1] || dailyStreakRewards[0];

  const transaction = await applyWalletTransaction({
    client: { query: (...args) => query(...args) },
    userId,
    amount: reward.coins,
    reason: 'daily_bonus',
    referenceType: 'daily_bonus',
    referenceId: randomUUID(),
  });

  const currentXp = Number(user.xp || 0);
  const newXp = currentXp + reward.xp;
  const newLevel = Math.max(1, Math.floor(newXp / 500) + 1);

  await query(
    'UPDATE users SET xp = $1, level = $2, updated_at = NOW() WHERE id = $3',
    [newXp, newLevel, userId]
  );

  await query(
    `INSERT INTO user_stats (user_id, daily_streak, updated_at)
     VALUES ($1, $2, NOW())
     ON DUPLICATE KEY UPDATE
       daily_streak = $2,
       updated_at = NOW()`,
    [userId, newStreak]
  );

  try {
    await recalculateAchievements(userId);
  } catch (err) {
    console.error('Failed to recalculate achievements for recovered streak:', err);
  }

  return {
    success: true,
    claimed: true,
    recovered: true,
    bonusCoins: reward.coins,
    bonusXp: reward.xp,
    balance: Number(transaction.balanceAfter),
    remainingSeconds: Math.round(CLAIM_COOLDOWN_MS / 1000),
    currentDay,
    currentStreak: newStreak,
    newXp,
    newLevel,
    schedule: dailyStreakRewards,
  };
}

async function getStreak(userId) {
  try {
    const datesRes = await query(
      `SELECT DISTINCT play_date FROM (
         SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as play_date FROM user_match_history WHERE user_id = $1
         UNION
         SELECT DATE_FORMAT(answered_at, '%Y-%m-%d') as play_date FROM answers WHERE user_id = $1
         UNION
         SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as play_date FROM wallet_transactions WHERE user_id = $1
         UNION
         SELECT DATE_FORMAT(updated_at, '%Y-%m-%d') as play_date FROM game_scores WHERE user_id = $1
       ) all_dates
       WHERE play_date IS NOT NULL
       ORDER BY play_date DESC
       LIMIT 60`,
      [userId]
    );

    const activeDates = new Set(datesRes.rows.map((r) => String(r.play_date).substring(0, 10)));

    const now = new Date();
    const formatYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatYMD(now);
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayStr = formatYMD(yesterday);

    let currentStreak = 0;
    const playedToday = activeDates.has(todayStr);
    const playedYesterday = activeDates.has(yesterdayStr);

    let checkDate = playedToday ? new Date(now) : (playedYesterday ? new Date(yesterday) : null);

    if (checkDate) {
      let d = new Date(checkDate);
      while (true) {
        const dStr = formatYMD(d);
        if (activeDates.has(dStr)) {
          currentStreak++;
          d.setDate(d.getDate() - 1);
        } else {
          break;
        }
      }
    }

    const streakDays = currentStreak > 0 ? ((currentStreak - 1) % 7) + 1 : (playedToday ? 1 : 1);

    const lastClaim = await query(
      `SELECT created_at FROM wallet_transactions
       WHERE user_id = $1 AND reason = 'weekly_streak_reward'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    let weeklyRewardClaimable = false;
    if (currentStreak >= 7 && playedToday) {
      if (!lastClaim.rows[0]) {
        weeklyRewardClaimable = true;
      } else {
        const daysSinceClaim = (Date.now() - new Date(lastClaim.rows[0].created_at).getTime()) / (1000 * 86400);
        if (daysSinceClaim >= 6) {
          weeklyRewardClaimable = true;
        }
      }
    }

    return {
      currentStreak: Math.max(playedToday ? 1 : 0, currentStreak),
      streakDays: Math.min(7, Math.max(1, streakDays)),
      totalTargetDays: 7,
      percentage: Math.min(100, Math.round((Math.min(7, Math.max(1, streakDays)) / 7) * 100)),
      playedToday,
      weeklyRewardClaimable,
    };
  } catch (err) {
    console.error('Streak calculation error:', err);
    return {
      currentStreak: 1,
      streakDays: 1,
      totalTargetDays: 7,
      percentage: 14,
      playedToday: false,
      weeklyRewardClaimable: false,
    };
  }
}

async function claimWeeklyStreakReward(userId) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    const transaction = await applyWalletTransaction({
      client,
      userId,
      amount: 500,
      reason: 'weekly_streak_reward',
      referenceType: 'streak',
      referenceId: randomUUID(),
    });
    await client.query('COMMIT');

    return {
      claimed: true,
      bonusCoins: 500,
      balance: Number(transaction.balanceAfter),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateProfile(userId, { displayName, avatarUrl }) {
  await query(
    `UPDATE users
     SET display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         updated_at = NOW()
     WHERE id = $1`,
    [userId, displayName || null, avatarUrl || null]
  );
  const updated = await query(
    'SELECT id, username, email, display_name, invite_code, avatar_url, is_guest, xp, level, coins FROM users WHERE id = $1',
    [userId]
  );
  return updated.rows[0];
}

async function registerPushToken(userId, { token, platform }) {
  if (!token) {
    const error = new Error('Push token is required');
    error.status = 400;
    throw error;
  }
  await savePushToken({
    userId,
    token,
    platform,
  });
  return { saved: true };
}

async function searchUsers(userId, term) {
  const cleanTerm = String(term || '').trim();
  if (cleanTerm.length < 3) {
    return [];
  }

  const { rows } = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.level,
            f.id AS friendship_id, f.status AS friendship_status,
            f.requester_id, f.addressee_id
     FROM users u
     LEFT JOIN friendships f
       ON ((f.requester_id = $1 AND f.addressee_id = u.id)
        OR (f.requester_id = u.id AND f.addressee_id = $1))
     WHERE u.id <> $1
       AND u.deleted_at IS NULL
       AND (LOWER(u.username) LIKE LOWER($2)
        OR LOWER(u.display_name) LIKE LOWER($2)
        OR LOWER(REPLACE(u.username, '_', ' ')) LIKE LOWER($2))
     ORDER BY u.display_name ASC
     LIMIT 10`,
    [userId, `%${cleanTerm}%`]
  );

  return rows.map((user) => ({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    level: user.level,
    friendship_id: user.friendship_id || null,
    friendship_status: user.friendship_status || null,
    request_direction: user.friendship_id
      ? user.requester_id === userId
        ? 'outgoing'
        : 'incoming'
      : null,
  }));
}

async function getFriends(userId) {
  // Authoritative DB cleanup: Expire past-due pending challenges
  await query(
    `UPDATE challenges
     SET status = 'expired'
     WHERE status = 'pending'
       AND ends_at IS NOT NULL
       AND ends_at <= NOW()`
  );

  const { rows } = await query(
    `SELECT f.id, f.status, f.created_at, f.requester_id, f.addressee_id,
            u.id AS friend_id, u.username, u.display_name, u.avatar_url, u.level,
            c.id AS active_challenge_id,
            c.status AS active_challenge_status,
            c.challenger_id AS active_challenge_challenger_id,
            c.ends_at AS active_challenge_ends_at
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     LEFT JOIN challenges c ON c.status IN ('pending', 'accepted')
       AND (
         (c.challenger_id = $1 AND c.challenged_id = u.id)
         OR (c.challenger_id = u.id AND c.challenged_id = $1)
       )
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows;
}

async function addFriend(userId, { username, targetId }) {
  const found = targetId
    ? await query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId])
    : await query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL', [username || '']);

  if (!found.rows[0]) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  if (found.rows[0].id === userId) {
    const error = new Error('You cannot add yourself as a friend');
    error.status = 400;
    throw error;
  }

  const existing = await query(
    `SELECT * FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     LIMIT 1`,
    [userId, found.rows[0].id]
  );

  if (existing.rows[0]) {
    return { friendship: existing.rows[0], alreadyExists: true };
  }

  await query(
    `INSERT INTO friendships (id, requester_id, addressee_id, status)
     VALUES ($1, $2, $3, 'pending')`,
    [randomUUID(), userId, found.rows[0].id]
  );

  const { rows } = await query(
    'SELECT * FROM friendships WHERE requester_id = $1 AND addressee_id = $2',
    [userId, found.rows[0].id]
  );
  return { friendship: rows[0], alreadyExists: false };
}

async function respondFriendRequest(userId, friendshipId, action) {
  const cleanAction = String(action || '').toLowerCase();
  const { rows } = await query('SELECT * FROM friendships WHERE id = $1', [friendshipId]);
  const friendship = rows[0];
  if (!friendship) {
    const error = new Error('Friend request not found');
    error.status = 404;
    throw error;
  }

  if (cleanAction === 'accept') {
    if (friendship.addressee_id !== userId || friendship.status !== 'pending') {
      const error = new Error('Only the invited user can accept this request');
      error.status = 403;
      throw error;
    }
    await query(
      `UPDATE friendships
       SET status = 'accepted', updated_at = NOW()
       WHERE id = $1`,
      [friendship.id]
    );
    const updated = await query('SELECT * FROM friendships WHERE id = $1', [friendship.id]);
    return { friendship: updated.rows[0] };
  }

  if (cleanAction === 'decline') {
    if (friendship.addressee_id !== userId || friendship.status !== 'pending') {
      const error = new Error('Only the invited user can decline this request');
      error.status = 403;
      throw error;
    }
    await query('DELETE FROM friendships WHERE id = $1', [friendship.id]);
    return { declined: true };
  }

  const error = new Error('Invalid friend action');
  error.status = 400;
  throw error;
}

module.exports = {
  getSystemStats,
  getGlobalPlayerStats,
  listUsersForAdmin,
  adjustCoinsAdmin,
  updateUserAdmin,
  getUserProfile,
  getDailyBonusStatus,
  claimDailyBonus,
  recoverDailyStreak,
  getStreak,
  claimWeeklyStreakReward,
  updateProfile,
  registerPushToken,
  searchUsers,
  getFriends,
  addFriend,
  respondFriendRequest,
  getPlayerDetailsAdmin,
  updateUserStatusAdmin,
  getAiBestScore,
  getOverallAiBestScore,
  dailyStreakRewards,
};
