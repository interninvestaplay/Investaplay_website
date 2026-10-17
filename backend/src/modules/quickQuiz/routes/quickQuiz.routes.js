/**
 * Quick Quiz Routes — Express router for /api/quick-quiz/*
 *
 * Uses the existing requireAuth middleware for authentication.
 * Adds Quick Quiz-specific rate limiting to protect Groq free tier.
 */

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../../../middleware/auth');
const controller = require('../controllers/quickQuiz.controller');

const router = Router();

// ── Rate Limiting ───────────────────────────────────────────────────────────
// Quick Quiz generation is expensive (AI API calls). Limit per user.
const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10,             // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many quiz generation requests. Please wait a moment.' },
  keyGenerator: (req) => req.user?.id || 'anonymous',
});

// ── File Upload (Multer) ────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', '..', '..', '..', 'uploads', 'quick-quiz-pdfs');

// Ensure upload directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Safe filename: timestamp + random + .pdf
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.pdf`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' ||
                  file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return cb(new Error('Only PDF files are allowed'), false);
    }
    cb(null, true);
  },
});

// ── Routes ──────────────────────────────────────────────────────────────────

// All Quick Quiz routes require authentication
router.use(requireAuth);

// POST /api/quick-quiz/generate — Generate a topic-based quiz
router.post('/generate', generateLimiter, controller.generateQuiz);

// POST /api/quick-quiz/upload-pdf — Upload PDF and generate quiz
router.post(
  '/upload-pdf',
  generateLimiter,
  (req, res, next) => {
    upload.single('pdf')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'PDF must be smaller than 10 MB' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  controller.uploadPdfAndGenerate
);

// GET /api/quick-quiz/online-players — Get online players available to challenge
router.get('/online-players', controller.getOnlinePlayers);

// POST /api/quick-quiz/challenge — Challenge an online player to a Quick Quiz
router.post('/challenge', generateLimiter, controller.createQuickQuizChallenge);

// GET /api/quick-quiz/session/:id — Get session with questions
router.get('/session/:id', controller.getSession);

// POST /api/quick-quiz/session/:id/complete — Complete a quiz session
router.post('/session/:id/complete', controller.completeQuizSession);

module.exports = router;
