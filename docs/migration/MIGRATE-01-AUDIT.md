# KOMUNIPH MIGRATION — MIGRATE-01: CURRENT SYSTEM AUDIT

## 1. Current Directory Structure

```text
KomuniPH/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health.py
│   │   │   └── router.py
│   │   ├── core/
│   │   │   ├── constants.py
│   │   │   └── security.py
│   │   ├── database/
│   │   │   ├── base.py
│   │   │   ├── migrations/
│   │   │   ├── model_registry.py
│   │   │   └── session.py
│   │   ├── middleware/
│   │   │   ├── cors.py
│   │   │   ├── logging.py
│   │   │   ├── rate_limit.py
│   │   │   └── request_id.py
│   │   ├── modules/
│   │   │   ├── admin/
│   │   │   ├── auth/
│   │   │   ├── community/
│   │   │   ├── feed/
│   │   │   ├── live/
│   │   │   ├── marketplace/
│   │   │   ├── messenger/
│   │   │   ├── notification/
│   │   │   ├── profile/
│   │   │   ├── settings/
│   │   │   └── wallet/
│   │   ├── tests/
│   │   ├── config.py
│   │   ├── dependencies.py
│   │   ├── exceptions.py
│   │   ├── lifespan.py
│   │   ├── logging.py
│   │   └── main.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── feed/
│   │   │   └── profile/
│   │   ├── router/
│   │   ├── services/
│   │   ├── store/
│   │   └── styles/
│   └── package.json
└── docs/
```

## 2. Backend Audit

### 2.1 Language & Runtime
- **Language**: Python 3.x
- **Runtime**: Python with asyncio (async/await)
- **Framework**: FastAPI 0.141.1
- **ASGI Server**: Uvicorn 0.32.1

### 2.2 Application Entry Point
- **File**: `backend/app/main.py`
- **Function**: `create_app()` returns configured FastAPI instance
- **Instance**: `app = create_app()` at module level

### 2.3 Architecture Pattern
- **Pattern**: Modular monolith with feature modules
- **Base**: `app.database.base.Base` (SQLAlchemy DeclarativeBase)
- **Routing**: `app.api.router.api_router` (single top-level APIRouter)

### 2.4 Feature Modules (Implemented)
| Module | Status | Components |
|--------|--------|------------|
| auth | IMPLEMENTED | models, schemas, service, repository, api/routes |
| profile | IMPLEMENTED | models only (no API/service) |
| feed | EMPTY | No implementation |
| community | EMPTY | No implementation |
| live | EMPTY | No implementation |
| marketplace | EMPTY | No implementation |
| messenger | EMPTY | No implementation |
| notification | EMPTY | No implementation |
| settings | EMPTY | No implementation |
| wallet | EMPTY | No implementation |
| admin | EMPTY | No implementation |

### 2.5 Core Infrastructure
- **Security**: `app.core.security.py` — Argon2id hashing, JWT creation/decoding, permission checking
- **Config**: `app.config.py` — Pydantic Settings (env-based configuration)
- **Database**: `app.database/` — SQLAlchemy async, PostgreSQL (asyncpg)
- **Middleware**: CORS, rate limiting (Redis), request logging, request ID
- **Lifespan**: `app.lifespan.py` — startup/shutdown (engine, Redis, model discovery)
- **Exceptions**: `app.exceptions.py` — custom error handlers

## 3. Database Audit

### 3.1 Current Engine
- **Engine**: PostgreSQL (asyncpg driver)
- **ORM**: SQLAlchemy 2.0.36 (async)
- **Migrations**: Alembic 1.14.0

### 3.2 Tables (Implemented)

#### Users Table (`users`)
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | UUID | NO | Primary key (client-generated UUID4) |
| email | VARCHAR(320) | NO | Unique constraint (uq_users_email) |
| username | VARCHAR(32) | NO | Unique constraint (uq_users_username) |
| password_hash | VARCHAR(255) | NO | Argon2id hash |
| role | VARCHAR(20) | NO | Default 'member', CHECK constraint |
| account_status | VARCHAR(20) | NO | Default 'active', CHECK constraint |
| created_at | TIMESTAMP(tz) | NO | Server default now() |
| updated_at | TIMESTAMP(tz) | NO | Server default now() |

