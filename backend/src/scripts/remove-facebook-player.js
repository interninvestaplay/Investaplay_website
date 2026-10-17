const { query } = require('../db/pool');

async function removeFacebookPlayers() {
  console.log('=== Inspecting and Removing Facebook Player Data ===');

  const fbUsers = await query(`
    SELECT id, username, display_name, email, role, is_guest, coins, level, xp, created_at
    FROM users
    WHERE LOWER(username) LIKE '%facebook%'
       OR LOWER(display_name) LIKE '%facebook%'
       OR LOWER(email) LIKE '%facebook%'
  `);

  console.log(`Found ${fbUsers.rows.length} Facebook user(s) in database:`);
  fbUsers.rows.forEach((u, i) => {
    console.log(` ${i + 1}. ID: ${u.id} | Username: "${u.username}" | Display: "${u.display_name}" | Email: ${u.email || 'N/A'}`);
  });

  if (fbUsers.rows.length === 0) {
    console.log('No Facebook player accounts found in database.');
    process.exit(0);
  }

  // Find admin user for safe reassignment if needed
  const adminRes = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const adminId = adminRes.rows[0]?.id;

  for (const u of fbUsers.rows) {
    const userId = u.id;
    console.log(`\nRemoving user and all related records for ID: ${userId} ("${u.display_name}")`);

    // 1. Delete answers and scores
    try { await query('DELETE FROM answers WHERE user_id = $1', [userId]); } catch (e) { console.error('answers:', e.message); }
    try { await query('DELETE FROM game_scores WHERE user_id = $1', [userId]); } catch (e) { console.error('game_scores:', e.message); }
    try { await query('DELETE FROM user_match_history WHERE user_id = $1', [userId]); } catch (e) { console.error('user_match_history:', e.message); }
    try { await query('DELETE FROM user_stats WHERE user_id = $1', [userId]); } catch (e) { console.error('user_stats:', e.message); }
    try { await query('DELETE FROM user_achievements WHERE user_id = $1', [userId]); } catch (e) { console.error('user_achievements:', e.message); }
    try { await query('DELETE FROM user_ai_level_scores WHERE user_id = $1', [userId]); } catch (e) { console.error('user_ai_level_scores:', e.message); }
    try { await query('DELETE FROM skill_scores WHERE user_id = $1', [userId]); } catch (e) { console.error('skill_scores:', e.message); }
    try { await query('DELETE FROM wallet_transactions WHERE user_id = $1', [userId]); } catch (e) { console.error('wallet_transactions:', e.message); }
    try { await query('DELETE FROM friendships WHERE requester_id = $1 OR addressee_id = $1', [userId]); } catch (e) { console.error('friendships:', e.message); }
    try { await query('DELETE FROM challenges WHERE challenger_id = $1 OR challenged_id = $1', [userId]); } catch (e) { console.error('challenges:', e.message); }
    try { await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]); } catch (e) { console.error('refresh_tokens:', e.message); }
    try { await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]); } catch (e) { console.error('password_reset_tokens:', e.message); }
    try { await query('DELETE FROM room_players WHERE user_id = $1', [userId]); } catch (e) { console.error('room_players:', e.message); }

    // 2. Clean rooms hosted by this user
    if (adminId) {
      try { await query('UPDATE rooms SET host_user_id = $1 WHERE host_user_id = $2', [adminId, userId]); } catch (e) { console.error('rooms update:', e.message); }
      try { await query('UPDATE games SET created_by = $1 WHERE created_by = $2', [adminId, userId]); } catch (e) { console.error('games update:', e.message); }
    } else {
      try { await query('DELETE FROM room_players WHERE room_id IN (SELECT id FROM rooms WHERE host_user_id = $1)', [userId]); } catch (e) {}
      try { await query('DELETE FROM rooms WHERE host_user_id = $1', [userId]); } catch (e) {}
      try { await query('DELETE FROM games WHERE created_by = $1', [userId]); } catch (e) {}
    }

    // 3. Delete user
    try {
      await query('DELETE FROM users WHERE id = $1', [userId]);
      console.log(`✓ Successfully deleted Facebook player: ${userId}`);
    } catch (e) {
      console.error(`Final delete failed for user ${userId}:`, e.message);
    }
  }

  // Verify remaining users
  const remaining = await query('SELECT id, username, email, display_name, role, is_guest, coins, level, xp FROM users ORDER BY created_at ASC');
  console.log('\n=== Cleanup Complete ===');
  console.log(`Remaining Unique Users in Database: ${remaining.rows.length}`);
  remaining.rows.forEach((u, i) => {
    console.log(` ${i + 1}. [${u.role}${u.is_guest ? ' (Guest)' : ''}] ${u.username} | Display: "${u.display_name}" | Email: ${u.email || 'N/A'}`);
  });

  process.exit(0);
}

removeFacebookPlayers().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
