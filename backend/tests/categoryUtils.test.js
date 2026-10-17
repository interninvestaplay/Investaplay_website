const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCategoryName, getCategoryMatchKey, getCategorySearchValues } = require('../src/utils/categoryUtils');

test('normalizeCategoryName canonicalizes common aliases', () => {
  assert.equal(normalizeCategoryName('  science  '), 'Science');
  assert.equal(normalizeCategoryName('maths'), 'Mathematics');
  assert.equal(normalizeCategoryName('sport'), 'Sports');
  assert.equal(normalizeCategoryName('general knowledge'), 'General');
  assert.equal(normalizeCategoryName('Computer Science'), 'Technology');
});

test('getCategoryMatchKey is case-insensitive and trimmed', () => {
  assert.equal(getCategoryMatchKey('  History  '), 'history');
  assert.equal(getCategoryMatchKey('technology'), 'technology');
});

test('getCategorySearchValues keeps canonical and alias forms', () => {
  const values = getCategorySearchValues('General');
  assert.ok(values.includes('general'));
  assert.ok(values.includes('general knowledge'));
});
