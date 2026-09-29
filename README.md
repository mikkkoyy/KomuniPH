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
- **Directly resizable Profile Viewer (CREATOR-07)** — superseded by CREATOR-07A, which replaced the eight invisible viewer grips with resizable workspace columns. The floating viewer toolbar remains **removed entirely**, with no replacement: there is no zoom −/+, no percentage readout, no **Fit**, no **100%**, no ← ↑ ↓ → pan pad and no numeric size fields — the viewer contains no buttons at all. (CREATOR-08 later added a separate zoom bar *above* the viewer, outside the viewer itself; it restores only zoom −/+ with a readout and Reset, and still carries no size controls, no **Fit** and no pan pad.)
- **Profile Viewer with no scrollbars (CREATOR-07)** — the viewer fills its workspace by default (`#studio-stage` is the positioning context, `#studio-viewer` is `position: absolute; inset: 0`) and clips rather than scrolls: `#studio-viewer`, `#studio-canvas-scroll` and `#studio-canvas-inner` all use `overflow: hidden`, so no horizontal or vertical scrollbar is ever rendered or reachable. A design larger than the viewer is reached by panning, not by a scrollbar, and the previous 560px canvas minimum is gone so the viewer is sized by the workspace rather than by its content. A pinned viewer height is no longer re-clamped against the window on resize (CREATOR-07B made the height independent workspace state), and the stacked single-column layout below 960px keeps the viewer at its own usable height so it still fills the stage. Empty-canvas panning, component dragging/resizing, layer ordering and property editing are unchanged.
- **Adjustable Profile Viewer (CREATOR-06)** — the Studio separates two independent coordinate systems. *Design coordinates* (`layout.components[].x/y/width/height/rotation/zIndex`) remain the saved, authoritative profile. *Viewer coordinates* (zoom, pan X/Y, viewer size) are ephemeral editor state held in a dedicated DOM-free module, `web/js/studioViewer.js`, and are never written to the design or sent to the server. Pan is bounded so the design can never be dragged fully out of reach (it re-centres when the profile fits). Dragging **empty canvas pans the viewer**; dragging a **component still moves that component** — the two gestures are handled by separate drag modes and never compete. Arrow keys move the selected component by ±1 (Shift ±10) and pan the viewer when nothing is selected; text/number inputs are excluded so typing and native number-stepping are never hijacked. Pointer-to-design conversion divides out zoom only, so panning can never corrupt component X/Y. (CREATOR-07 removed the CREATOR-06 zoom/Fit/100%/pan toolbar, but kept this coordinate separation, the pan bounds and the gesture isolation.)
- **Compact lower Layers section (CREATOR-06)** — the shared `.studio-panel` keeps its useful 480px editing height for the side editor panels, but `#studio-layers` drops to `min-height: 0` with a height-capped, scrollable layer list, so the lower panel no longer consumes vertical space. `#studio-stage` hosts the Profile Viewer, which takes the full flexible area of the middle column.
- **Arrow-key movement now refreshes the Properties panel (CREATOR-06)** — keyboard nudges previously moved the component but left the X/Y fields showing stale values, so the gesture looked like a no-op. The arrow-key branch now re-renders the properties panel alongside the canvas and layers.
- **Profile Viewer zoom controls (CREATOR-08)** — a compact zoom bar sits above the viewer with `−` / `+` stepping the zoom in 10% increments, a live percentage readout, and **Reset**, which restores 100% and re-centres the pan. Zoom is clamped to **25%–300%** and every change re-clamps the pan so the design can never be dragged out of reach. This is *viewer* state only, held in the same DOM-free `web/js/studioViewer.js` module as the pan: zooming **never** touches component X/Y/width/height/rotation/z-index, never marks the design dirty, never pushes an undo entry and never saves or publishes. The bar deliberately controls **zoom and pan only** — it carries no size controls, so the viewer keeps the CREATOR-07B rule that its height is independent workspace state changed solely by the bottom boundary grip, and the grid/panel sizes are unchanged.
- **One editable Profile Guide per design (CREATOR-08)** — every new design is created with **exactly one** full-canvas guide and there is no "Add guide" button: the guide is part of the design's starting state, not an optional extra. It is a real `profile_guide` component saved with the design, so it survives reload, Save Draft and Publish, and it is fully editable like any other element — select it from the Layers panel (`Guide — Default Profile`) or by clicking it once selected, then move it, resize it with the normal eight handles, and edit X/Y/W/H through the Properties panel. It ships **inset at (12, 12) sized 936×1176** rather than at the exact 960×1200 canvas edges, because the guide's own selection handles sit just outside its box and would otherwise straddle the canvas border where they cannot be grabbed.
- **The Profile Guide is a Studio-only aid (CREATOR-08)** — the guide is excluded from `CONTENT_COMPONENT_TYPES` and from `COMPONENT_SELECTORS` in `web/js/profileDesign.js`, so the public profile renderer silently skips it and it is never drawn on a real profile; Preview mode hides it too. Until it is selected the guide is `pointer-events: none`, so it never blocks editing a component underneath. Its pattern is chosen from a fixed allowlist of built-in layouts — `default`, `minimal` and `classic`, with `default` as the default — and swapping the pattern in Properties **replaces the layout in place**, preserving the guide's geometry, z-index and selection. Because a pattern is an id rather than authored markup, a stored guide can never carry arbitrary HTML, CSS or script.
- **The server validates guides strictly (CREATOR-08)** — `server/profileDesign.js` accepts `profile_guide` in the save and publish component-type list and validates the config against the same allowlist: a missing or unknown pattern id, a non-object config, or geometry outside the design bounds is rejected rather than silently normalised. A design with a valid guide round-trips unchanged through Save and Publish, and public rendering drops it.

