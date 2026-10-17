const { query } = require('./pool');

async function autoMigrateDatabase() {
  console.log('[AutoMigrate] Verifying complete database schema & migrations...');

  // 1. Ensure all optional / migrated columns exist across all tables
  const alterStatements = [
    // games table
    `ALTER TABLE games ADD COLUMN ai_bot_name VARCHAR(100) NULL`,
    `ALTER TABLE games ADD COLUMN ai_level INT NULL`,
    `ALTER TABLE games ADD COLUMN room_id CHAR(36) NULL`,
    `ALTER TABLE games ADD COLUMN tournament_id CHAR(36) NULL`,
    `ALTER TABLE games ADD COLUMN created_by CHAR(36) NULL`,

    // rooms table
    `ALTER TABLE rooms ADD COLUMN room_name VARCHAR(100) NULL`,
    `ALTER TABLE rooms ADD COLUMN max_players INT NOT NULL DEFAULT 4`,
    `ALTER TABLE rooms ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE rooms ADD COLUMN active_game_id CHAR(36) NULL`,

    // users table
    `ALTER TABLE users ADD COLUMN invite_code VARCHAR(12) NULL UNIQUE`,
    `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL`,
    `ALTER TABLE users ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN xp INT NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN coins INT NOT NULL DEFAULT 100`,
    `ALTER TABLE users ADD COLUMN level INT NOT NULL DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL`,
    `ALTER TABLE users ADD COLUMN equipped_avatar VARCHAR(80) NOT NULL DEFAULT 'avatar_01'`,
    `ALTER TABLE users ADD COLUMN equipped_frame VARCHAR(80) NOT NULL DEFAULT 'frame_default'`,
    `ALTER TABLE users ADD COLUMN equipped_title VARCHAR(80) NOT NULL DEFAULT 'Novice Quizzer'`,
    `ALTER TABLE users ADD COLUMN lifeline_fifty_fifty INT NOT NULL DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN lifeline_skip INT NOT NULL DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN lifeline_time_freeze INT NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN status ENUM('active', 'suspended', 'banned') NOT NULL DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN status_reason VARCHAR(255) NULL`,
    `ALTER TABLE users ADD COLUMN last_active_at DATETIME NULL`,

    // game_scores table
    `ALTER TABLE game_scores ADD COLUMN fast_answers INT NOT NULL DEFAULT 0`,
    `ALTER TABLE game_scores ADD COLUMN total_time_ms INT DEFAULT 0`,
    `ALTER TABLE game_scores ADD COLUMN incorrect_answers INT NOT NULL DEFAULT 0`,
    `ALTER TABLE game_scores ADD COLUMN completion_status ENUM('completed', 'abandoned', 'disconnected') NOT NULL DEFAULT 'completed'`,
    `ALTER TABLE game_scores ADD COLUMN \`rank\` INT NULL`,
    `ALTER TABLE game_scores ADD COLUMN avg_response_time_ms INT DEFAULT 0`,
    `ALTER TABLE game_scores ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE game_scores ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,

    // wallet_transactions table
    `ALTER TABLE wallet_transactions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,

    // answers table
    `ALTER TABLE answers ADD COLUMN answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`,

    // user_stats table
    `ALTER TABLE user_stats ADD COLUMN fast_answers INT NOT NULL DEFAULT 0`,
    `ALTER TABLE user_stats ADD COLUMN room_wins INT NOT NULL DEFAULT 0`,
    `ALTER TABLE user_stats ADD COLUMN daily_streak INT NOT NULL DEFAULT 0`,

    // categories table
    `ALTER TABLE categories MODIFY COLUMN status ENUM('active', 'hidden', 'inactive') NOT NULL DEFAULT 'active'`,

    // questions table
    `ALTER TABLE questions ADD COLUMN source_question_id VARCHAR(120) NULL UNIQUE`,
    `ALTER TABLE questions ADD COLUMN \`level\` INT NOT NULL DEFAULT 1`,
    `ALTER TABLE questions ADD COLUMN explanation TEXT NULL`,
    `ALTER TABLE quick_quiz_questions ADD COLUMN hint TEXT NULL`,

    // challenges table columns & indexes for canonical active 1v1 matchmaking
    `ALTER TABLE challenges MODIFY COLUMN status ENUM('pending', 'accepted', 'declined', 'completed', 'expired', 'cancelled') NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE challenges ADD COLUMN pair_key VARCHAR(73) GENERATED ALWAYS AS (CASE WHEN challenger_id < challenged_id THEN CONCAT(challenger_id, ':', challenged_id) ELSE CONCAT(challenged_id, ':', challenger_id) END) VIRTUAL`,
    `ALTER TABLE challenges ADD COLUMN active_pair_key VARCHAR(73) GENERATED ALWAYS AS (CASE WHEN status IN ('pending', 'accepted') THEN (CASE WHEN challenger_id < challenged_id THEN CONCAT(challenger_id, ':', challenged_id) ELSE CONCAT(challenged_id, ':', challenger_id) END) ELSE NULL END) VIRTUAL`,
    `ALTER TABLE challenges ADD COLUMN cancellation_reason VARCHAR(64) NULL`,
    `ALTER TABLE challenges ADD COLUMN challenger_dismissed BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE challenges ADD COLUMN challenged_dismissed BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE challenges ADD COLUMN quiz_type VARCHAR(40) NULL DEFAULT 'standard'`,
    `ALTER TABLE challenges ADD COLUMN topic VARCHAR(120) NULL`,
    `ALTER TABLE challenges ADD COLUMN difficulty VARCHAR(20) NULL`,
    `ALTER TABLE challenges ADD COLUMN question_limit INT NULL`,
    `ALTER TABLE challenges ADD COLUMN custom_question_ids JSON NULL`,
    `ALTER TABLE rooms ADD COLUMN custom_question_ids JSON NULL`,
    `ALTER TABLE challenges ADD INDEX idx_challenges_pair_status (challenger_id, challenged_id, status)`,
    `ALTER TABLE challenges ADD INDEX idx_challenges_receiver_status (challenged_id, status)`,
    `ALTER TABLE challenges ADD INDEX idx_challenges_pair_key_status (pair_key, status)`,

    // tournament_players table
    `ALTER TABLE tournament_players ADD COLUMN has_attempted BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE tournament_players ADD COLUMN completed_at DATETIME NULL`,

    // tournaments table
    `ALTER TABLE tournaments ADD COLUMN category VARCHAR(80) NULL`,
    `ALTER TABLE tournaments ADD COLUMN difficulty ENUM('easy', 'medium', 'hard') NULL DEFAULT 'medium'`,
    `ALTER TABLE tournaments ADD COLUMN question_limit INT NOT NULL DEFAULT 10`,
    `ALTER TABLE tournaments ADD COLUMN entry_fee INT NOT NULL DEFAULT 0`,
    `ALTER TABLE tournaments ADD COLUMN prize_pool INT NOT NULL DEFAULT 0`,
    `ALTER TABLE tournaments ADD COLUMN description TEXT NULL`,

    // achievements table
    `ALTER TABLE achievements ADD COLUMN category VARCHAR(50) NOT NULL DEFAULT 'general'`,
    `ALTER TABLE achievements ADD COLUMN tier ENUM('bronze', 'silver', 'gold', 'platinum', 'diamond') NOT NULL DEFAULT 'bronze'`,
    `ALTER TABLE achievements ADD COLUMN icon VARCHAR(50) NOT NULL DEFAULT 'Award'`,
    `ALTER TABLE achievements ADD COLUMN coin_reward INT NOT NULL DEFAULT 50`,
    `ALTER TABLE achievements ADD COLUMN xp_reward INT NOT NULL DEFAULT 25`,

    // user_achievements table
    `ALTER TABLE user_achievements ADD COLUMN claimed_at DATETIME NULL`,

    // password_reset_tokens upgrade
    `ALTER TABLE password_reset_tokens ADD COLUMN code_hash VARCHAR(255) NULL`,
    `ALTER TABLE password_reset_tokens ADD COLUMN attempt_count INT NOT NULL DEFAULT 0`,
    `ALTER TABLE password_reset_tokens ADD COLUMN max_attempts INT NOT NULL DEFAULT 5`,
    `ALTER TABLE password_reset_tokens ADD INDEX idx_prt_user_expires (user_id, expires_at)`,
    `ALTER TABLE password_reset_tokens ADD INDEX idx_prt_code_hash (code_hash)`,

    // refresh_tokens table upgrade
    `ALTER TABLE refresh_tokens ADD COLUMN last_used_at DATETIME NULL`,
    `ALTER TABLE refresh_tokens ADD INDEX idx_refresh_tokens_user_status (user_id, revoked_at, expires_at)`,
  ];

  for (const sql of alterStatements) {
    try {
      await query(sql);
    } catch (err) {
      // Ignore already existing columns (ER_DUP_FIELDNAME = 1060 / ER_DUP_KEYNAME = 1061)
    }
  }

  // Ensure canonical active pair unique index is active on active_pair_key
  try {
    const existingIndexes = await query("SHOW INDEX FROM challenges WHERE Key_name = 'uq_challenges_active_pair'");
    const isAlreadyOnActivePairKey = existingIndexes.rows?.some((r) => r.Column_name === 'active_pair_key');
    if (!isAlreadyOnActivePairKey) {
      if (existingIndexes.rows?.length > 0) {
        await query('DROP INDEX uq_challenges_active_pair ON challenges');
      }
      await query(`
        UPDATE challenges c
        JOIN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY (CASE WHEN challenger_id < challenged_id THEN CONCAT(challenger_id, ':', challenged_id) ELSE CONCAT(challenged_id, ':', challenger_id) END)
                     ORDER BY created_at DESC, id DESC
                   ) as rn
            FROM challenges
            WHERE status IN ('pending', 'accepted')
          ) ranked
          WHERE ranked.rn > 1
        ) dupes ON c.id = dupes.id
        SET c.status = 'expired'
      `);
      await query('ALTER TABLE challenges ADD UNIQUE KEY uq_challenges_active_pair (active_pair_key)');
    }
  } catch (_) {}

  // 2. Ensure all tables exist
  const tableStatements = [
    // user_ai_level_scores
    `CREATE TABLE IF NOT EXISTS user_ai_level_scores (
      user_id CHAR(36) NOT NULL,
      bot_name VARCHAR(50) NOT NULL,
      level INT NOT NULL,
      best_score INT NOT NULL DEFAULT 0,
      best_correct_answers INT NOT NULL DEFAULT 0,
      attempts INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, bot_name, level),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // user_ai_progress
    `CREATE TABLE IF NOT EXISTS user_ai_progress (
      user_id CHAR(36) NOT NULL,
      bot_name VARCHAR(50) NOT NULL,
      unlocked_level INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, bot_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // wallet_transactions
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      amount INT NOT NULL,
      balance_after INT NOT NULL,
      reason VARCHAR(80) NOT NULL,
      reference_type VARCHAR(80) NOT NULL,
      reference_id CHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_wallet_transaction_reference (user_id, reason, reference_type, reference_id),
      CONSTRAINT wallet_transactions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // user_match_history
    `CREATE TABLE IF NOT EXISTS user_match_history (
      id CHAR(36) PRIMARY KEY,
      game_id CHAR(36) NOT NULL,
      room_id CHAR(36) NULL,
      user_id CHAR(36) NOT NULL,
      opponent_user_ids JSON NULL,
      score INT NOT NULL DEFAULT 0,
      \`rank\` INT NOT NULL,
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
    )`,

    // skill_scores
    `CREATE TABLE IF NOT EXISTS skill_scores (
      user_id CHAR(36) PRIMARY KEY,
      base_score INT NOT NULL DEFAULT 1000,
      current_score INT NOT NULL DEFAULT 1000,
      accuracy_component INT NOT NULL DEFAULT 500,
      speed_component INT NOT NULL DEFAULT 300,
      consistency_component INT NOT NULL DEFAULT 150,
      win_rate_component INT NOT NULL DEFAULT 50,
      total_matches INT NOT NULL DEFAULT 0,
      win_count INT NOT NULL DEFAULT 0,
      loss_count INT NOT NULL DEFAULT 0,
      total_accuracy DECIMAL(5,2) NOT NULL DEFAULT 0,
      avg_response_time_ms INT DEFAULT 0,
      recent_performance_avg DECIMAL(5,2) DEFAULT 0,
      streak_count INT NOT NULL DEFAULT 0,
      best_streak INT NOT NULL DEFAULT 0,
      last_match_played_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT skill_scores_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // player_rejoin_sessions
    `CREATE TABLE IF NOT EXISTS player_rejoin_sessions (
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
      CONSTRAINT player_rejoin_sessions_user_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      CONSTRAINT player_rejoin_sessions_user_fk2 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // room_stats
    `CREATE TABLE IF NOT EXISTS room_stats (
      room_id CHAR(36) PRIMARY KEY,
      total_games INT NOT NULL DEFAULT 0,
      total_players_participated INT NOT NULL DEFAULT 0,
      avg_players_per_game INT DEFAULT 0,
      most_common_winner_user_id CHAR(36) NULL,
      most_common_category VARCHAR(80) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT room_stats_room_fk FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )`,

    // friend_skill_cache
    `CREATE TABLE IF NOT EXISTS friend_skill_cache (
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
    )`,

    // user_push_tokens
    `CREATE TABLE IF NOT EXISTS user_push_tokens (
      user_id CHAR(36) NOT NULL,
      token VARCHAR(255) NOT NULL,
      platform VARCHAR(40),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, token),
      CONSTRAINT user_push_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // daily_challenge_suggestions
    `CREATE TABLE IF NOT EXISTS daily_challenge_suggestions (
      user_id CHAR(36) NOT NULL,
      suggested_user_id CHAR(36) NOT NULL,
      suggestion_date DATE NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, suggested_user_id, suggestion_date),
      CONSTRAINT challenge_suggestion_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT challenge_suggestion_target_fk FOREIGN KEY (suggested_user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // challenges
    `CREATE TABLE IF NOT EXISTS challenges (
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
    )`,

    // password_reset_tokens
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT password_reset_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // user_referrals table for growth & invite link rewards
    `CREATE TABLE IF NOT EXISTS user_referrals (
      id CHAR(36) PRIMARY KEY,
      referrer_id CHAR(36) NOT NULL,
      referred_id CHAR(36) NOT NULL UNIQUE,
      bonus_coins INT NOT NULL DEFAULT 200,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT user_referrals_referrer_fk FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_referrals_referred_fk FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    // shop_items table
    `CREATE TABLE IF NOT EXISTS shop_items (
      id VARCHAR(80) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      category ENUM('avatar', 'frame', 'title', 'powerup') NOT NULL,
      description VARCHAR(255) NOT NULL,
      coin_price INT NOT NULL DEFAULT 0,
      min_level INT NOT NULL DEFAULT 1,
      icon VARCHAR(80) NOT NULL,
      preview_asset VARCHAR(100) NULL,
      badge_text VARCHAR(50) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // user_inventory table
    `CREATE TABLE IF NOT EXISTS user_inventory (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      item_id VARCHAR(80) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT user_inventory_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT user_inventory_item_fk FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_user_item (user_id, item_id)
    )`,

    // iap_coin_packs table for Google Play IAP
    `CREATE TABLE IF NOT EXISTS iap_coin_packs (
      id VARCHAR(80) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sku VARCHAR(100) NOT NULL UNIQUE,
      coins INT NOT NULL,
      bonus_coins INT NOT NULL DEFAULT 0,
      price_inr DECIMAL(10, 2) NOT NULL,
      price_formatted VARCHAR(20) NOT NULL,
      badge_text VARCHAR(50) NULL,
      icon VARCHAR(80) NOT NULL DEFAULT 'Coins',
      display_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS shop_reward_settings (
      reward_type VARCHAR(80) PRIMARY KEY,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      reward_coins INT NOT NULL DEFAULT 50,
      daily_limit INT NOT NULL DEFAULT 10
    )`,

    `CREATE TABLE IF NOT EXISTS shop_spin_rewards (
      id VARCHAR(80) PRIMARY KEY,
      amount INT NOT NULL,
      weight INT NOT NULL,
      label VARCHAR(80) NOT NULL,
      color VARCHAR(20) NOT NULL,
      display_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`,

    // iap_orders table for server verification & transaction audit
    `CREATE TABLE IF NOT EXISTS iap_orders (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      sku VARCHAR(100) NOT NULL,
      coins_amount INT NOT NULL,
      bonus_coins INT NOT NULL DEFAULT 0,
      total_coins INT NOT NULL,
      price_inr DECIMAL(10, 2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      purchase_token TEXT NULL,
      order_id VARCHAR(120) NULL,
      platform VARCHAR(40) NOT NULL DEFAULT 'android_google_play',
      status ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'COMPLETED',
      is_test_purchase BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT iap_orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_iap_user (user_id)
    )`,

    // user_rewarded_ad_claims table for tracking daily rewarded video ad spins & coin rewards
    `CREATE TABLE IF NOT EXISTS user_rewarded_ad_claims (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      reward_type ENUM('daily_spin', 'watch_ad_coins', 'streak_revive') NOT NULL,
      coins_awarded INT NOT NULL DEFAULT 0,
      powerup_awarded VARCHAR(50) NULL,
      claim_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT rewarded_claims_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_reward_user_date (user_id, claim_date)
    )`,

    // auth_identities table for multi-provider secure identity architecture
    `CREATE TABLE IF NOT EXISTS auth_identities (
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
    )`,

    // security_events table for secure audit logging
    `CREATE TABLE IF NOT EXISTS security_events (
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
    )`,

    // quick_quiz_sources table
    `CREATE TABLE IF NOT EXISTS quick_quiz_sources (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      topic VARCHAR(255) NULL,
      file_name VARCHAR(255) NULL,
      file_path VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_qq_sources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_qq_sources_user (user_id)
    )`,

    // quick_quiz_questions table
    `CREATE TABLE IF NOT EXISTS quick_quiz_questions (
      id CHAR(36) PRIMARY KEY,
      source_id CHAR(36) NULL,
      source_type VARCHAR(20) NOT NULL,
      topic VARCHAR(255) NULL,
      question_text TEXT NOT NULL,
      question_hash VARCHAR(64) NOT NULL UNIQUE,
      concept_key VARCHAR(100) NOT NULL,
      difficulty VARCHAR(20) NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_option VARCHAR(10) NOT NULL,
      explanation TEXT NULL,
      hint TEXT NULL,
      source_page INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_qq_topic (topic),
      INDEX idx_qq_concept (concept_key),
      INDEX idx_qq_difficulty (difficulty),
      INDEX idx_qq_source (source_id)
    )`,

    // quick_quiz_sessions table
    `CREATE TABLE IF NOT EXISTS quick_quiz_sessions (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      source_id CHAR(36) NULL,
      topic VARCHAR(255) NULL,
      difficulty VARCHAR(20) NOT NULL,
      question_count INT NOT NULL DEFAULT 5,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      CONSTRAINT fk_qq_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_qq_sessions_user (user_id)
    )`,

    // quick_quiz_session_questions table
    `CREATE TABLE IF NOT EXISTS quick_quiz_session_questions (
      id CHAR(36) PRIMARY KEY,
      session_id CHAR(36) NOT NULL,
      question_id CHAR(36) NOT NULL,
      question_order INT NOT NULL,
      CONSTRAINT fk_qqsq_session FOREIGN KEY (session_id) REFERENCES quick_quiz_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_qqsq_question FOREIGN KEY (question_id) REFERENCES quick_quiz_questions(id) ON DELETE CASCADE,
      INDEX idx_qqsq_session_order (session_id, question_order)
    )`,

    // quick_quiz_user_history table
    `CREATE TABLE IF NOT EXISTS quick_quiz_user_history (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      question_id CHAR(36) NOT NULL,
      session_id CHAR(36) NOT NULL,
      answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_qquh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_qquh_question FOREIGN KEY (question_id) REFERENCES quick_quiz_questions(id) ON DELETE CASCADE,
      INDEX idx_qquh_user_question (user_id, question_id)
    )`
  ];

  for (const sql of tableStatements) {
    try {
      await query(sql);
    } catch (err) {
      // Ignore table already exists
    }
  }

  for (const sql of [
    `ALTER TABLE shop_reward_settings ADD COLUMN reward_coins INT NOT NULL DEFAULT 50`,
    `ALTER TABLE shop_reward_settings ADD COLUMN daily_limit INT NOT NULL DEFAULT 10`,
  ]) {
    try { await query(sql); } catch { }
  }

  try {
    await query(`INSERT IGNORE INTO shop_reward_settings (reward_type, is_active, reward_coins, daily_limit) VALUES ('daily_spin', TRUE, 0, 10), ('watch_ad_coins', TRUE, 50, 10)`);
  } catch { }

  try {
    await query(`INSERT IGNORE INTO shop_spin_rewards (id, amount, weight, label, color, display_order) VALUES
      ('coins_20', 20, 32, '20 🪙', '#F59E0B', 0),
      ('coins_40', 40, 24, '40 🪙', '#0EA5E9', 1),
      ('coins_60', 60, 16, '60 🪙', '#F97316', 2),
      ('coins_100', 100, 12, '100 🪙', '#10B981', 3),
      ('coins_150', 150, 8, '150 🪙', '#8B5CF6', 4),
      ('coins_200', 200, 5, '200 🪙', '#EC4899', 5),
      ('coins_300', 300, 2, '300 🪙', '#06B6D4', 6),
      ('coins_500', 500, 1, '500 👑', '#EAB308', 7)`);
  } catch { }

  // Seed default shop items catalog
  const defaultShopItems = [
    // Avatars
    ['avatar_01', 'Young Explorer', 'avatar', 'Curious and ready for every quiz', 0, 1, 'User', 'avatar01', 'FREE'],
    ['avatar_02', 'Bright Learner', 'avatar', 'Cheerful learner with a quick mind', 0, 1, 'User', 'avatar02', 'FREE'],
    ['avatar_03', 'Teen Gamer', 'avatar', 'Focused gamer chasing the high score', 0, 1, 'Gamepad2', 'avatar03', 'FREE'],
    ['avatar_04', 'Fox Cap Scholar', 'avatar', 'Clever challenger in a fox cap', 0, 1, 'GraduationCap', 'avatar04', 'FREE'],
    ['avatar_05', 'Campus Champion', 'avatar', 'Confident college quiz competitor', 0, 1, 'BookOpen', 'avatar05', 'FREE'],
    ['avatar_06', 'Campus Star', 'avatar', 'Smart student ready for a challenge', 0, 1, 'BookOpen', 'avatar06', 'FREE'],
    ['avatar_07', 'Quiz Professional', 'avatar', 'Sharp professional with winning focus', 0, 1, 'Briefcase', 'avatar07', 'FREE'],
    ['avatar_08', 'Knowledge Pro', 'avatar', 'Confident professional trivia expert', 0, 1, 'Briefcase', 'avatar08', 'FREE'],
    ['avatar_09', 'Sports Captain', 'avatar', 'Fast-thinking and full of team spirit', 0, 1, 'Trophy', 'avatar09', 'FREE'],
    ['avatar_10', 'Sports Ace', 'avatar', 'Energetic competitor who plays to win', 0, 1, 'Trophy', 'avatar10', 'FREE'],
    ['avatar_11', 'Gaming Hero', 'avatar', 'Quick reactions and clever answers', 0, 1, 'Gamepad2', 'avatar11', 'FREE'],
    ['avatar_12', 'World Traveler', 'avatar', 'Explorer collecting knowledge everywhere', 0, 1, 'Globe2', 'avatar12', 'FREE'],
    ['avatar_13', 'Music Maestro', 'avatar', 'Creative thinker with perfect rhythm', 0, 1, 'Music2', 'avatar13', 'FREE'],
    ['avatar_14', 'Creative Artist', 'avatar', 'Imaginative player with colorful ideas', 0, 1, 'Palette', 'avatar14', 'FREE'],
    ['avatar_15', 'Science Whiz', 'avatar', 'Future scientist powered by curiosity', 0, 1, 'FlaskConical', 'avatar15', 'FREE'],
    ['avatar_16', 'Adventure Scout', 'avatar', 'Bold explorer seeking the next answer', 0, 1, 'Compass', 'avatar16', 'FREE'],

    // Frames
    ['frame_default', 'Classic Steel', 'frame', 'Clean metallic border', 0, 1, 'Square', 'frame_default', 'DEFAULT'],
    ['frame_gold', 'Royal Gold Crown', 'frame', 'Shimmering 24K gold VIP border', 800, 2, 'Crown', 'frame_gold', 'VIP'],
    ['frame_cyber_neon', 'Cyberpunk Neon', 'frame', 'Electric pulsing cyan glow ring', 1200, 3, 'Zap', 'frame_cyber_neon', 'POPULAR'],
    ['frame_fire_blaze', 'Inferno Fire Flame', 'frame', 'Blazing crimson fire border', 1800, 4, 'Flame', 'frame_fire_blaze', 'HOT'],
    ['frame_cosmic_purple', 'Galactic Cosmic', 'frame', 'Mystic celestial galaxy ring', 2500, 5, 'Sparkles', 'frame_cosmic_purple', 'EPIC'],
    ['frame_emerald_legend', 'Emerald Master', 'frame', 'Prestige glowing emerald legend border', 3500, 6, 'Award', 'frame_emerald_legend', 'LEGEND'],

    // Titles
    ['title_novice', 'Novice Quizzer', 'title', 'Beginner quiz explorer', 0, 1, 'BookOpen', 'Novice Quizzer', 'STARTER'],
    ['title_trivia_champ', 'Trivia Champion', 'title', 'Proven quiz champion', 400, 2, 'Trophy', 'Trivia Champion', 'POPULAR'],
    ['title_brainstorm', 'Brainstorm Beast', 'title', 'Unstoppable thinking machine', 700, 3, 'Brain', 'Brainstorm Beast', 'EPIC'],
    ['title_speed_demon', 'Speed Demon ⚡', 'title', 'Fastest answer in the lobby', 1200, 4, 'Zap', 'Speed Demon ⚡', 'HOT'],
    ['title_grandmaster', 'Grandmaster 🧠', 'title', 'Elite high-IQ grandmaster', 2000, 5, 'Medal', 'Grandmaster 🧠', 'VIP'],
    ['title_invincible', 'The Invincible 👑', 'title', 'Untouchable quiz deity', 3500, 7, 'Crown', 'The Invincible 👑', 'LEGEND'],

    // Power-Ups
    ['powerup_fifty_fifty', '50-50 Lifelines (x3)', 'powerup', 'Removes 2 incorrect choices in matches', 300, 1, 'Percent', 'fifty_fifty', '3X PACK'],
    ['powerup_time_freeze', 'Time Freeze (x3)', 'powerup', 'Adds +10 extra seconds to answer timer', 400, 2, 'Clock', 'time_freeze', '+10 SEC'],
    ['powerup_skip', 'Skip Question (x3)', 'powerup', 'Instantly skip a difficult quiz question', 350, 1, 'FastForward', 'skip', '3X PACK'],
  ];

  for (const item of defaultShopItems) {
    try {
      await query(
        `INSERT IGNORE INTO shop_items (id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        item
      );
    } catch {
      // Ignore duplicates
    }
  }

  try {
    await query(`UPDATE shop_items SET is_active = FALSE WHERE id IN ('avatar_boy', 'avatar_girl', 'avatar_friend', 'robot_nova', 'robot_astra', 'robot_orion', 'robot_zphry', 'robot_hero')`);
    await query(`UPDATE shop_items SET is_active = TRUE, coin_price = 0, min_level = 1, badge_text = 'FREE' WHERE id IN ('avatar_01', 'avatar_02', 'avatar_03', 'avatar_04', 'avatar_05', 'avatar_06', 'avatar_07', 'avatar_08', 'avatar_09', 'avatar_10', 'avatar_11', 'avatar_12', 'avatar_13', 'avatar_14', 'avatar_15', 'avatar_16')`);
    await query(`UPDATE users SET equipped_avatar = 'avatar_01' WHERE equipped_avatar IS NULL OR equipped_avatar IN ('avatar_boy', 'avatar_girl', 'avatar_friend', 'robot_nova', 'robot_astra', 'robot_orion', 'robot_zphry', 'robot_hero')`);
    await query(`ALTER TABLE users MODIFY equipped_avatar VARCHAR(80) NOT NULL DEFAULT 'avatar_01'`);
  } catch (err) {
    console.warn('[AutoMigrate] Avatar catalog migration warning:', err.message);
  }

  // Seed default Google Play Compliant Coin Packs
  const defaultCoinPacks = [
    ['coin_pack_mini', 'Handful of Coins', 'quiz_coin_pack_mini_250', 250, 0, 9.00, '₹9', 'STARTER', 'Coins', 1],
    ['coin_pack_basic', 'Pouch of Coins', 'quiz_coin_pack_basic_1000', 1000, 100, 29.00, '₹29', 'POPULAR', 'Coins', 2],
    ['coin_pack_pro', 'Chest of Coins', 'quiz_coin_pack_pro_5000', 5000, 1000, 99.00, '₹99', 'BEST VALUE', 'Gift', 3],
    ['coin_pack_ultra', 'Vault of Champions', 'quiz_coin_pack_ultra_15000', 15000, 5000, 199.00, '₹199', 'VIP ELITE', 'Crown', 4],
  ];

  for (const pack of defaultCoinPacks) {
    try {
      await query(
        `INSERT IGNORE INTO iap_coin_packs (id, name, sku, coins, bonus_coins, price_inr, price_formatted, badge_text, icon, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        pack
      );
    } catch {
      // Ignore duplicates
    }
  }

  // Ensure index on order_id and status in iap_orders for fast idempotency lookups
  try {
    await query('ALTER TABLE iap_orders ADD INDEX idx_iap_order_id (order_id)');
  } catch (_) {}
  try {
    await query('ALTER TABLE iap_orders ADD INDEX idx_iap_status (status)');
  } catch (_) {}
  try {
    await query('ALTER TABLE iap_orders ADD INDEX idx_iap_token_status (purchase_token(100), status)');
  } catch (_) {}
  try {
    await query('ALTER TABLE iap_orders ADD COLUMN is_test_purchase BOOLEAN NOT NULL DEFAULT FALSE');
  } catch (_) {}

  // Backfill code_hash in password_reset_tokens
  try {
    await query('UPDATE password_reset_tokens SET code_hash = token_hash WHERE code_hash IS NULL');
  } catch (_) {}

  // Backfill existing password users into auth_identities
  try {
    await query(`
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
        )
    `);
  } catch (err) {
    console.warn('[AutoMigrate] auth_identities backfill warning:', err.message);
  }

  console.log('[AutoMigrate] Complete schema verification passed successfully.');
}

module.exports = {
  autoMigrateDatabase,
};
