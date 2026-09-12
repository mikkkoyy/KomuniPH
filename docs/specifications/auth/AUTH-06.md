# AUTH-06 — Email Verification

Status: SPECIFICATION — NOT YET IMPLEMENTED

## 1. Objective

Track whether an account's email address has been confirmed, and provide
secure single-use verification tokens that a user can redeem to confirm it —
without leaking which email addresses are registered.

## 2. Scope

In scope:

- Verification state on the account (`users.email_verified`,
  `users.email_verified_at`)
- Outstanding-token storage (`email_verifications` table, hashes only)
- Secure token generation/expiry/single-use consumption
- Request/resend + redemption endpoints
- Optional login-enforcement switch (default off)

Out of scope: any external email-delivery provider integration (a delivery
abstraction stub only), domain/MX validation, disposable-email blocking,
email-change workflows (may become a later stage).

## 3. Functional requirements

### Email verification state

Two columns added to `users`:

| Column              | Type        | Notes                                  |
|---------------------|-------------|----------------------------------------|
| `email_verified`    | boolean     | NOT NULL, server default `false`       |
| `email_verified_at` | timestamptz | NULL until verified                    |

New registrations start unverified. Existing AUTH-02/AUTH-03 behavior is
unchanged by default.

### Verification token

- Opaque random string generated with a CSPRNG
  (`secrets.token_urlsafe`, ≥ 32 bytes of entropy).
- NOT a JWT: verification tokens are decoupled from auth tokens so they can
  be revoked/consumed independently.
- Delivered to the user via the delivery abstraction; the raw token exists
  only in the response/delivery layer.

### Secure token generation

Generation happens once per issued verification request in the service layer
using the platform CSPRNG. Tokens are never logged.

### Token storage

Only `SHA-256(token)` is persisted (`token_hash`), mirroring AUTH-04. The
unique constraint on `token_hash` enables O(1) lookup at redemption without
enumerable sequential identifiers.

`email_verifications` table:

| Column       | Type         | Notes                                     |
|--------------|--------------|-------------------------------------------|
| `id`         | UUID PK      | from `UUIDPrimaryKeyMixin`                |
| `user_id`    | UUID FK      → `users.id`, ON DELETE CASCADE, indexed   |
| `token_hash` | String(64)   | UNIQUE                                    |
| `expires_at` | timestamptz  | NOT NULL                                  |
| `consumed_at`| timestamptz  | NULL until redeemed                       |
| `created_at` / `updated_at` | timestamptz | from `TimestampMixin`         |

Issuing a new token supersedes prior unconsumed tokens for that user
(previous outstanding rows are consumed/invalidated) so exactly one live
token exists per account.

### Token expiration

Configurable lifetime (`email_verification_expire_hours`, default 24h).
Expired tokens are rejected at redemption regardless of validity otherwise.

### Single-use token

Redemption consumes the row (`consumed_at = now`) inside the same
transaction as the `users.email_verified` update. A consumed token is dead:
replays return the generic failure.

### Verification request/resend

`POST /auth/verify/request` issues a fresh token for the authenticated
account (bearer access token). Re-requesting is always allowed; issuing
supersedes older outstanding tokens. Resending for an already-verified
account succeeds generically without creating tokens.

### Email verification endpoint

`POST /auth/verify` with body `{ "token": "<raw>" }`. On success: marks the
account verified, stamps `email_verified_at`, consumes the token, returns
200 with `{ "email_verified": true }`.

### Successful verification

Idempotent outcome for already-verified accounts presented with their final
valid token: generic success (no state change, no extra disclosure).

### Token consumption

Consumption and verification flag update commit atomically; partial states
(consumed but not verified, or vice versa) must be impossible.

### Expired token handling

Generic rejection: HTTP 400, code `VERIFICATION_FAILED`, message
"Invalid or expired verification token." Expired rows may be cleaned up
lazily on issue.

### Invalid token handling

