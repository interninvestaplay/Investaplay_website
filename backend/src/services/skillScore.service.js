const { query, connect } = require('../db/pool');
const { randomUUID } = require('crypto');

/**
 * Skill Score System
 * Components:
 * - Accuracy (0-500 points): Based on correct answer percentage
 * - Speed (0-300 points): Based on average response time
 * - Consistency (0-150 points): Based on performance variance
 * - Win Rate (0-50 points): Based on win percentage
 * Total base score: 1000
 */

const SKILL_SCORE_WEIGHTS = {
  accuracy: 0.5,
  speed: 0.3,
  consistency: 0.15,
  winRate: 0.05,
};

async function calculateAccuracyComponent(userId) {
  const { rows } = await query(
    `SELECT AVG(accuracy_percentage) as avg_accuracy
     FROM (
       SELECT accuracy_percentage
       FROM user_match_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20
     ) recent`,
    [userId]
  );

  const avgAccuracy = Number(rows[0]?.avg_accuracy);
  if (isNaN(avgAccuracy)) return 500; // Default for new players

  const accuracy = Math.min(100, Math.max(0, avgAccuracy)) / 100;
  return Math.round(accuracy * 500); // Max 500 points
}

async function calculateSpeedComponent(userId) {
  const { rows } = await query(
    `SELECT AVG(avg_response_time_ms) as avg_response_time
     FROM (
       SELECT avg_response_time_ms
       FROM user_match_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20
     ) recent`,
    [userId]
  );

  const avgTime = Number(rows[0]?.avg_response_time || 15000);
  
  // Speed scoring: faster = higher score
  // Reference: 5s = 300 points, 30s = 0 points (linear)
  const speedScore = Math.max(0, Math.round((30000 - avgTime) / 100));
  return Math.min(300, speedScore); // Max 300 points
}

async function calculateConsistencyComponent(userId) {
  const { rows } = await query(
    `SELECT 
       AVG(accuracy_percentage) as avg_accuracy,
       STDDEV(accuracy_percentage) as accuracy_stddev
     FROM (
       SELECT accuracy_percentage, avg_response_time_ms
       FROM user_match_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20
     ) recent`,
    [userId]
  );

  const stdDev = Number(rows[0]?.accuracy_stddev || 50);
  
  // Consistency scoring: lower variance = higher score
  // High variance (50+) = 0 points, no variance = 150 points (exponential)
  const consistencyScore = Math.round(150 * Math.exp(-stdDev / 30));
  return Math.min(150, consistencyScore); // Max 150 points
}

async function calculateWinRateComponent(userId) {
  const { rows } = await query(
    `SELECT 
       COUNT(*) as total_matches,
       SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as win_count
     FROM (
       SELECT is_winner
       FROM user_match_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20
     ) recent`,
    [userId]
  );

  const total = Number(rows[0]?.total_matches || 0);
  if (total === 0) return 0;

  const winRate = Number(rows[0]?.win_count || 0) / total;
  return Math.round(winRate * 50); // Max 50 points
}

async function calculateOverallSkillScore(userId) {
  const accuracyComponent = await calculateAccuracyComponent(userId);
  const speedComponent = await calculateSpeedComponent(userId);
  const consistencyComponent = await calculateConsistencyComponent(userId);
  const winRateComponent = await calculateWinRateComponent(userId);

  const totalScore = accuracyComponent + speedComponent + consistencyComponent + winRateComponent;

  return {
    currentScore: totalScore,
    accuracyComponent,
    speedComponent,
    consistencyComponent,
    winRateComponent,
  };
}

async function getPlayerSkillScore(userId) {
  const { rows } = await query(
    `SELECT * FROM skill_scores WHERE user_id = $1`,
    [userId]
  );

  if (rows.length > 0) {
    return rows[0];
  }

  // Initialize skill score for new player
  await query(
    `INSERT INTO skill_scores (user_id, base_score, current_score)
     VALUES ($1, 1000, 1000)`,
    [userId]
  );

  return {
    user_id: userId,
    base_score: 1000,
    current_score: 1000,
    accuracy_component: 500,
    speed_component: 300,
    consistency_component: 150,
    win_rate_component: 50,
    total_matches: 0,
    win_count: 0,
    loss_count: 0,
    total_accuracy: 0,
    avg_response_time_ms: 0,
    recent_performance_avg: 0,
    streak_count: 0,
    best_streak: 0,
  };
}

