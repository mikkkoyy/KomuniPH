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
import { initDatabase, closeDatabase, seedDefaultTheme, seedAdminUser } from './database.js';
import { requireAuth, requireAdmin } from './auth.js';
import { handleRegister, handleLogin, handleVerify, handleVerifyEmailLink, handleForgotPassword, handleResetPassword } from './auth.js';
import { handleAdminLogin, handleAdminChangePassword } from './adminAuth.js';
import { handleGetSettings, handleUpdateSettings } from './settings.js';
import { handleGetProfile, handleGetPublicProfile, handleUpdateProfile, handleUploadPhoto, handleUpdateTheme, handleUploadBackground } from './profile.js';
import { handleGetTestimonials, handleCreateTestimonial, handleDeleteTestimonial, handleGetUserTestimonials } from './testimonials.js';
import { handleGetPhotos, handleUploadPhoto as handleGalleryUploadPhoto, handleDeletePhoto, handleGetOwnPhotos } from './gallery.js';
import { getAllLocations, getCountries, getCities, getBarangays } from './locations.js';
import {
  handleGetOwnAlbums,
  handleGetAlbums,
  handleGetAlbum,
  handleCreateAlbum,
  handleUpdateAlbum,
  handleDeleteAlbum,
  handleGetPhotosWithAlbum,
  handleGetProfilePicturesAlbum,
} from './albums.js';
import {
  handleListCommunities,
  handleDiscoverCommunities,
  handleRecommendedCommunities,
  handleGetCommunity,
  handleJoinCommunity,
  handleLeaveCommunity,
  handleGetCommunityMembers,
  handleGetCommunityPosts,
  handleCreateCommunityPost,
  handleGetProfileCommunities,
  handleGetElection,
  handleNominateCommunity,
  handleVoteCommunity,
  handleGetElectionHistory,
  handleFeaturePost,
  handleUnfeaturePost,
  handleGetCommunityEvents,
  handleCreateCommunityEvent,
  handleDeleteCommunityEvent,
  handleGetCommunityMedia,
  handleGetCommunityRules,
  handleCreateCommunityRule,
  handleUpdateCommunityRule,
  handleDeleteCommunityRule,
  handlePinPost,
  handleUnpinPost,
  handleCreateReport,
  handleGetReports,
  handleResolveReport,
  handleDismissReport,
  handleGetCommunitySettings,
  handleUpdateCommunitySettings,
  initCommunities,
} from './communities.js';
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
import {
  handleGetWallet,
  handleGetTransactions,
  handleGetExchangeRate,
  handleGetPaymentAccounts,
  handleCreateTopup,
  handleGetTopups,
  handleGetTopupStatus,
  handlePaymongoWebhook,
  handleCreateWithdrawal,
  handleGetWithdrawals,
  handleAdminListTopups,
  handleAdminApproveTopup,
  handleAdminRejectTopup,
  handleAdminListWithdrawals,
  handleAdminApproveWithdrawal,
  handleAdminRejectWithdrawal,
  handleAdminCompleteWithdrawal,
  handleAdminCoinSummary,
} from './coins.js';
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
    // No caching headers were being sent at all, so browsers were free to
    // reuse a previously cached copy of index.html/app.js/profile.js/
    // styles.css indefinitely (even across normal reloads), which is why
    // fixes saved to disk were not always visible in the browser. These
    // are small, frequently-edited app files, not versioned/hashed build
    // output, so always revalidate instead of letting the browser guess.
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
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

  // Admin auth routes (no auth for login, admin auth for change-password)
  if (method === 'POST' && path === '/api/admin/login') {
    return handleAdminLogin(req, res);
  }
  if (method === 'POST' && path === '/api/admin/change-password') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminChangePassword(req, res, user);
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

