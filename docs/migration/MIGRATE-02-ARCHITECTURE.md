# KOMUNIPH MIGRATION — MIGRATE-02: COMPACT NODE.JS ARCHITECTURE

## 1. Target Architecture

```text
komuniph/
├── server/
│   ├── index.js          # Entry point, HTTP server
│   ├── config.js         # Environment configuration
│   ├── database.js       # SQLite setup + schema init
│   ├── auth.js           # Auth routes + JWT middleware
│   ├── profile.js        # Profile routes
│   ├── feed.js           # Feed routes (posts, comments, reactions)
│   └── utils.js          # Shared utilities
├── web/
│   ├── index.html        # Single page application
│   ├── css/
│   │   └── styles.css    # Plain CSS (KomuniPH design tokens)
│   └── js/
│       ├── app.js        # Router + main app logic
│       ├── api.js        # API client (fetch wrapper)
│       ├── auth.js       # Auth UI (login, register)
│       ├── feed.js       # Feed UI (posts, comments, reactions)
│       └── profile.js    # Profile UI
├── data/
│   └── komuniph.db       # SQLite database (auto-created)
├── config/
│   └── .env              # Environment variables
├── package.json
└── README.md
```

## 2. Technology Choices

| Component | Original | Migration Target | Rationale |
|-----------|----------|------------------|-----------|
| Runtime | Python 3.x | Node.js 24.x | Available, modern |
| HTTP Framework | FastAPI | Native http module | Zero dependencies |
| Database | PostgreSQL | SQLite (better-sqlite3) | Embedded, zero config |
| ORM | SQLAlchemy | Raw SQL (parameterized) | Simpler, fewer deps |
| Auth | Argon2id + PyJWT | bcrypt + jsonwebtoken | Standard Node.js |
| Frontend | React + Vite + Tailwind | Vanilla HTML/CSS/JS | Zero build step |
| State | Zustand + React Query | Plain JS objects | Zero dependencies |
| Forms | React Hook Form + Zod | Native HTML forms | Zero dependencies |
| Styling | Tailwind CSS | Plain CSS | Zero dependencies |

## 3. Backend Design

### 3.1 Request Flow

```text
HTTP Request
    ↓
Node.js http server (index.js)
    ↓
Route matching (URL path + method)
    ↓
Auth middleware (if protected route)
    ↓
Route handler (auth.js / profile.js / feed.js)
    ↓
SQLite query (database.js)
    ↓
JSON Response
```

### 3.2 Database Schema (SQLite)

```sql
-- Users table
CREATE TABLE users (
    id TEXT PRIMARY KEY,           -- UUID4
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    account_status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profiles table
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    real_name TEXT,
    alias TEXT,
    alias_enabled INTEGER NOT NULL DEFAULT 0,
    bio TEXT,
    profile_photo_url TEXT,
    cover_photo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Posts table
CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT
);

-- Comments table
CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reactions table (likes)
CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(post_id, user_id)
);
```

### 3.3 API Endpoints

```text
AUTH:
  POST /api/auth/register     - Register new user
  POST /api/auth/login        - Login, returns JWT
  POST /api/auth/verify       - Verify email token

PROFILE:
  GET  /api/profile           - Get own profile (auth required)

FEED:
  GET  /api/feed              - Get paginated feed (auth required)
  POST /api/feed/posts        - Create post (auth required)
  PATCH /api/feed/posts/:id   - Update post (auth required, owner only)
  DELETE /api/feed/posts/:id  - Delete post (auth required, owner only)
  POST /api/feed/posts/:id/like    - Like post (auth required)
  DELETE /api/feed/posts/:id/like  - Unlike post (auth required)
  GET  /api/feed/posts/:id/comments    - Get comments (auth required)
  POST /api/feed/posts/:id/comments    - Create comment (auth required)
  DELETE /api/feed/comments/:id         - Delete comment (auth required, owner only)

HEALTH:
  GET  /api/health            - Health check
```

### 3.4 Authentication

- JWT tokens (access + refresh)
- bcrypt password hashing
- Token stored in memory (frontend)
- Authorization header: `Bearer <token>`

## 4. Frontend Design

### 4.1 Single Page Application

```text
index.html
    ↓
Hash-based routing (#/login, #/register, #/home, #/profile)
    ↓
JavaScript modules (auth.js, feed.js, profile.js)
    ↓
DOM manipulation (no framework)
    ↓
API calls (api.js → fetch)
```

### 4.2 Pages

| Route | Component | Auth Required |
|-------|-----------|---------------|
| #/login | Login form | No |
| #/register | Register form | No |
| #/verify-email | Email verification | No |
| #/home | Feed + post composer | Yes |
| #/profile | User profile | Yes |

### 4.3 UI Components (Vanilla JS)

- AuthLayout (gradient background + garland)
- LoginForm
- RegisterForm
- HomePage (feed + composer)
- PostCard (with reactions, comments)
- CommentsSection
- ProfilePage
- Loading/Error/Empty states

## 5. Security

- Password hashing (bcrypt, 12 rounds)
- JWT signing (HS256)
- Parameterized SQL queries
- SQLite foreign keys enabled
- Input validation (server-side)
- CORS configuration
- No secrets in source code

## 6. Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "bcrypt": "^5.1.0",
    "jsonwebtoken": "^9.0.0",
    "uuid": "^10.0.0",
    "dotenv": "^16.0.0"
  }
}
```

Total: 5 runtime dependencies (vs 43 in original)

---

**MIGRATE-02 STATUS: COMPLETE**

**NEXT STAGE: MIGRATE-03 — NODE.JS CORE + SQLITE**
