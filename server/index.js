/**
 * KomuniPH Lite - Server Entry Point
 * HTTP server, routing, and static file serving
 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from './config.js';
import { initDatabase, closeDatabase, seedDefaultTheme } from './database.js';
import { requireAuth } from './auth.js';
import { handleRegister, handleLogin, handleVerify, handleVerifyEmailLink, handleForgotPassword, handleResetPassword } from './auth.js';
import { handleGetProfile, handleGetPublicProfile, handleUpdateProfile, handleUploadPhoto, handleUpdateTheme, handleUploadBackground } from './profile.js';
import { getAllLocations, getCountries, getCities, getBarangays } from './locations.js';
import {
  handleGetFeed,
  handleCreatePost,
  handleUpdatePost,
  handleDeletePost,
  handleLikePost,
  handleUnlikePost,
  handleGetComments,
  handleCreateComment,
  handleDeleteComment,
} from './feed.js';
import {
  handleCreateConversation,
  handleListConversations,
  handleGetMessages,
  handleSendMessage,
  handleGetUnreadCount,
  handleMarkConversationRead,
} from './messages.js';
import { jsonResponse, errorResponse, matchRoute, parseQuery } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEB_DIR = resolve(__dirname, '..', 'web');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const UPLOADS_DIR = resolve(__dirname, '..', 'uploads');

/**
 * Serve static files from the web directory
 */
function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/' || filePath === '') {
    filePath = '/index.html';
  }

  const fullPath = resolve(WEB_DIR, filePath.slice(1));

  // Security: prevent directory traversal
  if (!fullPath.startsWith(WEB_DIR)) {
    errorResponse(res, 403, 'Forbidden');
    return true;
  }

  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return false;
  }

  const ext = extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    errorResponse(res, 500, 'Error reading file');
  }

  return true;
}

/**
 * Handle API requests
 */
