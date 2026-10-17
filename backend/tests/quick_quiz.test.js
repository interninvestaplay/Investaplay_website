const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateGenerateInput,
  validateQuestion,
  validateAiResponse,
} = require('../src/modules/quickQuiz/validators/quickQuiz.validator');

const {
  normalizeQuestion,
  hashQuestion,
} = require('../src/modules/quickQuiz/services/duplicate.service');

const {
  buildTopicPrompt,
  buildPdfPrompt,
} = require('../src/modules/quickQuiz/prompts/quizGeneration.prompt');

test('Quick Quiz Validator: validates valid topic input', () => {
  const errors = validateGenerateInput({
    sourceType: 'topic',
    topic: 'Quantum Computing',
    difficulty: 'medium',
    questionCount: 5,
  });
  assert.equal(errors.length, 0);
});

test('Quick Quiz Validator: rejects empty or invalid sourceType', () => {
  const errors = validateGenerateInput({
    sourceType: 'invalid',
    topic: 'Valid Topic',
    difficulty: 'medium',
    questionCount: 5,
  });
  assert.ok(errors.length > 0);
});

test('Quick Quiz Validator: rejects empty or too short topic', () => {
  const errors = validateGenerateInput({
    sourceType: 'topic',
    topic: '   ',
    difficulty: 'medium',
    questionCount: 5,
  });
  assert.ok(errors.length > 0);
});

test('Quick Quiz Validator: validates question count', () => {
  assert.equal(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'medium', questionCount: 5 }).length,
    0
  );
  assert.ok(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'medium', questionCount: 0 }).length > 0
  );
  assert.ok(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'medium', questionCount: 50 }).length > 0
  );
});

test('Quick Quiz Validator: validates difficulty', () => {
  assert.equal(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'easy', questionCount: 5 }).length,
    0
  );
  assert.equal(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'hard', questionCount: 5 }).length,
    0
  );
  assert.ok(
    validateGenerateInput({ sourceType: 'topic', topic: 'Valid Topic', difficulty: 'expert', questionCount: 5 }).length > 0
  );
});

test('Quick Quiz Validator: validates AI question shape', () => {
  const validQ = {
    question: 'What is the speed of light in vacuum?',
    options: ['299,792 km/s', '150,000 km/s', '384,400 km/s', '1,000,000 km/s'],
    correctOption: 0,
    explanation: 'The speed of light in vacuum is approximately 299,792 km/s.',
    difficulty: 'medium',
    conceptKey: 'speed_of_light_vacuum',
  };

  const validation = validateQuestion(validQ, 0, 'topic');
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('Quick Quiz Validator: rejects questions with duplicate options', () => {
  const invalidOptions = {
    question: 'What color is the sky on a clear day?',
    options: ['Blue', 'Blue', 'Green', 'Yellow'],
    correctOption: 0,
    explanation: 'Rayleigh scattering causes the sky to appear blue.',
    difficulty: 'easy',
    conceptKey: 'sky_color',
  };

  const validation = validateQuestion(invalidOptions, 0, 'topic');
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('duplicate options')));
});

test('Duplicate Service: normalizes and hashes questions consistently', () => {
  const q1 = 'What is the capital of France?';
  const q2 = '  what IS  the capital of france?  ';

  assert.equal(normalizeQuestion(q1), normalizeQuestion(q2));
  assert.equal(hashQuestion(q1), hashQuestion(q2));
});

test('Prompt Builder: builds prompt with correct count and difficulty', () => {
  const prompt = buildTopicPrompt({
    topic: 'Artificial Intelligence',
    difficulty: 'medium',
    questionCount: 5,
  });

  assert.ok(prompt.includes('Artificial Intelligence'));
  assert.ok(prompt.includes('medium'));
  assert.ok(prompt.includes('5'));
  assert.ok(prompt.includes('conceptKey'));
});
