const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const env = require('./config/env');
const { query } = require('./db/pool');
const authRoutes = require('./routes/auth.routes');
const roomRoutes = require('./routes/rooms.routes');
const gameRoutes = require('./routes/games.routes');
const tournamentRoutes = require('./routes/tournaments.routes');
const userRoutes = require('./routes/users.routes');
const questionRoutes = require('./routes/questions.routes');
const challengeRoutes = require('./routes/challenges.routes');
const statisticsRoutes = require('./routes/statistics.routes');
const shopRoutes = require('./routes/shop.routes');
const quickQuizRoutes = require('./modules/quickQuiz/routes/quickQuiz.routes');
const { registerSockets } = require('./sockets');

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: (origin, callback) => {
    // Mobile apps (Android/iOS native), Postman, or server-to-server requests have no Origin header
    if (!origin) return callback(null, true);

    // Development mode: Allow localhost, local LAN IPs, and development web origins
    if (env.nodeEnv !== 'production') {
      return callback(null, true);
    }

    // Production mode: Enforce configured client origins
    if (env.clientOrigins.length === 0 || env.clientOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
  },
  credentials: true,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.nodeEnv === 'production' ? 30 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'unsafe-none' },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '30mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '1y', immutable: true }));

const io = new Server(server, {
  cors: corsOptions,
});

app.set('io', io);

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'quizgame-backend',
    message: 'QuizzyFox Backend API Server is active and ready',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      rooms: '/api/rooms',
      games: '/api/games',
      quickQuiz: '/api/quick-quiz',
      challenges: '/api/challenges',
      statistics: '/api/statistics',
      users: '/api/users',
      shop: '/api/shop',
      tournaments: '/api/tournaments',
    },
  });
});

app.get('/health', async (req, res) => {
  const db = await query('SELECT NOW() AS now');
  res.json({ ok: true, service: 'quizgame-backend', databaseTime: db.rows[0].now });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/quick-quiz', quickQuizRoutes);

app.use((req, res) => {
  console.warn(`[Backend 404]: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
  const status = error.status || error.statusCode || 500;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({
    error: error.message || 'Internal server error',
    code: error.code || undefined,
  });
});

const { autoMigrateDatabase } = require('./db/autoMigrate');
const { startTournamentScheduler } = require('./services/tournamentScheduler.service');

registerSockets(io);
startTournamentScheduler(io);

server.listen(env.port, '0.0.0.0', async () => {
  console.log(`QuizGame backend listening on http://0.0.0.0:${env.port} (IPv4 ready)`);
  try {
    await autoMigrateDatabase();
  } catch (err) {
    console.error('[AutoMigrate Error]:', err.message);
  }
});