// Testimonials routes
   const testimonialsMatch = matchRoute('/api/profiles/:username/testimonials', path);
   if (method === 'GET' && testimonialsMatch) {
     return handleGetTestimonials(req, res, testimonialsMatch);
   }

   if (method === 'POST' && path === '/api/testimonials') {
     const user = requireAuth(req, res);
     if (!user) return;
     return handleCreateTestimonial(req, res, user);
   }

   const testimonialMatch = matchRoute('/api/testimonials/:id', path);
   if (method === 'DELETE' && testimonialMatch) {
     const user = requireAuth(req, res);
     if (!user) return;
     return handleDeleteTestimonial(req, res, user, testimonialMatch);
   }

   // Photo Gallery routes
   const photosMatch = matchRoute('/api/profiles/:username/photos', path);
   if (method === 'GET' && photosMatch) {
     return handleGetPhotos(req, res, photosMatch);
   }

   if (method === 'POST' && path === '/api/profile/photos') {
     const user = requireAuth(req, res);
     if (!user) return;
     return handleGalleryUploadPhoto(req, res, user);
   }

   const ownPhotosMatch = matchRoute('/api/profile/photos', path);
   if (method === 'GET' && ownPhotosMatch) {
     const user = requireAuth(req, res);
     if (!user) return;
     return handleGetOwnPhotos(req, res, user);
   }

