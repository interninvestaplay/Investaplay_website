INSERT INTO shop_items (id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active)
VALUES
  ('avatar_01', 'Young Explorer', 'avatar', 'Curious and ready for every quiz', 0, 1, 'User', 'avatar01', 'FREE', TRUE),
  ('avatar_02', 'Bright Learner', 'avatar', 'Cheerful learner with a quick mind', 0, 1, 'User', 'avatar02', 'FREE', TRUE),
  ('avatar_03', 'Teen Gamer', 'avatar', 'Focused gamer chasing the high score', 0, 1, 'Gamepad2', 'avatar03', 'FREE', TRUE),
  ('avatar_04', 'Fox Cap Scholar', 'avatar', 'Clever challenger in a fox cap', 0, 1, 'GraduationCap', 'avatar04', 'FREE', TRUE),
  ('avatar_05', 'Campus Champion', 'avatar', 'Confident college quiz competitor', 0, 1, 'BookOpen', 'avatar05', 'FREE', TRUE),
  ('avatar_06', 'Campus Star', 'avatar', 'Smart student ready for a challenge', 0, 1, 'BookOpen', 'avatar06', 'FREE', TRUE),
  ('avatar_07', 'Quiz Professional', 'avatar', 'Sharp professional with winning focus', 0, 1, 'Briefcase', 'avatar07', 'FREE', TRUE),
  ('avatar_08', 'Knowledge Pro', 'avatar', 'Confident professional trivia expert', 0, 1, 'Briefcase', 'avatar08', 'FREE', TRUE),
  ('avatar_09', 'Sports Captain', 'avatar', 'Fast-thinking and full of team spirit', 0, 1, 'Trophy', 'avatar09', 'FREE', TRUE),
  ('avatar_10', 'Sports Ace', 'avatar', 'Energetic competitor who plays to win', 0, 1, 'Trophy', 'avatar10', 'FREE', TRUE),
  ('avatar_11', 'Gaming Hero', 'avatar', 'Quick reactions and clever answers', 0, 1, 'Gamepad2', 'avatar11', 'FREE', TRUE),
  ('avatar_12', 'World Traveler', 'avatar', 'Explorer collecting knowledge everywhere', 0, 1, 'Globe2', 'avatar12', 'FREE', TRUE),
  ('avatar_13', 'Music Maestro', 'avatar', 'Creative thinker with perfect rhythm', 0, 1, 'Music2', 'avatar13', 'FREE', TRUE),
  ('avatar_14', 'Creative Artist', 'avatar', 'Imaginative player with colorful ideas', 0, 1, 'Palette', 'avatar14', 'FREE', TRUE),
  ('avatar_15', 'Science Whiz', 'avatar', 'Future scientist powered by curiosity', 0, 1, 'FlaskConical', 'avatar15', 'FREE', TRUE),
  ('avatar_16', 'Adventure Scout', 'avatar', 'Bold explorer seeking the next answer', 0, 1, 'Compass', 'avatar16', 'FREE', TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), coin_price = 0,
  min_level = 1, icon = VALUES(icon), preview_asset = VALUES(preview_asset),
  badge_text = 'FREE', is_active = TRUE;

UPDATE shop_items
SET is_active = FALSE
WHERE id IN ('avatar_boy', 'avatar_girl', 'avatar_friend', 'robot_nova', 'robot_astra', 'robot_orion', 'robot_zphry', 'robot_hero');

UPDATE users
SET equipped_avatar = 'avatar_01'
WHERE equipped_avatar IS NULL
   OR equipped_avatar IN ('avatar_boy', 'avatar_girl', 'avatar_friend', 'robot_nova', 'robot_astra', 'robot_orion', 'robot_zphry', 'robot_hero');

ALTER TABLE users MODIFY equipped_avatar VARCHAR(80) NOT NULL DEFAULT 'avatar_01';