#### Profiles Table (`profiles`)
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | UUID | NO | Primary key |
| user_id | UUID | NO | FK → users.id (CASCADE), Unique constraint |
| display_name | VARCHAR(100) | NO | |
| real_name | VARCHAR(200) | YES | |
| alias | VARCHAR(50) | YES | |
| alias_enabled | BOOLEAN | NO | Default false |
| bio | TEXT | YES | |
| profile_photo_url | VARCHAR(500) | YES | |
| cover_photo_url | VARCHAR(500) | YES | |
| created_at | TIMESTAMP(tz) | NO | |
| updated_at | TIMESTAMP(tz) | NO | |

### 3.3 Relationships
- User → Profile: One-to-one (Profile.user → User.id, CASCADE delete)
- User has many Posts (future)
- Post has many Comments (future)
- Post has many Reactions (future)

## 4. API Audit

### 4.1 Implemented Endpoints

```text
POST /auth/login
  AUTH: NO
  REQUEST: { email, password }
  RESPONSE: { access_token, refresh_token, token_type, expires_in }
  DATABASE: reads users table
  STATUS: WORKING

GET /health
  AUTH: NO
  REQUEST: none
  RESPONSE: { status: "ok" }
  DATABASE: none (ping only)
  STATUS: WORKING
```

### 4.2 Frontend-Expected Endpoints (Not Yet Implemented)

```text
POST /auth/register
  AUTH: NO
  REQUEST: { email, username, password }
  RESPONSE: 201 (user created)
  DATABASE: INSERT users + profiles
  STATUS: NOT IMPLEMENTED IN BACKEND

POST /auth/verify
  AUTH: NO
  REQUEST: { token }
  RESPONSE: { message }
  DATABASE: UPDATE users
  STATUS: NOT IMPLEMENTED IN BACKEND

GET /profile
  AUTH: YES (Bearer token)
  REQUEST: none
  RESPONSE: { profile object }
  DATABASE: SELECT profiles JOIN users
  STATUS: NOT IMPLEMENTED IN BACKEND

GET /feed
  AUTH: YES (Bearer token)
  REQUEST: ?limit=&offset=
  RESPONSE: { posts: [...], limit, offset, has_more }
  DATABASE: SELECT posts JOIN profiles
  STATUS: NOT IMPLEMENTED IN BACKEND

POST /feed/posts
  AUTH: YES (Bearer token)
  REQUEST: { content }
  RESPONSE: { post object }
  DATABASE: INSERT posts
  STATUS: NOT IMPLEMENTED IN BACKEND

PATCH /feed/posts/:id
  AUTH: YES (Bearer token)
  REQUEST: { content }
  RESPONSE: { post object }
  DATABASE: UPDATE posts
  STATUS: NOT IMPLEMENTED IN BACKEND

POST /feed/posts/:id/like
  AUTH: YES (Bearer token)
  REQUEST: none
  RESPONSE: { liked, like_count }
  DATABASE: INSERT/DELETE reactions
  STATUS: NOT IMPLEMENTED IN BACKEND

DELETE /feed/posts/:id/like
  AUTH: YES (Bearer token)
  REQUEST: none
  RESPONSE: { liked, like_count }
  DATABASE: DELETE reactions
  STATUS: NOT IMPLEMENTED IN BACKEND

GET /feed/posts/:id/comments
  AUTH: YES (Bearer token)
  REQUEST: ?limit=&offset=
  RESPONSE: { comments: [...], limit, offset, has_more }
  DATABASE: SELECT comments JOIN profiles
  STATUS: NOT IMPLEMENTED IN BACKEND

POST /feed/posts/:id/comments
  AUTH: YES (Bearer token)
  REQUEST: { content }
  RESPONSE: { comment object }
  DATABASE: INSERT comments
  STATUS: NOT IMPLEMENTED IN BACKEND

DELETE /feed/comments/:id
  AUTH: YES (Bearer token)
  REQUEST: none
  RESPONSE: 204
  DATABASE: DELETE comments
  STATUS: NOT IMPLEMENTED IN BACKEND
```

