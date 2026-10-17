CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(120) NOT NULL UNIQUE,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  display_name VARCHAR(160) NOT NULL,
  invite_code VARCHAR(12) UNIQUE,
  avatar_url TEXT,
  role ENUM('player', 'admin', 'ai') NOT NULL DEFAULT 'player',
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  xp INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  coins INT NOT NULL DEFAULT 0,
  token_version INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(45),
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT refresh_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  id CHAR(36) PRIMARY KEY,
  level INT NOT NULL DEFAULT 1,
  category VARCHAR(80) NOT NULL,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL,
  prompt TEXT NOT NULL,
  options JSON NOT NULL,
  correct_option VARCHAR(255) NOT NULL,
  explanation TEXT,
  time_limit_seconds INT NOT NULL DEFAULT 15,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_prompt (prompt(255))
);

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  status ENUM('active', 'hidden') NOT NULL DEFAULT 'active',
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT categories_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(12) NOT NULL UNIQUE,
  host_user_id CHAR(36) NOT NULL,
  mode ENUM('friends', 'ai') NOT NULL DEFAULT 'friends',
  category VARCHAR(80) NOT NULL DEFAULT 'General',
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'easy',
  question_limit INT NOT NULL DEFAULT 5,
  max_players INT NOT NULL DEFAULT 4,
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('waiting', 'in_game', 'completed', 'cancelled') NOT NULL DEFAULT 'waiting',
  active_game_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT rooms_host_fk FOREIGN KEY (host_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS room_players (
  room_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('host', 'player', 'ai') NOT NULL DEFAULT 'player',
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT room_players_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT room_players_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tournaments (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  category VARCHAR(80) NOT NULL DEFAULT 'General',
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
  question_limit INT NOT NULL DEFAULT 10,
  entry_fee_coins INT NOT NULL DEFAULT 0,
  prize_coins INT NOT NULL DEFAULT 0,
  max_players INT NOT NULL DEFAULT 1000,
  status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  active_game_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tournament_title (title)
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, user_id),
  CONSTRAINT tournament_players_tournament_fk FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT tournament_players_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS games (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NULL,
  tournament_id CHAR(36) NULL,
  mode ENUM('room', 'ai', 'tournament') NOT NULL,
  status ENUM('pending', 'active', 'completed', 'abandoned') NOT NULL DEFAULT 'pending',
  current_question_index INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT games_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  CONSTRAINT games_tournament_fk FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE SET NULL,
  CONSTRAINT games_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_questions (
  game_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (game_id, question_id),
  UNIQUE KEY uq_game_question_order (game_id, sort_order),
  CONSTRAINT game_questions_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT game_questions_question_fk FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS answers (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  selected_option VARCHAR(255) NOT NULL,
  is_correct BOOLEAN NOT NULL,
  answered_in_ms INT,
  score_delta INT NOT NULL DEFAULT 0,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_answer_once (game_id, user_id, question_id),
  CONSTRAINT answers_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT answers_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT answers_question_fk FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS game_scores (
  game_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  score INT NOT NULL DEFAULT 0,
  correct_answers INT NOT NULL DEFAULT 0,
  fast_answers INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  CONSTRAINT game_scores_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT game_scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id CHAR(36) PRIMARY KEY,
  games_played INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  correct_answers INT NOT NULL DEFAULT 0,
  total_score INT NOT NULL DEFAULT 0,
  fast_answers INT NOT NULL DEFAULT 0,
  room_wins INT NOT NULL DEFAULT 0,
  daily_streak INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT user_stats_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS achievements (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  target_value INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id CHAR(36) NOT NULL,
  achievement_id CHAR(36) NOT NULL,
  progress_value INT NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_id),
  CONSTRAINT user_achievements_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_achievements_achievement_fk FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  id CHAR(36) PRIMARY KEY,
  requester_id CHAR(36) NOT NULL,
  addressee_id CHAR(36) NOT NULL,
  status ENUM('pending', 'accepted', 'blocked') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friendship_pair (requester_id, addressee_id),
  CONSTRAINT friendships_requester_fk FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT friendships_addressee_fk FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT friendships_not_self CHECK (requester_id <> addressee_id)
);

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
