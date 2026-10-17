const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuestionRows } = require('../src/services/question.service');

test('validateQuestionRows validates Excel-style question rows correctly', () => {
  const rows = validateQuestionRows([
    {
      level: 1,
      category: 'Science',
      difficulty: 'easy',
      prompt: 'What is the chemical symbol for water?',
      option_a: 'O',
      option_b: 'H2O',
      option_c: 'NaCl',
      option_d: 'CO2',
      correct_option: 'B',
      hint: 'It is a molecule',
      time_limit_seconds: 20,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, 1);
  assert.equal(rows[0].category, 'Science');
  assert.equal(rows[0].prompt, 'What is the chemical symbol for water?');
  assert.deepEqual(rows[0].options, ['O', 'H2O', 'NaCl', 'CO2']);
  assert.equal(rows[0].correctOption, 'H2O');
  assert.equal(rows[0].explanation, 'It is a molecule');
  assert.equal(rows[0].timeLimitSeconds, 20);
});