### CREATOR-10 — The Profile Viewer is the real profile

The Profile Viewer used to be a plain surface with unrelated placeholder boxes floating on it, so a creator had no idea what their finished profile would actually look like. It is now a faithful, editable representation of the real KomuniPH public profile, and it doubles as the visual design guide.

- **The real profile layout, not a generic canvas** — the canvas draws the actual public profile structure: the outer **PROFILE BACKGROUND** area, the wide **MAIN PROFILE** column on the left and a separate **SIDEBAR** column on the right. The main column carries Profile Photo, Name, Alias, Bio, **Personal Information** and **Testimonials**; the sidebar carries **Friend Space, Photo Gallery, Video Box, Music, Scraps** and Communities. This mirrors `renderProfilePage()` in `web/js/profile.js` — the public renderer is the source of truth, not a second design system. The structure is defined once, as `PROFILE_LAYOUT` in `web/js/profileDesign.js`, and the guide patterns are *generated* from it, so the viewer and the guide can never drift apart.

- **Every sidebar feature is its own independent card** — Friend Space, Photo Gallery, Video Box, Music and Scraps are five separate cards, each with its own geometry. They are never merged into one giant sidebar block, and the sidebar is never drawn as a single container. Photo Gallery is a **sidebar** module on the real profile (`#photo-gallery-module`), so the main column deliberately has **no Gallery section** below Testimonials — inventing one there was the specific bug CREATOR-10 fixes.

- **Outer Profile Background from an uploaded image (JPG/JPEG/PNG/WEBP)** — the flow is *Upload Image → Set as Profile Background*. The image becomes a background **layer** behind the entire profile: the main column, the sidebar and every individual sidebar card all sit on top of it. It is **not** a normal image card — it is design-level configuration on the design's theme, not an `image` component, so it can never be selected, dragged, resized or deleted on the canvas, and it never appears in the Layers list. Uploads go through the existing Creator Studio endpoint (`POST /api/creator/media`), so the server re-validates the real file content with Sharp exactly as it does for any other studio image. For a *design* the background URL is additionally validated against the same rule every other image field uses — `http(s)` or a same-origin `/uploads/` path — so `javascript:`, `data:` and protocol-relative URLs are rejected. Save Draft now persists the theme, and the public profile picks the background up through the existing `#profile-background-layer` / `applyProfileDesignAndTheme` path, so publishing carries it correctly. Size (cover/contain/stretch), position and repeat are exposed in Properties and validated server-side.

- **Direct image drag and resize** — an uploaded image can be clicked and dragged around the viewer, and resized with the normal **eight** handles (four corners resize both dimensions, four edges resize one). The **actual image** visibly resizes as the creator drags: the Studio's CSS targets the `img` itself, not just a box around it, so there is never a moment where the picture stops matching the selection. The image stays visible throughout the gesture.

- **Image quality is never degraded** — the stored `imageUrl` is the single source of truth and the renderer hands it to a plain `<img>`, so the browser scales the original file and the source stays sharp. Nothing is rasterised, downsampled, re-encoded or converted to a canvas bitmap when an image is resized, and no CSS-background substitution is used. Fit (`cover` / `contain` / `fill`) is preserved across a resize, no fixed aspect ratio is forced, and the original resolution is never replaced.

