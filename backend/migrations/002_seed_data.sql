INSERT INTO achievements (id, code, title, description, target_value)
VALUES
  (UUID(), 'first_win', 'First Win', 'Win your first quiz match.', 1),
  (UUID(), 'quiz_streak', 'Quiz Streak', 'Play quizzes across a 7 day streak.', 7),
  (UUID(), 'speed_solver', 'Speed Solver', 'Answer 20 questions correctly in under 5 seconds.', 20),
  (UUID(), 'room_champ', 'Room Champ', 'Win 10 friend room matches.', 10)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  target_value = VALUES(target_value);
