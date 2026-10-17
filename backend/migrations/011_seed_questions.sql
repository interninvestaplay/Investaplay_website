-- Seed questions across multiple categories and difficulty levels
INSERT INTO questions (id, level, category, difficulty, prompt, options, correct_option, explanation, time_limit_seconds)
VALUES

-- General Knowledge - Easy (level 1-3)
(UUID(), 1, 'General', 'easy', 'What is the capital of France?', JSON_ARRAY('Berlin', 'Madrid', 'Paris', 'Rome'), 'Paris', 'Paris is the capital and largest city of France.', 15),
(UUID(), 1, 'General', 'easy', 'How many days are in a week?', JSON_ARRAY('5', '6', '8', '7'), '7', 'A week has 7 days.', 15),
(UUID(), 1, 'General', 'easy', 'What color do you get when you mix red and white?', JSON_ARRAY('Orange', 'Pink', 'Purple', 'Yellow'), 'Pink', 'Mixing red and white paint produces pink.', 15),
(UUID(), 2, 'General', 'easy', 'Which planet is known as the Red Planet?', JSON_ARRAY('Venus', 'Jupiter', 'Mars', 'Saturn'), 'Mars', 'Mars is called the Red Planet because of iron oxide on its surface.', 15),
(UUID(), 2, 'General', 'easy', 'How many sides does a triangle have?', JSON_ARRAY('2', '4', '3', '5'), '3', 'A triangle has 3 sides and 3 angles.', 15),
(UUID(), 3, 'General', 'easy', 'What is the largest ocean on Earth?', JSON_ARRAY('Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean', 'Pacific Ocean'), 'Pacific Ocean', 'The Pacific Ocean is the largest and deepest ocean on Earth.', 15),
(UUID(), 3, 'General', 'easy', 'What do bees produce?', JSON_ARRAY('Milk', 'Honey', 'Wax only', 'Sugar'), 'Honey', 'Bees produce honey from flower nectar.', 15),

-- General Knowledge - Medium (level 4-7)
(UUID(), 4, 'General', 'medium', 'In which year did World War II end?', JSON_ARRAY('1943', '1944', '1946', '1945'), '1945', 'World War II ended in 1945 with Germany surrendering in May and Japan in September.', 20),
(UUID(), 5, 'General', 'medium', 'What is the chemical symbol for gold?', JSON_ARRAY('Go', 'Gd', 'Au', 'Ag'), 'Au', 'Gold''s chemical symbol Au comes from the Latin word "aurum".', 20),
(UUID(), 5, 'General', 'medium', 'Which country invented pizza?', JSON_ARRAY('USA', 'Greece', 'Spain', 'Italy'), 'Italy', 'Pizza originated in Naples, Italy in the 18th century.', 20),
(UUID(), 6, 'General', 'medium', 'Who painted the Mona Lisa?', JSON_ARRAY('Michelangelo', 'Raphael', 'Leonardo da Vinci', 'Donatello'), 'Leonardo da Vinci', 'The Mona Lisa was painted by Leonardo da Vinci between 1503 and 1519.', 20),
(UUID(), 7, 'General', 'medium', 'What is the speed of light in a vacuum?', JSON_ARRAY('150,000 km/s', '300,000 km/s', '450,000 km/s', '200,000 km/s'), '300,000 km/s', 'The speed of light in a vacuum is approximately 299,792 km/s.', 20),

-- General Knowledge - Hard (level 8+)
(UUID(), 8, 'General', 'hard', 'What is the smallest country in the world by area?', JSON_ARRAY('Monaco', 'San Marino', 'Vatican City', 'Liechtenstein'), 'Vatican City', 'Vatican City, with an area of 0.44 km², is the world''s smallest country.', 25),
(UUID(), 9, 'General', 'hard', 'In which year was the Eiffel Tower built?', JSON_ARRAY('1885', '1895', '1889', '1901'), '1889', 'The Eiffel Tower was built in 1889 for the World''s Fair in Paris.', 25),
(UUID(), 10, 'General', 'hard', 'What is the longest river in the world?', JSON_ARRAY('Amazon', 'Mississippi', 'Yangtze', 'Nile'), 'Nile', 'The Nile River in Africa is the world''s longest river at approximately 6,650 km.', 25),