## 5. Frontend Audit

### 5.1 Framework & Build
- **Framework**: React 18.3.1
- **Build Tool**: Vite 5.4.8
- **Package Manager**: pnpm 9.7.0
- **Language**: TypeScript 5.6.2
- **Styling**: Tailwind CSS 3.4.13

### 5.2 State Management
- **Auth**: Zustand 4.5.5 (useAuthStore)
- **Server State**: TanStack React Query 5.59.0

### 5.3 Forms
- **Form Library**: React Hook Form 7.53.0
- **Validation**: Zod 3.23.8 + @hookform/resolvers 3.9.0

### 5.4 Routing
- **Router**: React Router DOM 6.26.2
- **Auth Guard**: RequireAuth component (checks isAuthenticated)

### 5.5 Implemented Frontend Features

#### Auth Module
- LoginPage.tsx (login form)
- RegisterPage.tsx (registration form)
- VerifyEmailPage.tsx (email verification)
- VerificationRequiredPage.tsx
- LoginForm.tsx (with validation)
- RegisterForm.tsx (with validation)
- PasswordField.tsx (show/hide toggle)
- useLogin.ts (hook)
- useRegister.ts (hook)
- useVerifyEmail.ts (hook)
- authApi.ts (API service)

#### Feed Module
- HomePage.tsx (feed page with infinite scroll)
- PostCard.tsx (post with reactions, comments, edit)
- CreatePostForm.tsx (post composer)
- CommentCard.tsx
- CommentsSection.tsx
- CommentForm.tsx
- Avatar.tsx
- useFeed.ts (infinite query hook)
- useCreatePost.ts
- useReactToPost.ts
- useEditPost.ts
- feedApi.ts (API service)
- feed.types.ts (TypeScript types)

#### Profile Module
- ProfilePage.tsx (profile display)
- useProfile.ts
- profileApi.ts
- profile.types.ts

### 5.6 UI Components
- Button.tsx
- TextField.tsx
- Checkbox.tsx
- AuthLayout.tsx (shared auth backdrop)

## 6. Feature Inventory

### 6.1 Implemented Features
| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| User Registration | No API | Full UI | Frontend only |
| Email Verification | No API | Full UI | Frontend only |
| User Login | Full API | Full UI | WORKING |
| Feed Display | No API | Full UI | Frontend only |
| Create Post | No API | Full UI | Frontend only |
| Edit Post | No API | Full UI | Frontend only |
| Delete Post | No API | No UI | Not implemented |
| Like/Unlike | No API | Full UI | Frontend only |
| Comments | No API | Full UI | Frontend only |
| Profile Read | No API | Full UI | Frontend only |
| Profile Update | No API | No UI | Not implemented |
| Logout | Local only | Full UI | Frontend only |

### 6.2 Not Implemented
- Community features
- Live features
- Marketplace features
- Messenger features
- Notifications
- Settings
- Wallet
- Admin panel

## 7. Dependency Audit

### 7.1 Backend (Python)
| Package | Purpose | MIGRATE TO |
|---------|---------|------------|
| fastapi | Web framework | Node.js HTTP server |
| uvicorn | ASGI server | Node.js built-in http |
| pydantic | Validation | Custom validation |
| pydantic-settings | Config | dotenv / config |
| sqlalchemy | ORM | SQLite direct queries |
| asyncpg | PostgreSQL driver | better-sqlite3 |
| alembic | Migrations | Manual SQL init |
| redis | Cache/rate limiting | In-memory or none |
| argon2-cffi | Password hashing | bcrypt (Node.js) |
| pyjwt | JWT tokens | jsonwebtoken |
| python-multipart | Form data | Not needed |
| pytest | Testing | Jest/Vitest or manual |
| httpx | HTTP client | Not needed (frontend) |
| ruff | Linting | ESLint (frontend) |
| mypy | Type checking | TypeScript (frontend) |

