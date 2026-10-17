const { query, connect } = require('../db/pool');

async function inspectAndClean() {
  console.log('=== Checking Duplicate Users ===');

  // Check duplicate usernames (case insensitive)
  const dupUsernames = await query(`
    SELECT LOWER(username) as clean_username, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY LOWER(username)
    HAVING count > 1
  `);
  console.log('Duplicate Usernames:', dupUsernames.rows);

  // Check duplicate emails (case insensitive)
  const dupEmails = await query(`
    SELECT LOWER(email) as clean_email, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM users
    WHERE email IS NOT NULL AND email != '' AND deleted_at IS NULL
    GROUP BY LOWER(email)
    HAVING count > 1
  `);
  console.log('Duplicate Emails:', dupEmails.rows);

  // Check duplicate display_names for guests / players
  const dupDisplayNames = await query(`
    SELECT LOWER(display_name) as clean_name, display_name, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM users
    WHERE display_name IS NOT NULL AND display_name != '' AND deleted_at IS NULL
    GROUP BY LOWER(display_name)
    HAVING count > 1
  `);
  console.log('Duplicate Display Names:', dupDisplayNames.rows);

  // Show all users
  const allUsers = await query(`
    SELECT id, username, email, display_name, is_guest, role, coins, level, xp, created_at
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY display_name ASC, created_at ASC
  `);
  console.log('Total Active Users:', allUsers.rows.length);

  process.exit(0);
}

inspectAndClean().catch(err => {
  console.error(err);
  process.exit(1);
});
