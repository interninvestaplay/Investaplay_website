CREATE TABLE IF NOT EXISTS shop_reward_settings (
  reward_type VARCHAR(80) PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  reward_coins INT NOT NULL DEFAULT 50,
  daily_limit INT NOT NULL DEFAULT 10
);

INSERT IGNORE INTO shop_reward_settings (reward_type, is_active)
VALUES ('daily_spin', TRUE), ('watch_ad_coins', TRUE);
