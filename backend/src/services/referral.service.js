const { randomUUID } = require('crypto');
const { query } = require('../db/pool');
const { ensureInviteCode } = require('./invite.service');
const { applyWalletTransaction } = require('./wallet.service');
const { recalculateAchievements } = require('./achievement.service');

async function ensureReferralTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_referrals (
        id CHAR(36) PRIMARY KEY,
        referrer_id CHAR(36) NOT NULL,
        referred_id CHAR(36) NOT NULL UNIQUE,
        bonus_coins INT NOT NULL DEFAULT 200,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT user_referrals_referrer_fk FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT user_referrals_referred_fk FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  } catch {
    // Table already exists or handled by autoMigrate
  }
}

async function getReferralSummary(userId) {
  await ensureReferralTable();
  const inviteCode = await ensureInviteCode(userId);

  const [referralsCountRes, redeemedRes, recentRes] = await Promise.all([
    query(
      'SELECT COUNT(*) AS total, COALESCE(SUM(bonus_coins), 0) AS total_coins FROM user_referrals WHERE referrer_id = $1',
      [userId]
    ),
    query(
      `SELECT r.id, r.created_at, u.display_name AS referrer_name
       FROM user_referrals r
       JOIN users u ON u.id = r.referrer_id
       WHERE r.referred_id = $1`,
      [userId]
    ),
    query(
      `SELECT r.id, r.bonus_coins, r.created_at, u.display_name, u.username, u.avatar_url
       FROM user_referrals r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [userId]
    ),
  ]);

  const referralCount = Number(referralsCountRes.rows[0]?.total || 0);
  const totalCoinsEarned = Number(referralsCountRes.rows[0]?.total_coins || referralCount * 200);
  const redeemed = redeemedRes.rows[0] || null;

  return {
    inviteCode,
    referralCount,
    totalCoinsEarned,
    hasRedeemedCode: Boolean(redeemed),
    referredBy: redeemed ? redeemed.referrer_name : null,
    recentReferrals: recentRes.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name || row.username,
      username: row.username,
      coins: Number(row.bonus_coins || 200),
      createdAt: row.created_at,
    })),
  };
}

async function redeemReferralCode(userId, rawCode) {
  await ensureReferralTable();
  const cleanCode = String(rawCode || '').trim().toUpperCase();

  if (!cleanCode) {
    const error = new Error('Please enter a valid invite code');
    error.status = 400;
    throw error;
  }

  // Check if current user already redeemed an invite code
  const existingRedemption = await query(
    'SELECT id FROM user_referrals WHERE referred_id = $1',
    [userId]
  );
  if (existingRedemption.rows[0]) {
    const error = new Error('You have already redeemed a referral code');
    error.status = 400;
    throw error;
  }

  // Find the referrer by invite code
  const referrerRes = await query(
    'SELECT id, username, display_name FROM users WHERE invite_code = $1 AND deleted_at IS NULL',
    [cleanCode]
  );
  const referrer = referrerRes.rows[0];

  if (!referrer) {
    const error = new Error('Invite code not found. Please check and try again');
    error.status = 404;
    throw error;
  }

  if (referrer.id === userId) {
    const error = new Error('You cannot redeem your own invite code');
    error.status = 400;
    throw error;
  }

  const referralId = randomUUID();
  const REFERRED_BONUS = 100;
  const REFERRER_BONUS = 200;

  // 1. Credit referred user (current user) +100 coins
  const referredTx = await applyWalletTransaction({
    client: { query: (...args) => query(...args) },
    userId,
    amount: REFERRED_BONUS,
    reason: 'referral_signup_bonus',
    referenceType: 'referral',
    referenceId: referrer.id,
  });

  // 2. Credit referrer +200 coins
  await applyWalletTransaction({
    client: { query: (...args) => query(...args) },
    userId: referrer.id,
    amount: REFERRER_BONUS,
    reason: 'referral_reward',
    referenceType: 'referral',
    referenceId: userId,
  });

  // 3. Record in user_referrals
  await query(
    `INSERT INTO user_referrals (id, referrer_id, referred_id, bonus_coins, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [referralId, referrer.id, userId, REFERRER_BONUS]
  );

  // 4. Trigger achievement recalculations in background
  try {
    await Promise.allSettled([
      recalculateAchievements(userId),
      recalculateAchievements(referrer.id),
    ]);
  } catch {
    // Non-blocking
  }

  return {
    success: true,
    bonusCoins: REFERRED_BONUS,
    balance: Number(referredTx.balanceAfter),
    referrerName: referrer.display_name || referrer.username,
  };
}

module.exports = {
  getReferralSummary,
  redeemReferralCode,
};