const photoMatch = matchRoute('/api/profile/photos/:id', path);
    if (method === 'DELETE' && photoMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleDeletePhoto(req, res, user, photoMatch);
    }

    // Album routes (public)
    const albumsMatch = matchRoute('/api/profiles/:username/albums', path);
    if (method === 'GET' && albumsMatch) {
      return handleGetAlbums(req, res, albumsMatch);
    }

    const albumMatch = matchRoute('/api/profiles/:username/albums/:albumId', path);
    if (method === 'GET' && albumMatch) {
      return handleGetAlbum(req, res, albumMatch);
    }

    // Album routes (owner only)
    if (method === 'GET' && path === '/api/profile/albums') {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleGetOwnAlbums(req, res, user);
    }

    if (method === 'POST' && path === '/api/profile/albums') {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleCreateAlbum(req, res, user);
    }

    const ownAlbumMatch = matchRoute('/api/profile/albums/:id', path);
    if (method === 'PATCH' && ownAlbumMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleUpdateAlbum(req, res, user, ownAlbumMatch);
    }
    if (method === 'DELETE' && ownAlbumMatch) {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleDeleteAlbum(req, res, user, ownAlbumMatch);
    }

    // Profile pictures album (owner only)
    if (method === 'GET' && path === '/api/profile/profile-pictures-album') {
      const user = requireAuth(req, res);
      if (!user) return;
      return handleGetProfilePicturesAlbum(req, res, user);
    }

    // Photos with album filter
    const photosWithAlbumMatch = matchRoute('/api/profiles/:username/photos', path);
    if (method === 'GET' && photosWithAlbumMatch) {
      return handleGetPhotosWithAlbum(req, res, photosWithAlbumMatch);
    }

    // Public profile communities (public, matches the public profile endpoint).
    // Registered before the single-segment public profile route; matchRoute
    // requires an exact segment count so the two cannot shadow each other.
    const profileCommunitiesMatch = matchRoute('/api/profile/:username/communities', path);
    if (method === 'GET' && profileCommunitiesMatch) {
      return handleGetProfileCommunities(req, res, profileCommunitiesMatch);
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

  // Community routes (auth required)
  // COMMUNITY-04: discovery routes must be registered before the generic
  // /api/communities/:id route so "discover"/"recommended" are not treated
  // as community ids.
  if (method === 'GET' && path === '/api/communities/discover') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDiscoverCommunities(req, res, user);
  }
  if (method === 'GET' && path === '/api/communities/recommended') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleRecommendedCommunities(req, res, user);
  }
  if (method === 'GET' && path === '/api/communities') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleListCommunities(req, res, user);
  }

  const communityMatch = matchRoute('/api/communities/:id', path);
  if (method === 'GET' && communityMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunity(req, res, user, communityMatch);
  }

  const communityJoinMatch = matchRoute('/api/communities/:id/join', path);
  if (method === 'POST' && communityJoinMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleJoinCommunity(req, res, user, communityJoinMatch);
  }

  const communityLeaveMatch = matchRoute('/api/communities/:id/leave', path);
  if (method === 'POST' && communityLeaveMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleLeaveCommunity(req, res, user, communityLeaveMatch);
  }

  const communityMembersMatch = matchRoute('/api/communities/:id/members', path);
  if (method === 'GET' && communityMembersMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunityMembers(req, res, user, communityMembersMatch);
  }

  const communityPostsMatch = matchRoute('/api/communities/:id/posts', path);
  if (method === 'POST' && communityPostsMatch) {
    // COMMUNITY-05: multipart post creation (optional photo/video media).
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateCommunityPost(req, res, user, communityPostsMatch);
  }
  if (method === 'GET' && communityPostsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunityPosts(req, res, user, communityPostsMatch);
  }

  const communityMediaMatch = matchRoute('/api/communities/:id/media', path);
  if (method === 'GET' && communityMediaMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunityMedia(req, res, user, communityMediaMatch);
  }

  // Community events
  const communityEventsMatch = matchRoute('/api/communities/:id/events', path);
  if (method === 'GET' && communityEventsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunityEvents(req, res, user, communityEventsMatch);
  }
  if (method === 'POST' && communityEventsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateCommunityEvent(req, res, user, communityEventsMatch);
  }
  const communityEventDeleteMatch = matchRoute('/api/communities/:id/events/:eventId', path);
  if (method === 'DELETE' && communityEventDeleteMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDeleteCommunityEvent(req, res, user, communityEventDeleteMatch);
  }

  // Monthly moderator election
  const electionHistoryMatch = matchRoute('/api/communities/:id/election/history', path);
  if (method === 'GET' && electionHistoryMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetElectionHistory(req, res, user, electionHistoryMatch);
  }
  const electionMatch = matchRoute('/api/communities/:id/election', path);
  if (method === 'GET' && electionMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetElection(req, res, user, electionMatch);
  }
  const electionNominateMatch = matchRoute('/api/communities/:id/election/nominate', path);
  if (method === 'POST' && electionNominateMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleNominateCommunity(req, res, user, electionNominateMatch);
  }
  const electionVoteMatch = matchRoute('/api/communities/:id/election/vote', path);
  if (method === 'POST' && electionVoteMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleVoteCommunity(req, res, user, electionVoteMatch);
  }

  // Featured posts moderation
  const featureMatch = matchRoute('/api/communities/:id/posts/:postId/feature', path);
  if (method === 'POST' && featureMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleFeaturePost(req, res, user, featureMatch);
  }
  if (method === 'DELETE' && featureMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUnfeaturePost(req, res, user, featureMatch);
  }

  // Community rules
  const rulesMatch = matchRoute('/api/communities/:id/rules', path);
  if (method === 'GET' && rulesMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunityRules(req, res, user, rulesMatch);
  }
  if (method === 'POST' && rulesMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateCommunityRule(req, res, user, rulesMatch);
  }
  const ruleMatch = matchRoute('/api/communities/:id/rules/:ruleId', path);
  if (method === 'PUT' && ruleMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUpdateCommunityRule(req, res, user, ruleMatch);
  }
  if (method === 'DELETE' && ruleMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDeleteCommunityRule(req, res, user, ruleMatch);
  }

  // Pinned posts
  const pinMatch = matchRoute('/api/communities/:id/posts/:postId/pin', path);
  if (method === 'POST' && pinMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handlePinPost(req, res, user, pinMatch);
  }
  const unpinMatch = matchRoute('/api/communities/:id/posts/:postId/unpin', path);
  if (method === 'POST' && unpinMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUnpinPost(req, res, user, unpinMatch);
  }

  // Reports
  const reportsMatch = matchRoute('/api/communities/:id/reports', path);
  if (method === 'GET' && reportsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetReports(req, res, user, reportsMatch);
  }
  if (method === 'POST' && reportsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateReport(req, res, user, reportsMatch);
  }
  const reportResolveMatch = matchRoute('/api/communities/:id/reports/:reportId/resolve', path);
  if (method === 'POST' && reportResolveMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleResolveReport(req, res, user, reportResolveMatch);
  }
  const reportDismissMatch = matchRoute('/api/communities/:id/reports/:reportId/dismiss', path);
  if (method === 'POST' && reportDismissMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleDismissReport(req, res, user, reportDismissMatch);
  }

  // Settings
  const settingsMatch = matchRoute('/api/communities/:id/settings', path);
  if (method === 'GET' && settingsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetCommunitySettings(req, res, user, settingsMatch);
  }
  if (method === 'PUT' && settingsMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleUpdateCommunitySettings(req, res, user, settingsMatch);
  }

  // COINS-01: Coin economy routes
  if (method === 'GET' && path === '/api/coins/wallet') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetWallet(req, res, user);
  }
  if (method === 'GET' && path === '/api/coins/transactions') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetTransactions(req, res, user);
  }
  if (method === 'GET' && path === '/api/coins/exchange-rate') {
    return handleGetExchangeRate(req, res);
  }
  if (method === 'GET' && path === '/api/coins/payment-accounts') {
    return handleGetPaymentAccounts(req, res);
  }
  // PayMongo webhook — no auth required; verified by signature
  if (method === 'POST' && path === '/api/coins/paymongo/webhook') {
    return handlePaymongoWebhook(req, res);
  }
  if (method === 'POST' && path === '/api/coins/topup') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateTopup(req, res, user);
  }
  if (method === 'GET' && path === '/api/coins/topups') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetTopups(req, res, user);
  }
  const topupStatusMatch = matchRoute('/api/coins/topup/status/:id', path);
  if (method === 'GET' && topupStatusMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetTopupStatus(req, res, user, topupStatusMatch);
  }
  if (method === 'POST' && path === '/api/coins/withdraw') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleCreateWithdrawal(req, res, user);
  }
  if (method === 'GET' && path === '/api/coins/withdrawals') {
    const user = requireAuth(req, res);
    if (!user) return;
    return handleGetWithdrawals(req, res, user);
  }

  // Admin settings routes (admin only)
  if (method === 'GET' && path === '/api/admin/settings') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleGetSettings(req, res);
  }
  if (method === 'PUT' && path === '/api/admin/settings') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleUpdateSettings(req, res);
  }

  // COINS-01: Admin coin economy routes (admin only)
  if (method === 'GET' && path === '/api/admin/coins/summary') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminCoinSummary(req, res);
  }
  if (method === 'GET' && path === '/api/admin/coins/topups') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminListTopups(req, res);
  }
  const adminTopupApproveMatch = matchRoute('/api/admin/coins/topups/:id/approve', path);
  if (method === 'POST' && adminTopupApproveMatch) {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminApproveTopup(req, res, adminTopupApproveMatch);
  }
  const adminTopupRejectMatch = matchRoute('/api/admin/coins/topups/:id/reject', path);
  if (method === 'POST' && adminTopupRejectMatch) {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminRejectTopup(req, res, adminTopupRejectMatch);
  }
  if (method === 'GET' && path === '/api/admin/coins/withdrawals') {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminListWithdrawals(req, res);
  }
  const adminWithdrawalApproveMatch = matchRoute('/api/admin/coins/withdrawals/:id/approve', path);
  if (method === 'POST' && adminWithdrawalApproveMatch) {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminApproveWithdrawal(req, res, adminWithdrawalApproveMatch);
  }
  const adminWithdrawalRejectMatch = matchRoute('/api/admin/coins/withdrawals/:id/reject', path);
  if (method === 'POST' && adminWithdrawalRejectMatch) {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminRejectWithdrawal(req, res, adminWithdrawalRejectMatch);
  }
  const adminWithdrawalCompleteMatch = matchRoute('/api/admin/coins/withdrawals/:id/complete', path);
  if (method === 'POST' && adminWithdrawalCompleteMatch) {
    const user = requireAdmin(req, res);
    if (!user) return;
    return handleAdminCompleteWithdrawal(req, res, adminWithdrawalCompleteMatch);
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

  // ADMIN-SEED: create default admin user if none exists
  seedAdminUser();

  // COMMUNITY-01: seed Nationwide communities and City/Barangay communities
  // derived from existing profile locations (idempotent).
  initCommunities();

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
