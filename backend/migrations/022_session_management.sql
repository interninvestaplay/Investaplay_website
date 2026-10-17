-- 022_session_management.sql
-- Migration: Session Management, Token Versioning & Refresh Token Optimization

-- 1. Ensure last_used_at exists on refresh_tokens
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refresh_tokens' AND COLUMN_NAME = 'last_used_at';
SET @alter_sql = IF(@col_exists = 0, 'ALTER TABLE refresh_tokens ADD COLUMN last_used_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Populate last_used_at from created_at for existing rows
UPDATE refresh_tokens SET last_used_at = created_at WHERE last_used_at IS NULL;

-- 3. Add index on refresh_tokens for faster user session lookups and cleanup
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refresh_tokens' AND INDEX_NAME = 'idx_refresh_tokens_user_status';
SET @alter_sql = IF(@idx_exists = 0, 'CREATE INDEX idx_refresh_tokens_user_status ON refresh_tokens (user_id, revoked_at, expires_at)', 'SELECT 1');
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
