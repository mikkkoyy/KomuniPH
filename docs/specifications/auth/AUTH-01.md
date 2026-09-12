# AUTH-01 — User Persistence

Status: IMPLEMENTED AND VERIFIED (Tier A)

## 1. Objective

Provide the durable persistence layer for KomuniPH user accounts: the `users`
table, its SQLAlchemy model, repository access, Alembic migration, and
automatic model discovery. This stage owns storage only. Registration, login,
JWT issuance, hashing, and session logic live in later stages.

## 2. Scope

In scope:

- `User` ORM model (`app/modules/auth/models.py`)
- `users` PostgreSQL table and integrity constraints
- `AuthRepository` (`app/modules/auth/repository.py`)
- Alembic migration creating `users`
- Model discovery integration via `app.database.model_registry`

Out of scope: registration/login flows, password hashing implementation,
JWT/session handling, profile data (PROFILE module), Tier B tests requiring a
live database.

## 3. Functional requirements

### User account model

A single `User` class represents one account's persisted identity and
credential hash. The model stores an opaque hash string only; it has no
dependency, direct or transitive, on `app.core.security`.

### User identity fields

| Field             | Type            | Notes                                    |
|-------------------|-----------------|------------------------------------------|
| `id`              | UUID (v4) PK    | from `UUIDPrimaryKeyMixin`               |
| `email`           | String(320)     | RFC 5321 maximum mailbox length; unique  |
| `username`        | String(32)      | unique                                   |
| `password_hash`   | String(255)     | opaque Argon2id hash; never plaintext    |
| `role`            | String(20)      | server default `member`                  |
| `account_status`  | String(20)      | server default `active`                  |
| `created_at`      | timestamptz     | from `TimestampMixin`, DB-managed        |
| `updated_at`      | timestamptz     | from `TimestampMixin`, DB-managed        |

No fields beyond this set are permitted without a specification change.

### Username

- Maximum 32 characters, required, NOT NULL.
- Unique across accounts (see constraints).
- Case-normalization is a caller/service concern (AUTH-02); the database
  compares case-sensitively.

### Email

- Maximum 320 characters, required, NOT NULL.
- Unique across accounts.
- Format validation belongs to the registration schema (AUTH-02).

### Password hash

- Required, NOT NULL, no client-side default and no server-side default:
  every row must be given a real hash at insert time.
- Stores ONLY the encoded hash produced by `hash_password()`.
- Never appears in any API response or in `repr()`.

### Account status

- One of `active`, `suspended`, `deactivated`.
- Enforced by a named database CHECK constraint.

### Role

- One of `member`, `moderator`, `admin`.
- Enforced by a named database CHECK constraint.
- Deliberately independent of `app.core.security.Permission`: `role` is a
  coarse persisted classification; `Permission` is a code-level vocabulary.

### UUID primary key

- Client-generated UUID v4 via `UUIDPrimaryKeyMixin`, so IDs are known before
  commit and related rows can be built in the service layer.

### Created / updated timestamps

- Timezone-aware, managed by the database (`server_default now()`), with
  `updated_at` refreshed on update — exactly as provided by `TimestampMixin`.

## 4. Data/database requirements

Constraints on `users` (all explicitly named so migrations and diagnostics
are greppable):

- `uq_users_email` — UNIQUE(`email`)
- `uq_users_username` — UNIQUE(`username`)
- `ck_users_role_valid` — CHECK `role IN ('member','moderator','admin')`
- `ck_users_account_status_valid` — CHECK `account_status IN ('active','suspended','deactivated')`

Uniqueness is case-sensitive at the database level; normalization is a
service-layer responsibility (AUTH-02). Value sets are stored as Python
constants (`VALID_ROLES`, `VALID_ACCOUNT_STATUSES`) that generate the SQL
constraint text so they cannot drift apart silently.

Migration: `20260815_0001_create_users.py`, chained into the project's
Alembic history with matching upgrade/downgrade operations.

## 5. API requirements

None. This stage exposes no HTTP endpoints.

## 6. Security requirements

- `password_hash` must never be logged, serialized, or included in `repr()`.
- `models.py` must not import `app.core.security` (enforced mechanically by
  an AST-based test): hashing is exclusively the caller's responsibility.
- No default value may ever populate `password_hash`.

## 7. Error handling

No application-level errors are raised at this stage. Database constraint
violations surface to callers (e.g., AUTH-02) as `sqlalchemy.exc.IntegrityError`.

## 8. Acceptance criteria

1. Importing the model registers `users` on `Base.metadata`.
2. `configure_mappers()` succeeds after model discovery.
3. Column names/types/lengths match Section 3.
4. Required columns are NOT NULL; `password_hash` has no defaults.
5. Named unique/CHECK constraints exist as specified.
6. `role`/`account_status` defaults are database-level (`server_default`),
   not Python-level.
7. `repr(User)` never contains the password hash.
8. Repository can create a user and query by email/username/id against a
   session implementing the async SQLAlchemy interface.

## 9. Implementation checklist

- [x] `User` model with all specified columns/constraints
- [x] Named unique constraints for email and username
- [x] Named CHECK constraints for role and account status
- [x] Server-side defaults for role/account status; none for password hash
- [x] Migration `20260815_0001` creating `users`
- [x] `AuthRepository` (get_by_email, get_by_username, get_by_id, create)
- [x] Discovery-compatible placement under `app/modules/auth/models.py`
- [x] AST guard test proving no `app.core.security` dependency
- [ ] Tier B verification against a live PostgreSQL instance (deferred)

## 10. Dependencies on previous stages

None. This is the foundation stage.

## 11. Not included

- Password hashing/verification primitives (owned by `app.core.security`)
- Registration or login behavior (AUTH-02/AUTH-03)
- Sessions, refresh tokens, logout (AUTH-04/AUTH-05)
- Email verification state (AUTH-06)
- Profile data (PROFILE module)
- Live-database migration runs (Docker/PostgreSQL out of scope for this stage)
