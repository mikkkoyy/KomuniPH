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

