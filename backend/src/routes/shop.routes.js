const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const shopController = require('../controllers/shop.controller');

const router = express.Router();
router.use(requireAuth);


router.get('/admin/catalog', requireAdmin, shopController.getAdminCatalog);
router.post('/admin/items', requireAdmin, shopController.createAdminItem);
router.post('/admin/assets', requireAdmin, shopController.uploadAdminAsset);
router.post('/admin/avatars/import-zip', requireAdmin, shopController.importAdminAvatarZip);
router.put('/admin/items/:itemId', requireAdmin, shopController.updateAdminItem);
router.delete('/admin/items/:itemId', requireAdmin, shopController.deleteAdminItem);
router.put('/admin/coin-packs/:packId', requireAdmin, shopController.updateAdminCoinPack);
router.post('/admin/coin-packs', requireAdmin, shopController.createAdminCoinPack);
router.delete('/admin/coin-packs/:packId', requireAdmin, shopController.deleteAdminCoinPack);
router.put('/admin/rewards/:rewardType', requireAdmin, shopController.updateAdminReward);

router.get('/items', shopController.getCatalog);
router.get('/coin-packs', shopController.getCoinPacks);
router.get('/rewards/status', shopController.getRewardsStatus);
router.post('/buy', shopController.buyItem);
router.post('/equip', shopController.equipItem);
router.post('/verify-purchase', shopController.verifyPurchase);
router.post('/rewards/claim', shopController.claimReward);

module.exports = router;
