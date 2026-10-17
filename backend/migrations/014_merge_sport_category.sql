-- Migration to merge "Sport" into canonical "Sports" category safely.

UPDATE questions
SET category = 'Sports'
WHERE category IN ('Sport', 'sport', 'sports', 'SPORTS');

UPDATE rooms
SET category = 'Sports'
WHERE category IN ('Sport', 'sport', 'sports', 'SPORTS');

UPDATE tournaments
SET category = 'Sports'
WHERE category IN ('Sport', 'sport', 'sports', 'SPORTS');

DELETE FROM categories
WHERE name IN ('Sport', 'sport', 'sports', 'SPORTS')
  AND name <> 'Sports';

INSERT INTO categories (id, name, status)
VALUES (UUID(), 'Sports', 'active')
ON DUPLICATE KEY UPDATE status = 'active', updated_at = NOW();
