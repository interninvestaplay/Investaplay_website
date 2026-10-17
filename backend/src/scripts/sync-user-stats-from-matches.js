const { query } = require('../db/pool');

async function syncAllUserStats() {
  console.log('--- Starting User Stats & Leaderboard Sync with Real Match Data ---');

  const usersRes = await query('SELECT id, username, display_name, xp, level, coins FROM users WHERE deleted_at IS NULL');
  const allUsers = usersRes.rows;
  console.log(`Found ${allUsers.length} total users.`);

  for (const user of allUsers) {
    const gsRes = await query(
      `SELECT 
         COUNT(DISTINCT gs.game_id) AS verified_games_played,
         COALESCE(SUM(gs.score), 0) AS verified_total_score,
         COALESCE(SUM(gs.correct_answers), 0) AS verified_correct_answers,
         COALESCE(SUM(gs.fast_answers), 0) AS verified_fast_answers,
         COALESCE(MAX(gs.score), 0) AS verified_max_score,
         COALESCE(AVG(gs.score), 0) AS verified_avg_score
       FROM game_scores gs
       WHERE gs.user_id = $1`,
      [user.id]
    );

    const winsRes = await query(
      `SELECT 
         COUNT(*) AS verified_wins,
         SUM(CASE WHEN room_id IS NOT NULL THEN 1 ELSE 0 END) AS verified_room_wins
       FROM user_match_history 
       WHERE user_id = $1 AND (is_winner = 1 OR is_winner = true OR \`rank\` = 1)`,
      [user.id]
    );

    const gsWinsRes = await query(
      `SELECT COUNT(*) AS gs_wins 
       FROM game_scores 
       WHERE user_id = $1 AND \`rank\` = 1`,
      [user.id]
    );

    const gsStats = gsRes.rows[0] || {};
    const winStats = winsRes.rows[0] || {};
    const gsWinStats = gsWinsRes.rows[0] || {};

    const gamesPlayed = Number(gsStats.verified_games_played || 0);
    const totalScore = Number(gsStats.verified_total_score || 0);
    const correctAnswers = Number(gsStats.verified_correct_answers || 0);
    const fastAnswers = Number(gsStats.verified_fast_answers || 0);
    const wins = Math.max(Number(winStats.verified_wins || 0), Number(gsWinStats.gs_wins || 0));
    const roomWins = Number(winStats.verified_room_wins || 0);

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
      [user.id, gamesPlayed, wins, correctAnswers, totalScore, fastAnswers, roomWins]
    );

    const verifiedXp = totalScore + (wins * 50) + (gamesPlayed * 20);
    const verifiedLevel = Math.max(1, Math.floor(verifiedXp / 500) + 1);

    await query(
      `UPDATE users
       SET xp = $2,
           level = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, verifiedXp, verifiedLevel]
    );

    if (gamesPlayed > 0 || totalScore > 0) {
      console.log(`[SYNCED] ${user.username} (${user.display_name || 'No Name'}): Games=${gamesPlayed}, Wins=${wins}, Real TotalScore=${totalScore}, Real XP=${verifiedXp}, Level=${verifiedLevel}`);
    }
  }

  console.log('--- Resync Completed Successfully ---');
  process.exit(0);
}

syncAllUserStats().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
