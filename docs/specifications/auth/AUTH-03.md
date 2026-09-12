# AUTH-03 — Login and JWT Authentication

Status: IMPLEMENTED AND VERIFIED

## 1. Objective

Authenticate a user's credentials, issue signed JWT access/refresh token
pairs, and protect endpoints with a bearer-token authentication dependency —
without ever leaking whether an account exists or exposing credential
material.

## 2. Scope

In scope:

- `LoginRequest`, `TokenPair` schemas
- `AuthService.login` credential verification
- Access-token issuance and claims (via `app.core.security`)
- `POST /auth/login`
- `GET /auth/me` and the `get_current_user` dependency
- Authentication error handling and generic error responses

Out of scope: refresh-session persistence/rotation (AUTH-04), logout
(AUTH-05), permission/authorization checks beyond authentication, OAuth or
external identity providers.

## 3. Functional requirements

### Login flow

1. Client submits email + password to `POST /auth/login`.
2. Service normalizes the email (trim + lowercase) and looks up the account.
3. Password is verified against the stored Argon2id hash.
4. Account must be `active`; suspended/deactivated accounts fail login.
5. On success a `TokenPair` is returned with HTTP 200.
6. Any credential failure produces one identical generic 401 response.

### LoginRequest

| Field      | Type     | Rules                    |
|------------|----------|--------------------------|
| `email`    | EmailStr | valid address format     |
| `password` | string   | 1–128 characters         |

### TokenPair

| Field           | Notes                                    |
|-----------------|------------------------------------------|
| `access_token`  | signed JWT (see claims below)            |
| `refresh_token` | opaque JWT consumed by AUTH-04           |
| `token_type`    | fixed literal `bearer`                   |
| `expires_in`    | access lifetime in seconds (from config) |

The pair never includes user PII or hash material.

### Credential verification

Uses `verify_password()` (Argon2id). Verification failure of any kind maps to
the generic authentication error. Lookup order (unknown email → wrong
password → non-active status) is indistinguishable from the outside.

### Access token

Short-lived JWT minted by `create_token()`; consumed statelessly by protected
endpoints via `Authorization: Bearer <token>`.

### JWT claims

Every issued token carries:

| Claim | Meaning                                                        |
|-------|----------------------------------------------------------------|
| `sub` | subject — the user's UUID as string                            |
| `type`| `access` or `refresh` (`TokenType`)                            |
| `iss` | issuer — `settings.jwt_issuer`                                 |
| `aud` | audience — `settings.jwt_audience`                             |
| `jti` | unique token ID (UUID4) — future revocation foundation         |
| `iat` | issued-at (epoch seconds)                                      |
| `exp` | expiration (epoch seconds)                                     |
| header `kid` | key id — `settings.jwt_key_id` for future rotation      |

Reserved claims cannot be overridden through `extra_claims` (rejected with
`ValueError` at creation).

### JWT configuration

Sourced exclusively from `Settings`: `secret_key`, `jwt_algorithm` (default
HS256), `jwt_issuer`, `jwt_audience`, `jwt_key_id`,
`access_token_expire_minutes` (default 15),
`refresh_token_expire_minutes` (default 30 days).

### Token expiration

Enforced at decode time by signature+exp validation; expired tokens raise
`TokenError("Token has expired.")` which dependencies translate into a 401.

### Bearer authentication

`HTTPBearer(auto_error=False)` extracts credentials; a missing or non-bearer
header yields "Authentication credentials are required." → 401.

### Authentication dependency

`get_current_user` (in `app/modules/auth/dependencies.py`):

1. Require bearer credentials, else 401.
2. Decode + validate the token; `TokenError` → "Invalid or expired
   authentication token." → 401.
3. Require `type == access` (refresh tokens are rejected).
4. Parse `sub` as UUID; malformed subject → 401.
5. Load the user; missing user or non-`active` status → 401.
6. Return the `User` instance to the endpoint.

### Invalid credentials handling

All failures return HTTP 401, code `UNAUTHORIZED`, message exactly:
`"Invalid email or password."`

### Invalid/expired token handling

HTTP 401, code `UNAUTHORIZED`, messages limited to:
credentials-required / invalid-or-expired / invalid-token variants that
reveal nothing about users.

### Generic error responses

Login must never disclose whether an email exists. Suspended/deactivated
accounts receive the same response as wrong passwords.

## 4. Data/database requirements

Read-only against `users` (lookup by normalized email; lookup by id for
`/auth/me`). No writes occur at this stage.

## 5. API requirements

`POST /auth/login`

- Request: `LoginRequest`. Success: `200` + `TokenPair`.
- Missing fields/malformed body: `422 VALIDATION_FAILED`.
- Any credential/session-status failure: `401 UNAUTHORIZED`.

`GET /auth/me`

- Requires valid **access** bearer token.
- Success: `200` + safe identity representation
  (id/email/username/role/account_status — never password material).
- Missing/invalid/expired/refresh-typed tokens: `401 UNAUTHORIZED`.

## 6. Security requirements

- Argon2id verification only; no fallback verifiers.
- Constant-shape generic errors prevent account enumeration.
- Tokens are signed HS256 with server-side secret; kid recorded for rotation.
- Password hashes are never returned by any endpoint in this stage.
- `/auth/me` exposes only the whitelisted identity fields.

## 7. Error handling

Unexpected exceptions inside routes are converted by the global catch-all
handler into `500 INTERNAL_ERROR` ("An unexpected error occurred...") so raw
tracebacks/internals never reach clients.

## 8. Acceptance criteria

1. Correct credentials return 200 with both tokens and `expires_in`.
2. Email matching is case-insensitive (normalized before lookup).
3. Unknown email, wrong password, suspended, and deactivated accounts all
   produce identical 401s with the same generic message.
4. Access tokens decode as `type=access`; refresh tokens decode as
   `type=refresh`; lifetimes derive from settings.
5. `/auth/me` with a valid access token returns the caller's identity.
6. `/auth/me` rejects: no token, malformed token, bad signature, expired
   token, refresh-type token, unknown/non-active user — always 401.
7. No response in this stage contains a password or password hash.

## 9. Implementation checklist

- [x] `LoginRequest` schema
- [x] `TokenPair` schema
- [x] Credential verification with generic failure mapping
- [x] Non-active-account rejection folded into generic error
- [x] Access + refresh token creation with full claim set
- [x] `POST /auth/login` endpoint
- [x] `get_current_user` bearer dependency (access-only enforcement)
- [x] `GET /auth/me` endpoint returning safe representation
- [x] 401 paths for missing/invalid/expired/wrong-type tokens
- [x] Catch-all handler prevents internal leakage

## 10. Dependencies on previous stages

- AUTH-01: user persistence for lookups.
- AUTH-02: accounts exist to authenticate; hashing conventions established.

## 11. Not included

- Refresh-token storage, rotation, reuse prevention (AUTH-04)
- Logout/revocation UX (AUTH-05)
- Role-based authorization checks
- Rate limiting changes (existing middleware applies unchanged)
- Social/OAuth login, MFA, remember-me cookies
