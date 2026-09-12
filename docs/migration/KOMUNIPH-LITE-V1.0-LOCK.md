# KOMUNIPH LITE v1.0 — LOCK DOCUMENT

## Architecture

```text
komuniph/
├── server/
│   ├── index.js          # HTTP server, routing, static files
│   ├── config.js         # Environment configuration
│   ├── database.js       # SQLite setup + schema
│   ├── auth.js           # Authentication (JWT, bcrypt)
│   ├── profile.js        # Profile routes
│   ├── feed.js           # Feed routes (posts, comments, reactions)
│   └── utils.js          # Shared utilities
├── web/
│   ├── index.html        # SPA entry point
│   ├── css/styles.css    # Plain CSS (KomuniPH design tokens)
│   └── js/
│       ├── app.js        # Router + app init
│       ├── api.js        # API client (fetch)
│       ├── auth.js       # Auth UI (login, register)
│       ├── feed.js       # Feed UI (posts, comments, reactions)
│       └── profile.js    # Profile UI
├── data/
│   └── komuniph.db       # SQLite database (auto-created)
├── config/
│   └── .env              # Environment variables
├── package.json
└── package-lock.json
```

## Technology Stack

| Component | Implementation |
|-----------|----------------|
| Runtime | Node.js 24.x |
| HTTP Server | Native http module |
| Database | SQLite (better-sqlite3) |
| Authentication | bcrypt + jsonwebtoken |
| Frontend | Vanilla HTML/CSS/JS |
| Routing | Hash-based (#/login, #/home, etc.) |
| State | Plain JavaScript objects |
| Styling | Plain CSS with design tokens |

## Dependencies

### Runtime (5 packages)
- better-sqlite3: SQLite driver
- bcrypt: Password hashing
- jsonwebtoken: JWT tokens
- uuid: UUID generation
- dotenv: Environment config

### Dev Dependencies
- None

## Migrated Features

### Authentication
- User registration with email/username/password
- Login with JWT access/refresh tokens
- Logout / Sign Out
- Email verification (token-based)
- Password hashing (bcrypt, 12 rounds)
- Auth middleware for protected routes
- Account status checking

### Profile
- User profile creation (automatic on registration)
- Profile retrieval (own profile)
- Public profile by username
- Default theme assignment (KomuniPH Default, system-owned, free)
- Theme data included in profile API responses
- Theme rendered via CSS custom properties on profile card
- Profile theme customization (colors, background, card styling)
- Background image upload with Sharp/WebP processing
- Reset to default theme

### Feed
- Post creation with content
- Post retrieval (paginated feed)
- Post editing (owner only)
- Post deletion (owner only)
- Like/Unlike reactions
- Comment creation
- Comment retrieval (paginated)
- Comment deletion (owner only)
- Profile photo upload

### Frontend
- Login page with form validation
- Registration page with form validation
- Home page with feed display
- Post composer
- Post cards with reactions and comments
- Profile page
- Loading/error/empty states
- Responsive design

## Database Schema

```sql
users (id, email, username, password_hash, role, account_status, created_at, updated_at)
profiles (id, user_id, display_name, real_name, alias, alias_enabled, bio, profile_photo_url, cover_photo_url, theme_id, custom_theme_config, created_at, updated_at)
profile_themes (id, name, type, is_free, config, created_at, updated_at)
posts (id, author_id, content, created_at, updated_at, edited_at)
comments (id, post_id, author_id, content, created_at, updated_at)
reactions (id, post_id, user_id, created_at, UNIQUE(post_id, user_id))
```

## Security

- bcrypt password hashing (12 rounds)
- JWT tokens with expiration
- Parameterized SQL queries
- SQLite foreign keys enabled
- Input validation on all endpoints
- Authorization checks (owner-only operations)
- No secrets in source code

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| POST | /api/auth/register | No | Register user |
| POST | /api/auth/login | No | Login |
| POST | /api/auth/verify | No | Verify email |
| GET | /api/profile | Yes | Get own profile (includes merged theme) |
| PATCH | /api/profile | Yes | Update profile (display_name, bio, alias) |
| PATCH | /api/profile/theme | Yes | Update theme customization |
| POST | /api/profile/photo | Yes | Upload profile photo |
| POST | /api/profile/background | Yes | Upload profile background |
| GET | /api/profile/:username | No | Get public profile (includes merged theme) |
| GET | /api/feed | Yes | Get paginated feed |
| POST | /api/feed/posts | Yes | Create post |
| PATCH | /api/feed/posts/:id | Yes | Update post |
| DELETE | /api/feed/posts/:id | Yes | Delete post |
| POST | /api/feed/posts/:id/like | Yes | Like post |
| DELETE | /api/feed/posts/:id/like | Yes | Unlike post |
| GET | /api/feed/posts/:id/comments | Yes | Get comments |
| POST | /api/feed/posts/:id/comments | Yes | Create comment |
| DELETE | /api/feed/comments/:id | Yes | Delete comment |

## Deployment Requirements

- Node.js 18+ (tested on 24.x)
- No external services required
- No build step required
- SQLite database auto-created on first run

## Commands

```bash
npm install        # Install dependencies
npm start          # Start production server
npm run dev        # Start with auto-reload
npm run db:init    # Initialize database
```

## Verification Results

- Server starts successfully
- Health endpoint responds
- User registration works
- User login works
- Duplicate registration rejected (409)
- Unauthorized access rejected (401)
- Post creation works
- Feed retrieval works
- Like/Unlike works
- Comments work (FEED-05: VERIFIED)
- Profile retrieval works
- Profile photo upload works (FEED-06: VERIFIED)
- Default theme assigned on registration (PROFILE-02: VERIFIED)
- Profile theme customization works (PROFILE-03: VERIFIED)
- Frontend loads correctly

## FEED Feature Status

| Feature | Status |
|---------|--------|
| FEED-01: Post creation | VERIFIED |
| FEED-02: Post retrieval | VERIFIED |
| FEED-03A: Post edit | VERIFIED |
| FEED-03B: Post delete | VERIFIED |
| FEED-04: Like/Unlike | VERIFIED |
| FEED-05: Comments | VERIFIED |
| FEED-06: Profile photo upload | VERIFIED |
| FEED-06A: Profile photo optimization | VERIFIED |
| FEED-07: Profile edit | VERIFIED |

## FEED-07 — Profile Edit

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- `PATCH /api/profile` (auth required) — updates the authenticated user's own profile
  - `display_name`: required when provided, trimmed, 1–100 chars
  - `bio`: optional, trimmed, max 500 chars (empty → NULL)
  - `alias`: required when provided, trimmed, max 50 chars, allowed chars
    `[A-Za-z0-9_.-]`, unique case-insensitively (`COLLATE NOCASE`) → `409` on conflict
  - Partial updates supported; unspecified fields preserved
  - Parameterized SQLite `UPDATE`; response contains no secrets
- Profile UI edit mode: Edit Profile / Save Changes / Cancel, validation errors,
  duplicate-submission prevention, XSS-escaped rendering, immediate refresh on save

### Files Changed
- `server/profile.js` — `handleUpdateProfile`
- `server/index.js` — `PATCH /api/profile` route
- `web/js/profile.js` — edit mode, handlers, escaping
- `web/js/api.js` — `profileApi.updateProfile`
- `web/css/styles.css` — edit-mode styles

### Verification
- Display name / bio / alias update + persistence: PASS
- Duplicate alias (exact + case-insensitive): PASS (409, other profile unchanged)
- Validation (empty/oversized/invalid chars): PASS (422, DB unchanged)
- Authentication (no/invalid token): PASS (401, no modification)
- Regression: feed, posts, likes, comments, profile photo display,
  photo upload (JPEG → WebP 900x600 served as image/webp): PASS

## SOCIAL-02 — Sidebar Expansion

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Three new sidebar navigation items added to existing SOCIAL-01 left sidebar:
  - Creator Studio (`#/creator-studio`)
  - Marketplace (`#/marketplace`)
  - Community Groups (`#/groups`)
- Placement: between "Saved" and "Settings", separated by visual dividers
- Active navigation state: `getSidebarHtml(activeRoute)` sets `active` class based on current route
- Placeholder pages: centered card layout with icon, title, description, and "Coming soon." text
- No backend implementation, no database tables, no fake data
- Existing Home/Profile/Messages/Notifications/Saved/Settings/Logout navigation preserved
- Responsive: new pages work inside existing three-column shell on desktop; mobile bottom nav unaffected

### Files Changed
- `web/js/feed.js` — extracted `getSidebarHtml(activeRoute)`, added `renderPlaceholderPage()`, `initPlaceholderPage()`, `initSidebarCommon()`; new nav items + dividers
- `web/js/app.js` — added `/creator-studio`, `/marketplace`, `/groups` routes with auth guards
- `web/css/styles.css` — added `.sidebar-nav-divider`, `.placeholder-page`, `.placeholder-card`, `.placeholder-icon`, `.placeholder-description`, `.placeholder-coming-soon`
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section

### Verification
- Creator Studio nav item: PASS
- Marketplace nav item: PASS
- Community Groups nav item: PASS
- Placement between Saved and Settings: PASS
- `/creator-studio` route: PASS
- `/marketplace` route: PASS
- `/groups` route: PASS
- Active navigation state for all routes: PASS
- Placeholder page content (no fake data): PASS
- Desktop/tablet/mobile responsive: PASS
- Home feed regression: PASS
- Profile regression: PASS
- Messages regression: PASS
- Unread count regression: PASS
- Auth regression: PASS

## MESSAGE-04 — Back to Home Button

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Added `← Back to Home` button to the Messages page sidebar header (`#messages-back-home`)
- Button behavior: calls `destroyMessagesPage()` to stop polling/cleanup, then `navigate('/home')` to route to Home feed
- No browser reload; uses existing hash-based routing
- CSS: subtle rounded button matching KomuniPH dark/translucent style, responsive on mobile
- Existing `/home` route, `renderHomePage`, `initHomePage` unchanged
- `destroyMessagesPage()` already called by `app.js` on every route change — no duplicate cleanup logic

### Files Changed
- `web/js/messages.js` — added `messages-back-home` button in `renderMessagesPage()`, wired click handler in `initMessagesPage()`
- `web/css/styles.css` — added `.messages-back-home` styles
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section

### Verification
- Button present in Messages page: PASS
- Button calls destroyMessagesPage + navigate('/home'): PASS
- CSS styling applied: PASS
- /home route intact: PASS
- Polling cleanup verified (stopPolling, hasNewMessagesIndicator reset, selectedConversationId reset): PASS
- Feed regression: PASS
- Profile regression: PASS
- Messages list/chat regression: PASS
- Send message regression: PASS
- Unread count regression: PASS
- Mark read regression: PASS

## MESSAGE-03 — Chat Experience

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Conversation header: avatar, display name, @alias (when alias_enabled), no fake status
- Composer upgraded from `<input>` to `<textarea>`: Enter sends, Shift+Enter inserts newline
- Send button disabled during submission, re-enabled on success/failure; failed sends keep text in composer
- Empty chat state: "No messages yet. Start the conversation."
- Initial scroll: scrolls chat container to bottom on conversation open via requestAnimationFrame
- Load older messages: button at top of chat, paginates via offset, preserves scroll position by adjusting scrollTop after prepend
- "No older messages" state when pagination exhausted
- New-message polling: 7s interval while conversation is active; compares latest message ID to detect new messages
- New-message indicator: sticky "↓ New message(s)" button appears when user is scrolled up; clicking scrolls to bottom
- Read state: marks conversation read on open; MESSAGE-02 unread badges remain functional
- Polling cleanup: `stopPolling()` on conversation switch, back button, and page destroy via `app.js` route change
- XSS safety: message bodies rendered via `escapeHtml()` using textContent-based approach
- Mobile preserved: back button, composer, scroll, bottom nav

### Files Changed
- `web/js/messages.js` — major rewrite: composer textarea, scroll-to-bottom, load-older, polling, new-message indicator, alias in header, empty-chat state, send-failure UX, cleanup
- `web/js/app.js` — calls `destroyMessagesPage()` on route change for polling cleanup
- `web/css/styles.css` — added `.chat-header-alias`, `.chat-empty-state`, `.chat-older-btn`, `.chat-older-disabled`, `.new-messages-indicator`, textarea styles, message grouping, mobile composer adjustments
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section

### Files Unchanged
- `server/messages.js`, `server/index.js`, `server/database.js`, `web/js/api.js`, `web/js/feed.js` — no changes

### Verification
- T1 Open chat structure (renderMessagesPage, loadMessages, selectConversation, scrollToBottom, mark read): PASS
- T2 Send message persists and sender correct: PASS
- T3 Enter sends message: PASS
- T4 Shift+Enter inserts newline (textarea): PASS
- T5 Empty/whitespace message rejected (422): PASS
- T6 Load older messages button, scroll preservation, pagination via offset: PASS
- T7 Polling interval, start/stop polling, new-message indicator, isNearBottom: PASS
- T8 Polling cleanup on conversation switch, back button, page destroy: PASS
- T9 Mobile back button, CSS, composer, bottom nav: PASS
- T10 XSS safety (escapeHtml, textContent): PASS
- T11 MESSAGE-02 regression (conversation list, unread_count, unread-count API, mark-read): PASS
- T12 Existing app regression (feed, profile, MESSAGE-01 chat): PASS

## MESSAGE-02 — Conversation List + Unread

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Database migration: added `last_read_at` column to `conversation_participants` via safe `ALTER TABLE` (ignored if column already exists); existing conversations and messages remain intact
- Unread definition: `message.sender_id != current_user AND (last_read_at IS NULL OR message.created_at > last_read_at)`
- `GET /api/messages/conversations` extended with per-conversation `unread_count`
- `GET /api/messages/unread-count` — returns authenticated user's total unread across all conversations
- `POST /api/messages/conversations/:id/read` — updates only the authenticated participant's `last_read_at`; non-participants receive 403
- Conversation opens → messages load → mark-read POST → unread badges clear
- Conversation list UI: unread badge, bold name/preview, subtle teal-tinted background
- Left sidebar Messages nav item: compact coral badge synced with real API count
- Messages page header: unread count badge
- Refresh triggers: page init, conversation selected, message sent, mark-read response
- No realtime, no polling, no WebSocket

### Files Changed
- `server/database.js` — added `last_read_at` column + safe ALTER TABLE migration
- `server/messages.js` — extended `handleListConversations` with `unread_count`; added `handleGetUnreadCount`, `handleMarkConversationRead`
- `server/index.js` — registered `GET /api/messages/unread-count` and `POST /api/messages/conversations/:id/read`
- `web/js/api.js` — added `messagesApi.getUnreadCount()`, `messagesApi.markConversationRead()`
- `web/js/messages.js` — added `globalUnreadCount` state, `updateSidebarBadge()`, `refreshUnreadCount()`, `renderConversationList()`, unread badge rendering, mark-read on conversation open, sidebar badge refresh
- `web/js/feed.js` — added `#sidebar-messages-badge` to Messages nav item; calls `refreshUnreadCount()` on home init
- `web/css/styles.css` — added `.sidebar-nav-badge`, `.conversation-unread-badge`, `.conversation-item.unread`, `.unread-badge` styles

### Verification
- T1 Initial state unread_count=0, global=0: PASS
- T2 Incoming message B unread_count=1, global=1: PASS
- T3 Three incoming messages B unread_count=3, global=3: PASS
- T4 Sender A global unread unchanged (0): PASS
- T5 Open conversation → mark-read → unread_count=0, global=0: PASS
- T6 Per-user read state independent (A=0, B=0): PASS
- T7 New message after read → B unread_count=1: PASS
- T8 Non-participant mark-read blocked (403): PASS
- T9 Sidebar badge, conversation badge, CSS, API structure: PASS
- T10 MESSAGE-01 chat regression: PASS

## MESSAGE-01 — Messaging Foundation

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- SQLite tables: `conversations`, `conversation_participants` (PK: conversation_id + user_id), `messages`
- Indexes: `idx_messages_conversation_id`, `idx_messages_created_at` (composite), `idx_messages_sender_id`, `idx_conversation_participants_user_id`
- Private 1:1 conversations; non-participants cannot read or write messages
- API endpoints (all auth-required via existing `requireAuth`):
  - `POST /api/messages/conversations` — create or return existing conversation by target user_id; rejects self-conversation, missing/invalid user_id (422), nonexistent user (404)
  - `GET /api/messages/conversations` — paginated list with other_user profile, last message, updated_at
  - `GET /api/messages/conversations/:id/messages` — paginated messages, chronological (ASC), 403 for non-participants
  - `POST /api/messages/conversations/:id/messages` — send message; trims whitespace, rejects empty (422), max 2000 chars; returns created message with author info
- Frontend messaging page (`/messages`): two-pane desktop layout (conversation list | chat), mobile single-pane with back button
- Empty state, loading state, error state with retry; toast notifications for send errors
- Messages sidebar entry navigates to real messaging page (no longer "coming soon")
- Message body rendered via `textContent` (no `innerHTML` with raw user text)
- No realtime, no attachments, no reactions, no read receipts, no typing indicator

### Files Changed
- `server/database.js` — added `conversations`, `conversation_participants`, `messages` tables + indexes
- `server/messages.js` — new file: `handleCreateConversation`, `handleListConversations`, `handleGetMessages`, `handleSendMessage`
- `server/index.js` — registered messaging routes under `/api/messages/*`
- `web/js/api.js` — added `messagesApi` object
- `web/js/messages.js` — new file: `renderMessagesPage`, `initMessagesPage`, conversation list, chat view, send message
- `web/css/styles.css` — added `.messages-sidebar`, `.conversation-item`, `.messages-chat`, `.chat-bubble`, `.chat-input-form`, mobile responsive rules
- `web/js/app.js` — added `/messages` route case
- `web/js/feed.js` — changed sidebar "Messages" nav item from "coming soon" placeholder to `href="#/messages"`
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section

### Files Unchanged
- `server/profile.js`, `server/feed.js`, `server/auth.js`, `server/config.js`, `server/utils.js` — no changes
- `web/js/auth.js`, `web/js/profile.js`, `web/index.html` — no changes

### Verification
- T1 Unauthenticated rejected (401): PASS
- T2 Conversation created with two participants: PASS
- T3 Duplicate conversation prevented (same ID returned): PASS
- T4 Message persisted with correct sender: PASS
- T5 Recipient can retrieve messages: PASS
- T6 Non-participant blocked (403): PASS
- T7 Empty/whitespace message rejected (422): PASS
- T8 Conversation and messages persist across requests: PASS
- T9 Conversation list, selection, chat view, send message, loading/error/empty states, mobile back button: PASS
- T10 Home feed, profile, profile edit, profile photo: PASS (no regressions)

## SOCIAL-01 — Three-Column Social Layout

**Status: VERIFIED/LOCKED**
**Date: 2026-09-02**

### Implemented
- Three-column layout on desktop (≥1024px): left sidebar (280px) | center feed | right sidebar (320px)
- Two-column layout on tablet (641px–1023px): left sidebar (240px) | center feed (right sidebar hidden)
- Single-column layout on mobile (≤640px): center feed only, compact bottom navigation bar
- Left sidebar: authenticated user profile area (photo, display name, alias via `/api/profile`) with navigation links (Home, Profile, Messages, Notifications, Saved, Settings, Logout)
- Center column: preserved existing home feed, composer, post cards, likes, comments; added composer action bar (Post, Video, Photo Story, Reels entry points)
- Right sidebar: Search input (UI-only), People section (UI-only), Suggestions section (UI-only)
- Post action bar: "Post" focuses the existing composer; Video/Story/Reels show "coming soon" toast
- Profile photo: loaded from `profileApi.getOwnProfile()`, uses existing `/uploads/profile/*.webp` pipeline (FEED-06A), fallback to initials avatar
- Logout: uses existing `authApi.logout()` + navigate to `/login`
- Messages/Notifications/Saved/Settings: clearly marked future features, no fake functionality
- Accessibility: aria-labels, focus-visible styles preserved, keyboard-navigable nav items
- No server changes required

### Files Changed
- `web/css/styles.css` — three-column grid layout, sidebar styles, mobile nav, toast, responsive breakpoints
- `web/js/feed.js` — `renderHomePage()` restructured for 3-column layout, `initHomePage()` extended with sidebar profile loading, action handlers, mobile menu; added `loadSidebarProfile()` and `showToast()` helpers

### Files Unchanged
- `server/index.js` — no changes
- `server/profile.js` — no changes
- `server/feed.js` — no changes
- `server/auth.js` — no changes
- `web/js/app.js` — no changes
- `web/js/api.js` — no changes
- `web/js/auth.js` — no changes
- `web/js/profile.js` — no changes
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section added

### Verification
- Desktop three-column layout: PASS
- Left sidebar profile photo: PASS
- Left sidebar display name: PASS
- Left sidebar alias: PASS
- Left sidebar navigation (Home, Profile, Logout): PASS
- Coming-soon nav items (Messages, Notifications, Saved, Settings): PASS
- Center feed loads existing posts: PASS
- Composer action bar (Post, Video, Photo Story, Reels): PASS
- Right sidebar Search, People, Suggestions: PASS
- Tablet 2-column layout (right sidebar hidden): PASS
- Mobile 1-column layout with bottom nav: PASS
- Logout clears session and redirects to login: PASS
- Profile photo updates reflected in sidebar: PASS
- Like/comment/edit/post functionality unchanged: PASS

## Known Limitations

1. Email verification is a placeholder (no actual email sending)
2. No rate limiting (Redis removed)
3. No CORS configuration beyond defaults
4. No file upload for profile photos
5. No real-time updates (WebSocket)

## Pre-FEED-06 Cleanup

**Status: VERIFIED**
**Date: 2026-09-11**

### Removed
- `backend/` — Old Python/FastAPI backend
- `frontend/` — Old React/Vite frontend
- `alembic.ini` — Python Alembic config
- `pyproject.toml` — Python project config
- `requirements.txt` — Python requirements
- `.pytest_cache/` — Python test cache
- `Dockerfile` — Docker config
- `docker-compose.yml` — Docker Compose config
- `.dockerignore` — Docker ignore
- `_cleanup_backup_20260820_181021/` — Old backup
- `opensource-socialnetwork-master/` — PHP reference project
- `database/` — Empty directory
- `deployment/` — Empty directory
- `infrastructure/` — Empty directory
- `scripts/` — Empty directory
- `assets/` — Empty directory
- `creator-studio/` — Empty directory
- `.github/` — Empty directory
- `logs/` — Old logs
- `logs_test/` — Old test logs
- `454454.txt4` — Temporary file
- `cmd.txt` — Temporary file
- `command.txt` — Temporary file
- `backend_test_run.log` — Old test log
- `AUTH-01-SPECIFICATION.md` — Duplicate docs (in docs/)
- `AUTH-03-IMPLEMENTATION.md` — Duplicate docs (in docs/)
- `AUTH-04-SPECIFICATION.md` — Duplicate docs (in docs/)
- `AUTH07.md` — Duplicate docs (in docs/)
- `AUTH08.md` — Duplicate docs (in docs/)
- `AUTH09.md` — Duplicate docs (in docs/)
- `KOMUNIPH_BASELINE.md` — Old baseline
- `NEXT_BUILD_CHECKLIST.md` — Old checklist
- `PHASE2_IMPLEMENTATION_PLAN.md` — Old plan
- `.env.example` — Old Python env example
- `start-komuniph.ps1` — Old startup script
- `Start+Shutdown.bat` — Old startup script
- `check-users.mjs` — Utility script

### Preserved
- AUTH v1.0
- Forgot Password
- FEED-03B Home/Newsfeed
- FEED-04 Like/Unlike
- FEED-05 Comments
- SQLite database (`data/komuniph.db`)
- Server (`server/`)
- Frontend (`web/`)
- Configuration (`config/`)

## PROFILE-02 — Default Profile Theme Initialization

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Database: added `profile_themes` table and `theme_id` column to `profiles` via safe `ALTER TABLE` migration
- System default theme seeded on every server startup: `id='default'`, `name='KomuniPH Default'`, `type='system'`, `is_free=true`, config matches existing KomuniPH design tokens
- Registration: `POST /api/auth/register` now assigns `theme_id='default'` to the new profile
- Backfill: `seedDefaultTheme()` runs on startup and sets `theme_id='default'` on any existing profile that has no theme; existing valid themes are never overwritten
- Profile API: `GET /api/profile` and `GET /api/profile/:username` now return a `theme` object (`id`, `name`, `type`, `is_free`, `config`) alongside profile data
- Profile rendering: own profile page applies theme config as CSS custom properties on `.profile-card`; text colors also use theme variables with safe fallbacks to existing design tokens
- Security: theme values are system-controlled JSON strings parsed by the server; no user-generated CSS, JS, or HTML injection possible

### Theme Config Schema (PROFILE-02)
```json
{
  "background": "#fff7ec",
  "cardBackground": "rgba(255, 247, 236, 0.95)",
  "accent": "#0e6e6e",
  "border": "#f0dfc8",
  "text": "#2a2130",
  "textSecondary": "#6b6072",
  "cardRadius": "1.75rem",
  "cardShadow": "0 20px 60px -20px rgba(42, 33, 48, 0.35)"
}
```

### Files Changed
- `server/database.js` — `profile_themes` table, `profiles.theme_id` column, `seedDefaultTheme()` backfill
- `server/index.js` — calls `seedDefaultTheme()` on startup
- `server/auth.js` — registration inserts `theme_id='default'`
- `server/profile.js` — `PROFILE_SELECT` includes `theme_id`, `handleGetPublicProfile` includes theme, `buildTheme()` helper
- `web/js/profile.js` — `renderProfileContent()` applies theme CSS custom properties to `.profile-card`
- `web/css/styles.css` — `.profile-card`, `.profile-name`, `.profile-username`, `.profile-alias`, `.profile-bio` use `--theme-*` variables with fallbacks

### Verification
- New registration receives default theme: PASS
- New profile has `theme_id='default'` in DB: PASS
- Public profile API exposes theme: PASS
- Existing valid theme not overwritten by backfill: PASS
- Theme persists across logout/login: PASS
- Feed/post/like/comment regression: PASS
- Profile photo upload still works: PASS
- Profile edit still works: PASS

### Scope Limit
- No theme marketplace
- No Creator Studio integration
- No theme editor or selector UI
- No background upload
- No custom CSS/JS injection
- No visitor counters, widgets, or guestbook

## PROFILE-03 — Profile Theme & Background Customization

**Status: VERIFIED/LOCKED**
**Date: 2026-09-12**

### Implemented
- Database: added `custom_theme_config` TEXT column to `profiles` via safe `ALTER TABLE` migration; stores per-user JSON theme overrides without mutating shared system themes
- Background upload directory: `uploads/backgrounds/` with safe filenames, Sharp validation, WebP conversion, and Windows retry cleanup
- Server-side theme validation: only allowed fields are persisted; colors must be `#RRGGBB`; position/size/repeat are enum-validated; gradients must start with `linear-gradient(`; opacity 0–1; border radius 0–100px
- `PATCH /api/profile/theme` (auth required): accepts theme customization fields, merges with base theme config, stores only changed fields in `profiles.custom_theme_config`; sending `null` removes that field so it reverts to the base theme
- `POST /api/profile/background` (auth required): multipart upload with Busboy + Sharp, max 1920×1080 resize, WebP output, stores URL in custom theme config
- Profile API: `GET /api/profile` and `GET /api/profile/:username` return merged theme config (`base + custom overrides`) in `profile.theme.config`; `profile.theme.custom` exposes only the user's overrides
- Profile UI: "Customize Profile" button opens a compact panel with Background (solid/gradient/image), Position/Size/Repeat, Colors (text/muted/accent), Card (color/opacity/border/radius), live preview via CSS variables, Reset to Default, Cancel, Save
- Live preview: changing any control immediately updates CSS custom properties on `.profile-card`; background image/gradient/color applied directly
- Reset: sends `null` for all customizable fields, clearing `custom_theme_config` and restoring the system default appearance
- Security: no arbitrary CSS/JS/HTML injection; all values validated server-side; background images are processed through Sharp and stored outside web root; parameterized SQL throughout

### Theme Config Schema (PROFILE-03)
```json
{
  "background": "#fff7ec",
  "backgroundImage": "/uploads/backgrounds/xxx.webp",
  "backgroundGradient": "linear-gradient(135deg, #111827, #312e81)",
  "backgroundPosition": "center",
  "backgroundRepeat": "no-repeat",
  "backgroundSize": "cover",
  "cardBackground": "rgba(255, 247, 236, 0.95)",
  "cardOpacity": 0.92,
  "cardBorderColor": "#f0dfc8",
  "cardBorderRadius": "1.75rem",
  "cardShadow": "0 20px 60px -20px rgba(42, 33, 48, 0.35)",
  "text": "#2a2130",
  "textSecondary": "#6b6072",
  "accent": "#0e6e6e",
  "textColor": "#ffffff",
  "mutedTextColor": "#94a3b8",
  "accentColor": "#38bdf8"
}
```

### Files Changed
- `server/config.js` — added `upload.backgroundDir`
- `server/database.js` — `profiles.custom_theme_config` column migration, safe ALTER TABLE
- `server/profile.js` — `validateThemeConfig`, `handleUpdateTheme`, `handleUploadBackground`, `processBackgroundUpload`, merged theme in `buildTheme`, `PROFILE_SELECT` includes `custom_theme_config`
- `server/index.js` — registered `PATCH /api/profile/theme` and `POST /api/profile/background`
- `web/js/api.js` — `profileApi.updateTheme`, `profileApi.uploadBackground`
- `web/js/profile.js` — customization panel, live preview, save/reset handlers, background image support in profile rendering
- `web/css/styles.css` — `.theme-panel`, `.theme-section`, `.theme-field`, `.theme-panel-footer`, background/card CSS variables with fallbacks
- `docs/migration/KOMUNIPH-LITE-V1.0-LOCK.md` — this section

### Verification
- New registration receives default theme: PASS
- Theme customization persists in DB and API: PASS
- Theme persists after reload/login: PASS
- Public profile exposes merged custom theme: PASS
- User isolation (A customization does not affect B): PASS
- Reset to default clears custom config and restores base theme: PASS
- Background upload returns valid `/uploads/backgrounds/*.webp` URL: PASS
- Invalid colors/gradients/positions/sizes rejected (422): PASS
- Unknown fields rejected (422): PASS
- Unauthenticated theme modification rejected (401): PASS
- Feed/post/like/comment regression: PASS
- Profile photo upload still works: PASS
- Profile edit still works: PASS
- Messages regression: PASS

### Scope Limit
- No theme marketplace
- No Creator Studio integration
- No custom CSS/JS injection
- No visitor counters, widgets, guestbook, MP3, or payments

---



**KOMUNIPH LITE v1.0**
**STATUS: LOCKED**
**DATE: 2026-09-12**