### 7.2 Frontend (Node.js)
| Package | Purpose | KEEP? |
|---------|---------|-------|
| react | UI framework | REWRITE → plain HTML/JS |
| react-dom | React renderer | REWRITE → plain HTML/JS |
| react-router-dom | Routing | REWRITE → hash routing |
| @tanstack/react-query | Server state | REWRITE → fetch API |
| zustand | State management | REWRITE → plain JS |
| react-hook-form | Forms | REWRITE → native forms |
| @hookform/resolvers | Form validation | REWRITE → native validation |
| zod | Schema validation | REWRITE → custom validation |
| vite | Build tool | REMOVE |
| tailwindcss | CSS framework | REWRITE → plain CSS |
| typescript | Type checking | REMOVE |

## 8. Baseline Measurements

### 8.1 Source Size
- **Backend Python files**: ~15 files, ~2000 LOC
- **Frontend TypeScript/TSX**: ~30 files, ~3000 LOC
- **Total source**: ~5000 LOC

### 8.2 Dependencies
- **Python packages**: 14 runtime + 5 dev = 19
- **Node.js packages**: 11 runtime + 13 dev = 24
- **Total**: 43 packages

### 8.3 Infrastructure Requirements
- PostgreSQL server
- Redis server
- Python 3.x + pip + virtualenv
- Node.js 18+ + pnpm
- Vite build toolchain

## 9. Migration Summary

### What EXISTS and must be preserved:
1. Auth login flow (backend + frontend)
2. Auth registration UI (frontend only — no backend)
3. Feed display with infinite scroll (frontend only — no backend)
4. Post creation, editing (frontend only — no backend)
5. Reactions/likes (frontend only — no backend)
6. Comments (frontend only — no backend)
7. Profile display (frontend only — no backend)
8. JWT authentication system (backend)
9. Argon2id password hashing (backend)
10. User/Profile database models (backend)

### What is MISSING (frontend calls non-existent API):
1. POST /auth/register (no backend endpoint)
2. POST /auth/verify (no backend endpoint)
3. GET /profile (no backend endpoint)
4. GET /feed (no backend endpoint)
5. POST /feed/posts (no backend endpoint)
6. PATCH /feed/posts/:id (no backend endpoint)
7. POST/DELETE /feed/posts/:id/like (no backend endpoint)
8. GET/POST /feed/posts/:id/comments (no backend endpoint)
9. DELETE /feed/comments/:id (no backend endpoint)

### What will be REMOVED in migration:
1. PostgreSQL → SQLite
2. Redis → none
3. Python backend → Node.js backend
4. React frontend → plain HTML/CSS/JS frontend
5. Vite build → none (static files)
6. Tailwind CSS → plain CSS
7. TypeScript → JavaScript

### What will be PRESERVED in migration:
1. JWT authentication
2. Password hashing (bcrypt in Node.js)
3. User/Profile/Post/Comment/Reaction models
4. All API endpoints (login, register, feed, profile, etc.)
5. Frontend UX and functionality
6. Security best practices

## 10. Target Architecture

```text
komuniph/
├── server/
│   ├── index.js          # Entry point
│   ├── config.js         # Configuration
│   ├── database.js       # SQLite setup + migrations
│   ├── auth.js           # Auth routes + middleware
│   ├── profile.js        # Profile routes
│   ├── feed.js           # Feed routes (posts, comments, reactions)
│   └── middleware.js      # Auth middleware, error handling
├── web/
│   ├── index.html        # Main page
│   ├── css/
│   │   └── styles.css    # Plain CSS
│   └── js/
│       ├── app.js        # Main app logic
│       ├── api.js        # API client
│       ├── auth.js       # Auth UI logic
│       ├── feed.js       # Feed UI logic
│       └── profile.js    # Profile UI logic
├── data/
│   └── komuniph.db       # SQLite database
├── config/
│   └── .env              # Configuration
├── package.json
└── start scripts
```

---

**MIGRATE-01 STATUS: COMPLETE**

**NEXT STAGE: MIGRATE-02 — COMPACT NODE.JS ARCHITECTURE**
