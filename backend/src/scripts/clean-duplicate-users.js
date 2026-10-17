const { query } = require('../db/pool');

async function cleanDuplicates() {
  console.log('=== Cleaning Duplicate Users from Database ===');

  // Find duplicate display_names
  const dupGroups = await query(`
    SELECT LOWER(display_name) as clean_name, display_name, COUNT(*) as count, GROUP_CONCAT(id ORDER BY xp DESC, coins DESC, created_at ASC) as id_list
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY LOWER(display_name)
    HAVING count > 1
  `);

  console.log('Duplicate Groups Found:', dupGroups.rows.length);

  for (const group of dupGroups.rows) {
    const ids = group.id_list.split(',');
    const primaryId = ids[0]; // Keep the user with highest XP / coins / oldest created_at
    const duplicateIds = ids.slice(1);

    console.log(`\nGroup: "${group.display_name}" (Count: ${group.count})`);
    console.log(`  -> Keeping Primary User ID: ${primaryId}`);
    console.log(`  -> Deleting ${duplicateIds.length} Duplicate User IDs:`, duplicateIds);

    for (const dupId of duplicateIds) {
      try { await query('UPDATE games SET created_by = $1 WHERE created_by = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE games SET winner_user_id = $1 WHERE winner_user_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE rooms SET host_user_id = $1 WHERE host_user_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE tournaments SET created_by = $1 WHERE created_by = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE challenges SET challenger_id = $1 WHERE challenger_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE challenges SET challenged_id = $1 WHERE challenged_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE challenges SET winner_user_id = $1 WHERE winner_user_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('DELETE FROM refresh_tokens WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM wallet_transactions WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM user_stats WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM user_achievements WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM user_skill_scores WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM ai_best_scores WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM daily_streak WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM push_tokens WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM user_daily_bonus WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM friends WHERE requester_id = $1 OR addressee_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM room_players WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM game_answers WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM game_participants WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM tournament_participants WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM match_history WHERE user_id = $1', [dupId]); } catch (e) {}

      // Delete the duplicate user
      await query('DELETE FROM users WHERE id = $1', [dupId]);
      console.log(`  ✓ Successfully deleted duplicate user ${dupId}`);
    }
  }

  // Also verify duplicate usernames
  const dupUsernames = await query(`
    SELECT LOWER(username) as clean_username, username, COUNT(*) as count, GROUP_CONCAT(id ORDER BY created_at ASC) as id_list
    FROM users
    GROUP BY LOWER(username)
    HAVING count > 1
  `);

  for (const group of dupUsernames.rows) {
    const ids = group.id_list.split(',');
    const primaryId = ids[0];
    const duplicateIds = ids.slice(1);
    for (const dupId of duplicateIds) {
      try { await query('UPDATE games SET created_by = $1 WHERE created_by = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE games SET winner_user_id = $1 WHERE winner_user_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('UPDATE rooms SET host_user_id = $1 WHERE host_user_id = $2', [primaryId, dupId]); } catch (e) {}
      try { await query('DELETE FROM refresh_tokens WHERE user_id = $1', [dupId]); } catch (e) {}
      try { await query('DELETE FROM user_stats WHERE user_id = $1', [dupId]); } catch (e) {}
      await query('DELETE FROM users WHERE id = $1', [dupId]);
      console.log(`  ✓ Successfully deleted duplicate username user ${dupId}`);
    }
  }

  // Summary after cleanup
  const remaining = await query('SELECT id, username, email, display_name, role, is_guest, coins, level, xp, created_at FROM users ORDER BY created_at ASC');
  console.log('\n=== Cleanup Complete ===');
  console.log(`Total Clean Unique Users Remaining: ${remaining.rows.length}`);
  remaining.rows.forEach((u, i) => {
    console.log(` ${i + 1}. [${u.role}${u.is_guest ? ' (Guest)' : ''}] ${u.username} | Display: "${u.display_name}" | Email: ${u.email || 'N/A'} | Level: ${u.level} | Coins: ${u.coins}`);
  });

  process.exit(0);
}

cleanDuplicates().catch(err => {
  console.error('Error cleaning duplicates:', err);
  process.exit(1);
});
