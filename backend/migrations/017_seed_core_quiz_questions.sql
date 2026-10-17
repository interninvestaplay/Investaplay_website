-- Add a durable baseline question set for every built-in category and difficulty.
INSERT INTO categories (id, name, description, status)
VALUES
  (UUID(), 'General', 'A broad mix of everyday trivia and general knowledge.', 'active'),
  (UUID(), 'Science', 'Science questions covering biology, physics, and chemistry.', 'active'),
  (UUID(), 'Mathematics', 'Math questions for arithmetic and number reasoning.', 'active'),
  (UUID(), 'History', 'Historical facts and major milestones.', 'active'),
  (UUID(), 'Technology', 'Questions about computers, software, and devices.', 'active'),
  (UUID(), 'Sports', 'Sports and athletics trivia.', 'active'),
  (UUID(), 'Geography', 'Countries, maps, capitals, and world facts.', 'active'),
  (UUID(), 'Literature', 'Books, authors, and literary terminology.', 'active'),
  (UUID(), 'Entertainment', 'Films, music, and pop culture trivia.', 'active')
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  status = 'active',
  updated_at = NOW();

INSERT INTO questions (
  id,
  source_question_id,
  level,
  category,
  difficulty,
  prompt,
  options,
  correct_option,
  explanation,
  time_limit_seconds
)
VALUES
  (UUID(), 'core-general-easy-1', 1, 'General', 'easy', 'How many continents are there on Earth?', JSON_ARRAY('5', '6', '7', '8'), '7', 'Earth has seven continents.', 15),
  (UUID(), 'core-general-easy-2', 1, 'General', 'easy', 'Which instrument has black and white keys?', JSON_ARRAY('Guitar', 'Piano', 'Trumpet', 'Violin'), 'Piano', 'A piano keyboard has black and white keys.', 15),
  (UUID(), 'core-general-medium-1', 2, 'General', 'medium', 'Which country uses the yen as its currency?', JSON_ARRAY('China', 'Japan', 'South Korea', 'Thailand'), 'Japan', 'The yen is the currency of Japan.', 20),
  (UUID(), 'core-general-medium-2', 2, 'General', 'medium', 'What is the largest internal organ in the human body?', JSON_ARRAY('Heart', 'Liver', 'Lung', 'Kidney'), 'Liver', 'The liver is the largest internal organ.', 20),
  (UUID(), 'core-general-hard-1', 3, 'General', 'hard', 'Which SI base unit measures electric current?', JSON_ARRAY('Volt', 'Watt', 'Ampere', 'Ohm'), 'Ampere', 'Electric current is measured in amperes.', 25),
  (UUID(), 'core-general-hard-2', 3, 'General', 'hard', 'What is the name of the line at zero degrees longitude?', JSON_ARRAY('Equator', 'Tropic of Cancer', 'Prime Meridian', 'International Date Line'), 'Prime Meridian', 'The Prime Meridian is defined as zero degrees longitude.', 25),

  (UUID(), 'core-science-easy-1', 1, 'Science', 'easy', 'What force pulls objects toward Earth?', JSON_ARRAY('Magnetism', 'Gravity', 'Friction', 'Electricity'), 'Gravity', 'Gravity pulls objects toward Earth.', 15),
  (UUID(), 'core-science-easy-2', 1, 'Science', 'easy', 'Which organ pumps blood around the body?', JSON_ARRAY('Brain', 'Liver', 'Heart', 'Lung'), 'Heart', 'The heart pumps blood through the circulatory system.', 15),
  (UUID(), 'core-science-medium-1', 2, 'Science', 'medium', 'Which particle has a negative electric charge?', JSON_ARRAY('Proton', 'Neutron', 'Electron', 'Photon'), 'Electron', 'Electrons carry a negative electric charge.', 20),
  (UUID(), 'core-science-medium-2', 2, 'Science', 'medium', 'A solution with a pH below 7 is described as what?', JSON_ARRAY('Acidic', 'Basic', 'Neutral', 'Radioactive'), 'Acidic', 'A pH value below 7 indicates acidity.', 20),
  (UUID(), 'core-science-hard-1', 3, 'Science', 'hard', 'What is the process in which a solid changes directly into a gas?', JSON_ARRAY('Condensation', 'Sublimation', 'Freezing', 'Evaporation'), 'Sublimation', 'Sublimation changes a solid directly into a gas.', 25),
  (UUID(), 'core-science-hard-2', 3, 'Science', 'hard', 'What is the chemical symbol for tungsten?', JSON_ARRAY('T', 'Tu', 'W', 'Tg'), 'W', 'Tungsten has the chemical symbol W.', 25),

  (UUID(), 'core-mathematics-easy-1', 1, 'Mathematics', 'easy', 'What is 8 plus 5?', JSON_ARRAY('11', '12', '13', '14'), '13', 'Eight plus five equals thirteen.', 15),
  (UUID(), 'core-mathematics-easy-2', 1, 'Mathematics', 'easy', 'Which shape has four equal sides and four right angles?', JSON_ARRAY('Triangle', 'Rectangle', 'Square', 'Circle'), 'Square', 'A square has four equal sides and four right angles.', 15),
  (UUID(), 'core-mathematics-medium-1', 2, 'Mathematics', 'medium', 'What is the perimeter of a square with side length 6?', JSON_ARRAY('12', '18', '24', '36'), '24', 'A square has four sides, so 4 times 6 equals 24.', 20),
  (UUID(), 'core-mathematics-medium-2', 2, 'Mathematics', 'medium', 'Which fraction is equal to 0.75?', JSON_ARRAY('1/2', '2/3', '3/4', '4/5'), '3/4', 'Three quarters written as a decimal is 0.75.', 20),
  (UUID(), 'core-mathematics-hard-1', 3, 'Mathematics', 'hard', 'What is the derivative of x squared with respect to x?', JSON_ARRAY('x', '2x', 'x squared', '2'), '2x', 'The derivative of x squared is 2x.', 25),
  (UUID(), 'core-mathematics-hard-2', 3, 'Mathematics', 'hard', 'What is pi rounded to two decimal places?', JSON_ARRAY('3.12', '3.14', '3.16', '3.18'), '3.14', 'Pi rounded to two decimal places is 3.14.', 25),

  (UUID(), 'core-history-easy-1', 1, 'History', 'easy', 'Which ship carried the Pilgrims to North America in 1620?', JSON_ARRAY('Santa Maria', 'Mayflower', 'Endeavour', 'Beagle'), 'Mayflower', 'The Pilgrims travelled aboard the Mayflower.', 15),
  (UUID(), 'core-history-easy-2', 1, 'History', 'easy', 'Which ancient civilization used hieroglyphics?', JSON_ARRAY('Ancient Egyptians', 'Vikings', 'Aztecs', 'Phoenicians'), 'Ancient Egyptians', 'Ancient Egyptians wrote with hieroglyphics.', 15),
  (UUID(), 'core-history-medium-1', 2, 'History', 'medium', 'Which treaty formally ended World War I?', JSON_ARRAY('Treaty of Paris', 'Treaty of Versailles', 'Treaty of Rome', 'Treaty of Vienna'), 'Treaty of Versailles', 'The Treaty of Versailles formally ended World War I.', 20),
  (UUID(), 'core-history-medium-2', 2, 'History', 'medium', 'Which British leader was known as the Iron Lady?', JSON_ARRAY('Queen Victoria', 'Margaret Thatcher', 'Theresa May', 'Indira Gandhi'), 'Margaret Thatcher', 'Margaret Thatcher was widely known as the Iron Lady.', 20),
  (UUID(), 'core-history-hard-1', 3, 'History', 'hard', 'In which country was the Magna Carta signed in 1215?', JSON_ARRAY('France', 'England', 'Italy', 'Spain'), 'England', 'The Magna Carta was sealed in England in 1215.', 25),
  (UUID(), 'core-history-hard-2', 3, 'History', 'hard', 'Which empire was ruled from Constantinople after the fall of the Western Roman Empire?', JSON_ARRAY('Ottoman Empire', 'Byzantine Empire', 'Mongol Empire', 'Persian Empire'), 'Byzantine Empire', 'The Byzantine Empire was centered on Constantinople.', 25),

  (UUID(), 'core-technology-easy-1', 1, 'Technology', 'easy', 'Which device is commonly used to enter text into a computer?', JSON_ARRAY('Keyboard', 'Monitor', 'Speaker', 'Printer'), 'Keyboard', 'A keyboard is used to type text into a computer.', 15),
  (UUID(), 'core-technology-easy-2', 1, 'Technology', 'easy', 'What does URL stand for?', JSON_ARRAY('Uniform Resource Locator', 'Universal Reading Link', 'User Routing Language', 'Unified Resource Line'), 'Uniform Resource Locator', 'URL stands for Uniform Resource Locator.', 15),
  (UUID(), 'core-technology-medium-1', 2, 'Technology', 'medium', 'Which two digits are used by the binary number system?', JSON_ARRAY('0 and 1', '1 and 2', '2 and 3', '8 and 9'), '0 and 1', 'Binary numbers use only zero and one.', 20),
  (UUID(), 'core-technology-medium-2', 2, 'Technology', 'medium', 'What is a firewall primarily used for?', JSON_ARRAY('Cooling a computer', 'Protecting a network', 'Printing documents', 'Charging a battery'), 'Protecting a network', 'A firewall helps protect networks from unwanted traffic.', 20),
  (UUID(), 'core-technology-hard-1', 3, 'Technology', 'hard', 'Which HTTP status code means Not Found?', JSON_ARRAY('200', '301', '404', '500'), '404', 'HTTP 404 means that a requested resource was not found.', 25),
  (UUID(), 'core-technology-hard-2', 3, 'Technology', 'hard', 'What term describes a decentralized record of transactions?', JSON_ARRAY('Firewall', 'Blockchain', 'Spreadsheet', 'Compiler'), 'Blockchain', 'A blockchain is a decentralized record of transactions.', 25),
  (UUID(), 'core-technology-easy-3', 1, 'Technology', 'easy', 'Which computer part stores files permanently?', JSON_ARRAY('Hard drive', 'Monitor', 'Mouse', 'Keyboard'), 'Hard drive', 'A hard drive stores files even when the computer is turned off.', 15),

  (UUID(), 'core-sports-easy-1', 1, 'Sports', 'easy', 'How many bases are on a baseball field?', JSON_ARRAY('3', '4', '5', '6'), '4', 'A baseball field has four bases.', 15),
  (UUID(), 'core-sports-easy-2', 1, 'Sports', 'easy', 'Which sport includes a scrum?', JSON_ARRAY('Rugby', 'Tennis', 'Swimming', 'Golf'), 'Rugby', 'A scrum is a common restart in rugby.', 15),
  (UUID(), 'core-sports-medium-1', 2, 'Sports', 'medium', 'Which country won the inaugural FIFA World Cup in 1930?', JSON_ARRAY('Brazil', 'Germany', 'Uruguay', 'Italy'), 'Uruguay', 'Uruguay won the first FIFA World Cup in 1930.', 20),
  (UUID(), 'core-sports-medium-2', 2, 'Sports', 'medium', 'What is three strikes in a row called in bowling?', JSON_ARRAY('Hat trick', 'Turkey', 'Triple play', 'Grand slam'), 'Turkey', 'Three consecutive strikes in bowling are called a turkey.', 20),
  (UUID(), 'core-sports-hard-1', 3, 'Sports', 'hard', 'In cricket, how many runs are scored when the ball crosses the boundary without bouncing?', JSON_ARRAY('4', '5', '6', '7'), '6', 'A boundary without a bounce scores six runs in cricket.', 25),
  (UUID(), 'core-sports-hard-2', 3, 'Sports', 'hard', 'Which chess piece moves in an L shape?', JSON_ARRAY('Bishop', 'Knight', 'Rook', 'Queen'), 'Knight', 'The knight moves in an L-shaped pattern.', 25),

  (UUID(), 'core-geography-easy-1', 1, 'Geography', 'easy', 'What is the capital of Japan?', JSON_ARRAY('Kyoto', 'Tokyo', 'Osaka', 'Nagoya'), 'Tokyo', 'Tokyo is the capital of Japan.', 15),
  (UUID(), 'core-geography-easy-2', 1, 'Geography', 'easy', 'Which is the largest hot desert in the world?', JSON_ARRAY('Gobi', 'Sahara', 'Kalahari', 'Atacama'), 'Sahara', 'The Sahara is the largest hot desert.', 15),
  (UUID(), 'core-geography-medium-1', 2, 'Geography', 'medium', 'Which continent has the most countries?', JSON_ARRAY('Africa', 'Asia', 'Europe', 'South America'), 'Africa', 'Africa has the most sovereign countries of any continent.', 20),
  (UUID(), 'core-geography-medium-2', 2, 'Geography', 'medium', 'Which country is home to Machu Picchu?', JSON_ARRAY('Chile', 'Peru', 'Mexico', 'Bolivia'), 'Peru', 'Machu Picchu is located in Peru.', 20),
  (UUID(), 'core-geography-hard-1', 3, 'Geography', 'hard', 'Which strait separates Asia and North America?', JSON_ARRAY('Strait of Gibraltar', 'Bering Strait', 'Bosporus', 'Strait of Malacca'), 'Bering Strait', 'The Bering Strait lies between Asia and North America.', 25),
  (UUID(), 'core-geography-hard-2', 3, 'Geography', 'hard', 'What is the highest mountain above sea level?', JSON_ARRAY('K2', 'Mount Everest', 'Kangchenjunga', 'Makalu'), 'Mount Everest', 'Mount Everest is the highest mountain above sea level.', 25),
  (UUID(), 'core-geography-easy-3', 1, 'Geography', 'easy', 'Which ocean lies between Africa and Australia?', JSON_ARRAY('Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean', 'Southern Ocean'), 'Indian Ocean', 'The Indian Ocean lies between Africa and Australia.', 15),

  (UUID(), 'core-literature-easy-1', 1, 'Literature', 'easy', 'Who wrote the Harry Potter books?', JSON_ARRAY('J. K. Rowling', 'Suzanne Collins', 'Stephen King', 'Roald Dahl'), 'J. K. Rowling', 'J. K. Rowling wrote the Harry Potter series.', 15),
  (UUID(), 'core-literature-easy-2', 1, 'Literature', 'easy', 'What is a story main character called?', JSON_ARRAY('Narrator', 'Protagonist', 'Antagonist', 'Editor'), 'Protagonist', 'The protagonist is the central character in a story.', 15),
  (UUID(), 'core-literature-medium-1', 2, 'Literature', 'medium', 'Which literary device gives human qualities to non-human things?', JSON_ARRAY('Alliteration', 'Personification', 'Hyperbole', 'Onomatopoeia'), 'Personification', 'Personification attributes human qualities to non-human things.', 20),
  (UUID(), 'core-literature-medium-2', 2, 'Literature', 'medium', 'Who wrote Pride and Prejudice?', JSON_ARRAY('Jane Austen', 'Emily Bronte', 'Virginia Woolf', 'Mary Shelley'), 'Jane Austen', 'Jane Austen wrote Pride and Prejudice.', 20),
  (UUID(), 'core-literature-hard-1', 3, 'Literature', 'hard', 'What is a fourteen-line poem traditionally called?', JSON_ARRAY('Haiku', 'Sonnet', 'Limerick', 'Ode'), 'Sonnet', 'A traditional sonnet has fourteen lines.', 25),
  (UUID(), 'core-literature-hard-2', 3, 'Literature', 'hard', 'Who wrote One Hundred Years of Solitude?', JSON_ARRAY('Jorge Luis Borges', 'Gabriel Garcia Marquez', 'Pablo Neruda', 'Isabel Allende'), 'Gabriel Garcia Marquez', 'Gabriel Garcia Marquez wrote One Hundred Years of Solitude.', 25),
  (UUID(), 'core-literature-easy-3', 1, 'Literature', 'easy', 'What do we call a group of lines in a poem?', JSON_ARRAY('Chapter', 'Stanza', 'Paragraph', 'Volume'), 'Stanza', 'A stanza is a grouped set of lines in a poem.', 15),

  (UUID(), 'core-entertainment-easy-1', 1, 'Entertainment', 'easy', 'Which animated film features the character Elsa?', JSON_ARRAY('Moana', 'Frozen', 'Tangled', 'Coco'), 'Frozen', 'Elsa is a main character in Frozen.', 15),
  (UUID(), 'core-entertainment-easy-2', 1, 'Entertainment', 'easy', 'Who played Harry Potter in the film series?', JSON_ARRAY('Daniel Radcliffe', 'Elijah Wood', 'Tom Holland', 'Rupert Grint'), 'Daniel Radcliffe', 'Daniel Radcliffe played Harry Potter in the films.', 15),
  (UUID(), 'core-entertainment-medium-1', 2, 'Entertainment', 'medium', 'Which television series is set in the Seven Kingdoms?', JSON_ARRAY('The Witcher', 'Game of Thrones', 'Stranger Things', 'The Crown'), 'Game of Thrones', 'Game of Thrones is set in the fictional Seven Kingdoms.', 20),
  (UUID(), 'core-entertainment-medium-2', 2, 'Entertainment', 'medium', 'Which instrument traditionally has six strings?', JSON_ARRAY('Flute', 'Guitar', 'Trumpet', 'Drum'), 'Guitar', 'A standard guitar usually has six strings.', 20),
  (UUID(), 'core-entertainment-hard-1', 3, 'Entertainment', 'hard', 'Which composer wrote The Four Seasons?', JSON_ARRAY('Mozart', 'Vivaldi', 'Beethoven', 'Bach'), 'Vivaldi', 'Antonio Vivaldi composed The Four Seasons.', 25),
  (UUID(), 'core-entertainment-hard-2', 3, 'Entertainment', 'hard', 'Who directed the film Inception?', JSON_ARRAY('Christopher Nolan', 'James Cameron', 'Steven Spielberg', 'Denis Villeneuve'), 'Christopher Nolan', 'Christopher Nolan directed Inception.', 25),
  (UUID(), 'core-entertainment-easy-3', 1, 'Entertainment', 'easy', 'Which film series features a character named Luke Skywalker?', JSON_ARRAY('Star Wars', 'Harry Potter', 'Jurassic Park', 'The Lord of the Rings'), 'Star Wars', 'Luke Skywalker is a central character in Star Wars.', 15)
ON DUPLICATE KEY UPDATE
  level = VALUES(level),
  category = VALUES(category),
  difficulty = VALUES(difficulty),
  prompt = VALUES(prompt),
  options = VALUES(options),
  correct_option = VALUES(correct_option),
  explanation = VALUES(explanation),
  time_limit_seconds = VALUES(time_limit_seconds);