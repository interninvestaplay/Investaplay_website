-- Seed a richer, category-specific question set for the quiz app.
INSERT INTO categories (id, name, description, status, created_by)
VALUES
  (UUID(), 'General', 'A broad mix of everyday trivia and general knowledge.', 'active', NULL),
  (UUID(), 'Science', 'Science questions covering biology, physics, and chemistry.', 'active', NULL),
  (UUID(), 'Mathematics', 'Math questions for arithmetic and number reasoning.', 'active', NULL),
  (UUID(), 'History', 'Historical facts and major milestones.', 'active', NULL),
  (UUID(), 'Technology', 'Questions about computers, software, and devices.', 'active', NULL),
  (UUID(), 'Sports', 'Sports and athletics trivia.', 'active', NULL),
  (UUID(), 'Geography', 'Countries, maps, capitals, and world facts.', 'active', NULL),
  (UUID(), 'Literature', 'Books, authors, and literary terminology.', 'active', NULL),
  (UUID(), 'Entertainment', 'Films, music, and pop culture trivia.', 'active', NULL)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  status = VALUES(status),
  updated_at = NOW();

INSERT INTO questions (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
VALUES
  (UUID(), 1, 'General', 'easy', 'Which language is primarily spoken in Brazil?', JSON_ARRAY('Spanish', 'Portuguese', 'French', 'Italian'), 'Portuguese', 'Brazil officially speaks Portuguese.', 15),
  (UUID(), 1, 'General', 'easy', 'What is the largest ocean on Earth?', JSON_ARRAY('Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean', 'Pacific Ocean'), 'Pacific Ocean', 'The Pacific Ocean is the largest ocean.', 15),
  (UUID(), 2, 'General', 'medium', 'What is the capital city of Australia?', JSON_ARRAY('Sydney', 'Melbourne', 'Canberra', 'Perth'), 'Canberra', 'Canberra is the capital of Australia.', 20),
  (UUID(), 1, 'Science', 'easy', 'What planet is known as the Red Planet?', JSON_ARRAY('Venus', 'Mars', 'Mercury', 'Jupiter'), 'Mars', 'Mars is often called the Red Planet because of its reddish appearance.', 15),
  (UUID(), 1, 'Science', 'medium', 'What part of the cell contains genetic material?', JSON_ARRAY('Ribosome', 'Nucleus', 'Cell membrane', 'Cytoplasm'), 'Nucleus', 'The nucleus houses the cell’s genetic material.', 20),
  (UUID(), 2, 'Science', 'easy', 'What gas do plants take in from the atmosphere for photosynthesis?', JSON_ARRAY('Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'), 'Carbon dioxide', 'Plants use carbon dioxide during photosynthesis.', 15),
  (UUID(), 1, 'Mathematics', 'easy', 'What is 9 × 7?', JSON_ARRAY('63', '56', '72', '54'), '63', '9 times 7 equals 63.', 15),
  (UUID(), 1, 'Mathematics', 'medium', 'What is the value of 15% of 200?', JSON_ARRAY('20', '25', '30', '35'), '30', '15% of 200 is 30.', 20),
  (UUID(), 2, 'Mathematics', 'easy', 'Which number is prime?', JSON_ARRAY('21', '27', '29', '33'), '29', '29 is a prime number because it has exactly two factors.', 15),
  (UUID(), 1, 'History', 'easy', 'Who was the first person to walk on the Moon?', JSON_ARRAY('Yuri Gagarin', 'Neil Armstrong', 'Buzz Aldrin', 'John Glenn'), 'Neil Armstrong', 'Neil Armstrong was the first astronaut to walk on the Moon.', 15),
  (UUID(), 1, 'History', 'medium', 'Which ancient civilization built Machu Picchu?', JSON_ARRAY('Romans', 'Maya', 'Inca', 'Greeks'), 'Inca', 'Machu Picchu was built by the Inca civilization.', 20),
  (UUID(), 2, 'History', 'easy', 'What year did the Berlin Wall fall?', JSON_ARRAY('1989', '1991', '1987', '1993'), '1989', 'The Berlin Wall fell in 1989.', 15),
  (UUID(), 1, 'Technology', 'easy', 'What does CPU stand for?', JSON_ARRAY('Central Processing Unit', 'Computer Program Utility', 'Central Program Unit', 'Compact Processing Unit'), 'Central Processing Unit', 'CPU stands for Central Processing Unit.', 15),
  (UUID(), 1, 'Technology', 'medium', 'Which of these is a programming language?', JSON_ARRAY('HTML', 'HTTP', 'SQL', 'CSS'), 'SQL', 'SQL is a programming language used for querying databases.', 20),
  (UUID(), 2, 'Technology', 'easy', 'Which company created the iPhone?', JSON_ARRAY('Google', 'Amazon', 'Apple', 'Microsoft'), 'Apple', 'Apple created the iPhone.', 15),
  (UUID(), 1, 'Sports', 'easy', 'How many players are on the field for one soccer team?', JSON_ARRAY('9', '10', '11', '12'), '11', 'A soccer team has 11 players on the field.', 15),
  (UUID(), 1, 'Sports', 'medium', 'In basketball, how many points is a free throw worth?', JSON_ARRAY('1', '2', '3', '4'), '1', 'A free throw is worth one point.', 20),
  (UUID(), 2, 'Sports', 'easy', 'Which sport uses a shuttlecock?', JSON_ARRAY('Tennis', 'Badminton', 'Golf', 'Rugby'), 'Badminton', 'Badminton uses a shuttlecock.', 15),
  (UUID(), 1, 'Geography', 'easy', 'Which is the largest continent by land area?', JSON_ARRAY('Africa', 'Asia', 'Europe', 'North America'), 'Asia', 'Asia is the largest continent.', 15),
  (UUID(), 1, 'Geography', 'medium', 'What is the capital of France?', JSON_ARRAY('Berlin', 'Madrid', 'Paris', 'Rome'), 'Paris', 'Paris is the capital of France.', 20),
  (UUID(), 2, 'Geography', 'easy', 'Which river is the longest in the world?', JSON_ARRAY('Amazon', 'Nile', 'Yangtze', 'Mississippi'), 'Nile', 'The Nile is often cited as the longest river in the world.', 15),
  (UUID(), 1, 'Literature', 'easy', 'Who wrote the play Romeo and Juliet?', JSON_ARRAY('Charles Dickens', 'Jane Austen', 'William Shakespeare', 'Mark Twain'), 'William Shakespeare', 'Romeo and Juliet was written by William Shakespeare.', 15),
  (UUID(), 1, 'Literature', 'medium', 'Which novel begins with the line “Call me Ishmael”?', JSON_ARRAY('Moby-Dick', 'The Great Gatsby', 'War and Peace', 'Frankenstein'), 'Moby-Dick', 'Moby-Dick begins with that iconic line.', 20),
  (UUID(), 2, 'Literature', 'easy', 'What is the main setting of the novel 1984?', JSON_ARRAY('London', 'Paris', 'New York', 'Berlin'), 'London', '1984 is set in London.', 15),
  (UUID(), 1, 'Entertainment', 'easy', 'Which band released the album Abbey Road?', JSON_ARRAY('The Beatles', 'Queen', 'Coldplay', 'The Rolling Stones'), 'The Beatles', 'Abbey Road is a Beatles album.', 15),
  (UUID(), 1, 'Entertainment', 'medium', 'Which movie features the character Jack Sparrow?', JSON_ARRAY('Titanic', 'Pirates of the Caribbean', 'The Matrix', 'Avatar'), 'Pirates of the Caribbean', 'Jack Sparrow is from Pirates of the Caribbean.', 20),
  (UUID(), 2, 'Entertainment', 'easy', 'What is the name of the fictional African nation in Black Panther?', JSON_ARRAY('Wakanda', 'Zamunda', 'Naboo', 'Genovia'), 'Wakanda', 'Wakanda is the fictional nation in Black Panther.', 15)
ON DUPLICATE KEY UPDATE
  level = VALUES(level),
  category = VALUES(category),
  difficulty = VALUES(difficulty),
  options = VALUES(options),
  correct_option = VALUES(correct_option),
  explanation = VALUES(explanation),
  time_limit_seconds = VALUES(time_limit_seconds);
