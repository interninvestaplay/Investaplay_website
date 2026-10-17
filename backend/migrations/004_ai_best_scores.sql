-- These columns may already exist if migrations were previously run
-- Attempting to add them is safe as the table is already created
-- MySQL will handle duplicate column errors gracefully on re-run

CREATE TABLE IF NOT EXISTS user_ai_level_scores (
  user_id CHAR(36) NOT NULL,
  bot_name VARCHAR(40) NOT NULL,
  level INT NOT NULL,
  best_score INT NOT NULL DEFAULT 0,
  best_correct_answers INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, bot_name, level),
  CONSTRAINT user_ai_level_scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
