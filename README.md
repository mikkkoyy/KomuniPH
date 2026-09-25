# KomuniPH

KomuniPH is a community-first social networking platform for the Philippines, built with Node.js, SQLite, and vanilla JavaScript.

## Tech Stack

- **Backend:** Node.js (ES modules, no framework — `node:http`)
- **Database:** SQLite (`better-sqlite3`)
- **Frontend:** vanilla JavaScript + HTML/CSS (no build step)

## Features

- **Profiles** — identity, bio, photos, privacy controls (`real_name_visible`)
- **Feed** — posts, comments, reactions
- **Messaging** — direct conversations
- **Community discovery** — search, type/location/joined filters, and Recommended Communities on `GET /api/communities/discover` and `GET /api/communities/recommended`; eligibility-aware cards with public activity counts (members, posts, last activity) and in-place join from discovery
- **Communities** — location-scoped groups (nationwide / city / barangay) with server-side eligibility derived from the stored profile location
- **Community membership** — join/leave, member list, first member becomes owner
- **Elections** — monthly moderator elections with nominations, voting, runoffs, and history
- **Rules** — owner/moderator-managed community rules
- **Pinned announcements** — pin/unpin community posts (limit 5)
- **Reports** — member reporting with duplicate protection and a moderator queue (resolve/dismiss)
- **Moderation** — owner/moderator feature, unfeature, and delete powers scoped to their community
- **Events** — community events with member creation and moderator deletion
- **Media** — image URLs shared in community posts, listed per community
- **Settings** — per-community toggles (`allow_member_posts`, `allow_member_comments`, `allow_events`, `allow_media`, `moderation_enabled`)
- **Coins & Wallet** — one wallet per user (`.balance`, `.frozen_balance`, available = balance − frozen); an atomic, source-idempotent transaction ledger (`coin_transactions`) records every credit/debit/freeze/unfreeze with running balances; GCash/Maya top-ups via PayMongo webhooks (`/api/coins/paymongo/webhook`); withdrawals freeze coins on request and cash them out on admin approval; a one-time 15-coin reward on identity verification; admin adjust `/api/admin/coins/adjust` with full audit trail
- **Profile designs** — server-validated profile layout engine foundation (`/api/profile/design` CRUD + publish/archive): a controlled component registry (profile photo, name, alias, bio, personal info, gallery, testimonials, communities), strict JSON layout validation (geometry/z-index bounds, 64-component cap, canvas bounds, markup/script rejection), exactly one published design per user (publishing archives the previous one, each publish bumps `version`); published designs are attached to own and public profile responses as `profile.design`, while drafts and archived designs are never exposed and invalid stored designs safely degrade to a default profile

## Getting Started

```bash
npm install
npm start
```

The server listens on `http://localhost:3000` and uses `./data/komuniph.db` (see `DATABASE_PATH` in `config/.env`).

## Testing

Targeted community suite (requires the server running on port 3000):

```bash
node tests/test_community.mjs
```

Focused discovery suite (COMMUNITY-04):

```bash
node tests/test_community_discovery.mjs
```

Coin economy suite (COINS-01) — self-contained (temp DB, runs offline):

```bash
npm run test:coins
```

Profile design engine suite (CREATOR-01A) — self-contained (temp DB, runs offline):

```bash
npm run test:creator
```

