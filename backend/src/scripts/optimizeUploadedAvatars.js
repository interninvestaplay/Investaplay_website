require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { query, pool } = require('../db/pool');

async function main() {
  const result = await query(
    `SELECT id, preview_asset FROM shop_items
     WHERE category = 'avatar' AND preview_asset LIKE '/uploads/shop/%'`
  );
  const uploadRoot = path.resolve(__dirname, '..', '..', 'uploads', 'shop');
  let beforeBytes = 0;
  let afterBytes = 0;
  let optimizedCount = 0;

  for (const item of result.rows) {
    const source = path.resolve(__dirname, '..', '..', String(item.preview_asset).replace(/^\//, ''));
    if (!source.startsWith(`${uploadRoot}${path.sep}`)) continue;
    const original = await fs.readFile(source).catch(() => null);
    if (!original) continue;
    const optimized = await sharp(original, { failOn: 'error', limitInputPixels: 25_000_000 })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 5 })
      .toBuffer()
      .catch(() => null);
    if (!optimized) continue;

    const target = path.join(uploadRoot, `${item.id}.webp`);
    await fs.writeFile(target, optimized);
    const previewAsset = `/uploads/shop/${item.id}.webp`;
    await query('UPDATE shop_items SET preview_asset = $1 WHERE id = $2', [previewAsset, item.id]);
    await query('UPDATE users SET avatar_url = $1 WHERE equipped_avatar = $2', [previewAsset, item.id]);
    if (source !== target) await fs.unlink(source).catch(() => {});
    beforeBytes += original.length;
    afterBytes += optimized.length;
    optimizedCount += 1;
  }

  console.log(JSON.stringify({ optimizedCount, beforeBytes, afterBytes }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
