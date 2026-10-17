require('dotenv').config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const required = (key, fallback) => {
  const value = process.env[key];
  if (isProduction) {
    if (!value || value.includes('dev-') || value.includes('change-me') || value.includes('replace-with-')) {
      throw new Error(`[Security Alert] In production, a secure '${key}' must be set in environment variables.`);
    }
  }
  return value || fallback;
};

const defaultDevOrigins = 'http://localhost:8081,http://localhost:8082,http://localhost:19006';

const userOrigins = (process.env.CLIENT_ORIGIN || (isProduction ? '' : defaultDevOrigins))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const clientOrigins = !isProduction
  ? Array.from(new Set([...userOrigins, 'http://localhost:8081', 'http://localhost:8082', 'http://localhost:19006', 'http://127.0.0.1:8081', 'http://127.0.0.1:8082']))
  : userOrigins;

module.exports = {
  nodeEnv,
  isProduction,
  port: toNumber(process.env.PORT, 4000),
  clientOrigins,
  dbHost: required('DB_HOST', 'localhost'),
  dbPort: toNumber(process.env.DB_PORT, 3306),
  dbUser: required('DB_USER', 'root'),
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: required('DB_NAME', 'quizgame'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: toNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  bcryptRounds: toNumber(process.env.BCRYPT_ROUNDS, 10),
  adminEmail: process.env.ADMIN_EMAIL || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || null,
  // Comma-separated allow-list. Include the Web client used by Android ID tokens.
  googleClientIds: process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
  facebookAppId: process.env.FACEBOOK_APP_ID || process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || null,
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET || null,
  groqApiKey: process.env.GROQ_API_KEY || null,
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
};

