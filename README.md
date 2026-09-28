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
- **Profile designs** — server-validated profile layout engine (`/api/profile/design` CRUD + publish/archive): a controlled component registry (profile photo, name, alias, bio, personal info, gallery, testimonials, communities) plus four user-content components (text, image, card, sticker), strict JSON layout validation (geometry/rotation/z-index bounds, style field limits, per-type config contracts, http(s)-only image URLs, 64-component cap, canvas bounds, markup/script rejection), exactly one published design per user (publishing archives the previous one, each publish bumps `version`); published designs are attached to own and public profile responses as `profile.design`, while drafts and archived designs are never exposed and invalid stored designs safely degrade to a default profile

- **Creator Assets** (CREATOR-02A) — reusable creator-product foundation. A separate `creator_assets` table stores validated, versioned snapshots that are independent of the user's personal profile design. Supports asset type `profile_design` (the only fully supported type in this milestone). Lifecycle: `draft → submitted → published → archived`. Published assets contain their own immutable snapshot — editing the personal profile design later does not affect published assets. Ownership always derives from the authenticated `user.sub`; cross-user access is denied (404). Price metadata (`price_coins`) is stored but no coin movement, purchases, or payouts are implemented — `price_coins` is metadata only, Marketplace purchases are not yet built. Supported asset type: `profile_design`. Asset validation is server-side, reusing the existing profile design validator. Creator Studio includes "Save as Creator Asset" modal.

  - `npm run test:assets` runs the CREATOR-02A test suite

- **Marketplace & Coin Shop** (CREATOR-03) — two distinct marketplace experiences:
  - **Normal Marketplace** — Shopee/Lazada-style discovery marketplace for physical products, services, digital goods, and local items. Features: product listings with images, search/filter by category, pagination, product detail pages. Primary actions: **Message Seller**, **Visit Profile**, **Share Link**. No cart, checkout, or Buy Now. External sales are supported — buyers and sellers arrange transactions themselves via KomuniPH messaging, Facebook, Shopee, Lazada, GCash/Maya, or offline.
  - **Creator Coin Shop** — Dedicated section for purchasing creator digital assets (themes, backgrounds, animations, stickers, decorations, profile designs) using KomuniPH Coins. Features: asset browsing with category filters, search, single-product **Buy** action using the existing atomic wallet/ledger system. Primary actions: **Buy**, **Visit Profile**, **Message Creator**, **Share Link**. Duplicate-purchase prevention via `purchased_assets` table.

  Key APIs:
  - `GET /api/marketplace/listings` — list normal marketplace listings (auth required)
  - `POST /api/marketplace/listings` — create a listing (draft status)
  - `GET /api/marketplace/listings/:id` — view a published listing (public)
  - `PATCH /api/marketplace/listings/:id` — edit draft listing
  - `POST /api/marketplace/listings/:id/publish` — publish listing
  - `GET /api/marketplace/assets` — list published creator assets for Coin Shop (auth required)
  - `GET /api/coin-shop/products/:id` — view a single product (public)
  - `POST /api/coin-shop/buy/:id` — purchase a creator asset (auth, coins required)
  - `GET /api/coin-shop/purchases` — list buyer's purchased assets
  - `GET /api/coin-shop/purchased/:id` — check if buyer owns asset

  - `npm run test:marketplace` runs the CREATOR-03 test suite

- **Marketplace Seller Management & Creator Library** (CREATOR-04) — completes the CREATOR-03 workflow:
  - **Seller dashboard** (`#/marketplace/manage`) — owner-scoped listings with draft/published/archived counts; create/edit/publish/archive via `GET /api/marketplace/my-listings`, `PATCH /api/marketplace/listings/:id`, `POST .../publish` (also restores archived listings), `POST .../archive` (idempotent). Draft-only editing is preserved; archived listings stay hidden publicly but remain manageable.
  - **Listing images + external sales** — image URLs are validated server-side (http(s) only, max 10, add/remove/reorder in the UI); optional `external_url` (http(s) only, `javascript:`/`data:` rejected) and `contact_info` identify the seller's external sales destination. No cart, checkout, shipping, orders, or payments — Discovery → Message Seller → External Transaction.
  - **Buyer library** (`#/coin-shop/library`) — purchased assets from `GET /api/coin-shop/purchases` with preview, creator, price, date, and ownership status. `profile_design` assets install via `POST /api/coin-shop/install/:id` into a buyer-owned draft design through the existing validated design system (creator snapshot untouched; buyer publishes via Creator Studio); other types show a clear not-installable state.
  - **Contextual messaging** — Message Seller / Message Creator deep-link to `#/messages?to=<username>&listing=<id>` (or `&asset=<id>`); the messages page resolves the recipient server-side from the published product record, shows a product context banner, and opens the existing conversation with a prefilled product reference. Fabricated parameters can never change the recipient.

  - `npm run test:marketplace-manage` runs the CREATOR-04 seller-management suite
  - `npm run test:coin-library` runs the CREATOR-04 buyer-library suite

