# AUTH-04 — Refresh Tokens and Sessions

Status: IMPLEMENTED AND VERIFIED

## 1. Objective

Give refresh tokens a durable, revocable server-side identity. Every refresh
token is backed by a session row that stores only a secure hash of the token,
tracks creation/expiration/revocation state, and is rotated on every use so
that replaying an old token is structurally impossible.

## 2. Scope

In scope:

- `RefreshSession` persistence model and migration
- `RefreshSessionRepository`
- Session-backed issuance during login
- `POST /auth/refresh` with rotation and reuse prevention
- Hash-only token storage (SHA-256 fingerprint)

Out of scope: logout UX (AUTH-05), access-token revocation, device
fingerprinting, geolocation/IP metadata, multi-device session dashboards.

## 3. Functional requirements

### Refresh-token architecture

- A refresh JWT remains the portable credential, but it now embeds a `sid`
  claim identifying its server-side session row.
- The session row — not the JWT — is the source of truth for validity.
- Access tokens remain stateless and are never persisted.

### Session persistence

Table `refresh_sessions`, one row per issued refresh token:

| Column       | Type         | Notes                                        |
|--------------|--------------|----------------------------------------------|
| `id`         | UUID PK      | client-generated; becomes the `sid` claim    |
| `user_id`    | UUID FK      → `users.id`, ON DELETE CASCADE, indexed     |
| `token_hash` | String(64)   | SHA-256 hex of the encoded JWT; UNIQUE       |
| `expires_at` | timestamptz  | NOT NULL                                     |
| `revoked_at` | timestamptz  | NULL while active                            |
| `created_at` / `updated_at` | timestamptz | from `TimestampMixin`          |

State model: `active` = not revoked and not expired; `expired` =
`expires_at <= now`; `revoked` = `revoked_at IS NOT NULL` (includes rotated-out
sessions). Migration: `20260824_0003_create_auth_sessions.py`.

### User/session relationship

Each session belongs to exactly one user (`user_id`). Cascade delete removes
a user's sessions with the account. Sessions of different users are fully
independent.

### Secure token storage

Only `SHA-256(encoded_refresh_jwt)` is stored. The database therefore cannot
be replayed against the API even if fully dumped. Token hashes are compared
using constant-time comparison.

### Token hashing/fingerprinting

Hash input is the exact encoded token string returned to the client. No salt
is required because the input already contains high-entropy signed content;
the unique constraint on `token_hash` doubles as tamper detection.

### Session creation

On successful login the service:

1. Generates the session UUID up front.
2. Mints the refresh JWT embedding `sid`.
3. Inserts the session row with the token's hash and expiry derived from
   `refresh_token_expire_minutes`.

The ID must be known before commit so it can be embedded in the token.

### Session expiration

Expiry is enforced twice: by the JWT's own `exp` claim at decode time, and by
the row's `expires_at` before rotation (defense in depth).

### Session revocation

Setting `revoked_at` (once) marks the session permanently unusable.
Revocation is irreversible within this stage.

### Refresh-token rotation

`POST /auth/refresh` always rotates:

1. Decode + validate the presented JWT (signature, exp, iss, aud).
2. Require `type == refresh`.
3. Parse the `sid` claim as UUID.
4. Load the session row by `sid`.
5. Constant-time compare the stored hash against the presented token's hash.
6. Require the session to be active (not revoked, not expired).
7. Require the owning user to exist and be `active`.
8. Revoke the old row.
9. Issue and persist a new session row + new token pair (new `sid`).

### POST /auth/refresh

Request body: `{ "refresh_token": "<jwt>" }`. Success: `200` with the same
`TokenPair` shape as login (`access_token`, `refresh_token`, `token_type`,
`expires_in`) plus a transaction commit.

## 4. Data/database requirements

- One insert per issuance (login and each refresh).
- One update per rotation (revoke previous row).
- Unique index on `token_hash`; regular index on `user_id`.

## 5. API requirements

| Endpoint           | Method | Auth        | Success        |
|--------------------|--------|-------------|----------------|
| `/auth/login`      | POST   | none        | 200 TokenPair  |
| `/auth/refresh`    | POST   | refresh JWT in body | 200 rotated TokenPair |

Malformed bodies fail schema validation (`422 VALIDATION_FAILED`).

## 6. Security requirements

- Never persist or return plaintext refresh tokens or their hashes.
- All refresh failure modes return one generic message:
  "Invalid or expired authentication token." — no oracle distinguishing
  unknown/expired/revoked/mismatched tokens.
- Reuse prevention: rotation revokes the predecessor, so replay resolves to a
  revoked row and is rejected.
- Access tokens are rejected at `/auth/refresh` (wrong type).
- Hash comparison is constant-time (`hmac.compare_digest`).

## 7. Error handling

| Condition                                   | Result                    |
|---------------------------------------------|---------------------------|
| Malformed/expired/bad-signature JWT          | 401 `UNAUTHORIZED` generic |
| Non-refresh token type                       | 401 generic               |
| Missing/unparseable `sid`                    | 401 generic               |
| Unknown session / hash mismatch              | 401 generic               |
| Revoked or expired session                   | 401 generic               |
| Owning user missing or non-active            | 401 generic               |

## 8. Acceptance criteria

1. Login returns a pair whose refresh token decodes as `type=refresh` with a
   valid `sid`, and whose persisted value equals SHA-256(token).
2. A valid refresh yields a new working access token and a NEW refresh token
   bound to a new session; the old row ends revoked.
3. Presenting the same refresh token twice fails the second time (401).
4. Expired (row-level or claim-level) tokens are rejected with 401.
5. Explicitly revoked sessions are rejected with 401.
6. Garbage strings and access tokens are rejected with 401.
7. No response ever contains a token hash; no database column contains a
   usable token.

## 9. Implementation checklist

- [x] `RefreshSession` model with hash/expiry/revocation columns
- [x] Migration `20260824_0003` creating `refresh_sessions`
- [x] `RefreshSessionRepository` (get_by_id, create, revoke)
- [x] Login mints session-bound refresh tokens (`sid` claim)
- [x] SHA-256 fingerprint storage; constant-time comparison
- [x] `POST /auth/refresh` endpoint with full validation chain
- [x] Rotation revokes predecessors; reuse rejected
- [x] Generic single-message error surface for all refresh failures
- [x] Tests: hashing, rotation, reuse, expiry, revocation, garbage, wrong type

## 10. Dependencies on previous stages

- AUTH-01: users table/FK target.
- AUTH-02: accounts to own sessions.
- AUTH-03: token minting/decoding primitives, `TokenPair` contract, login
  flow that AUTH-04 extends.

## 11. Not included

- Logout endpoint and user-initiated revocation (AUTH-05)
- Access-token denylist or shortening of access lifetimes
- Device/session listing for end users
- IP/user-agent capture, anomaly detection
- Refresh-token families/tree tracking beyond single-step rotation
