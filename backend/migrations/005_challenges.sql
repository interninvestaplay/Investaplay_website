ALTER TABLE users ADD COLUMN invite_code VARCHAR(12) NULL UNIQUE;

CREATE TABLE IF NOT EXISTS user_push_tokens (
  user_id CHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform VARCHAR(40),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, token),
  CONSTRAINT user_push_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_challenge_suggestions (
  user_id CHAR(36) NOT NULL,
  suggested_user_id CHAR(36) NOT NULL,
  suggestion_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, suggested_user_id, suggestion_date),
  CONSTRAINT challenge_suggestion_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT challenge_suggestion_target_fk FOREIGN KEY (suggested_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS challenges (
  id CHAR(36) PRIMARY KEY,
  challenger_id CHAR(36) NOT NULL,
  challenged_id CHAR(36) NOT NULL,
  room_id CHAR(36) NULL,
  game_id CHAR(36) NULL,
  status ENUM('pending', 'accepted', 'declined', 'completed', 'expired') NOT NULL DEFAULT 'pending',
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  winner_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT challenges_challenger_fk FOREIGN KEY (challenger_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT challenges_challenged_fk FOREIGN KEY (challenged_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT challenges_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  CONSTRAINT challenges_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL,
  CONSTRAINT challenges_winner_fk FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL
);
