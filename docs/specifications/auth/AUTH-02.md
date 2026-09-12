# AUTH-02 — User Registration

Status: IMPLEMENTED AND VERIFIED

## 1. Objective

Allow a new user to create a KomuniPH account through `POST /auth/register`,
with validated input, securely hashed credentials, duplicate-account
handling, and a response that never exposes credential material.

## 2. Scope

In scope:

- Registration request/response schemas (`app/modules/auth/schemas.py`)
- Registration business rules in `AuthService.register`
- User creation via `AuthRepository.create`
- `POST /auth/register` endpoint (`app/modules/auth/api/routes.py`)

Out of scope: login/token issuance (AUTH-03), sessions (AUTH-04), email
verification (AUTH-06), profile creation, transaction-management redesign.

## 3. Functional requirements

### Registration flow

1. Client submits email, username, password.
2. Schema-level validation runs (Section 5).
3. Service normalizes identifiers and checks for existing accounts.
4. Password is hashed with Argon2id; the hash — never the plaintext — is
   passed to the repository.
5. Repository inserts the `User`; route commits the transaction.
6. Safe representation of the created account is returned with HTTP 201.

### RegisterRequest

| Field      | Type     | Rules                                                        |
|------------|----------|--------------------------------------------------------------|
| `email`    | EmailStr | valid RFC-style address                                      |
| `username` | string   | 3–32 chars after normalization; letters, digits, underscore  |
| `password` | string   | 8–128 characters                                             |

Username validation lowercases and trims the value, rejects blanks, and
rejects anything outside `[a-z0-9_]`.

### RegisterResponse

| Field            | Notes                                  |
|------------------|----------------------------------------|
| `id`             | account UUID as string                 |
| `email`          | normalized email                       |
| `username`       | normalized username                    |
| `role`           | effective role (`member`)              |
| `account_status` | effective status (`active`)            |

The response model must make it structurally impossible to include `password`
or `password_hash`.

### Email validation

Performed by the request schema (email-format). The service additionally
lowercases/trim-normalizes before uniqueness checks and storage.

### Username validation

Length bounds and character-set rules as above; normalized to lowercase
before checking and storing.

### Password validation

Minimum 8 / maximum 128 characters at the schema boundary. Complexity rules
are deliberately not imposed at this stage beyond length.

### Password hashing

Hashing uses `app.core.security.hash_password()` (Argon2id with OWASP-aligned
parameters pinned in that module). Hashing happens in the service layer only;
neither schema nor repository nor model performs or imports it.

### Duplicate email handling

Pre-insert check by exact (normalized) email raises
`ConflictError("An account with this email already exists.")` → HTTP 409,
code `RESOURCE_CONFLICT`. No account is created.

### Duplicate username handling

Identical pattern for usernames → HTTP 409, code `RESOURCE_CONFLICT`.

A race between the pre-checks and INSERT is backstopped by catching
`IntegrityError`, rolling back, and raising the same conflict error, so the
database's unique constraints remain the final authority.

### User creation

Repository adds the `User` with client-known fields and flushes so IDs are
available before commit. Transaction ownership stays with the route layer.

### Account status initialization

New accounts rely on the database defaults from AUTH-01:
`role='member'`, `account_status='active'`.

### Repository/service responsibilities

- Service: normalization, duplicate detection, hashing, orchestration,
  domain errors.
- Repository: existence queries and insertion only — no business rules.
- Route: transport mapping and explicit `session.commit()` on success.

## 4. Data/database requirements

Writes exactly one row to `users` (AUTH-01 schema). Uniqueness is ultimately
enforced by `uq_users_email` / `uq_users_username`.

## 5. API requirements

`POST /auth/register`

- Request body: `RegisterRequest`.
- Success: `201 Created`, body `RegisterResponse`.
- Validation failure (bad email format, short password, bad username):
  `422`, envelope code `VALIDATION_FAILED`.
- Duplicate email/username: `409`, envelope code `RESOURCE_CONFLICT`.

All errors use the global error envelope:

```
{ "error": { "code": "...", "message": "...", "details": {}, "request_id": "..." } }
```

## 6. Security requirements

- Argon2id hashing only; parameters owned solely by `app.core.security`.
- Plaintext passwords must never be logged or persisted anywhere.
- Responses never contain password material or hashes.
- Database unique constraints are the authoritative duplicate defense.

## 7. Error handling

| Condition                        | Result                              |
|----------------------------------|-------------------------------------|
| Malformed payload                | 422 `VALIDATION_FAILED`             |
| Email already registered         | 409 `RESOURCE_CONFLICT`             |
| Username already taken           | 409 `RESOURCE_CONFLICT`             |
| Insert-time constraint race      | rollback + 409 `RESOURCE_CONFLICT`  |

Duplicate messages may distinguish email vs. username; the insert-race
backstop uses one combined message.

## 8. Acceptance criteria

1. Valid registration returns 201 with id/email/username/role/account_status.
2. Response never includes password or password-hash fields.
3. Stored `password_hash` verifies against the submitted plaintext via
   `verify_password`, and differs per registration (salted).
4. Duplicate email (any casing) yields 409 without creating an account.
5. Duplicate username (any casing) yields 409 without creating an account.
6. Simulated insert race yields 409 and rolls back.
7. Weak/short passwords and invalid payloads yield 422.
8. New accounts default to `role=member`, `account_status=active`.

## 9. Implementation checklist

- [x] `RegisterRequest` schema with field validators
- [x] `RegisterResponse` schema excluding all credential material
- [x] Service normalization (email/username lowercase-trim)
- [x] Pre-insert duplicate checks (email, then username)
- [x] Argon2id hashing in service layer
- [x] `IntegrityError` race backstop with rollback
- [x] `POST /auth/register` returning 201 and committing
- [x] Error-envelope integration (`AppError` handlers)
- [x] Tests covering success, duplicates (both), weak password, race

## 10. Dependencies on previous stages

- AUTH-01: `users` table/model/repository, defaults, unique constraints.

## 11. Not included

- Login or token issuance (AUTH-03)
- Email verification or confirmation mail (AUTH-06)
- Profile row creation (PROFILE module)
- Password complexity policies, breach-list checks, CAPTCHA
- Administrative account management
