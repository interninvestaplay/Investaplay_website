INSERT INTO users (id, username, email, password_hash, display_name, invite_code, role)
VALUES (
  UUID(),
  'investaplay_admin',
  'admin@investaplay.com',
  '$2a$10$3I3REb7cbSJKlf8z.ZJlW.8eqRpzL.QqBj9aSbVGKckBxQPsLuYyW',
  'Investaplay Admin',
  CONCAT('ADM', LEFT(REPLACE(UUID(), '-', ''), 9)),
  'admin'
)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  display_name = VALUES(display_name),
  role = 'admin',
  deleted_at = NULL;
