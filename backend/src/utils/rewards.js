function getSignupBonusCoins() {
  return 1000;
}

function getDefaultEntryFeeCoins() {
  return 100;
}

function getCorrectAnswerRewardCoins() {
  return 100;
}

function canAffordEntryFee(balance, entryFee = getDefaultEntryFeeCoins()) {
  return Number(balance || 0) >= Number(entryFee || 0);
}

module.exports = {
  getSignupBonusCoins,
  getDefaultEntryFeeCoins,
  getCorrectAnswerRewardCoins,
  canAffordEntryFee,
};
