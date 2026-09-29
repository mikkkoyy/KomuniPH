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
- **Locked reward Coins** (COINS-02A) — accounting model: `user_wallets` carries `locked_reward_balance` next to `balance`/`frozen_balance` (single mutable row, no drift); `transferable = balance − frozen − locked`. KomuniPH-issued rewards (identity verification: exactly 15 Coins once, via the existing `reward_awarded` flow and a reusable `awardLockedRewardCoins` helper) are personally spendable but permanently non-transferable: gifts and withdrawals/freeze may only consume transferable coins, while personal spending (Coin Shop `spend`) consumes locked rewards first and received gifts stay transferable. The `verification_reward` ledger type (plus `gift`) keeps every class auditable in the existing `coin_transactions` ledger. Live databases migrate safely: all rows/balances preserved, previously issued identity rewards classified as locked (capped at coins still held, never re-awarded)
  - `npm run test:coin-rewards` runs the COINS-02A test suite
- **Gift Coins** (COINS-02) — user-to-user transfers from the Coins page (`Cash In | Cash Out | Gift`): recipient search (`GET /api/users/search`, public fields only), explicit selection, positive-integer amount, and a confirmation showing current/after balances. `POST /api/coins/gift` resolves the recipient server-side, rejects self-gifts, and settles debit + credit + receiver notification atomically in one transaction (sender `Gift Sent` debit, receiver `Gift Received` credit, `gift` ledger type). The receiver gets an unread `coin_gift` notification ("You received 100 Coins from John Doe (@johndoe).") linking to `#/wallet`, with a sidebar badge and a `#/notifications` inbox (mark read / mark all read). Client idempotency keys make replays settle exactly once; frozen funds are respected; no negative balances
  - `npm run test:coin-gift` runs the COINS-02 test suite
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
- **Creator Studio** — in-app visual editor (`#/creator-studio`) for profile designs: drag/resize/rotate components on a WYSIWYG canvas, snap-to-guides, eight-way handles, an elements panel, a live properties panel (geometry, appearance, per-type content), a layers panel with z-order operations (front/back/forward/backward, hide, lock, duplicate, delete, z-index field), undo/redo, and a preview mode; drafts are saved per design (Save Draft) and publishing (`designApi.publishDesign`) makes the design live on the owner's profile; the studio only edits the stored model through the existing validated API and never bypasses server checks
- **Creator Studio media upload + workspace (CREATOR-06)** — image/sticker components accept local JPG/JPEG/PNG/WEBP uploads (`POST /api/creator/media`, auth required) into a separate `uploads/creator/` store: Sharp validates actual file content, output is re-encoded WebP under generated safe filenames (GIF/text/oversized/unauthenticated rejected); the uploaded URL drops straight into the component with immediate canvas preview, preserving alt text and fit. Design/asset/listing validators accept same-origin `/uploads/` image URLs while `javascript:`/`data:` stay rejected. The editor uses a roomier three-column workspace (300px components/layers, 370px properties, taller scroll areas, larger grouped Position/Size/Layer/Transform/Appearance/Image controls) with the toolbar sticky; side panels collapse to one column under 960px. Every movable component exposes free X/Y positioning (precise numeric fields, direct mouse drag with snap guides, Arrow keys ±1 and Shift+Arrow ±10 outside text inputs), W/H resize (fields + 8 handles), rotation, and Layer controls (Z-index field plus explicit Move Up / Move Down buttons reusing the single z-order model, plus canvas Left/Center/Right/Top/Middle/Bottom align shortcuts)
- **Back navigation (CREATOR-06)** — shared `renderBackButton` helper with deterministic routes: Marketplace catalog → Profile, Marketplace product → Marketplace, Seller Center → Marketplace, Coin Shop catalog → Marketplace, Coin Shop product → Coin Shop, Library → Coin Shop, Coin Shop Manager → Creator Studio/Coin Shop, Wallet → Profile, Creator Studio → Profile
- **Large, independent Profile Viewer workspace (CREATOR-07B)** — the Profile Viewer is the main editing area and its height is **completely independent of the side panels**. This fixes a real defect: the viewer used to be squeezed to roughly half height, because the grid stretched the stage to the tallest side panel (`.studio-panel` had `min-height: 480px` + `max-height: calc(100vh - 140px)` and the grid used `align-items: stretch`), and its height was additionally capped by a `viewportHeight - 200` "chrome" estimate. Both couplings are gone. `.studio-layout` now uses `align-items: start`, so the Properties and Profile Sections panels cannot contribute their height to the viewer's; they scroll internally instead. `#studio-stage` declares its own height, and `viewerHeight` is seeded with a **deliberate** `DEFAULT_VIEWER_HEIGHT` of 900px rather than `null`, so there is no state in which the stage has no height and inherits the grid row's. The `viewportHeight - chrome` ceiling was removed outright: `clampViewerHeight` no longer takes a viewport and is bounded only by a 320px usability floor and a generous 4000px hard ceiling, so a taller window never shortens the editing area and a downward drag can genuinely make the viewer taller than the window. Concretely: **left panel width → center column width**, and **Profile Viewer height → independent workspace state**, with no path from panel height to viewer height. The viewer still has **no width of its own** (it fills the center column) and its only size control is the invisible **bottom** boundary: drag **down** to make it taller, drag **up** to make it shorter, with no left/right/top/corner viewer grips and no viewer toolbar of any kind. Below 960px the layout goes single-column and the desktop handles are hidden, but the viewer **keeps** a usable height rather than collapsing to a `60vh` sliver, and the page gains no horizontal overflow.
- **A profile taller than the viewer stays fully editable (CREATOR-07B)** — the design canvas keeps its real authored dimensions (960×1200); it is **never** auto-scaled down to fit the viewer (`zoom` stays 1 and no fit logic runs). A profile taller than the editing area is still reached by panning, with `overflow: hidden` throughout so no browser scrollbar ever appears. Resizing the viewer is an **editor-viewport** operation: it never modifies component X/Y, width, height, rotation or z-index, never changes saved design geometry, never marks the design dirty, never creates an undo entry, and never triggers Save or Publish. Component drag, component resize handles, property editing, arrow-key nudging, layer ordering and panning all continue to work after any workspace resize.
- **Resizable Creator Studio workspace (CREATOR-07A)** — the whole studio workspace is now resizable through its own **column boundaries** instead of the CREATOR-07 per-viewer edge grips, which are gone. Two invisible boundary handles sit in the gaps between the Components/Layers panel, the Viewer and the Properties panel (`ew-resize`, at least 8px wide), and a third grip on the viewer's bottom edge (`ns-resize`) changes its height. Dragging a column boundary resizes that side panel and lets the Viewer take up or give up the difference, so the Viewer still fills the whole center column and has **no width of its own**; dragging the bottom grip only changes height. The two panel widths are written to the layout element as the `--studio-col-left` / `--studio-col-right` custom properties that drive the CSS grid, and the height to the stage's inline height. All three are transient editor state held in the DOM-free `web/js/studioViewer.js` module (`clampPanelWidth` / `columnWidthsFromDrag` / `clampViewerHeight`), clamped so no panel or the viewer can ever collapse, and re-clamped when the window resizes. Resizing **never** touches component X/Y/width/height/rotation/z-index, never marks the design dirty, never pushes an undo entry and never saves or publishes — the dedicated `panel-resize` and `viewer-height` drag modes return before any component or history logic runs. Below 960px the layout is a single column, so the handles are hidden and the pinned column widths are released back to the stylesheet; below 760px the grab bands widen for touch.
- **Directly resizable Profile Viewer (CREATOR-07)** — superseded by CREATOR-07A, which replaced the eight invisible viewer grips with resizable workspace columns. The floating viewer toolbar remains **removed entirely**, with no replacement: there is no zoom −/+, no percentage readout, no **Fit**, no **100%**, no ← ↑ ↓ → pan pad and no numeric size fields — the viewer contains no buttons at all.
- **Profile Viewer with no scrollbars (CREATOR-07)** — the viewer fills its workspace by default (`#studio-stage` is the positioning context, `#studio-viewer` is `position: absolute; inset: 0`) and clips rather than scrolls: `#studio-viewer`, `#studio-canvas-scroll` and `#studio-canvas-inner` all use `overflow: hidden`, so no horizontal or vertical scrollbar is ever rendered or reachable. A design larger than the viewer is reached by panning, not by a scrollbar, and the previous 560px canvas minimum is gone so the viewer is sized by the workspace rather than by its content. A pinned viewer height is no longer re-clamped against the window on resize (CREATOR-07B made the height independent workspace state), and the stacked single-column layout below 960px keeps the viewer at its own usable height so it still fills the stage. Empty-canvas panning, component dragging/resizing, layer ordering and property editing are unchanged.
- **Adjustable Profile Viewer (CREATOR-06)** — the Studio separates two independent coordinate systems. *Design coordinates* (`layout.components[].x/y/width/height/rotation/zIndex`) remain the saved, authoritative profile. *Viewer coordinates* (zoom, pan X/Y, viewer size) are ephemeral editor state held in a dedicated DOM-free module, `web/js/studioViewer.js`, and are never written to the design or sent to the server. Pan is bounded so the design can never be dragged fully out of reach (it re-centres when the profile fits). Dragging **empty canvas pans the viewer**; dragging a **component still moves that component** — the two gestures are handled by separate drag modes and never compete. Arrow keys move the selected component by ±1 (Shift ±10) and pan the viewer when nothing is selected; text/number inputs are excluded so typing and native number-stepping are never hijacked. Pointer-to-design conversion divides out zoom only, so panning can never corrupt component X/Y. (CREATOR-07 removed the CREATOR-06 zoom/Fit/100%/pan toolbar, but kept this coordinate separation, the pan bounds and the gesture isolation.)
- **Compact lower Layers section (CREATOR-06)** — the shared `.studio-panel` keeps its useful 480px editing height for the side editor panels, but `#studio-layers` drops to `min-height: 0` with a height-capped, scrollable layer list, so the lower panel no longer consumes vertical space. `#studio-stage` hosts the Profile Viewer, which takes the full flexible area of the middle column.
- **Arrow-key movement now refreshes the Properties panel (CREATOR-06)** — keyboard nudges previously moved the component but left the X/Y fields showing stale values, so the gesture looked like a no-op. The arrow-key branch now re-renders the properties panel alongside the canvas and layers.

  - `npm run test:studio-media` runs the CREATOR-06/07/07A/07B upload/nav/viewer suite (39 checks: upload security + formats, uploaded-URL integration, back navigation, workspace column/height resize geometry and clamping, viewer height independence from the panels and the window, workspace wiring, non-edit behavior, removed-toolbar and removed-grip regressions, studio layout, responsive rules and the panel/viewer decoupling rules)
  - `npm run test:studio-media-e2e` runs the headless-browser E2E (30 checks: login, catalogs, back buttons, studio upload + save, a large initial viewer height, the viewer height staying unchanged when either side panel is resized, the viewer height staying independent of Properties-panel content, a profile taller than the viewer staying unscaled and pannable with no scrollbar, the viewer filling the workspace, absence of any viewer toolbar, the workspace handles being the topmost element at their boundaries, left/right column-boundary dragging, bottom-edge viewer dragging in both directions with the grip following the new boundary, clamping under absurd pointer travel, resizing leaving geometry/undo/dirty untouched, component drag/resize and property editing still working, single-column mode with a retained viewer height and no horizontal overflow, empty-canvas pan isolation, arrow-key movement, and non-hijacked text inputs)

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

Coin gifting suite (COINS-02) — self-contained (temp DB, runs offline):

```bash
npm run test:coin-gift
```

Locked reward accounting suite (COINS-02A) — self-contained (temp DB, runs offline):

```bash
npm run test:coin-rewards
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