- **Design coordinates and viewer coordinates stay separate** — the design canvas remains the saved **960×1200** coordinate system, and drag/resize write only the real design fields `x`, `y`, `width`, `height`, `rotation` and `zIndex`. Zoom, pan, viewer width and viewer height are ephemeral viewer state, so changing zoom never moves an image, changing the viewer size never resizes one, and resizing a side panel never changes image or guide geometry.

- **The editable canvas is always centered (CREATOR-10)** — the Profile Viewer no longer leaves the design jammed against its top-left corner. A new pure helper `centeredPan()` in `web/js/studioViewer.js` computes the pan that puts the canvas in the middle of the viewer:

  ```text
  centerX = (viewportWidth  - scaledCanvasWidth ) / 2
  centerY = (viewportHeight - scaledCanvasHeight) / 2
  ```

  The same formula covers both cases, which is the point: a canvas **smaller** than the viewport gets a positive offset and floats with equal breathing room on all four sides, while a canvas **larger** than the viewport gets a negative offset that shows the middle of the design rather than pinning a corner into view. A centered offset always falls inside `clampPan()`'s reachable range, so the "the design can never be dragged out of reach" invariant is preserved rather than assumed. The centering is measured against the viewer's true **content box** — `#studio-canvas-scroll` carries a 1.25rem padding and a 1px border, so centring against the padding box would have skewed the canvas ~20px off and reintroduced the very edge-hugging look this removes.

  **Every action that re-establishes the view re-centers it**: zoom **−** and **+**, **Fit**, **Reset**, a left or right side-panel drag, a viewer-height drag, and a browser window resize. That is implemented by a `ResizeObserver` on the viewer rather than by hooking each call site, because a window resize event can arrive while the CSS grid is still laid out for the *previous* window width — centring in the event handler measures a stale viewport, and chasing it with an extra animation frame is a race rather than a guarantee. Observing the element's real size also covers relayouts nothing asked for: a scrollbar appearing, a sidebar re-flowing, or the layout flipping to single-column. Re-centring only ever writes a transform, never a size, so it cannot loop, and the observer settles after a single pass because it re-centers only when the measured size actually changed.

  **Reset** returns to `zoom = 100%` **and** re-centers, and it works after panel resizing, viewer resizing, browser resizing, previous zooming and previous panning. It is idempotent: from an already-centred 100% view it correctly changes nothing.

  **Manual panning is preserved.** Empty-canvas dragging still moves the viewer, and it still works when the design is larger than the viewer. Recentring is deliberately *not* called from `renderCanvas()`/`clampViewerPan()`, which run on every re-render — doing so would throw away a creator's pan during an ordinary component edit. Centering is an explicit action, and panning remains available in between.

  **Design model vs viewer model stay separate (CREATOR-10).** The saved design keeps `canvas`, `components[].x/y/width/height/rotation/zIndex` and the image source; the editor keeps `zoom`, `viewerPan`, viewport size, panel widths and viewer height. Centering, zooming, resetting, fitting and resizing the workspace are all viewer-only: they change no design coordinate, no image source, no rotation and no z-index, and they create **no undo history entry**. The design canvas remains **960×1200** and is never auto-scaled to fit — the transform's scale stays exactly 1 and only its translate changes.

- **A new Fit control (zoom state, not a viewer-size control)** — the design canvas is 960px wide, but the centre column is whatever the two side panels leave over, which is usually narrower. At 100% the right-hand edge — where the profile **sidebar** lives — was clipped off-screen, so a creator genuinely could not see where the sidebar began. **Fit** scales the design down (never up) until the whole profile is visible, then re-centres. Like zoom and pan it is viewer state only: it never changes the canvas size, never touches component geometry, never marks the design dirty and never adds an undo entry. The CREATOR-07/07A/07B ban on viewer *sizing* controls still stands — the viewer's box is still sized only by the two column boundaries and its bottom grip.

- **Side panels still give and take space from the viewer** — widening the left or right Creator Studio panel narrows the centre viewer automatically and narrowing it widens the viewer again, with the centre column held at or above a usable minimum. There is no overlap, no hidden controls, no broken handles and no negative width, and resizing never dirties the design or adds undo history.

