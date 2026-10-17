-- 021_secure_auth_architecture.sql
-- Migration: Secure Authentication Architecture Foundation

-- 1. Create auth_identities table
CREATE TABLE IF NOT EXISTS auth_identities (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  credential_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_auth_identities_provider_user UNIQUE (provider, provider_user_id),
  INDEX idx_auth_identities_user_id (user_id)
);

-- 2. Create security_events table
CREATE TABLE IF NOT EXISTS security_events (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  event_type VARCHAR(64) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_security_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_security_events_user_id (user_id),
  INDEX idx_security_events_event_type (event_type),
  INDEX idx_security_events_created_at (created_at)
);

-- 3. Upgrade password_reset_tokens table
-- Add columns if not already present
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens' AND COLUMN_NAME = 'code_hash';
SET @alter_sql = IF(@col_exists = 0, 'ALTER TABLE password_reset_tokens ADD COLUMN code_hash VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens' AND COLUMN_NAME = 'attempt_count';
SET @alter_sql = IF(@col_exists = 0, 'ALTER TABLE password_reset_tokens ADD COLUMN attempt_count INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens' AND COLUMN_NAME = 'max_attempts';
SET @alter_sql = IF(@col_exists = 0, 'ALTER TABLE password_reset_tokens ADD COLUMN max_attempts INT NOT NULL DEFAULT 5', 'SELECT 1');
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill code_hash from token_hash for existing records if code_hash is null
UPDATE password_reset_tokens SET code_hash = token_hash WHERE code_hash IS NULL;

-- 4. Backfill existing password users into auth_identities
INSERT INTO auth_identities (id, user_id, provider, provider_user_id, credential_hash, created_at, updated_at)
SELECT
  UUID(),
  u.id,
  'password',
  u.id,
  u.password_hash,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.password_hash IS NOT NULL
  AND u.password_hash != ''
  AND NOT EXISTS (
    SELECT 1 FROM auth_identities ai
    WHERE ai.provider = 'password' AND ai.provider_user_id = u.id
  );