- **Marketplace Seller Center & Coin Shop Manager** (CREATOR-05) — two separate selling systems:
  - **Seller Center** (`#/marketplace/seller`, alias `#/marketplace/manage`) — header with the seller's real profile identity (display name, not username), factual counts (All/Published/Drafts/Archived — no sales/revenue invention), server-authoritative search/status/category/sort over `GET /api/marketplace/my-listings`, draft preview modal, published dates, external-sale indicators, and Share on every status. Lifecycle unchanged: draft (edit/preview/publish/share) → published (view/archive/share) → archived (view/republish/share-link-stable). External URLs stay http(s)-only with `noopener noreferrer nofollow`; no cart/checkout/orders/payments.
  - **Coin Shop Manager** (`#/creator-studio/coin-shop`, linked from Creator Studio as "My Coin Shop") — built only on `creator_assets` (no duplicate table): per-status counts plus real sales/earned-Coins totals from `GET /api/creator/assets/sales` (sourced from `purchased_assets`, zero fabrication). Create flow per supported type (Profile Design snapshots from own designs, Theme color config, image URL + fit), positive-integer Coin pricing, realistic preview with a disabled Buy button, and an explicit "Publish to Coin Shop" confirmation. Published snapshots stay immutable; archived assets cannot be republished, matching the server contract. The Studio "Save as Asset" modal now targets Coin Shop sales with corrected copy and Coin Shop links.
  - Card alignment preserved from the CREATOR-04 UI fix (flex-column cards, balanced descriptions, bottom-anchored actions).

  - `npm run test:seller-center` runs the CREATOR-05 Seller Center suite
  - `npm run test:coin-shop-manager` runs the CREATOR-05 Coin Shop Manager suite
- **Creator Studio** — in-app visual editor (`#/creator-studio`) for profile designs: drag/resize/rotate components on a WYSIWYG canvas, snap-to-guides, eight-way handles, an elements panel, a live properties panel (geometry, appearance, per-type content), a layers panel with z-order operations (front/back/forward/backward, hide, lock, duplicate, delete, z-index field), undo/redo, zoom, and a preview mode; drafts are saved per design (Save Draft) and publishing (`designApi.publishDesign`) makes the design live on the owner's profile; the studio only edits the stored model through the existing validated API and never bypasses server checks

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

Creator Studio integration suite (CREATOR-01B) — self-contained (temp DB, runs offline):

```bash
npm run test:studio
```

Creator Asset foundation suite (CREATOR-02A) — self-contained (temp DB, runs offline):

```bash
npm run test:assets
```

Marketplace & Coin Shop suite (CREATOR-03) — self-contained (temp DB, runs offline):

```bash
npm run test:marketplace
```

Marketplace seller-management suite (CREATOR-04) — self-contained (temp DB, runs offline):

```bash
npm run test:marketplace-manage
```

Coin Shop buyer-library suite (CREATOR-04) — self-contained (temp DB, runs offline):

```bash
npm run test:coin-library
```

Marketplace Seller Center suite (CREATOR-05) — self-contained (temp DB, runs offline):

```bash
npm run test:seller-center
```

Creator Studio Coin Shop Manager suite (CREATOR-05) — self-contained (temp DB, runs offline):

```bash
npm run test:coin-shop-manager
```

BUGFIX regression suite (requires the server running on port 3000):

```bash
node tests/test_bugfix01.mjs
```

Community composer suite (requires the server running on port 3000):

```bash
node tests/test_community_composer.mjs
```

## Development admin account (CREATOR-01B)

During local development only, a single account can be promoted to `admin` on
server startup using two gitignored variables in `config/.env`:

```bash
DEV_ADMIN_ENABLED=true
DEV_ADMIN_USERNAME=your-username
```

The promotion is idempotent and reuses the existing `users.role` model /
`requireAdmin` checks — no bypass, backdoor, or hardcoded credentials. It is a
no-op in production unless you explicitly enable it. This account was used to
verify the admin-gated endpoints during local testing.