Unknown hash or malformed input → same generic 400 as expired. No
distinction between "never existed" and "wrong".

### Used token handling

Already-consumed tokens → same generic 400 (or the idempotent success above
when the account is already verified).

### Account-enumeration protection

The system never confirms whether an email is registered through verification
flows. All public-facing failures use one generic message; no endpoint
reports "no such user". Login behavior for unverified accounts must not leak
verification status either (see below).

## 4. Data/database requirements

- Migration adding the two `users` columns (server defaults preserve
  existing rows) and creating `email_verifications`.
- Indexes: unique `token_hash`; index `user_id`.

## 5. API requirements

| Endpoint                  | Method | Auth                    | Success |
|---------------------------|--------|-------------------------|---------|
| `/auth/verify/request`    | POST   | bearer access token     | 200 generic confirmation |
| `/auth/verify`            | POST   | none (token in body)    | 200 `{email_verified:true}` |

Login enforcement switch: `Settings.require_email_verification` (default
`false`). When enabled, login treats missing verification like bad
credentials (generic 401) so status is never disclosed pre-authentication.
Default preserves AUTH-03 exactly.

## 6. Security requirements

- CSPRNG tokens; SHA-256-at-rest only; constant-time comparison.
- Single-use consumption; supersession of stale outstanding tokens.
- Uniform generic errors across invalid/used/expired paths.
- Raw tokens appear only in the delivery abstraction boundary, never in logs,
  responses after issuance-time delivery, or database columns.

## 7. Error handling

| Condition                          | Result                              |
|------------------------------------|-------------------------------------|
| Malformed/unknown/expired token     | 400 `VERIFICATION_FAILED` generic   |
| Already-consumed token (unverified acct) | 400 generic                   |
| Re-request when verified            | 200 generic (no new token)          |
| Unverified login (enforcement on)   | 401 generic (as bad credentials)    |

## 8. Acceptance criteria

1. Fresh accounts have `email_verified=false`, `email_verified_at=NULL`.
2. Requesting verification stores ONLY the token hash; raw token is
   retrievable solely from the delivery abstraction output.
3. Redeeming a valid unexpired unconsumed token verifies the account,
   stamps the timestamp, consumes the row atomically.
4. Redeeming the same token again fails generically.
5. Expired tokens fail generically; unknown/garbage tokens fail identically.
6. Issuing a new token invalidates previous outstanding ones.
7. No flow distinguishes registered vs. unregistered emails.
8. With enforcement off, AUTH-03 login behavior is byte-for-byte unchanged;
   with it on, unverified logins receive the standard generic 401.
9. Deleting a user removes their verification rows (CASCADE).

## 9. Implementation checklist

- [ ] Migration: users.email_verified/email_verified_at + email_verifications
- [ ] Model additions (User columns; EmailVerification model)
- [ ] Repository for verification rows (create/supersede/get/consume)
- [ ] Service: token generation, hashing, expiry, single-use consume logic
- [ ] `POST /auth/verify/request` endpoint
- [ ] `POST /auth/verify` endpoint with atomic consume+verify transaction
- [ ] Delivery abstraction interface (stub implementation, no provider)
- [ ] `require_email_verification` setting wired into login policy
- [ ] Enumeration-protection tests (uniform messages)
- [ ] Expiry/single-use/replay tests
- [ ] Full AUTH suite regression run

## 10. Dependencies on previous stages

- AUTH-01: users table receiving the new columns.
- AUTH-02: registration initializes unverified accounts.
- AUTH-03: bearer dependency protects `/auth/verify/request`; login policy
  hook for optional enforcement.
- AUTH-04: hashing-at-rest precedent and constant-time comparison pattern.

## 11. Not included

- Real SMTP/provider sending, templates, localized content
- Email address change/reset flows
- Admin verification overrides
- Bulk cleanup jobs (only lazy cleanup on issue)
- SMS/OAuth alternative verification channels
