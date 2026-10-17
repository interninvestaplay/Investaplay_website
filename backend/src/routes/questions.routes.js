const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const questionController = require('../controllers/question.controller');

const router = express.Router();

router.get('/template', questionController.downloadTemplate);

router.use(requireAuth);

router.get('/categories', questionController.listCategories);
router.post('/categories', requireAdmin, questionController.createCategory);
router.put('/categories/:name', requireAdmin, questionController.updateCategory);
router.delete('/categories/:name', requireAdmin, questionController.deleteCategory);

router.get('/', questionController.listQuestions);
router.post('/', requireAdmin, questionController.createQuestion);
router.put('/:questionId', requireAdmin, questionController.updateQuestion);
router.delete('/:questionId', requireAdmin, questionController.deleteQuestion);

router.post('/import-excel', requireAdmin, questionController.importExcel);



module.exports = router;
