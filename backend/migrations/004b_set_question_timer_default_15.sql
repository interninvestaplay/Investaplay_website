ALTER TABLE questions
  ALTER COLUMN time_limit_seconds SET DEFAULT 15;

UPDATE questions
SET time_limit_seconds = 15
WHERE time_limit_seconds = 20;
