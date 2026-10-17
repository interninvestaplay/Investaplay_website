const { randomUUID } = require('crypto');

function insufficientCoinsError() {
  const error = new Error('Insufficient Coins');
  error.status = 402;
  return error;
}

async function applyWalletTransaction({ client, userId, amount, reason, referenceType, referenceId }) {
  const existing = await client.query(
    `SELECT id, amount, balance_after
     FROM wallet_transactions
     WHERE user_id = $1
       AND reason = $2
       AND reference_type = $3
       AND reference_id = $4
     FOR UPDATE`,
    [userId, reason, referenceType, referenceId],
  );

  if (existing.rows[0]) {
    return { ...existing.rows[0], applied: false };
  }

  const userResult = await client.query(
    `SELECT coins
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const nextBalance = Number(user.coins || 0) + Number(amount || 0);
  if (nextBalance < 0) {
    throw insufficientCoinsError();
  }

  await client.query(
    `UPDATE users
     SET coins = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, nextBalance],
  );

  const transaction = {
    id: randomUUID(),
    userId,
    amount: Number(amount || 0),
    balanceAfter: nextBalance,
    reason,
    referenceType,
    referenceId,
  };
  await client.query(
    `INSERT INTO wallet_transactions
       (id, user_id, amount, balance_after, reason, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      transaction.id,
      transaction.userId,
      transaction.amount,
      transaction.balanceAfter,
      transaction.reason,
      transaction.referenceType,
      transaction.referenceId,
    ],
  );

  return { ...transaction, applied: true };
}

module.exports = {
  applyWalletTransaction,
  insufficientCoinsError,
};