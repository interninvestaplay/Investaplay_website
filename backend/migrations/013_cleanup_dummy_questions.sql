-- Safe cleanup migration for dummy/placeholder questions.
-- Only deletes questions with dummy prompts like "General easy challenge..." or containing "everyday knowledge concept".

DELETE a FROM answers a
JOIN questions q ON q.id = a.question_id
WHERE q.prompt LIKE 'General easy challenge%'
   OR q.prompt LIKE '%everyday knowledge concept%';

DELETE gq FROM game_questions gq
JOIN questions q ON q.id = gq.question_id
WHERE q.prompt LIKE 'General easy challenge%'
   OR q.prompt LIKE '%everyday knowledge concept%';

DELETE FROM questions
WHERE prompt LIKE 'General easy challenge%'
   OR prompt LIKE '%everyday knowledge concept%';