- **The guide is the real profile pattern, and stays Studio-only** — the default guide is generated from `PROFILE_LAYOUT`, so there is one card per real profile module, positioned exactly where the viewer draws that module. Guide cards are placement markers only: they are excluded from `CONTENT_COMPONENT_TYPES` and `COMPONENT_SELECTORS`, so the public profile renderer and Preview both skip them, and they never reach Marketplace listings or installed assets. They remain real, editable components (select, move, resize, delete, "Reset Guide" restores the default set), and an intentionally deleted guide card is never recreated.

  - `npm run test:studio-media` runs the CREATOR-06/07/07A/07B/08/10 upload/nav/viewer suite (42 checks, including a guard that **every named import in `creatorStudio.js` resolves** — a named import used only inside a function body is a runtime `ReferenceError` that `node --check` and a bare `import()` both pass, so nothing else would catch it until a creator clicked the affected control; this caught a real bug where Reset referenced `DEFAULT_ZOOM` without importing it, so Reset silently did nothing. It also asserts the guide covers all 12 real profile sections, that Photo Gallery is a sidebar module with no main-column Gallery, and that Fit and re-centring stay viewer-only zoom/pan state)
  - `npm run test:studio-media-e2e` runs the headless-browser E2E (59 checks, including CREATOR-10: the real profile structure being drawn with main/sidebar and one independent card per sidebar module, the guide agreeing with it card-for-card, the background being uploaded through the real endpoint and sitting behind the whole profile while never becoming a component or a Layers row, save/reload/publish carrying it, an uploaded image being dragged, corner- and edge-resized with all eight handles while the picture itself resizes, the source resolution never changing, and both side panels resizing the viewer without touching the design. It also verifies **centering** in a real browser: the canvas is centered at 100%, stays centered through zooming out, zooming in, a large zoom, a small zoom, Fit and manual panning; Reset re-centers from a genuinely off-centre view; left-panel, right-panel, viewer-height and browser-window resizes all re-center the canvas; re-centering persists nothing, changes no design data and adds no undo history; and an image component's geometry and source are untouched by every one of them)
  - `node tests/test_creator10_profile_viewer.mjs` runs the CREATOR-10 suite (24 checks: the real profile layout geometry, independent sidebar cards, the absence of a main-column Gallery, guide/structure agreement, client–server section agreement, sidebar guide sections round-tripping, unknown sections still rejected, background persistence and strict URL/presentation validation, the background being design-level rather than a component, the published profile receiving it, the guide surviving a save/reload with deletions preserved, `fitZoom` clamping, zoom/pan independence from design coordinates, the image fit model surviving a free resize, and the centering arithmetic — `centeredPan` insetting a small canvas and showing the middle of a large one, a centered pan surviving `clampPan` unchanged, zoom re-centring by recomputation rather than by preserving the old pan, and no zoom level across the whole supported range anchoring the canvas to a corner)

  - `npm run test:studio-media` runs the CREATOR-06/07/07A/07B/08 upload/nav/viewer suite (41 checks: upload security + formats, uploaded-URL integration, back navigation, workspace column/height resize geometry and clamping, viewer height independence from the panels and the window, workspace wiring, non-edit behavior, removed-toolbar and removed-grip regressions, zoom step/clamp/reset arithmetic and the rule that the guide is absent from the public component types and selectors, studio layout, responsive rules and the panel/viewer decoupling rules)
  - `npm run test:studio-media-e2e` runs the headless-browser E2E (38 checks: login, catalogs, back buttons, studio upload + save, a large initial viewer height, the viewer height staying unchanged when either side panel is resized, the viewer height staying independent of Properties-panel content, a profile taller than the viewer staying unscaled and pannable with no scrollbar, the viewer filling the workspace, absence of any viewer size controls, the workspace handles being the topmost element at their boundaries, left/right column-boundary dragging, bottom-edge viewer dragging in both directions with the grip following the new boundary, clamping under absurd pointer travel, resizing leaving geometry/undo/dirty untouched, component drag/resize and property editing still working, single-column mode with a retained viewer height and no horizontal overflow, empty-canvas pan isolation, arrow-key movement, non-hijacked text inputs, zoom stepping/clamping and leaving the design untouched, the guide rendering exactly once with its pattern structure and click-through default, being selectable from Layers with its eight handles, moving under a body drag and resizing under a north-handle drag plus the Properties Width field, having its pattern replaced in place, being deletable without returning, and staying hidden in Preview)

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

