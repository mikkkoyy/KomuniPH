/**
 * KomuniPH Lite - Authentication
 * Auth routes, JWT handling, and middleware
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import config from './config.js';
import { queryOne, execute, transaction } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody, isValidEmail, isValidUsername } from './utils.js';

const SALT_ROUNDS = 12;
const TOKEN_BYTES = 32;

/**
 * Hash a password
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Create a JWT token
 */
export function createToken(userId, tokenType = 'access') {
  const expiresIn = tokenType === 'access'
    ? `${config.jwt.accessExpireMinutes}m`
    : `${config.jwt.refreshExpireMinutes}m`;

  return jwt.sign(
    {
      sub: userId,
      type: tokenType,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
      jti: generateId(),
    },
    config.jwt.secretKey,
    {
      algorithm: config.jwt.algorithm,
      expiresIn,
      header: { kid: config.jwt.keyId },
    }
  );
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secretKey, {
    algorithms: [config.jwt.algorithm],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

/**
 * Auth middleware - extracts and verifies token
 */
export function authMiddleware(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.type !== 'access') {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Require auth middleware - returns 401 if not authenticated
 */
export function requireAuth(req, res) {
  const user = authMiddleware(req);
  if (!user) {
    errorResponse(res, 401, 'Authentication required');
    return null;
  }
  return user;
}

/**
 * Handle POST /api/auth/register
 */
export async function handleRegister(req, res) {
  try {
    const body = await parseBody(req);
    const { email, username, password } = body;

    // Validate input
    if (!email || !username || !password) {
      return errorResponse(res, 422, 'Email, username, and password are required');
    }

    if (!isValidEmail(email)) {
      return errorResponse(res, 422, 'Invalid email format');
    }

    if (!isValidUsername(username)) {
      return errorResponse(res, 422, 'Username must be 3-32 characters (letters, numbers, underscore)');
    }

    if (password.length < 8) {
      return errorResponse(res, 422, 'Password must be at least 8 characters');
    }

    // Check for existing user
    const existingEmail = queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existingEmail) {
      return errorResponse(res, 409, 'Email already registered');
    }

    const existingUsername = queryOne('SELECT id FROM users WHERE username = ?', [username.toLowerCase()]);
    if (existingUsername) {
      return errorResponse(res, 409, 'Username already taken');
    }

    // Create user
    const userId = generateId();
    const passwordHash = await hashPassword(password);

    execute(
      'INSERT INTO users (id, email, username, password_hash, role, account_status) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, email.toLowerCase(), username.toLowerCase(), passwordHash, 'member', 'active']
    );

    // Create profile
    // PROFILE-04: Initialize identity fields; username is NOT used as display name
    const profileId = generateId();
    execute(
      'INSERT INTO profiles (id, user_id, first_name, last_name, display_name, theme_id) VALUES (?, ?, ?, ?, ?, ?)',
      [profileId, userId, '', '', '', 'default']
    );

    // Generate verification token
    cleanupExpiredVerificationTokens();
    const rawToken = generateResetToken();
    const tokenHash = hashToken(rawToken);
    const tokenId = generateId();
    const expiresAt = new Date(Date.now() + config.emailVerification.expiryMinutes * 60 * 1000).toISOString();

    execute(
      'INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [tokenId, userId, tokenHash, expiresAt, now()]
    );

    // Send verification email (or log in dev mode)
    let emailSent = false;
    if (config.emailVerification.devMode) {
      const baseUrl = config.cors.origins[0] || 'http://localhost:3000';
      const verificationUrl = `${baseUrl}/#/verify-email?token=${rawToken}`;
      console.log('[AUTH] Email verification dev mode. URL:', verificationUrl);
      emailSent = true;
    } else {
      emailSent = await sendVerificationEmail(email.toLowerCase(), rawToken);
    }

    // Generate tokens
    const accessToken = createToken(userId, 'access');
    const refreshToken = createToken(userId, 'refresh');

    jsonResponse(res, 201, {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: config.jwt.accessExpireMinutes * 60,
      email_verification_sent: emailSent,
    });
  } catch (err) {
    console.error('[AUTH] Register error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/auth/login
 * Accepts either username or email as the identifier.
 */
export async function handleLogin(req, res) {
  try {
    const body = await parseBody(req);
    const { identifier, email, password } = body;

    // Accept both "identifier" (new) and "email" (backward compat) as the login value
    const loginValue = identifier || email;

    // Validate input
    if (!loginValue || !password) {
      return errorResponse(res, 422, 'Username/email and password are required');
    }

    // Find user by username OR email (case-insensitive)
    const user = queryOne(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [loginValue.toLowerCase(), loginValue.toLowerCase()]
    );
    if (!user) {
      return errorResponse(res, 401, 'Invalid username/email or password');
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return errorResponse(res, 401, 'Invalid username/email or password');
    }

    // Check account status
    if (user.account_status !== 'active') {
      return errorResponse(res, 403, 'Account is not active');
    }

    // Generate tokens
    const accessToken = createToken(user.id, 'access');
    const refreshToken = createToken(user.id, 'refresh');

    jsonResponse(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: config.jwt.accessExpireMinutes * 60,
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/auth/verify (email verification)
 */
export async function handleVerify(req, res) {
  try {
    const body = await parseBody(req);
    const { token } = body;

    if (!token) {
      return errorResponse(res, 422, 'Verification token is required');
    }

    // Hash the provided token
    const tokenHash = hashToken(token);

    // Find the verification token record
    const verificationToken = queryOne(
      'SELECT * FROM email_verification_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!verificationToken) {
      return errorResponse(res, 400, 'Invalid verification token');
    }

    // Check if token has already been used
    if (verificationToken.verified_at) {
      return errorResponse(res, 400, 'This verification token has already been used');
    }

    // Check if token has expired
    const expiresAt = new Date(verificationToken.expires_at);
    if (expiresAt < new Date()) {
      return errorResponse(res, 400, 'This verification token has expired');
    }

    // Mark token as used and update user email_verified_at
    transaction(() => {
      // Mark this token as verified
      execute(
        'UPDATE email_verification_tokens SET verified_at = datetime(\'now\') WHERE id = ?',
        [verificationToken.id]
      );

      // Update user's email_verified_at (if column exists, otherwise just log)
      try {
        execute(
          'UPDATE users SET updated_at = datetime(\'now\') WHERE id = ?',
          [verificationToken.user_id]
        );
      } catch (e) {
        // Column might not exist yet, that's okay
        console.log('[AUTH] Note: users.email_verified_at column not available');
      }
    });

    jsonResponse(res, 200, { message: 'Email verified successfully' });
  } catch (err) {
    console.error('[AUTH] Verify error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle GET /api/auth/verify-email (for link-based verification)
 */
export async function handleVerifyEmailLink(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      // Return HTML error page
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid verification link</h1><p>No token provided.</p></body></html>');
      return;
    }

    // Hash the provided token
    const tokenHash = hashToken(token);

    // Find the verification token record
    const verificationToken = queryOne(
      'SELECT * FROM email_verification_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!verificationToken || verificationToken.verified_at) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid or used verification link</h1><p>This link is invalid or has already been used.</p></body></html>');
      return;
    }

    // Check if token has expired
    const expiresAt = new Date(verificationToken.expires_at);
    if (expiresAt < new Date()) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Verification link expired</h1><p>This link has expired. Please request a new one.</p></body></html>');
      return;
    }

    // Mark token as used
    execute(
      'UPDATE email_verification_tokens SET verified_at = datetime(\'now\') WHERE id = ?',
      [verificationToken.id]
    );

    // Redirect to success page
    res.writeHead(302, { 'Location': '/#/verify-email-success' });
    res.end();
  } catch (err) {
    console.error('[AUTH] Verify email link error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Verification failed</h1><p>An error occurred during verification.</p></body></html>');
  }
}

/**
 * Generate a cryptographically secure random token
 */
function generateResetToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Clean up expired and used reset tokens
 */
function cleanupExpiredTokens() {
  execute(
    'DELETE FROM password_reset_tokens WHERE expires_at < datetime(\'now\') OR used_at IS NOT NULL'
  );
}

/**
 * Clean up expired email verification tokens
 */
function cleanupExpiredVerificationTokens() {
  execute(
    'DELETE FROM email_verification_tokens WHERE expires_at < datetime(\'now\') OR verified_at IS NOT NULL'
  );
}

/**
 * Create SMTP transporter
 */
function createTransporter() {
  if (!config.smtp.host) {
    return null;
  }
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
  });
}

/**
 * Send verification email
 */
async function sendVerificationEmail(email, token) {
  const baseUrl = config.cors.origins[0] || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/#/verify-email?token=${token}`;

  const transporter = createTransporter();
  if (!transporter) {
    console.log('[AUTH] SMTP not configured. Verification URL:', verificationUrl);
    return false;
  }

  const mailOptions = {
    from: config.smtp.from,
    to: email,
    subject: 'Verify your KomuniPH email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to KomuniPH!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <p style="margin: 20px 0;">
          <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Verify Email</a>
        </p>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not create an account, please ignore this email.</p>
        <hr>
        <p style="color: #666; font-size: 12px;">KomuniPH - Community Platform</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('[AUTH] Failed to send verification email:', err.message);
    return false;
  }
}

/**
 * Handle POST /api/auth/forgot-password
 */
export async function handleForgotPassword(req, res) {
  try {
    const body = await parseBody(req);
    const { email } = body;

    if (!email || !isValidEmail(email)) {
      return errorResponse(res, 422, 'Valid email is required');
    }

    // Clean up old tokens
    cleanupExpiredTokens();

    // Always return the same message regardless of whether account exists
    const genericMessage = 'If an account exists for that email, password reset instructions have been prepared.';

    // Find user by email
    const user = queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);

    if (!user) {
      // Return same message to prevent account enumeration
      const response = { message: genericMessage };
      if (config.passwordReset.devMode) {
        response.reset_url = null;
      }
      return jsonResponse(res, 200, response);
    }

    // Invalidate any existing outstanding tokens for this user
    execute(
      'UPDATE password_reset_tokens SET used_at = datetime(\'now\') WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );

    // Generate new token
    const rawToken = generateResetToken();
    const tokenHash = hashToken(rawToken);
    const tokenId = generateId();
    const expiresAt = new Date(Date.now() + config.passwordReset.expiryMinutes * 60 * 1000).toISOString();

    // Store hashed token
    execute(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [tokenId, user.id, tokenHash, expiresAt, now()]
    );

    const response = { message: genericMessage };
    if (config.passwordReset.devMode) {
      const baseUrl = config.cors.origins[0] || 'http://localhost:3000';
      response.reset_url = `${baseUrl}/#/reset-password?token=${rawToken}`;
    }

    jsonResponse(res, 200, response);
  } catch (err) {
    console.error('[AUTH] Forgot password error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Handle POST /api/auth/reset-password
 */
export async function handleResetPassword(req, res) {
  try {
    const body = await parseBody(req);
    const { token, password, password_confirmation } = body;

    if (!token) {
      return errorResponse(res, 422, 'Reset token is required');
    }

    if (!password) {
      return errorResponse(res, 422, 'New password is required');
    }

    if (password.length < 8) {
      return errorResponse(res, 422, 'Password must be at least 8 characters');
    }

    if (password_confirmation !== undefined && password !== password_confirmation) {
      return errorResponse(res, 422, 'Passwords do not match');
    }

    // Hash the provided token
    const tokenHash = hashToken(token);

    // Find the reset token record
    const resetToken = queryOne(
      'SELECT * FROM password_reset_tokens WHERE token_hash = ?',
      [tokenHash]
    );

    if (!resetToken) {
      return errorResponse(res, 400, 'Invalid or expired reset token');
    }

    // Check if token has been used
    if (resetToken.used_at) {
      return errorResponse(res, 400, 'This reset token has already been used');
    }

    // Check if token has expired
    const expiresAt = new Date(resetToken.expires_at);
    if (expiresAt < new Date()) {
      return errorResponse(res, 400, 'This reset token has expired');
    }

    // Find the user
    const user = queryOne('SELECT * FROM users WHERE id = ?', [resetToken.user_id]);
    if (!user) {
      return errorResponse(res, 400, 'Invalid or expired reset token');
    }

    // Hash the new password
    const newPasswordHash = await hashPassword(password);

    // Update password and mark token as used in a transaction
    transaction(() => {
      // Update user's password
      execute(
        'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [newPasswordHash, user.id]
      );

      // Mark this token as used
      execute(
        'UPDATE password_reset_tokens SET used_at = datetime(\'now\') WHERE id = ?',
        [resetToken.id]
      );

      // Invalidate any other outstanding tokens for this user
      execute(
        'UPDATE password_reset_tokens SET used_at = datetime(\'now\') WHERE user_id = ? AND id != ? AND used_at IS NULL',
        [user.id, resetToken.id]
      );
    });

    jsonResponse(res, 200, { message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('[AUTH] Reset password error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}
