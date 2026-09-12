# AUTH-05 — Logout and Session Revocation

Status: SPECIFICATION — NOT YET IMPLEMENTED

## 1. Objective

Let an authenticated client end its current refresh session on demand:
`POST /auth/logout` revokes exactly the session presented, leaves all other
sessions untouched, and behaves safely when called repeatedly or with
already-dead credentials.

## 2. Scope

In scope:

- `POST /auth/logout` endpoint (`app/modules/auth/api/routes.py`)
- Current-session identification from the presented refresh token
- Single-session revocation via the AUTH-04 session store
- Idempotent repeated-logout behavior

Out of scope: global "log out everywhere" (may become a future stage),
access-token invalidation/denylisting, admin-forced revocation UI,
cookie/session storage changes.

## 3. Functional requirements

### Logout flow

1. Client presents the refresh token of the session to terminate in the
   request body: `{ "refresh_token": "<jwt>" }`.
2. The service validates the token through the same chain as `/auth/refresh`
   (decode → type → `sid` → row lookup → constant-time hash match).
3. If the referenced session is still active, it is revoked.
4. Success is confirmed with HTTP 204 and no body.
5. No new tokens are issued.

### POST /auth/logout

- Requires no access-token header: possession of the full refresh token IS
  the authorization to destroy that session (only the legitimate holder can
  match its stored hash). A valid access token without a matching refresh
  token cannot revoke anything.
- Request/response: request as above; success `204 No Content`.

### Current-session identification

The `sid` claim locates the exact session row; the constant-time hash match
proves the caller holds the complete credential for that row. Both must
succeed before any mutation.

### Session revocation

Reuses `RefreshSessionRepository.revoke` from AUTH-04. Revocation sets
`revoked_at` once; subsequent calls observe a revoked row and change nothing.

### Refresh-token revocation

Revoking the session permanently invalidates its refresh token: every later
attempt to use it at `/auth/refresh` resolves to a revoked row and returns
the generic 401. This is the logout guarantee.

### Multiple-session behavior

A user may hold several concurrent sessions (one per login/device). Logout
revokes ONLY the presented token's session. All other rows remain active and
their tokens continue working. Regression tests must cover this explicitly.

### Repeated logout behavior

Logout is idempotent: presenting the same valid-format refresh token after
its session was already revoked returns `204` again (no error, no state
change), because "this session is already ended" discloses nothing useful to
an attacker and makes client retry logic safe.

### Invalid/revoked session behavior

| Input                                   | Result                    |
|-----------------------------------------|---------------------------|
| Malformed/expired/bad-signature token    | 401 generic               |
| Non-refresh token type                   | 401 generic               |
| Unknown session / hash mismatch          | 401 generic               |
| Already-revoked but otherwise valid      | 204 (idempotent success)  |

Expired sessions need no revocation; they return 401 like any dead token.

## 4. Data/database requirements

- At most one UPDATE (`revoked_at`) per successful logout.
- No inserts; no deletes; unrelated rows are never touched.

## 5. API requirements

| Endpoint        | Method | Auth                     | Success |
|-----------------|--------|--------------------------|---------|
| `/auth/logout`  | POST   | refresh JWT in request body | 204  |

Errors follow the standard envelope (`401 UNAUTHORIZED`,
`422 VALIDATION_FAILED`).

## 6. Security requirements

- Only the exact credential holder can revoke a session (hash match).
- Generic error messages only; responses never reveal whether a token was
  revoked vs. unknown vs. malformed (except the deliberate idempotent-204).
- Logout never extends any token lifetime and never issues tokens.
- Revocation remains one-way within this stage.

## 7. Error handling

All rejections reuse the AUTH-04 generic unauthorized message so clients get
identical semantics across `/auth/refresh` and `/auth/logout`. Malformed JSON
bodies produce `422 VALIDATION_FAILED`.

## 8. Acceptance criteria

1. Logging out with a valid active session's refresh token returns 204 and
   that session becomes revoked.
2. After logout, `/auth/refresh` with the same token returns 401.
3. Other active sessions of the same user keep refreshing successfully.
4. Repeating logout with the same token returns 204 again (idempotent).
5. Garbage/expired/wrong-type/unknown tokens return generic 401.
6. An access token cannot authorize logout of any session.
7. No response leaks session/token metadata.

## 9. Implementation checklist

- [ ] `POST /auth/logout` route registered on the auth router
- [ ] Logout service method reusing the AUTH-04 validation chain
- [ ] Active-session-only revocation; idempotent already-revoked handling
- [ ] 204 success contract wired (no response body)
- [ ] Multi-session isolation test (other sessions unaffected)
- [ ] Repeated-logout test
- [ ] Invalid/garbage/wrong-type rejection tests (generic message)
- [ ] Full AUTH suite regression run

## 10. Dependencies on previous stages

- AUTH-04: session model/repository/rotation chain being revoked; `sid`
  claim convention; hash comparison utilities.

## 11. Not included

- "Logout everywhere" / bulk revocation
- Access-token immediate invalidation (accepted trade-off: access tokens
  stay valid until their short expiry)
- Admin-initiated forced logout
- Token-family theft detection beyond single-step rotation
