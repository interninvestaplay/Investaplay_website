const { randomUUID } = require('crypto');
const { query, connect } = require('../db/pool');
const { applyWalletTransaction } = require('./wallet.service');
const googlePlayService = require('./googlePlay.service');

async function getShopCatalog(userId) {
  const userRes = await query(
    `SELECT coins, level, equipped_avatar, equipped_frame, equipped_title,
            lifeline_fifty_fifty, lifeline_skip, lifeline_time_freeze
     FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRes.rows[0] || {
    coins: 0,
    level: 1,
    equipped_avatar: 'avatar_01',
    equipped_frame: 'frame_default',
    equipped_title: 'Novice Quizzer',
    lifeline_fifty_fifty: 1,
    lifeline_skip: 1,
    lifeline_time_freeze: 0,
  };

  const [catalogRes, inventoryRes] = await Promise.all([
    query(
      `SELECT id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text
       FROM shop_items
       WHERE is_active = TRUE
       ORDER BY category ASC, coin_price ASC`
    ),
    query(
      `SELECT item_id, quantity FROM user_inventory WHERE user_id = $1`,
      [userId]
    ),
  ]);

  const inventoryMap = new Map();
  for (const row of inventoryRes.rows) {
    inventoryMap.set(row.item_id, Number(row.quantity || 1));
  }

  const items = catalogRes.rows.map((item) => {
    const isFree = item.coin_price === 0;
    const isOwned = isFree || inventoryMap.has(item.id);
    const quantity = inventoryMap.get(item.id) || (isFree ? 1 : 0);

    let isEquipped = false;
    if (item.category === 'avatar' && (user.equipped_avatar === item.id || (isFree && !user.equipped_avatar && item.id === 'avatar_01'))) {
      isEquipped = true;
    } else if (item.category === 'frame' && (user.equipped_frame === item.id || (isFree && !user.equipped_frame && item.id === 'frame_default'))) {
      isEquipped = true;
    } else if (item.category === 'title' && (user.equipped_title === item.name || user.equipped_title === item.id || (isFree && !user.equipped_title && item.id === 'title_novice'))) {
      isEquipped = true;
    }

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      description: item.description,
      coinPrice: Number(item.coin_price || 0),
      minLevel: Number(item.min_level || 1),
      icon: item.icon,
      previewAsset: item.preview_asset,
      badgeText: item.badge_text,
      isOwned,
      isEquipped,
      quantity,
      canAfford: user.coins >= item.coin_price,
      isLevelLocked: user.level < item.min_level,
    };
  });

  return {
    items,
    userCoins: Number(user.coins || 0),
    userLevel: Number(user.level || 1),
    equipped: {
      avatar: user.equipped_avatar || 'avatar_01',
      frame: user.equipped_frame || 'frame_default',
      title: user.equipped_title || 'Novice Quizzer',
    },
    lifelines: {
      fiftyFifty: Number(user.lifeline_fifty_fifty || 0),
      skip: Number(user.lifeline_skip || 0),
      timeFreeze: Number(user.lifeline_time_freeze || 0),
    },
  };
}

async function buyShopItem(userId, itemId) {
  if (!itemId) {
    throw new Error('Item ID is required');
  }

  const itemRes = await query(
    `SELECT * FROM shop_items WHERE id = $1 AND is_active = TRUE`,
    [itemId]
  );
  const item = itemRes.rows[0];
  if (!item) {
    throw new Error('Store item not found or unavailable');
  }

  const userRes = await query(
    `SELECT id, coins, level, equipped_avatar, equipped_frame, equipped_title FROM users WHERE id = $1`,
    [userId]
  );
  const user = userRes.rows[0];
  if (!user) {
    throw new Error('User not found');
  }

  if (user.level < item.min_level) {
    throw new Error(`Requires Level ${item.min_level} to unlock`);
  }

  if (user.coins < item.coin_price) {
    throw new Error(`Insufficient coins. You have ${user.coins} 🪙, need ${item.coin_price} 🪙`);
  }

  const isPowerup = item.category === 'powerup';

  // If permanent cosmetic, ensure not already owned
  if (!isPowerup) {
    const invRes = await query(
      `SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2`,
      [userId, itemId]
    );
    if (invRes.rows.length > 0 || item.coin_price === 0) {
      throw new Error('You already own this item');
    }
  }

  // Deduct coins atomically
  const cost = item.coin_price;
  let newBalance = Number(user.coins || 0);
  if (cost > 0) {
    const tx = await applyWalletTransaction({
      client: { query: (...args) => query(...args) },
      userId,
      amount: -cost,
      reason: 'shop_purchase',
      referenceType: 'shop_item',
      referenceId: item.id,
    });
    newBalance = tx.balanceAfter !== undefined ? tx.balanceAfter : newBalance - cost;
  }

  // Update Inventory
  const invId = randomUUID();
  if (isPowerup) {
    await query(
      `INSERT INTO user_inventory (id, user_id, item_id, quantity)
       VALUES ($1, $2, $3, 3)
       ON DUPLICATE KEY UPDATE quantity = quantity + 3`,
      [invId, userId, itemId]
    );

    if (itemId === 'powerup_fifty_fifty') {
      await query(`UPDATE users SET lifeline_fifty_fifty = lifeline_fifty_fifty + 3 WHERE id = $1`, [userId]);
    } else if (itemId === 'powerup_time_freeze') {
      await query(`UPDATE users SET lifeline_time_freeze = lifeline_time_freeze + 3 WHERE id = $1`, [userId]);
    } else if (itemId === 'powerup_skip') {
      await query(`UPDATE users SET lifeline_skip = lifeline_skip + 3 WHERE id = $1`, [userId]);
    }
  } else {
    await query(
      `INSERT INTO user_inventory (id, user_id, item_id, quantity)
       VALUES ($1, $2, $3, 1)`,
      [invId, userId, itemId]
    );

    // Auto-equip newly bought cosmetic item immediately
    if (item.category === 'avatar') {
      await query(`UPDATE users SET equipped_avatar = $1, avatar_url = $2 WHERE id = $3`, [itemId, item.preview_asset || null, userId]);
    } else if (item.category === 'frame') {
      await query(`UPDATE users SET equipped_frame = $1 WHERE id = $2`, [itemId, userId]);
    } else if (item.category === 'title') {
      await query(`UPDATE users SET equipped_title = $1 WHERE id = $2`, [item.name, userId]);
    }
  }

  return {
    success: true,
    balance: newBalance,
    item: {
      id: item.id,
      name: item.name,
      category: item.category,
      coinPrice: item.coin_price,
    },
    message: `Purchased ${item.name}!`,
  };
}

async function equipShopItem(userId, itemId) {
  if (!itemId) {
    throw new Error('Item ID is required');
  }

  const itemRes = await query(
    `SELECT * FROM shop_items WHERE id = $1 AND is_active = TRUE`,
    [itemId]
  );
  const item = itemRes.rows[0];
  if (!item) {
    throw new Error('Item not found');
  }

  if (item.category === 'powerup') {
    throw new Error('Power-ups cannot be equipped');
  }

  // Verify ownership (unless free item with coin_price === 0)
  if (item.coin_price > 0) {
    const invRes = await query(
      `SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2`,
      [userId, itemId]
    );
    if (invRes.rows.length === 0) {
      throw new Error('You do not own this item. Purchase it in the shop first.');
    }
  }

  if (item.category === 'avatar') {
    await query(`UPDATE users SET equipped_avatar = $1, avatar_url = $2 WHERE id = $3`, [itemId, item.preview_asset || null, userId]);
  } else if (item.category === 'frame') {
    await query(`UPDATE users SET equipped_frame = $1 WHERE id = $2`, [itemId, userId]);
  } else if (item.category === 'title') {
    await query(`UPDATE users SET equipped_title = $1 WHERE id = $2`, [item.name, userId]);
  }

  return {
    success: true,
    category: item.category,
    equippedId: itemId,
    equippedName: item.name,
    avatarUrl: item.category === 'avatar' ? item.preview_asset : undefined,
  };
}

async function getCoinPacks() {
  const packsRes = await query(
    `SELECT id, name, sku, coins, bonus_coins, price_inr, price_formatted, badge_text, icon, display_order
     FROM iap_coin_packs
     WHERE is_active = TRUE
     ORDER BY display_order ASC, price_inr ASC`
  );

  return packsRes.rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    coins: Number(p.coins || 0),
    bonusCoins: Number(p.bonus_coins || 0),
    totalCoins: Number(p.coins || 0) + Number(p.bonus_coins || 0),
    priceInr: Number(p.price_inr || 0),
    priceFormatted: p.price_formatted,
    badgeText: p.badge_text,
    icon: p.icon || 'Coins',
  }));
}

async function verifyAndCreditCoinPurchase(userId, { sku, purchaseToken, orderId, platform = 'android_google_play' }) {
  if (!sku) {
    throw new Error('SKU / Product ID is required for coin purchase');
  }

  if (!purchaseToken || typeof purchaseToken !== 'string' || !purchaseToken.trim()) {
    throw new Error('Google Play purchase token is required for purchase verification');
  }

  const trimmedToken = purchaseToken.trim();
  const lowerToken = trimmedToken.toLowerCase();

  // Reject any fake or simulated tokens immediately
  if (
    lowerToken.startsWith('mock_') ||
    lowerToken.startsWith('fake_') ||
    lowerToken.startsWith('gp_token_') ||
    lowerToken.includes('simulated')
  ) {
    throw new Error('Simulated or mock purchase tokens are not permitted. Real Google Play purchase token required.');
  }

  // Retrieve coin pack from database
  const packRes = await query(
    `SELECT * FROM iap_coin_packs WHERE (sku = $1 OR id = $1)`,
    [sku]
  );
  const pack = packRes.rows[0];
  if (!pack) {
    throw new Error('Coin pack not found');
  }

  if (!pack.is_active) {
    throw new Error('This coin pack is currently hidden or disabled from purchase');
  }

  // Idempotency: Prevent replay / duplicate purchase crediting
  // 1. Check if this purchaseToken has already been fulfilled
  const existingTokenOrder = await query(
    `SELECT id, status, total_coins, order_id, is_test_purchase FROM iap_orders WHERE purchase_token = $1 AND status = 'COMPLETED'`,
    [trimmedToken]
  );
  if (existingTokenOrder.rows.length > 0) {
    const userRes = await query(`SELECT coins FROM users WHERE id = $1`, [userId]);
    return {
      success: true,
      alreadyProcessed: true,
      balance: Number(userRes.rows[0]?.coins || 0),
      orderId: existingTokenOrder.rows[0].order_id,
      isTestPurchase: Boolean(existingTokenOrder.rows[0].is_test_purchase),
      message: 'Purchase has already been fulfilled to your account',
    };
  }

  // 2. Check if this orderId has already been completed (when provided)
  if (orderId && typeof orderId === 'string' && orderId.trim()) {
    const existingOrderId = await query(
      `SELECT id, status, total_coins, is_test_purchase FROM iap_orders WHERE order_id = $1 AND status = 'COMPLETED'`,
      [orderId.trim()]
    );
    if (existingOrderId.rows.length > 0) {
      const userRes = await query(`SELECT coins FROM users WHERE id = $1`, [userId]);
      return {
        success: true,
        alreadyProcessed: true,
        balance: Number(userRes.rows[0]?.coins || 0),
        orderId: orderId.trim(),
        isTestPurchase: Boolean(existingOrderId.rows[0].is_test_purchase),
        message: 'Order already fulfilled',
      };
    }
  }

  const userRes = await query(`SELECT id, coins FROM users WHERE id = $1`, [userId]);
  const user = userRes.rows[0];
  if (!user) {
    throw new Error('User not found');
  }

  // Verify purchase with Google Play Developer API
  const verification = await googlePlayService.verifyProductPurchase({
    productId: pack.sku,
    token: trimmedToken,
    orderId,
  });

  const isTest = Boolean(verification.isTestPurchase);
  const targetOrderId = verification.orderId || orderId || null;

  // Handle Pending State
  if (verification.status === 'PENDING') {
    const pendingId = randomUUID();
    await query(
      `INSERT INTO iap_orders (id, user_id, sku, coins_amount, bonus_coins, total_coins, price_inr, currency, purchase_token, order_id, platform, status, is_test_purchase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, $9, $10, 'PENDING', $11)
       ON DUPLICATE KEY UPDATE status = 'PENDING'`,
      [pendingId, userId, pack.sku, Number(pack.coins || 0), Number(pack.bonus_coins || 0), Number(pack.coins || 0) + Number(pack.bonus_coins || 0), pack.price_inr, trimmedToken, targetOrderId, platform, isTest]
    );

    return {
      success: false,
      status: 'PENDING',
      orderId: targetOrderId,
      balance: Number(user.coins || 0),
      isTestPurchase: isTest,
      message: 'Your Google Play purchase is currently pending. Coins will be credited once payment is completed.',
    };
  }

  // Handle Cancelled State
  if (verification.status === 'CANCELLED') {
    const failedId = randomUUID();
    await query(
      `INSERT INTO iap_orders (id, user_id, sku, coins_amount, bonus_coins, total_coins, price_inr, currency, purchase_token, order_id, platform, status, is_test_purchase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, $9, $10, 'FAILED', $11)`,
      [failedId, userId, pack.sku, Number(pack.coins || 0), Number(pack.bonus_coins || 0), Number(pack.coins || 0) + Number(pack.bonus_coins || 0), pack.price_inr, trimmedToken, targetOrderId, platform, isTest]
    );

    return {
      success: false,
      status: 'CANCELLED',
      orderId: targetOrderId,
      balance: Number(user.coins || 0),
      isTestPurchase: isTest,
      message: 'The purchase was cancelled.',
    };
  }

  // Handle Failed or Invalid State
  if (!verification.valid || verification.status !== 'COMPLETED') {
    const failedId = randomUUID();
    await query(
      `INSERT INTO iap_orders (id, user_id, sku, coins_amount, bonus_coins, total_coins, price_inr, currency, purchase_token, order_id, platform, status, is_test_purchase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, $9, $10, 'FAILED', $11)`,
      [failedId, userId, pack.sku, Number(pack.coins || 0), Number(pack.bonus_coins || 0), Number(pack.coins || 0) + Number(pack.bonus_coins || 0), pack.price_inr, trimmedToken, targetOrderId, platform, isTest]
    );

    throw new Error(verification.message || 'Google Play purchase verification failed');
  }

  // Credit coins + bonus coins atomically based strictly on database definition (NEVER client values)
  const coins = Number(pack.coins || 0);
  const bonusCoins = Number(pack.bonus_coins || 0);
  const totalCoins = coins + bonusCoins;
  const currentCoins = Number(user.coins || 0);

  // Record completed IAP order for auditing & preventing replays
  const iapId = randomUUID();

  // Credit wallet atomically
  const tx = await applyWalletTransaction({
    client: { query: (...args) => query(...args) },
    userId,
    amount: totalCoins,
    reason: 'iap_purchase',
    referenceType: 'iap_order',
    referenceId: targetOrderId || iapId,
  });

  await query(
    `INSERT INTO iap_orders (id, user_id, sku, coins_amount, bonus_coins, total_coins, price_inr, currency, purchase_token, order_id, platform, status, is_test_purchase)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8, $9, $10, 'COMPLETED', $11)`,
    [iapId, userId, pack.sku, coins, bonusCoins, totalCoins, pack.price_inr, trimmedToken, targetOrderId, platform, isTest]
  );

  // Consume the consumable coin pack on Google Play after successful verification and crediting.
  // Note: Consuming automatically satisfies Google Play acknowledgement for consumables.
  // Do NOT call acknowledgePurchase separately.
  try {
    await googlePlayService.consumePurchase({
      productId: pack.sku,
      token: trimmedToken,
    });
  } catch (consumeErr) {
    console.warn('[ShopService] Post-fulfillment consume warning:', consumeErr.message);
  }

  return {
    success: true,
    status: 'COMPLETED',
    balance: tx.balanceAfter !== undefined ? tx.balanceAfter : currentCoins + totalCoins,
    coinsAdded: totalCoins,
    baseCoins: coins,
    bonusCoins,
    packName: pack.name,
    orderId: targetOrderId,
    isTestPurchase: isTest,
    message: isTest
      ? `[TEST] Successfully credited ${totalCoins.toLocaleString()} Coins! (Google Play Test Account)`
      : `Successfully credited ${totalCoins.toLocaleString()} Coins!`,
  };
}

const DAILY_MAX_SPINS = 10;
const DAILY_MAX_AD_COINS = 10;

const SPIN_PRIZES = [
  { id: 'coins_20', type: 'coins', amount: 20, label: '20 🪙', weight: 32, color: '#F59E0B' },
  { id: 'coins_40', type: 'coins', amount: 40, label: '40 🪙', weight: 24, color: '#0EA5E9' },
  { id: 'coins_60', type: 'coins', amount: 60, label: '60 🪙', weight: 16, color: '#F97316' },
  { id: 'coins_100', type: 'coins', amount: 100, label: '100 🪙', weight: 12, color: '#10B981' },
  { id: 'coins_150', type: 'coins', amount: 150, label: '150 🪙', weight: 8, color: '#8B5CF6' },
  { id: 'coins_200', type: 'coins', amount: 200, label: '200 🪙', weight: 5, color: '#EC4899' },
  { id: 'coins_300', type: 'coins', amount: 300, label: '300 🪙', weight: 2, color: '#06B6D4' },
  { id: 'coins_500', type: 'coins', amount: 500, label: '500 👑', weight: 1, color: '#EAB308' },
];

function chooseWeightedPrize(prizes) {
  const totalWeight = prizes.reduce((total, prize) => total + Math.max(0, Number(prize.weight || 0)), 0);
  if (totalWeight <= 0) return prizes[0];
  let roll = Math.random() * totalWeight;
  for (const prize of prizes) {
    roll -= Math.max(0, Number(prize.weight || 0));
    if (roll < 0) return prize;
  }
  return prizes[prizes.length - 1];
}

// Returns whether `spins` positive-value prizes can add up to `target` exactly.
// This is intentionally evaluated from the live prize list: it prevents an early
// spin from making the configured daily cap impossible to reach on the final spin.
function canReachExactTotal(target, spins, prizes, memo = new Map()) {
  const key = `${target}:${spins}`;
  if (memo.has(key)) return memo.get(key);
  if (spins === 0) return target === 0;
  if (target <= 0) return false;
  const result = prizes.some((prize) => {
    const amount = Number(prize.amount || 0);
    return amount > 0 && amount <= target && canReachExactTotal(target - amount, spins - 1, prizes, memo);
  });
  memo.set(key, result);
  return result;
}

// Prize values and weights are read on every request so an Admin change takes
// effect immediately. The constant above is only a legacy fallback for installs
// that have not run the migration yet.
async function getActiveSpinPrizes(client = { query }) {
  try {
    const result = await client.query(
      `SELECT id, amount, weight, label, color
       FROM shop_spin_rewards
       WHERE is_active = TRUE
       ORDER BY display_order ASC`,
    );
    if (result.rows.length) {
      return result.rows.map((prize) => ({
        id: prize.id,
        type: 'coins',
        amount: Number(prize.amount),
        weight: Number(prize.weight),
        label: prize.label,
        color: prize.color,
      }));
    }
  } catch {
    // Legacy database: retain the established wheel until migrations run.
  }
  return SPIN_PRIZES;
}

async function getDailyRewardStatus(userId) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const settingsRes = await query(`SELECT reward_type, reward_coins, daily_limit FROM shop_reward_settings`);
  const settings = new Map(settingsRes.rows.map((row) => [row.reward_type, row]));
  const spinSettings = settings.get('daily_spin') || { reward_coins: 0, daily_limit: DAILY_MAX_SPINS };
  const adSettings = settings.get('watch_ad_coins') || { reward_coins: 50, daily_limit: DAILY_MAX_AD_COINS };
  const maxSpins = Math.max(1, Number(spinSettings.daily_limit || DAILY_MAX_SPINS));
  const maxAdCoins = Math.max(1, Number(adSettings.daily_limit || DAILY_MAX_AD_COINS));

  // Count today's spin claims
  const spinClaimsRes = await query(
    `SELECT COUNT(*) as claim_count
     FROM user_rewarded_ad_claims
     WHERE user_id = $1 AND claim_date = $2 AND reward_type = 'daily_spin'`,
    [userId, todayStr]
  );
  const spinClaims = Number(spinClaimsRes.rows[0]?.claim_count || 0);

  // Count today's ad-coin claims
  const adCoinClaimsRes = await query(
    `SELECT COUNT(*) as claim_count
     FROM user_rewarded_ad_claims
     WHERE user_id = $1 AND claim_date = $2 AND reward_type = 'watch_ad_coins'`,
    [userId, todayStr]
  );
  const adCoinClaims = Number(adCoinClaimsRes.rows[0]?.claim_count || 0);

  // Total coins awarded today via spins (only meaningful when coin cap is active)
  let coinsAwardedToday = 0;
  let coinsRemaining = undefined;
  let coinsCap = undefined;
  if (spinClaims > 0) {
    const coinsRes = await query(
      `SELECT COALESCE(SUM(coins_awarded), 0) as total_awarded
       FROM user_rewarded_ad_claims
       WHERE user_id = $1 AND claim_date = $2 AND reward_type = 'daily_spin'`,
      [userId, todayStr]
    );
    coinsAwardedToday = Number(coinsRes.rows[0]?.total_awarded || 0);
  }
  // Coin cap info for display (derived from spin settings)
  const spinConfiguredCoins = Math.max(0, Number(spinSettings.reward_coins || 0));
  if (spinConfiguredCoins > 0) {
    coinsCap = spinConfiguredCoins;
    coinsRemaining = Math.max(0, coinsCap - coinsAwardedToday);
  }

  const spinPrizes = await getActiveSpinPrizes();
  return {
    today: todayStr,
    spinsRemaining: Math.max(0, maxSpins - spinClaims),
    maxSpinsPerDay: maxSpins,
    spinsUsedToday: spinClaims,
    adCoinsRemaining: Math.max(0, maxAdCoins - adCoinClaims),
    maxAdCoinsPerDay: maxAdCoins,
    adCoinsUsedToday: adCoinClaims,
    adCoinRewardAmount: Math.max(0, Number(adSettings.reward_coins || 50)),
    // Show total coins awarded today via spins (for info)
    coinsAwardedToday,
    // Coin cap fields (when reward_coins > 0 for daily_spin)
    coinsRemaining,
    coinsCap,
    prizes: spinPrizes.map((p, idx) => ({
      index: idx,
      id: p.id,
      label: p.label,
      type: p.type,
      amount: p.amount,
      color: p.color,
    })),
  };
}

async function claimDailyRewardedAdLegacy(userId, { rewardType = 'daily_spin' }) {
  const rewardSetting = await query(`SELECT is_active FROM shop_reward_settings WHERE reward_type = $1`, [rewardType]);
  if (rewardSetting.rows[0] && !rewardSetting.rows[0].is_active) {
    throw new Error('This free reward is currently unavailable');
  }
  const settingsRes = await query(`SELECT reward_coins, daily_limit FROM shop_reward_settings WHERE reward_type = $1`, [rewardType]);
  const settings = settingsRes.rows[0] || {};
  const todayStr = new Date().toISOString().slice(0, 10);

  const claimsRes = await query(
    `SELECT COUNT(*) as claim_count
     FROM user_rewarded_ad_claims
     WHERE user_id = $1 AND claim_date = $2 AND reward_type = $3`,
    [userId, todayStr, rewardType]
  );
  const usedToday = Number(claimsRes.rows[0]?.claim_count || 0);

  // Check daily limit and coin cap
  const limit = Math.max(1, Number(settings.daily_limit || (rewardType === 'daily_spin' ? DAILY_MAX_SPINS : DAILY_MAX_AD_COINS)));
  const configuredCoins = Math.max(0, Number(settings.reward_coins || 0));

  // For daily_spin: if reward_coins > 0, use it as coin cap
  // daily_limit = max spins, reward_coins = max total coins
  const useCoinCap = rewardType === 'daily_spin' && configuredCoins > 0;
  const coinCap = useCoinCap ? configuredCoins : 0;
  let totalAwardedToday = 0;

  if (useCoinCap) {
    // In coin cap mode, check total coins awarded today
    const todayCoinsRes = await query(
      `SELECT COALESCE(SUM(coins_awarded), 0) as total_awarded
       FROM user_rewarded_ad_claims
       WHERE user_id = $1 AND claim_date = $2 AND reward_type = $3`,
      [userId, todayStr, rewardType]
    );
    totalAwardedToday = Number(todayCoinsRes.rows[0]?.total_awarded || 0);

    // Check if coin cap already reached - block and ask to watch ads
    if (totalAwardedToday >= coinCap) {
      throw new Error(`Daily coin limit reached for today (${coinCap}/${coinCap} coins). Watch a video ad to earn more spins!`);
    }
  }

  // Check spin limit (max number of spins)
  if (rewardType === 'daily_spin' && usedToday >= limit) {
    throw new Error(`Daily spin limit reached for today (${limit}/${limit} spins used). Watch a video ad to earn more spins!`);
  }

  let selectedPrize = null;
  let coinsAwarded = 0;
  let powerupAwarded = null;

  if (rewardType === 'daily_spin') {
    // Always use the weighted wheel for spins - never give fixed amount
    // Use a proper weighted random selection with cumulative distribution
    const totalWeight = SPIN_PRIZES.reduce((acc, p) => acc + p.weight, 0);
    // Generate random number with full precision
    const rand = Math.floor(Math.random() * totalWeight);
    let cumulativeWeight = 0;
    let selectedIndex = 0;
    for (let i = 0; i < SPIN_PRIZES.length; i++) {
      cumulativeWeight += SPIN_PRIZES[i].weight;
      if (rand < cumulativeWeight) {
        selectedIndex = i;
        break;
      }
    }
    // Fallback to first prize if something goes wrong
    if (selectedIndex === 0 && rand >= cumulativeWeight) {
      selectedIndex = 0;
    }
    selectedPrize = { ...SPIN_PRIZES[selectedIndex], index: selectedIndex, prizeIndex: selectedIndex };
    coinsAwarded = selectedPrize.amount;

    // NO coin cap enforcement - each spin gives full random prize
    // Just award whatever the wheel shows
    coinsAwarded = selectedPrize.amount;

    // No capping logic here - let user get full random coins each spin
  } else if (rewardType === 'watch_ad_coins') {
    coinsAwarded = Math.max(0, Number(settings.reward_coins || 50));
    selectedPrize = { id: 'watch_ad_coins', type: 'coins', amount: coinsAwarded, label: `${coinsAwarded} Coins`, index: 0 };
  }

  const claimId = randomUUID();

  // Credit coins atomically
  let newBalance = 0;
  if (coinsAwarded > 0) {
    const tx = await applyWalletTransaction({
      client: { query: (...args) => query(...args) },
      userId,
      amount: coinsAwarded,
      reason: 'rewarded_ad_payout',
      referenceType: 'rewarded_ad',
      referenceId: claimId,
    });
    newBalance = tx.balanceAfter;
  } else {
    const userRes = await query(`SELECT coins FROM users WHERE id = $1`, [userId]);
    newBalance = Number(userRes.rows[0]?.coins || 0);
  }

  // Record claim
  await query(
    `INSERT INTO user_rewarded_ad_claims (id, user_id, reward_type, coins_awarded, powerup_awarded, claim_date)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [claimId, userId, rewardType, coinsAwarded, powerupAwarded, todayStr]
  );

  return {
    success: true,
    rewardType,
    prize: selectedPrize,
    coinsAwarded,
    powerupAwarded,
    balance: newBalance,
    // Show remaining spins
    spinsRemaining: rewardType === 'daily_spin'
      ? Math.max(0, limit - (usedToday + 1))
      : undefined,
    spinsUsedToday: rewardType === 'daily_spin'
      ? usedToday + 1
      : undefined,
    maxSpinsPerDay: rewardType === 'daily_spin'
      ? limit
      : undefined,
    adCoinsRemaining: rewardType === 'watch_ad_coins'
      ? Math.max(0, DAILY_MAX_AD_COINS - (usedToday + 1))
      : undefined,
    // Coin cap info (if active)
    coinsRemaining: useCoinCap
      ? Math.max(0, coinCap - (totalAwardedToday + coinsAwarded))
      : undefined,
    coinsCap: useCoinCap ? coinCap : undefined,
    // Total coins awarded today
    coinsAwardedToday: totalAwardedToday,
    message: `Won +${coinsAwarded} Coins! 🪙`,
  };
}