async function handleApi(req, res) {
  const { path } = parseQuery(req.url);
  const method = req.method;

  // Health check
  if (method === 'GET' && path === '/api/health') {
    return jsonResponse(res, 200, { status: 'ok', version: config.app.version });
  }

  // Auth routes
  if (method === 'POST' && path === '/api/auth/register') {
    return handleRegister(req, res);
  }
  if (method === 'POST' && path === '/api/auth/login') {
    return handleLogin(req, res);
  }

  // Locations routes
  if (method === 'GET' && path === '/api/locations') {
    return jsonResponse(res, 200, getAllLocations());
  }
  if (method === 'GET' && path === '/api/locations/countries') {
    return jsonResponse(res, 200, getCountries());
  }
  const citiesMatch = matchRoute('/api/locations/cities/:country', path);
  if (method === 'GET' && citiesMatch) {
    return jsonResponse(res, 200, getCities(citiesMatch.country));
  }
  const barangaysMatch = matchRoute('/api/locations/barangays/:country/:city', path);
  if (method === 'GET' && barangaysMatch) {
    return jsonResponse(res, 200, getBarangays(barangaysMatch.country, barangaysMatch.city));
  }
  if (method === 'POST' && path === '/api/auth/verify') {
    return handleVerify(req, res);
  }
  if (method === 'GET' && path === '/api/auth/verify-email') {
    return handleVerifyEmailLink(req, res);
  }
  if (method === 'POST' && path === '/api/auth/forgot-password') {
    return handleForgotPassword(req, res);
  }
  if (method === 'POST' && path === '/api/auth/reset-password') {
    return handleResetPassword(req, res);
  }

  // Profile routes (auth required)
  if (method === 'GET' && path === '/api/profile') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetProfile(req, res, user);
  }
  if (method === 'PATCH' && path === '/api/profile') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUpdateProfile(req, res, user);
  }
  if (method === 'POST' && path === '/api/profile/photo') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUploadPhoto(req, res, user);
  }
  if (method === 'PATCH' && path === '/api/profile/theme') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUpdateTheme(req, res, user);
  }
  if (method === 'POST' && path === '/api/profile/background') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUploadBackground(req, res, user);
  }

  // Public profile by username
  const publicProfileMatch = matchRoute('/api/profile/:username', path);
  if (method === 'GET' && publicProfileMatch) {
    return handleGetPublicProfile(req, res, publicProfileMatch);
  }

  // Feed routes (auth required)
  if (method === 'GET' && path === '/api/feed') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetFeed(req, res, user);
  }

  if (method === 'POST' && path === '/api/feed/posts') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreatePost(req, res, user);
  }

  // Update/Delete post
  const postMatch = matchRoute('/api/feed/posts/:id', path);
  if (method === 'PATCH' && postMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUpdatePost(req, res, user, postMatch);
  }
  if (method === 'DELETE' && postMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDeletePost(req, res, user, postMatch);
  }

  // Like/Unlike post
  const likeMatch = matchRoute('/api/feed/posts/:id/like', path);
  if (method === 'POST' && likeMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleLikePost(req, res, user, likeMatch);
  }
  if (method === 'DELETE' && likeMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUnlikePost(req, res, user, likeMatch);
  }

  // Comments
  const commentsMatch = matchRoute('/api/feed/posts/:id/comments', path);
  if (method === 'GET' && commentsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetComments(req, res, user, commentsMatch);
  }
  if (method === 'POST' && commentsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateComment(req, res, user, commentsMatch);
  }

  const deleteCommentMatch = matchRoute('/api/feed/comments/:id', path);
  if (method === 'DELETE' && deleteCommentMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDeleteComment(req, res, user, deleteCommentMatch);
  }

  // Messaging routes (auth required)
  if (method === 'POST' && path === '/api/messages/conversations') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateConversation(req, res, user);
  }
  if (method === 'GET' && path === '/api/messages/conversations') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleListConversations(req, res, user);
  }

  const messagesMatch = matchRoute('/api/messages/conversations/:id/messages', path);
  if (method === 'GET' && messagesMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetMessages(req, res, user, messagesMatch);
  }
  if (method === 'POST' && messagesMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleSendMessage(req, res, user, messagesMatch);
  }

  // Mark conversation read
  const readMatch = matchRoute('/api/messages/conversations/:id/read', path);
  if (method === 'POST' && readMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleMarkConversationRead(req, res, user, readMatch);
  }

  // Unread count
  if (method === 'GET' && path === '/api/messages/unread-count') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetUnreadCount(req, res, user);
  }

  // 404 for unknown API routes
  errorResponse(res, 404, 'API endpoint not found');
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', config.cors.origins.join(', '));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // API routes
    if (req.url.startsWith('/api/')) {
      return await handleApi(req, res);
    }

    // Uploads static files
    if (req.url.startsWith('/uploads/')) {
      const uploadPath = req.url.split('?')[0];
      const fullUploadPath = resolve(UPLOADS_DIR, uploadPath.slice(9));
      
      if (fullUploadPath.startsWith(UPLOADS_DIR) && existsSync(fullUploadPath) && statSync(fullUploadPath).isFile()) {
        const ext = extname(fullUploadPath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        try {
          const content = readFileSync(fullUploadPath);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        } catch (err) {
          errorResponse(res, 500, 'Error reading file');
        }
        return;
      }
    }

    // Static files
    if (!serveStatic(req, res)) {
      // SPA fallback - serve index.html for non-API, non-file routes
      const indexPath = resolve(WEB_DIR, 'index.html');
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } else {
        errorResponse(res, 404, 'Not found');
      }
    }
  } catch (err) {
    console.error('[SERVER] Request error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Start the server
 */
function start() {
  console.log(`[${config.app.name}] Starting v${config.app.version}...`);

  // Initialize database
  initDatabase();

  // PROFILE-02: seed default theme and backfill existing profiles
  seedDefaultTheme();

  // Create HTTP server
  const server = createServer(handleRequest);

  // Start listening
  server.listen(config.server.port, config.server.host, () => {
    console.log(`[${config.app.name}] Server running at http://${config.server.host}:${config.server.port}`);
    console.log(`[${config.app.name}] Environment: ${config.app.environment}`);
    console.log(`[${config.app.name}] API: http://localhost:${config.server.port}/api/health`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[SERVER] Shutting down...');
    server.close(() => {
      closeDatabase();
      console.log('[SERVER] Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start the server
start();
