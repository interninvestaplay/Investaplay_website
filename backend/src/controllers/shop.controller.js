const shopService = require('../services/shop.service');

async function optimizeAvatarImage(buffer) {
  const sharp = require('sharp');
  return sharp(buffer, { failOn: 'error', limitInputPixels: 25_000_000 })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toBuffer();
}

async function getCatalog(req, res, next) {
  try {
    const data = await shopService.getShopCatalog(req.user.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function buyItem(req, res, next) {
  try {
    const { itemId } = req.body || {};
    const result = await shopService.buyShopItem(req.user.id, itemId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function equipItem(req, res, next) {
  try {
    const { itemId } = req.body || {};
    const result = await shopService.equipShopItem(req.user.id, itemId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getCoinPacks(req, res, next) {
  try {
    const packs = await shopService.getCoinPacks();
    res.json({ packs });
  } catch (err) {
    next(err);
  }
}

async function verifyPurchase(req, res, next) {
  try {
    const { sku, purchaseToken, orderId, platform } = req.body || {};
    const result = await shopService.verifyAndCreditCoinPurchase(req.user.id, {
      sku,
      purchaseToken,
      orderId,
      platform,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getRewardsStatus(req, res, next) {
  try {
    const status = await shopService.getDailyRewardStatus(req.user.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
}

async function claimReward(req, res, next) {
  try {
    const { rewardType } = req.body || {};
    const result = await shopService.claimDailyRewardedAd(req.user.id, { rewardType });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getAdminCatalog(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const [items, coinPacks] = await Promise.all([
      query(`SELECT id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active FROM shop_items ORDER BY category, coin_price, name`),
      query(`SELECT id, name, sku, coins, bonus_coins, price_inr, price_formatted, badge_text, icon, display_order, is_active FROM iap_coin_packs ORDER BY display_order ASC, price_inr ASC`),
    ]);
    // Keep the catalog usable on installations that have not yet run migration 019.
    const rewards = await query(`SELECT reward_type, is_active, reward_coins, daily_limit FROM shop_reward_settings ORDER BY reward_type`).catch(() => ({ rows: [
      { reward_type: 'daily_spin', is_active: true, reward_coins: 0, daily_limit: 10 }, { reward_type: 'watch_ad_coins', is_active: true, reward_coins: 50, daily_limit: 10 },
    ] }));
    res.json({
      items: items.rows.map((item) => ({ id: item.id, name: item.name, category: item.category, description: item.description, coinPrice: Number(item.coin_price || 0), minLevel: Number(item.min_level || 1), icon: item.icon, previewAsset: item.preview_asset, badgeText: item.badge_text, isActive: item.is_active })),
      coinPacks: coinPacks.rows.map((pack) => ({
        id: pack.id,
        name: pack.name,
        sku: pack.sku,
        coins: Number(pack.coins || 0),
        bonusCoins: Number(pack.bonus_coins || 0),
        totalCoins: Number(pack.coins || 0) + Number(pack.bonus_coins || 0),
        priceInr: Number(pack.price_inr || 0),
        priceFormatted: pack.price_formatted,
        badgeText: pack.badge_text,
        icon: pack.icon || 'Coins',
        displayOrder: Number(pack.display_order || 0),
        isActive: Boolean(pack.is_active),
      })),
      rewards: rewards.rows.map((reward) => ({ rewardType: reward.reward_type, isActive: reward.is_active, rewardCoins: Number(reward.reward_coins || 0), dailyLimit: Number(reward.daily_limit || 0) })),
    });
  } catch (err) { next(err); }
}

async function updateAdminReward(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const input = req.body || {};
    if (!['daily_spin', 'watch_ad_coins'].includes(req.params.rewardType)) return res.status(400).json({ error: 'Invalid reward update' });
    const updates = [];
    const values = [];
    if (typeof input.isActive === 'boolean') { values.push(input.isActive); updates.push(`is_active = $${values.length}`); }
    if (input.rewardCoins !== undefined) { values.push(Math.max(0, Number(input.rewardCoins) || 0)); updates.push(`reward_coins = $${values.length}`); }
    if (input.dailyLimit !== undefined) { values.push(Math.max(1, Number(input.dailyLimit) || 1)); updates.push(`daily_limit = $${values.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'No reward changes supplied' });
    values.push(req.params.rewardType);
    await query(`UPDATE shop_reward_settings SET ${updates.join(', ')} WHERE reward_type = $${values.length}`, values);
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function updateAdminItem(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const input = req.body || {};
    const fields = [['name', 'name'], ['description', 'description'], ['coinPrice', 'coin_price'], ['minLevel', 'min_level'], ['badgeText', 'badge_text'], ['previewAsset', 'preview_asset'], ['isActive', 'is_active']];
    const updates = fields.filter(([key]) => Object.prototype.hasOwnProperty.call(input, key));
    if (!updates.length) return res.status(400).json({ error: 'No shop item changes supplied' });
    const values = updates.map(([key]) => input[key]);
    const setSql = updates.map(([, column], index) => `${column} = $${index + 1}`).join(', ');
    const result = await query(`UPDATE shop_items SET ${setSql} WHERE id = $${values.length + 1}`, [...values, req.params.itemId]);
    if (!result.result?.affectedRows) return res.status(404).json({ error: 'Shop item not found' });
    const itemResult = await query(`SELECT id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active FROM shop_items WHERE id = $1`, [req.params.itemId]);
    const item = itemResult.rows[0];
    res.json({ item: { id: item.id, name: item.name, category: item.category, description: item.description, coinPrice: Number(item.coin_price || 0), minLevel: Number(item.min_level || 1), icon: item.icon, previewAsset: item.preview_asset, badgeText: item.badge_text, isActive: item.is_active } });
  } catch (err) { next(err); }
}

async function createAdminItem(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const { randomUUID } = require('crypto');
    const input = req.body || {};
    const categories = ['avatar', 'frame', 'title', 'powerup'];
    if (!input.name?.trim() || !categories.includes(input.category)) return res.status(400).json({ error: 'Name and a valid category are required' });
    const id = `${input.category}_${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO shop_items (id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [id, input.name.trim(), input.category, input.description || '', Math.max(0, Number(input.coinPrice) || 0), Math.max(1, Number(input.minLevel) || 1), input.icon || 'Sparkles', input.previewAsset || null, input.badgeText || null, Boolean(input.isActive)]
    );
    const itemResult = await query(`SELECT id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active FROM shop_items WHERE id = $1`, [id]);
    const item = itemResult.rows[0];
    res.status(201).json({ item: { id: item.id, name: item.name, category: item.category, description: item.description, coinPrice: Number(item.coin_price), minLevel: Number(item.min_level), icon: item.icon, badgeText: item.badge_text, isActive: item.is_active } });
  } catch (err) { next(err); }
}

async function uploadAdminAsset(req, res, next) {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    const { randomUUID } = require('crypto');
    const { fileName = 'shop-image.png', mimeType = '', data = '' } = req.body || {};
    if (!mimeType.startsWith('image/') || !String(data).startsWith('data:image/')) return res.status(400).json({ error: 'Please upload a valid image file' });
    const match = String(data).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Only PNG, JPG, and WebP images are supported' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Image must be 2 MB or smaller' });
    const optimized = await optimizeAvatarImage(buffer).catch(() => null);
    if (!optimized) return res.status(400).json({ error: 'The uploaded file is not a valid image' });
    const directory = path.join(__dirname, '..', '..', 'uploads', 'shop');
    await fs.mkdir(directory, { recursive: true });
    const safeName = `${randomUUID()}.webp`;
    await fs.writeFile(path.join(directory, safeName), optimized);
    res.status(201).json({ url: `/uploads/shop/${safeName}`, originalName: String(fileName).slice(0, 120) });
  } catch (err) { next(err); }
}

async function importAdminAvatarZip(req, res, next) {
  try {
    const AdmZip = require('adm-zip');
    const fs = require('fs/promises');
    const path = require('path');
    const { randomUUID } = require('crypto');
    const { query } = require('../db/pool');
    const { data = '', coinPrice = 0, minLevel = 1 } = req.body || {};
    const match = String(data).match(/^data:(?:application\/(?:zip|x-zip-compressed)|application\/octet-stream);base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Please upload a valid ZIP file' });
    const zipBuffer = Buffer.from(match[1], 'base64');
    if (zipBuffer.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'ZIP file must be 20 MB or smaller' });

    const entries = new AdmZip(zipBuffer).getEntries().filter((entry) => !entry.isDirectory && /\.(png|jpe?g|webp)$/i.test(entry.entryName));
    if (!entries.length) return res.status(400).json({ error: 'ZIP does not contain PNG, JPG, or WebP images' });
    if (entries.length > 100) return res.status(400).json({ error: 'A ZIP can contain at most 100 avatars' });
    if (entries.some((entry) => Number(entry.header?.size || 0) > 2 * 1024 * 1024)) return res.status(413).json({ error: 'Each avatar must be 2 MB or smaller' });
    const files = entries.map((entry) => ({ entry, buffer: entry.getData() }));
    if (files.some(({ buffer }) => buffer.length > 2 * 1024 * 1024)) return res.status(413).json({ error: 'Each avatar must be 2 MB or smaller' });
    if (files.reduce((sum, file) => sum + file.buffer.length, 0) > 20 * 1024 * 1024) return res.status(413).json({ error: 'Extracted avatars must total 20 MB or less' });

    const directory = path.join(__dirname, '..', '..', 'uploads', 'shop');
    await fs.mkdir(directory, { recursive: true });
    const created = [];
    for (const { entry, buffer } of files) {
      const baseName = path.basename(entry.entryName, path.extname(entry.entryName)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Avatar';
      const name = baseName.replace(/\b\w/g, (char) => char.toUpperCase());
      const optimized = await optimizeAvatarImage(buffer).catch(() => null);
      if (!optimized) continue;
      const fileName = `${randomUUID()}.webp`;
      const id = `avatar_${randomUUID().slice(0, 8)}`;
      const previewAsset = `/uploads/shop/${fileName}`;
      await fs.writeFile(path.join(directory, fileName), optimized);
      await query(`INSERT INTO shop_items (id, name, category, description, coin_price, min_level, icon, preview_asset, badge_text, is_active) VALUES ($1,$2,'avatar',$3,$4,$5,'UserRound',$6,NULL,TRUE)`, [id, name, `${name} avatar`, Math.max(0, Number(coinPrice) || 0), Math.max(1, Number(minLevel) || 1), previewAsset]);
      created.push({ id, name, previewAsset });
    }
    if (!created.length) return res.status(400).json({ error: 'ZIP did not contain any valid avatar images' });
    res.status(201).json({ imported: created.length, skipped: entries.length - created.length, items: created });
  } catch (err) { next(err); }
}

async function deleteAdminItem(req, res, next) {
  try {
    const fs = require('fs/promises');
    const path = require('path');
    const { query } = require('../db/pool');
    const itemResult = await query(`SELECT id, category, preview_asset FROM shop_items WHERE id = $1`, [req.params.itemId]);
    const item = itemResult.rows[0];
    if (!item) return res.status(404).json({ error: 'Shop item not found' });
    if (item.id === 'avatar_01') return res.status(400).json({ error: 'The default avatar cannot be deleted' });
    if (item.category === 'avatar') await query(`UPDATE users SET equipped_avatar = 'avatar_01', avatar_url = NULL WHERE equipped_avatar = $1`, [item.id]);
    await query(`DELETE FROM user_inventory WHERE item_id = $1`, [item.id]);
    await query(`DELETE FROM shop_items WHERE id = $1`, [item.id]);
    if (item.preview_asset?.startsWith('/uploads/shop/')) {
      const target = path.resolve(__dirname, '..', '..', item.preview_asset.replace(/^\//, ''));
      const uploadRoot = path.resolve(__dirname, '..', '..', 'uploads', 'shop');
      if (target.startsWith(`${uploadRoot}${path.sep}`)) await fs.unlink(target).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function updateAdminCoinPack(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const input = req.body || {};
    const packId = req.params.packId;

    // Check pack exists
    const packCheck = await query(`SELECT id, sku FROM iap_coin_packs WHERE id = $1`, [packId]);
    if (!packCheck.rows.length) {
      return res.status(404).json({ error: 'Coin pack not found' });
    }

    // If SKU is being updated, verify uniqueness
    if (input.sku !== undefined) {
      const newSku = String(input.sku || '').trim();
      if (!newSku) {
        return res.status(400).json({ error: 'SKU / Product ID cannot be empty' });
      }
      const skuCheck = await query(`SELECT id FROM iap_coin_packs WHERE sku = $1 AND id != $2`, [newSku, packId]);
      if (skuCheck.rows.length > 0) {
        return res.status(400).json({ error: `A coin pack with SKU "${newSku}" already exists` });
      }
    }

    const fieldMap = [
      ['name', 'name', (val) => String(val || '').trim()],
      ['sku', 'sku', (val) => String(val || '').trim()],
      ['coins', 'coins', (val) => Math.max(1, Number(val) || 0)],
      ['bonusCoins', 'bonus_coins', (val) => Math.max(0, Number(val) || 0)],
      ['priceInr', 'price_inr', (val) => Math.max(0, Number(val) || 0)],
      ['priceFormatted', 'price_formatted', (val) => String(val || '').trim()],
      ['badgeText', 'badge_text', (val) => (val ? String(val).trim() : null)],
      ['icon', 'icon', (val) => String(val || 'Coins').trim()],
      ['displayOrder', 'display_order', (val) => Number(val) || 0],
      ['isActive', 'is_active', (val) => Boolean(val)],
    ];

    const updates = [];
    const values = [];

    for (const [key, column, transform] of fieldMap) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        values.push(transform ? transform(input[key]) : input[key]);
        updates.push(`${column} = $${values.length}`);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No coin pack changes supplied' });
    }

    values.push(packId);
    await query(`UPDATE iap_coin_packs SET ${updates.join(', ')} WHERE id = $${values.length}`, values);

    // Fetch updated pack
    const updatedRes = await query(`SELECT * FROM iap_coin_packs WHERE id = $1`, [packId]);
    const p = updatedRes.rows[0];

    res.json({
      success: true,
      pack: p ? {
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
        displayOrder: Number(p.display_order || 0),
        isActive: Boolean(p.is_active),
      } : null,
    });
  } catch (err) { next(err); }
}

async function createAdminCoinPack(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const { randomUUID } = require('crypto');
    const input = req.body || {};
    const name = String(input.name || '').trim();
    const sku = String(input.sku || '').trim();
    const coins = Math.max(1, Number(input.coins) || 0);
    const priceInr = Math.max(0, Number(input.priceInr) || 0);

    if (!name || !sku || !coins) {
      return res.status(400).json({ error: 'Pack Name, SKU / Product ID, and coins are required' });
    }

    // Verify SKU uniqueness
    const existingSku = await query(`SELECT id FROM iap_coin_packs WHERE sku = $1`, [sku]);
    if (existingSku.rows.length > 0) {
      return res.status(400).json({ error: `A coin pack with SKU "${sku}" already exists` });
    }

    const id = `coin_pack_${randomUUID().slice(0, 8)}`;
    const bonusCoins = Math.max(0, Number(input.bonusCoins) || 0);
    const priceFormatted = String(input.priceFormatted || `₹${priceInr}`).trim();
    const badgeText = input.badgeText ? String(input.badgeText).trim() : null;
    const icon = String(input.icon || 'Coins').trim();
    const displayOrder = Number(input.displayOrder) || 0;
    const isActive = input.isActive !== false;

    await query(
      `INSERT INTO iap_coin_packs (id, name, sku, coins, bonus_coins, price_inr, price_formatted, badge_text, icon, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, name, sku, coins, bonusCoins, priceInr, priceFormatted, badgeText, icon, displayOrder, isActive]
    );

    res.status(201).json({
      success: true,
      id,
      pack: {
        id,
        name,
        sku,
        coins,
        bonusCoins,
        totalCoins: coins + bonusCoins,
        priceInr,
        priceFormatted,
        badgeText,
        icon,
        displayOrder,
        isActive,
      },
    });
  } catch (err) { next(err); }
}

async function deleteAdminCoinPack(req, res, next) {
  try {
    const { query } = require('../db/pool');
    const packId = req.params.packId;

    const packCheck = await query(`SELECT id, name FROM iap_coin_packs WHERE id = $1`, [packId]);
    if (!packCheck.rows.length) {
      return res.status(404).json({ error: 'Coin pack not found' });
    }

    await query(`DELETE FROM iap_coin_packs WHERE id = $1`, [packId]);
    res.json({ success: true, message: 'Coin pack deleted successfully' });
  } catch (err) { next(err); }
}

module.exports = {
  getCatalog,
  buyItem,
  equipItem,
  getCoinPacks,
  verifyPurchase,
  getRewardsStatus,
  claimReward,
  getAdminCatalog,
  updateAdminItem,
  createAdminItem,
  uploadAdminAsset,
  importAdminAvatarZip,
  deleteAdminItem,
  updateAdminCoinPack,
  createAdminCoinPack,
  deleteAdminCoinPack,
  updateAdminReward,
};
