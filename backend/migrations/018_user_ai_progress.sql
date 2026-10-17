CREATE TABLE IF NOT EXISTS user_ai_progress (
  user_id CHAR(36) NOT NULL,
  bot_name ENUM('Nova', 'Astra', 'Orion', 'Zphry') NOT NULL,
  level INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, bot_name),
  CONSTRAINT user_ai_progress_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
