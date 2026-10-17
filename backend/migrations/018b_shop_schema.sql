ALTER TABLE users ADD COLUMN equipped_avatar VARCHAR(80) NOT NULL DEFAULT 'avatar_01';
ALTER TABLE users ADD COLUMN equipped_frame VARCHAR(80) NOT NULL DEFAULT 'frame_default';
ALTER TABLE users ADD COLUMN equipped_title VARCHAR(80) NOT NULL DEFAULT 'Novice Quizzer';

CREATE TABLE IF NOT EXISTS shop_items (
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
);

CREATE TABLE IF NOT EXISTS user_inventory (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id VARCHAR(80) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_inventory_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_inventory_item_fk FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_user_item (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS iap_coin_packs (
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
);

CREATE TABLE IF NOT EXISTS shop_spin_rewards (
  id VARCHAR(80) PRIMARY KEY,
  amount INT NOT NULL,
  weight INT NOT NULL,
  label VARCHAR(80) NOT NULL,
  color VARCHAR(20) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS iap_orders (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT iap_orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_iap_user (user_id)
);

CREATE TABLE IF NOT EXISTS user_rewarded_ad_claims (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  reward_type ENUM('daily_spin', 'watch_ad_coins', 'streak_revive') NOT NULL,
  coins_awarded INT NOT NULL DEFAULT 0,
  powerup_awarded VARCHAR(50) NULL,
  claim_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rewarded_claims_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reward_user_date (user_id, claim_date)
);
