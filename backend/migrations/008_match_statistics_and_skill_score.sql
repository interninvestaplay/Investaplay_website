-- Match Statistics and Skill Score System
-- This migration adds comprehensive match tracking and player skill score calculations

-- Enhanced game_scores table with additional metrics
ALTER TABLE game_scores ADD COLUMN total_time_ms INT DEFAULT 0;
ALTER TABLE game_scores ADD COLUMN incorrect_answers INT NOT NULL DEFAULT 0;
ALTER TABLE game_scores ADD COLUMN completion_status ENUM('completed', 'abandoned', 'disconnected') NOT NULL DEFAULT 'completed';
ALTER TABLE game_scores ADD COLUMN `rank` INT NULL;
ALTER TABLE game_scores ADD COLUMN avg_response_time_ms INT DEFAULT 0;

-- Create user_match_history table to track all multiplayer matches
CREATE TABLE IF NOT EXISTS user_match_history (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  room_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  opponent_user_ids JSON NULL, -- JSON array of opponent user IDs
  score INT NOT NULL DEFAULT 0,
  `rank` INT NOT NULL,
  total_players INT NOT NULL,
  correct_answers INT NOT NULL DEFAULT 0,
  incorrect_answers INT NOT NULL DEFAULT 0,
  total_time_ms INT NOT NULL DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  accuracy_percentage DECIMAL(5,2) DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  completion_status ENUM('completed', 'abandoned', 'disconnected') NOT NULL DEFAULT 'completed',
  category VARCHAR(80),
  difficulty ENUM('easy', 'medium', 'hard'),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_game (user_id, game_id),
  INDEX idx_user_created (user_id, created_at),
  CONSTRAINT user_match_history_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_match_history_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Create skill_scores table to track player skill progression
CREATE TABLE IF NOT EXISTS skill_scores (
  user_id CHAR(36) PRIMARY KEY,
  base_score INT NOT NULL DEFAULT 1000, -- Starting ELO-like score
  current_score INT NOT NULL DEFAULT 1000,
  accuracy_component INT NOT NULL DEFAULT 500, -- Contribution from accuracy (0-500)
  speed_component INT NOT NULL DEFAULT 300, -- Contribution from speed (0-300)
  consistency_component INT NOT NULL DEFAULT 150, -- Contribution from consistency (0-150)
  win_rate_component INT NOT NULL DEFAULT 50, -- Contribution from win rate (0-50)
  total_matches INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  loss_count INT NOT NULL DEFAULT 0,
  total_accuracy DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  recent_performance_avg DECIMAL(5,2) DEFAULT 0, -- Average of last 10 matches
  streak_count INT NOT NULL DEFAULT 0, -- Current win/loss streak (positive for wins, negative for losses)
  best_streak INT NOT NULL DEFAULT 0, -- Best win streak
  last_match_played_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT skill_scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create player_rejoin_sessions table to track disconnections and reconnections
CREATE TABLE IF NOT EXISTS player_rejoin_sessions (
  id CHAR(36) PRIMARY KEY,
  game_id CHAR(36) NOT NULL,
  room_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  disconnected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reconnected_at DATETIME NULL,
  current_question_index INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_active_sessions (game_id, is_active),
  INDEX idx_user_sessions (user_id, is_active),
  CONSTRAINT player_rejoin_sessions_game_fk FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  CONSTRAINT player_rejoin_sessions_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT player_rejoin_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create room_stats table to track room-level statistics
CREATE TABLE IF NOT EXISTS room_stats (
  room_id CHAR(36) PRIMARY KEY,
  total_games INT NOT NULL DEFAULT 0,
  total_players_participated INT NOT NULL DEFAULT 0,
  avg_players_per_game INT DEFAULT 0,
  most_common_winner_user_id CHAR(36) NULL,
  most_common_category VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT room_stats_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- Create friend_comparisons view/table for easy skill score comparisons
CREATE TABLE IF NOT EXISTS friend_skill_cache (
  user_id CHAR(36) NOT NULL,
  friend_id CHAR(36) NOT NULL,
  friend_skill_score INT NOT NULL,
  friend_win_rate DECIMAL(5,2),
  friend_total_matches INT,
  user_rank_in_friend_group INT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT friend_skill_cache_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT friend_skill_cache_friend_fk FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for performance on frequently queried columns
CREATE INDEX idx_user_match_accuracy ON user_match_history(user_id, accuracy_percentage);
CREATE INDEX idx_user_match_winner ON user_match_history(user_id, is_winner);
CREATE INDEX idx_game_status ON games(room_id, status);
CREATE INDEX idx_skill_scores_ranking ON skill_scores(current_score);