-- Science - Easy
(UUID(), 1, 'Science', 'easy', 'What gas do plants absorb from the air?', JSON_ARRAY('Oxygen', 'Nitrogen', 'Hydrogen', 'Carbon Dioxide'), 'Carbon Dioxide', 'Plants absorb carbon dioxide (CO2) and release oxygen during photosynthesis.', 15),
(UUID(), 2, 'Science', 'easy', 'What is the boiling point of water at sea level?', JSON_ARRAY('90°C', '80°C', '100°C', '110°C'), '100°C', 'Water boils at 100°C (212°F) at standard atmospheric pressure.', 15),
(UUID(), 3, 'Science', 'easy', 'Which organ pumps blood around the human body?', JSON_ARRAY('Lungs', 'Liver', 'Brain', 'Heart'), 'Heart', 'The heart is a muscle that pumps blood through the circulatory system.', 15),

-- Science - Medium
(UUID(), 4, 'Science', 'medium', 'What is the powerhouse of the cell?', JSON_ARRAY('Nucleus', 'Ribosome', 'Mitochondria', 'Vacuole'), 'Mitochondria', 'The mitochondria generates most of the cell''s supply of ATP, used as chemical energy.', 20),
(UUID(), 5, 'Science', 'medium', 'How many bones are in the adult human body?', JSON_ARRAY('185', '206', '215', '230'), '206', 'An adult human body has 206 bones.', 20),
(UUID(), 6, 'Science', 'medium', 'What is the chemical formula for water?', JSON_ARRAY('HO2', 'H2O2', 'H3O', 'H2O'), 'H2O', 'Water''s chemical formula is H2O — two hydrogen atoms bonded to one oxygen atom.', 20),
(UUID(), 7, 'Science', 'medium', 'What planet is closest to the Sun?', JSON_ARRAY('Venus', 'Earth', 'Mars', 'Mercury'), 'Mercury', 'Mercury is the closest planet to the Sun in our solar system.', 20),

-- Science - Hard
(UUID(), 8, 'Science', 'hard', 'What is the half-life of Carbon-14?', JSON_ARRAY('About 1,570 years', 'About 5,730 years', 'About 3,200 years', 'About 8,100 years'), 'About 5,730 years', 'Carbon-14 has a half-life of approximately 5,730 years, used in radiocarbon dating.', 25),
(UUID(), 9, 'Science', 'hard', 'Which subatomic particle has no electric charge?', JSON_ARRAY('Proton', 'Electron', 'Photon', 'Neutron'), 'Neutron', 'Neutrons have no electric charge and are found in the nucleus with protons.', 25),
(UUID(), 10, 'Science', 'hard', 'What is the most abundant gas in Earth''s atmosphere?', JSON_ARRAY('Oxygen', 'Carbon Dioxide', 'Argon', 'Nitrogen'), 'Nitrogen', 'Nitrogen makes up about 78% of Earth''s atmosphere.', 25),

-- Mathematics - Easy
(UUID(), 1, 'Mathematics', 'easy', 'What is 12 × 12?', JSON_ARRAY('132', '144', '124', '148'), '144', '12 multiplied by 12 equals 144.', 15),
(UUID(), 2, 'Mathematics', 'easy', 'What is the square root of 81?', JSON_ARRAY('7', '8', '9', '10'), '9', 'The square root of 81 is 9, because 9 × 9 = 81.', 15),
(UUID(), 3, 'Mathematics', 'easy', 'What is 25% of 200?', JSON_ARRAY('40', '50', '60', '45'), '50', '25% of 200 = 0.25 × 200 = 50.', 15),

-- Mathematics - Medium
(UUID(), 4, 'Mathematics', 'medium', 'What is the value of π (pi) to two decimal places?', JSON_ARRAY('3.12', '3.41', '3.21', '3.14'), '3.14', 'Pi (π) is approximately 3.14159, so 3.14 to two decimal places.', 20),
(UUID(), 5, 'Mathematics', 'medium', 'If a triangle has angles of 60° and 80°, what is the third angle?', JSON_ARRAY('30°', '50°', '40°', '45°'), '40°', 'Angles in a triangle sum to 180°. 180 - 60 - 80 = 40°.', 20),
(UUID(), 6, 'Mathematics', 'medium', 'What is the next number in the Fibonacci sequence: 1, 1, 2, 3, 5, 8, ?', JSON_ARRAY('11', '12', '13', '14'), '13', 'Each Fibonacci number is the sum of the two preceding: 5 + 8 = 13.', 20),