async function updateSkillScoreAfterMatch(userId, matchResult) {
  const client = await connect();
  try {
    await client.query('BEGIN');

    // Get current skill score
    const currentSkill = await getPlayerSkillScore(userId);
    const isWinner = typeof matchResult.isWinner === 'boolean'
      ? matchResult.isWinner
      : (matchResult.mode === 'ai'
          ? Number(matchResult.correctAnswers || 0) >= 6
          : (matchResult.rank === 1 && ((matchResult.totalPlayers || 1) > 1 ? true : Number(matchResult.correctAnswers || 0) >= 6)));

    // Calculate new components
    const skillComponents = await calculateOverallSkillScore(userId);
    
    // Calculate streak
    let newStreak = currentSkill.streak_count || 0;
    if (isWinner) {
      newStreak = Math.max(0, newStreak) + 1;
    } else {
      newStreak = Math.min(0, newStreak) - 1;
    }

    const bestStreak = Math.max(currentSkill.best_streak || 0, newStreak);

    // Update skill_scores
    await client.query(
      `INSERT INTO skill_scores (
         user_id, base_score, current_score,
         accuracy_component, speed_component, consistency_component, win_rate_component,
         total_matches, win_count, loss_count, streak_count, best_streak, last_match_played_at
       ) VALUES ($1, 1000, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, NOW())
       ON DUPLICATE KEY UPDATE
         current_score = $2,
         accuracy_component = $3,
         speed_component = $4,
         consistency_component = $5,
         win_rate_component = $6,
         total_matches = total_matches + 1,
         win_count = win_count + $7,
         loss_count = loss_count + $8,
         streak_count = $9,
         best_streak = $10,
         last_match_played_at = NOW(),
         updated_at = NOW()`,
      [
        userId,
        skillComponents.currentScore,
        skillComponents.accuracyComponent,
        skillComponents.speedComponent,
        skillComponents.consistencyComponent,
        skillComponents.winRateComponent,
        isWinner ? 1 : 0,
        isWinner ? 0 : 1,
        newStreak,
        bestStreak,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function compareSkillWithFriends(userId) {
  const { rows } = await query(
    `SELECT 
       f.id as friendship_id,
       CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END as friend_id,
       u.username,
       u.display_name,
       u.avatar_url,
       COALESCE(us.total_score, (SELECT COALESCE(SUM(gs.score), 0) FROM game_scores gs WHERE gs.user_id = u.id), u.xp, 0) as current_score,
       COALESCE(us.wins, 0) as win_count,
       COALESCE(us.games_played, 0) as total_matches,
       COALESCE(ss.accuracy_component, 500) / 5 as avg_accuracy,
       ROUND((COALESCE(us.wins, 0) / GREATEST(1, COALESCE(us.games_played, 0))) * 100, 2) as win_rate
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     LEFT JOIN user_stats us ON us.user_id = u.id
     LEFT JOIN skill_scores ss ON ss.user_id = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
     ORDER BY COALESCE(us.total_score, (SELECT COALESCE(SUM(gs.score), 0) FROM game_scores gs WHERE gs.user_id = u.id), u.xp, 0) DESC`,
    [userId]
  );

  const userSkill = await getPlayerSkillScore(userId);
  const currentUserScoreRes = await query(
    `SELECT COALESCE(us.total_score, (SELECT COALESCE(SUM(gs.score), 0) FROM game_scores gs WHERE gs.user_id = u.id), u.xp, 0) as score
     FROM users u
     LEFT JOIN user_stats us ON us.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const currentUserScore = Number(currentUserScoreRes.rows[0]?.score || 0);

  const friends = rows.map((row, index) => ({
    ...row,
    user_id: row.friend_id,
    current_score: Number(row.current_score || 0),
    win_count: Number(row.win_count || 0),
    total_matches: Number(row.total_matches || 0),
    win_rate: Number(row.win_rate || 0),
    avg_accuracy: Number(row.avg_accuracy || 0),
    rank_in_friend_group: index + 1,
  }));

  // Find user's rank relative to friends (how many friends scored strictly higher than user)
  const higherScoringFriends = friends.filter(f => Number(f.current_score || 0) > currentUserScore);
  const userRank = higherScoringFriends.length + 1;

  return {
    userSkill: {
      ...userSkill,
      current_score: currentUserScore,
    },
    friends,
    userRankInFriendGroup: userRank,
    friendGroupAvgScore: friends.length > 0 
      ? Math.round(friends.reduce((sum, f) => sum + (Number(f.current_score) || 0), 0) / friends.length)
      : currentUserScore,
  };
}

async function getPlayerPerformanceDashboard(userId) {
  const skillScore = await getPlayerSkillScore(userId);
  const friendComparison = await compareSkillWithFriends(userId);

  // Get recent matches (last 5)
  const { rows: recentMatches } = await query(
    `SELECT 
       id, score, \`rank\`, total_players, correct_answers, incorrect_answers,
       total_time_ms, avg_response_time_ms, accuracy_percentage, is_winner,
       category, difficulty, created_at
     FROM user_match_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  );

  // Get statistics summary
  const { rows: stats } = await query(
    `SELECT 
       COUNT(*) as total_matches_played,
       SUM(CASE WHEN is_winner THEN 1 ELSE 0 END) as total_wins,
       SUM(CASE WHEN is_winner THEN 0 ELSE 1 END) as total_losses,
       AVG(accuracy_percentage) as avg_accuracy,
       AVG(avg_response_time_ms) as avg_response_time,
       MAX(score) as highest_score,
       MIN(score) as lowest_score,
       SUM(score) as total_score,
       AVG(score) as avg_score
     FROM user_match_history
     WHERE user_id = $1`,
    [userId]
  );

  const summary = stats[0] || {};

  let totalMatches = Number(summary.total_matches_played) || 0;
  let totalWins = Number(summary.total_wins) || 0;
  let totalScore = Number(summary.total_score) || 0;
  let highestScore = Number(summary.highest_score) || 0;
  let avgScore = Math.round(Number(summary.avg_score) || 0);

  if (totalMatches === 0 || totalScore === 0) {
    const fallbackRes = await query(
      `SELECT 
         COUNT(DISTINCT game_id) as total_games,
         COALESCE(SUM(score), 0) as total_score,
         COALESCE(MAX(score), 0) as highest_score,
         COALESCE(AVG(score), 0) as avg_score
       FROM game_scores
       WHERE user_id = $1`,
      [userId]
    );
    const fb = fallbackRes.rows[0];
    if (fb && Number(fb.total_games || 0) > 0) {
      if (totalMatches === 0) totalMatches = Number(fb.total_games);
      if (totalScore === 0) totalScore = Number(fb.total_score);
      if (highestScore === 0) highestScore = Number(fb.highest_score);
      if (avgScore === 0) avgScore = Math.round(Number(fb.avg_score));
    }
  }

  const userStatsRes = await query(
    `SELECT games_played, wins, total_score FROM user_stats WHERE user_id = $1`,
    [userId]
  );
  const usRow = userStatsRes.rows[0];
  if (usRow) {
    if (Number(usRow.total_score || 0) > totalScore) totalScore = Number(usRow.total_score);
    if (Number(usRow.games_played || 0) > totalMatches) totalMatches = Number(usRow.games_played);
    if (Number(usRow.wins || 0) > totalWins) totalWins = Number(usRow.wins);
  }

  // Get category performance breakdown
  let { rows: categoryStats } = await query(
    `SELECT 
       category,
       COUNT(*) as matches,
       SUM(CASE WHEN is_winner = 1 OR is_winner = true THEN 1 ELSE 0 END) as wins,
       COALESCE(AVG(accuracy_percentage), 0) as avg_accuracy
     FROM user_match_history
     WHERE user_id = $1 AND category IS NOT NULL AND category != ''
     GROUP BY category
     ORDER BY matches DESC`,
    [userId]
  );

  if (!categoryStats || categoryStats.length === 0) {
    const roomCatRes = await query(
      `SELECT 
         r.category,
         COUNT(DISTINCT gs.game_id) as matches,
         SUM(CASE WHEN gs.\`rank\` = 1 THEN 1 ELSE 0 END) as wins,
         COALESCE(AVG(CASE WHEN (gs.correct_answers + gs.incorrect_answers) > 0 THEN (gs.correct_answers * 100.0 / (gs.correct_answers + gs.incorrect_answers)) ELSE 0 END), 0) as avg_accuracy
       FROM game_scores gs
       JOIN games g ON g.id = gs.game_id
       JOIN rooms r ON r.id = g.room_id
       WHERE gs.user_id = $1 AND r.category IS NOT NULL AND r.category != ''
       GROUP BY r.category
       ORDER BY matches DESC`,
      [userId]
    );
    if (roomCatRes.rows && roomCatRes.rows.length > 0) {
      categoryStats = roomCatRes.rows;
    }
  }

  const currentSkillScore = Number(skillScore.current_score || 1000);
  const winRate = totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0;

  // Derive component ratings ensuring they are 100% real based on actual data
  const userAccuracyRating = totalMatches > 0 ? Math.round(Number(summary.avg_accuracy) || 0) : 0;
  const userSpeedRating = totalMatches > 0 ? Math.max(0, Math.min(100, Math.round((30000 - Number(summary.avg_response_time || 30000)) / 250))) : 0;
  const userWinRateRating = totalMatches > 0 ? Math.round(winRate) : 0;
  const userConsistencyRating = totalMatches > 0 ? Math.max(0, Math.min(100, Math.round(100 - (Number(summary.total_losses || 0) * 5)))) : 0;

  return {
    skillScore: currentSkillScore,
    winRate: Math.round(winRate),
    components: {
      accuracyComponent: totalMatches > 0 ? (skillScore.accuracy_component ? Number(skillScore.accuracy_component) / 5 : userAccuracyRating) : 0,
      speedComponent: totalMatches > 0 ? (skillScore.speed_component ? Number(skillScore.speed_component) / 3 : userSpeedRating) : 0,
      consistencyComponent: totalMatches > 0 ? (skillScore.consistency_component ? Number(skillScore.consistency_component) / 1.5 : userConsistencyRating) : 0,
      winRateComponent: totalMatches > 0 ? (skillScore.win_rate_component ? Number(skillScore.win_rate_component) * 2 : userWinRateRating) : 0,
    },
    rawSkillScore: skillScore,
    friendComparison,
    recentMatches,
    summary: {
      totalMatchesPlayed: totalMatches,
      totalWins,
      totalLosses: Number(summary.total_losses) || 0,
      avgAccuracy: Number(summary.avg_accuracy) || 0,
      avgResponseTime: Number(summary.avg_response_time) || 0,
      highestScore,
      lowestScore: Number(summary.lowest_score) || 0,
      totalScore,
      avgScore,
    },
    categoryPerformance: categoryStats.map(stat => ({
      category: stat.category,
      matches: Number(stat.matches),
      wins: Number(stat.wins),
      avgAccuracy: Number(stat.avg_accuracy),
    })),
  };
}

async function getGlobalLeaderboard(limit = 50) {
  const { rows } = await query(
    `SELECT
       u.id AS user_id,
       u.username,
       u.display_name,
       u.avatar_url,
       u.level,
       COALESCE(us.total_score, (SELECT COALESCE(SUM(gs.score), 0) FROM game_scores gs WHERE gs.user_id = u.id), u.xp, 0) AS skill_score,
       COALESCE(us.games_played, (SELECT COUNT(DISTINCT game_id) FROM game_scores WHERE user_id = u.id), 0) AS total_matches,
       COALESCE(us.wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = u.id AND is_winner = 1), 0) AS win_count,
       ROUND(
         (
           COALESCE(us.wins, (SELECT COUNT(*) FROM user_match_history WHERE user_id = u.id AND is_winner = 1), 0)
           / GREATEST(1, COALESCE(us.games_played, (SELECT COUNT(DISTINCT game_id) FROM game_scores WHERE user_id = u.id), 0))
         ) * 100,
         2
       ) AS win_rate
     FROM users u
     LEFT JOIN user_stats us ON us.user_id = u.id
     WHERE u.deleted_at IS NULL
       AND (u.role IS NULL OR u.role = 'player')
       AND u.username NOT LIKE 'AI_%'
     ORDER BY
       COALESCE(us.total_score, (SELECT COALESCE(SUM(gs.score), 0) FROM game_scores gs WHERE gs.user_id = u.id), u.xp, 0) DESC,
       u.xp DESC,
       u.level DESC,
       u.id ASC
     LIMIT $1`,
    [Math.min(Number(limit) || 50, 100)]
  );

  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    skill_score: Number(row.skill_score),
    lifetime_points: Number(row.skill_score),
    total_score: Number(row.skill_score),
    win_count: Number(row.win_count),
    total_matches: Number(row.total_matches),
    win_rate: Number(row.win_rate),
  }));
}
module.exports = {
  calculateOverallSkillScore,
  getPlayerSkillScore,
  updateSkillScoreAfterMatch,
  compareSkillWithFriends,
  getPlayerPerformanceDashboard,
  getGlobalLeaderboard,
};



