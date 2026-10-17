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

DELETE FROM tournaments
WHERE title IN (
  'Quiz Champion League',
  'World Knowledge Quiz',
  'Sports Mania Quiz',
  'Entertainment Quiz'
);

DELETE a FROM answers a
JOIN questions q ON q.id = a.question_id
WHERE q.prompt IN (
  'What is 7 + 8?',
  'What is 9 x 6?',
  'Which planet is known as the Red Planet?',
  'What gas do plants absorb for photosynthesis?',
  'What is the capital of India?',
  'Who was the first President of the United States?',
  'How many players are on a cricket team on the field?',
  'How many days are in a leap year?',
  'Which language is primarily used with React Native?',
  'What is the chemical symbol for gold?',
  'What is the largest ocean on Earth?',
  'What is 12 / 3?'
);

DELETE gq FROM game_questions gq
JOIN questions q ON q.id = gq.question_id
WHERE q.prompt IN (
  'What is 7 + 8?',
  'What is 9 x 6?',
  'Which planet is known as the Red Planet?',
  'What gas do plants absorb for photosynthesis?',
  'What is the capital of India?',
  'Who was the first President of the United States?',
  'How many players are on a cricket team on the field?',
  'How many days are in a leap year?',
  'Which language is primarily used with React Native?',
  'What is the chemical symbol for gold?',
  'What is the largest ocean on Earth?',
  'What is 12 / 3?'
);

DELETE FROM questions
WHERE prompt IN (
  'What is 7 + 8?',
  'What is 9 x 6?',
  'Which planet is known as the Red Planet?',
  'What gas do plants absorb for photosynthesis?',
  'What is the capital of India?',
  'Who was the first President of the United States?',
  'How many players are on a cricket team on the field?',
  'How many days are in a leap year?',
  'Which language is primarily used with React Native?',
  'What is the chemical symbol for gold?',
  'What is the largest ocean on Earth?',
  'What is 12 / 3?'
);

DELETE c FROM categories c
LEFT JOIN questions q ON q.category = c.name
LEFT JOIN tournaments t ON t.category = c.name
WHERE c.name IN ('General', 'Math', 'Science', 'Geography', 'History', 'Sports')
  AND q.id IS NULL
  AND t.id IS NULL;

INSERT INTO categories (id, name)
SELECT UUID(), q.category
FROM questions q
LEFT JOIN categories c ON c.name = q.category
WHERE c.id IS NULL
GROUP BY q.category;