-- Mathematics - Hard
(UUID(), 8, 'Mathematics', 'hard', 'What is the derivative of sin(x)?', JSON_ARRAY('-sin(x)', 'tan(x)', '-cos(x)', 'cos(x)'), 'cos(x)', 'The derivative of sin(x) with respect to x is cos(x).', 25),
(UUID(), 9, 'Mathematics', 'hard', 'What is the sum of interior angles of a hexagon?', JSON_ARRAY('540°', '720°', '600°', '660°'), '720°', 'A hexagon has 6 sides. Sum = (6-2) × 180° = 720°.', 25),

-- History - Easy
(UUID(), 1, 'History', 'easy', 'Who was the first President of the United States?', JSON_ARRAY('Thomas Jefferson', 'John Adams', 'George Washington', 'Benjamin Franklin'), 'George Washington', 'George Washington served as the first President of the United States from 1789 to 1797.', 15),
(UUID(), 2, 'History', 'easy', 'In which country was the first Olympic Games held?', JSON_ARRAY('Italy', 'Greece', 'Egypt', 'France'), 'Greece', 'The ancient Olympic Games originated in Olympia, Greece around 776 BC.', 15),
(UUID(), 3, 'History', 'easy', 'What is the Great Wall of China built to protect against?', JSON_ARRAY('Floods', 'Earthquakes', 'Northern invaders', 'Sea pirates'), 'Northern invaders', 'The Great Wall was built to protect Chinese states from northern nomadic invasions.', 15),

-- History - Medium
(UUID(), 5, 'History', 'medium', 'Who discovered America in 1492?', JSON_ARRAY('Amerigo Vespucci', 'Ferdinand Magellan', 'Vasco da Gama', 'Christopher Columbus'), 'Christopher Columbus', 'Christopher Columbus reached the Americas on October 12, 1492.', 20),
(UUID(), 6, 'History', 'medium', 'Which ancient wonder of the world is still standing?', JSON_ARRAY('Colossus of Rhodes', 'Lighthouse of Alexandria', 'Great Pyramid of Giza', 'Temple of Artemis'), 'Great Pyramid of Giza', 'The Great Pyramid of Giza is the only ancient wonder still largely intact.', 20),
(UUID(), 7, 'History', 'medium', 'In which year did the Berlin Wall fall?', JSON_ARRAY('1987', '1991', '1985', '1989'), '1989', 'The Berlin Wall fell on November 9, 1989, marking the end of the Cold War era.', 20),

-- History - Hard
(UUID(), 9, 'History', 'hard', 'What year did the French Revolution begin?', JSON_ARRAY('1776', '1799', '1804', '1789'), '1789', 'The French Revolution began in 1789 with the storming of the Bastille on July 14.', 25),
(UUID(), 10, 'History', 'hard', 'Who was the last pharaoh of ancient Egypt?', JSON_ARRAY('Nefertiti', 'Cleopatra VII', 'Hatshepsut', 'Tutankhamun'), 'Cleopatra VII', 'Cleopatra VII was the last active pharaoh of ancient Egypt before Roman conquest.', 25),

-- Technology - Easy
(UUID(), 1, 'Technology', 'easy', 'What does "www" stand for?', JSON_ARRAY('Wide World Web', 'World Wide Web', 'Web World Wide', 'World Web Wide'), 'World Wide Web', 'WWW stands for World Wide Web, invented by Tim Berners-Lee in 1989.', 15),
(UUID(), 2, 'Technology', 'easy', 'What does CPU stand for?', JSON_ARRAY('Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Computer Processing Utility'), 'Central Processing Unit', 'CPU stands for Central Processing Unit, the main processor of a computer.', 15),
(UUID(), 3, 'Technology', 'easy', 'Which company made the first iPhone?', JSON_ARRAY('Samsung', 'Google', 'Microsoft', 'Apple'), 'Apple', 'Apple Inc. launched the first iPhone on June 29, 2007.', 15),

