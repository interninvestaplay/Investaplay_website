const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { query, pool } = require('../db/pool');
const { createUniqueInviteCode } = require('../services/invite.service');

async function seedAdmin() {
  const email = process.argv[2] || env.adminEmail || 'admin@investaplay.com';
  const password = process.argv[3] || env.adminPassword;

  if (!password) {
    console.error('Usage: node src/scripts/seedAdmin.js <admin_email> <admin_password>');
    console.error('Or set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file.');
    process.exit(1);
  }

  const cleanEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const username = 'investaplay_admin';
  const displayName = 'Investaplay Admin';

  console.log(`Seeding admin user for email: ${cleanEmail}...`);

  await query(
    `INSERT INTO users (id, username, email, password_hash, display_name, invite_code, role)
     VALUES (UUID(), $1, $2, $3, $4, $5, 'admin')
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       display_name = VALUES(display_name),
       role = 'admin',
       deleted_at = NULL`,
    [username, cleanEmail, passwordHash, displayName, await createUniqueInviteCode()]
  );

  console.log('Admin user provisioned/updated successfully.');
  await pool.end();
}

seedAdmin().catch(err => {
  console.error('Error provisioning admin user:', err);
  process.exit(1);
});