async function claimDailyRewardedAd(userId, { rewardType = 'daily_spin' }) {
  const client = await connect();
  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    await client.beginTransaction();
    // Lock the user, setting, and claims. Concurrent requests wait, then
    // recalculate from the committed daily total instead of double-awarding.
    const userLock = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (!userLock.rows[0]) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }
    const settingsRes = await client.query(
      `SELECT is_active, reward_coins, daily_limit FROM shop_reward_settings WHERE reward_type = $1 FOR UPDATE`,
      [rewardType],
    );
    const settings = settingsRes.rows[0] || {};
    if (settingsRes.rows[0] && !settings.is_active) throw new Error('This free reward is currently unavailable');

    const claimsRes = await client.query(
      `SELECT coins_awarded FROM user_rewarded_ad_claims
       WHERE user_id = $1 AND claim_date = $2 AND reward_type = $3 FOR UPDATE`,
      [userId, todayStr, rewardType],
    );
    const usedToday = claimsRes.rows.length;
    const totalAwardedToday = claimsRes.rows.reduce((total, claim) => total + Number(claim.coins_awarded || 0), 0);
    const limit = Math.max(1, Number(settings.daily_limit || (rewardType === 'daily_spin' ? DAILY_MAX_SPINS : DAILY_MAX_AD_COINS)));
    const configuredCoins = Math.max(0, Number(settings.reward_coins || 0));
    const useCoinCap = rewardType === 'daily_spin' && configuredCoins > 0;
    const coinCap = useCoinCap ? configuredCoins : 0;

    if (usedToday >= limit) throw new Error(`Daily spin limit reached for today (${limit}/${limit} spins used).`);
    if (useCoinCap && totalAwardedToday >= coinCap) throw new Error(`Daily coin limit reached for today (${coinCap}/${coinCap} coins).`);

    let selectedPrize;
    let coinsAwarded;
    if (rewardType === 'daily_spin') {
      const remainingSpins = limit - usedToday;
      const remainingCoins = coinCap - totalAwardedToday;
      const spinPrizes = await getActiveSpinPrizes(client);
      let eligiblePrizes = spinPrizes;

      if (useCoinCap) {
        const feasibilityMemo = new Map();
        eligiblePrizes = spinPrizes.filter((prize) => {
          const amount = Number(prize.amount || 0);
          return amount > 0 && amount <= remainingCoins && canReachExactTotal(
            remainingCoins - amount,
            remainingSpins - 1,
            spinPrizes,
            feasibilityMemo,
          );
        });
        if (!eligiblePrizes.length) {
          throw new Error('The current spin limit, coin cap, and wheel rewards cannot reach an exact total. Update the Admin configuration.');
        }
      }

      const prize = chooseWeightedPrize(eligiblePrizes);
      const index = spinPrizes.findIndex((candidate) => candidate.id === prize.id);
      selectedPrize = { ...prize, index, prizeIndex: index };
      coinsAwarded = Number(prize.amount || 0);
    } else {
      coinsAwarded = Math.max(0, configuredCoins || 50);
      selectedPrize = { id: 'watch_ad_coins', type: 'coins', amount: coinsAwarded, label: `${coinsAwarded} Coins`, index: 0 };
    }

    const claimId = randomUUID();
    const wallet = coinsAwarded > 0
      ? await applyWalletTransaction({ client, userId, amount: coinsAwarded, reason: 'rewarded_ad_payout', referenceType: 'rewarded_ad', referenceId: claimId })
      : null;
    const newBalance = wallet
      ? wallet.balanceAfter
      : Number((await client.query(`SELECT coins FROM users WHERE id = $1 FOR UPDATE`, [userId])).rows[0]?.coins || 0);

    await client.query(
      `INSERT INTO user_rewarded_ad_claims (id, user_id, reward_type, coins_awarded, powerup_awarded, claim_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [claimId, userId, rewardType, coinsAwarded, null, todayStr],
    );
    await client.commit();

    const updatedTotal = totalAwardedToday + coinsAwarded;
    return {
      success: true,
      rewardType,
      prize: selectedPrize,
      coinsAwarded,
      powerupAwarded: null,
      balance: newBalance,
      spinsRemaining: rewardType === 'daily_spin' ? Math.max(0, limit - (usedToday + 1)) : undefined,
      spinsUsedToday: rewardType === 'daily_spin' ? usedToday + 1 : undefined,
      maxSpinsPerDay: rewardType === 'daily_spin' ? limit : undefined,
      adCoinsRemaining: rewardType === 'watch_ad_coins' ? Math.max(0, limit - (usedToday + 1)) : undefined,
      coinsRemaining: useCoinCap ? Math.max(0, coinCap - updatedTotal) : undefined,
      coinsCap: useCoinCap ? coinCap : undefined,
      coinsAwardedToday: rewardType === 'daily_spin' ? updatedTotal : undefined,
      message: `Won +${coinsAwarded} Coins! 🪙`,
    };
  } catch (error) {
    await client.rollback();
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getShopCatalog,
  buyShopItem,
  equipShopItem,
  getCoinPacks,
  verifyAndCreditCoinPurchase,
  getDailyRewardStatus,
  claimDailyRewardedAd,
};