-- Technology - Medium
(UUID(), 5, 'Technology', 'medium', 'What programming language is primarily used for web styling?', JSON_ARRAY('HTML', 'JavaScript', 'Python', 'CSS'), 'CSS', 'CSS (Cascading Style Sheets) is used to style HTML web pages.', 20),
(UUID(), 6, 'Technology', 'medium', 'What does "HTTP" stand for?', JSON_ARRAY('HyperText Transfer Protocol', 'High Transfer Text Protocol', 'HyperText Transmission Protocol', 'High Tech Transfer Program'), 'HyperText Transfer Protocol', 'HTTP stands for HyperText Transfer Protocol, the foundation of data communication on the web.', 20),
(UUID(), 7, 'Technology', 'medium', 'In computing, what does RAM stand for?', JSON_ARRAY('Read Access Memory', 'Random Access Memory', 'Rapid Application Memory', 'Randomly Accessed Module'), 'Random Access Memory', 'RAM stands for Random Access Memory, temporary storage used by running programs.', 20),

-- Technology - Hard
(UUID(), 8, 'Technology', 'hard', 'Which sorting algorithm has an average time complexity of O(n log n)?', JSON_ARRAY('Bubble Sort', 'Insertion Sort', 'Merge Sort', 'Selection Sort'), 'Merge Sort', 'Merge Sort has an average and worst-case time complexity of O(n log n).', 25),
(UUID(), 9, 'Technology', 'hard', 'What does SQL stand for?', JSON_ARRAY('Structured Query Language', 'Simple Query Language', 'Standard Query Logic', 'Sequential Query Language'), 'Structured Query Language', 'SQL stands for Structured Query Language, used to manage relational databases.', 25),
(UUID(), 10, 'Technology', 'hard', 'What is the binary representation of the decimal number 10?', JSON_ARRAY('1001', '1100', '1010', '0110'), '1010', 'The decimal number 10 in binary is 1010 (8+2 = 10).', 25),

-- Sports - Easy
(UUID(), 1, 'Sports', 'easy', 'How many players are in a standard football (soccer) team?', JSON_ARRAY('9', '10', '12', '11'), '11', 'A standard football team has 11 players including the goalkeeper.', 15),
(UUID(), 2, 'Sports', 'easy', 'In which sport do players use a racket and shuttlecock?', JSON_ARRAY('Tennis', 'Squash', 'Badminton', 'Table Tennis'), 'Badminton', 'Badminton is played with a racket and a feathered shuttlecock.', 15),
(UUID(), 3, 'Sports', 'easy', 'How many rings are on the Olympic flag?', JSON_ARRAY('4', '5', '6', '7'), '5', 'The Olympic flag has 5 interlocking rings representing the 5 inhabited continents.', 15),

-- Sports - Medium
(UUID(), 5, 'Sports', 'medium', 'Which country has won the most FIFA World Cup titles?', JSON_ARRAY('Germany', 'Argentina', 'Italy', 'Brazil'), 'Brazil', 'Brazil has won the FIFA World Cup a record 5 times (1958, 1962, 1970, 1994, 2002).', 20),
(UUID(), 6, 'Sports', 'medium', 'In tennis, what is the term for a score of 40-40?', JSON_ARRAY('Advantage', 'Break point', 'Deuce', 'Set point'), 'Deuce', 'When both players reach 40-40 in tennis, it is called "Deuce".', 20),

-- Sports - Hard
(UUID(), 8, 'Sports', 'hard', 'Which athlete has won the most Olympic gold medals?', JSON_ARRAY('Carl Lewis', 'Usain Bolt', 'Michael Phelps', 'Larisa Latynina'), 'Michael Phelps', 'Michael Phelps holds the record with 23 Olympic gold medals in swimming.', 25),
(UUID(), 9, 'Sports', 'hard', 'In cricket, how many balls are in a standard over?', JSON_ARRAY('4', '5', '8', '6'), '6', 'A standard over in cricket consists of 6 balls bowled by one bowler.', 25)

ON DUPLICATE KEY UPDATE
  prompt = VALUES(prompt);

-- Insert categories if they don't exist
INSERT INTO categories (id, name, description, status)
VALUES
  (UUID(), 'General', 'General knowledge questions covering a wide range of topics', 'active'),
  (UUID(), 'Science', 'Questions covering biology, chemistry, physics and more', 'active'),
  (UUID(), 'Mathematics', 'Arithmetic, algebra, geometry and mathematical concepts', 'active'),
  (UUID(), 'History', 'Historical events, figures and civilizations', 'active'),
  (UUID(), 'Technology', 'Computers, software, internet and modern technology', 'active'),
  (UUID(), 'Sports', 'Sports rules, records and sporting events', 'active')
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  status = VALUES(status);
