const test = require('node:test');
const assert = require('node:assert/strict');
const { getSignupBonusCoins, getDefaultEntryFeeCoins, canAffordEntryFee } = require('../src/utils/rewards');

test('signup bonus uses the expected default coin amount', () => {
  assert.equal(getSignupBonusCoins(), 1000);
});

test('entry fee uses the expected default coin amount', () => {
  assert.equal(getDefaultEntryFeeCoins(), 100);
});

test('canAffordEntryFee compares balance against the fee', () => {
  assert.equal(canAffordEntryFee(99), false);
  assert.equal(canAffordEntryFee(100), true);
  assert.equal(canAffordEntryFee(250, 150), true);
  assert.equal(canAffordEntryFee(149, 150), false);
});
