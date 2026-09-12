/**
 * KomuniPH Lite - Configuration
 * Centralized configuration loaded from environment variables
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenvConfig({ path: resolve(__dirname, '..', 'config', '.env') });

const config = {
  app: {
    name: process.env.APP_NAME || 'KomuniPH',
    version: process.env.APP_VERSION || '1.0.0',
    environment: process.env.ENVIRONMENT || 'development',
    debug: process.env.DEBUG === 'true',
  },
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000', 10),
  },
  database: {
    path: process.env.DATABASE_PATH || './data/komuniph.db',
  },
  jwt: {
    secretKey: process.env.SECRET_KEY || 'dev-secret-change-in-production-min-32-chars',
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    issuer: process.env.JWT_ISSUER || 'komuniph',
    audience: process.env.JWT_AUDIENCE || 'komuniph-clients',
    keyId: process.env.JWT_KEY_ID || 'v1',
    accessExpireMinutes: parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || '15', 10),
    refreshExpireMinutes: parseInt(process.env.REFRESH_TOKEN_EXPIRE_MINUTES || '43200', 10),
  },
  passwordReset: {
    expiryMinutes: parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '30', 10),
    devMode: process.env.PASSWORD_RESET_DEV_MODE === 'true',
  },
  emailVerification: {
    expiryMinutes: parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES || '1440', 10),
    devMode: process.env.EMAIL_VERIFICATION_DEV_MODE === 'true',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'noreply@komuniph.local',
  },
  upload: {
    maxFileSize: parseInt(process.env.UPLOAD_MAX_FILE_SIZE || '5242880', 10),
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    profileDir: process.env.UPLOAD_PROFILE_DIR || './uploads/profile',
    backgroundDir: process.env.UPLOAD_BACKGROUND_DIR || './uploads/backgrounds',
    maxWidth: parseInt(process.env.UPLOAD_PROFILE_MAX_WIDTH || '1024', 10),
    maxHeight: parseInt(process.env.UPLOAD_PROFILE_MAX_HEIGHT || '1024', 10),
    webpQuality: parseInt(process.env.UPLOAD_PROFILE_WEBP_QUALITY || '80', 10),
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
  },
};

export default config;
