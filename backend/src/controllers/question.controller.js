const path = require('path');
const questionService = require('../services/question.service');
const asyncHandler = require('../utils/asyncHandler');

const downloadTemplate = (req, res) => {
  res.download(path.resolve(__dirname, '../../templates/question-import-template.xlsx'));
};

const listCategories = asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  if (includeInactive && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const categories = await questionService.listCategories({ includeInactive });
  return res.json({ categories });
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await questionService.updateCategory(req.params.name, req.body);
  return res.json({ category });
});

const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const category = await questionService.createCategory(name, description, req.user.id);
  return res.status(201).json({ category });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const result = await questionService.deleteCategory(req.params.name);
  return res.json(result);
});

const listQuestions = asyncHandler(async (req, res) => {
  const { level, category } = req.query;
  const questions = await questionService.listQuestions(level, category);
  return res.json({ questions });
});

const createQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.createQuestion(req.body, req.user.id);
  return res.status(201).json({ question });
});

const updateQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.updateQuestion(req.params.questionId, req.body, req.user.id);
  return res.json({ question });
});

const deleteQuestion = asyncHandler(async (req, res) => {
  const result = await questionService.deleteQuestion(req.params.questionId);
  return res.json(result);
});

const importExcel = asyncHandler(async (req, res) => {
  const { fileBase64 } = req.body;
  if (!fileBase64) {
    return res.status(400).json({ error: 'fileBase64 is required' });
  }

  const base64 = String(fileBase64).includes(',')
    ? String(fileBase64).split(',').pop()
    : String(fileBase64);
  const result = await questionService.importQuestionsFromBuffer(Buffer.from(base64, 'base64'));
  return res.json(result);
});

module.exports = {
  downloadTemplate,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  importExcel,
};
