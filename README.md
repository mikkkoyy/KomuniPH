# KomuniPH

KomuniPH is a community-first social networking platform for the Philippines, built with Node.js, SQLite, and vanilla JavaScript.

## Tech Stack

- **Backend:** Node.js (ES modules, no framework â€” `node:http`)
- **Database:** SQLite (`better-sqlite3`)
- **Frontend:** vanilla JavaScript + HTML/CSS (no build step)

## Features

- **Profiles** â€” identity, bio, photos, privacy controls (`real_name_visible`)
- **Feed** â€” posts, comments, reactions
- **Messaging** â€” direct conversations
- **Community discovery** â€” search, type/location/joined filters, and Recommended Communities on `GET /api/communities/discover` and `GET /api/communities/recommended`; eligibility-aware cards with public activity counts (members, posts, last activity) and in-place join from discovery
- **Communities** â€” location-scoped groups (nationwide / city / barangay) with server-side eligibility derived from the stored profile location
- **Community membership** â€” join/leave, member list, first member becomes owner
- **Elections** â€” monthly moderator elections with nominations, voting, runoffs, and history
- **Rules** â€” owner/moderator-managed community rules
- **Pinned announcements** â€” pin/unpin community posts (limit 5)
- **Reports** â€” member reporting with duplicate protection and a moderator queue (resolve/dismiss)
- **Moderation** â€” owner/moderator feature, unfeature, and delete powers scoped to their community
- **Events** â€” community events with member creation and moderator deletion
- **Media** â€” image URLs shared in community posts, listed per community
- **Settings** â€” per-community toggles (`allow_member_posts`, `allow_member_comments`, `allow_events`, `allow_media`, `moderation_enabled`)
- **Coins & Wallet** â€” one wallet per user (`.balance`, `.frozen_balance`, available = balance âˆ’ frozen); an atomic, source-idempotent transaction ledger (`coin_transactions`) records every credit/debit/freeze/unfreeze with running balances; GCash/Maya top-ups via PayMongo webhooks (`/api/coins/paymongo/webhook`); withdrawals freeze coins on request and cash them out on admin approval; a one-time 15-coin reward on identity verification; admin adjust `/api/admin/coins/adjust` with full audit trail
- **Locked reward Coins** (COINS-02A) â€” accounting model: `user_wallets` carries `locked_reward_balance` next to `balance`/`frozen_balance` (single mutable row, no drift); `transferable = balance âˆ’ frozen âˆ’ locked`. KomuniPH-issued rewards (identity verification: exactly 15 Coins once, via the existing `reward_awarded` flow and a reusable `awardLockedRewardCoins` helper) are personally spendable but permanently non-transferable: gifts and withdrawals/freeze may only consume transferable coins, while personal spending (Coin Shop `spend`) consumes locked rewards first and received gifts stay transferable. The `verification_reward` ledger type (plus `gift`) keeps every class auditable in the existing `coin_transactions` ledger. Live databases migrate safely: all rows/balances preserved, previously issued identity rewards classified as locked (capped at coins still held, never re-awarded)
  - `npm run test:coin-rewards` runs the COINS-02A test suite
- **Gift Coins** (COINS-02) â€” user-to-user transfers from the Coins page (`Cash In | Cash Out | Gift`): recipient search (`GET /api/users/search`, public fields only), explicit selection, positive-integer amount, and a confirmation showing current/after balances. `POST /api/coins/gift` resolves the recipient server-side, rejects self-gifts, and settles debit + credit + receiver notification atomically in one transaction (sender `Gift Sent` debit, receiver `Gift Received` credit, `gift` ledger type). The receiver gets an unread `coin_gift` notification ("You received 100 Coins from John Doe (@johndoe).") linking to `#/wallet`, with a sidebar badge and a `#/notifications` inbox (mark read / mark all read). Client idempotency keys make replays settle exactly once; frozen funds are respected; no negative balances
  - `npm run test:coin-gift` runs the COINS-02 test suite
- **Profile designs** â€” server-validated profile layout engine (`/api/profile/design` CRUD + publish/archive): a controlled component registry (profile photo, name, alias, bio, personal info, gallery, testimonials, communities) plus four user-content components (text, image, card, sticker), strict JSON layout validation (geometry/rotation/z-index bounds, style field limits, per-type config contracts, http(s)-only image URLs, 64-component cap, canvas bounds, markup/script rejection), exactly one published design per user (publishing archives the previous one, each publish bumps `version`); published designs are attached to own and public profile responses as `profile.design`, while drafts and archived designs are never exposed and invalid stored designs safely degrade to a default profile

- **Creator Assets** (CREATOR-02A) â€” reusable creator-product foundation. A separate `creator_assets` table stores validated, versioned snapshots that are independent of the user's personal profile design. Supports asset type `profile_design` (the only fully supported type in this milestone). Lifecycle: `draft â†’ submitted â†’ published â†’ archived`. Published assets contain their own immutable snapshot â€” editing the personal profile design later does not affect published assets. Ownership always derives from the authenticated `user.sub`; cross-user access is denied (404). Price metadata (`price_coins`) is stored but no coin movement, purchases, or payouts are implemented â€” `price_coins` is metadata only, Marketplace purchases are not yet built. Supported asset type: `profile_design`. Asset validation is server-side, reusing the existing profile design validator. Creator Studio includes "Save as Creator Asset" modal.

  - `npm run test:assets` runs the CREATOR-02A test suite

- **Marketplace & Coin Shop** (CREATOR-03) â€” two distinct marketplace experiences:
  - **Normal Marketplace** â€” Shopee/Lazada-style discovery marketplace for physical products, services, digital goods, and local items. Features: product listings with images, search/filter by category, pagination, product detail pages. Primary actions: **Message Seller**, **Visit Profile**, **Share Link**. No cart, checkout, or Buy Now. External sales are supported â€” buyers and sellers arrange transactions themselves via KomuniPH messaging, Facebook, Shopee, Lazada, GCash/Maya, or offline.
  - **Creator Coin Shop** â€” Dedicated section for purchasing creator digital assets (themes, backgrounds, animations, stickers, decorations, profile designs) using KomuniPH Coins. Features: asset browsing with category filters, search, single-product **Buy** action using the existing atomic wallet/ledger system. Primary actions: **Buy**, **Visit Profile**, **Message Creator**, **Share Link**. Duplicate-purchase prevention via `purchased_assets` table.

  Key APIs:
  - `GET /api/marketplace/listings` â€” list normal marketplace listings (auth required)
  - `POST /api/marketplace/listings` â€” create a listing (draft status)
  - `GET /api/marketplace/listings/:id` â€” view a published listing (public)
  - `PATCH /api/marketplace/listings/:id` â€” edit draft listing
  - `POST /api/marketplace/listings/:id/publish` â€” publish listing
  - `GET /api/marketplace/assets` â€” list published creator assets for Coin Shop (auth required)
  - `GET /api/coin-shop/products/:id` â€” view a single product (public)
  - `POST /api/coin-shop/buy/:id` â€” purchase a creator asset (auth, coins required)
  - `GET /api/coin-shop/purchases` â€” list buyer's purchased assets
  - `GET /api/coin-shop/purchased/:id` â€” check if buyer owns asset

  - `npm run test:marketplace` runs the CREATOR-03 test suite

- **Marketplace Seller Management & Creator Library** (CREATOR-04) â€” completes the CREATOR-03 workflow:
  - **Seller dashboard** (`#/marketplace/manage`) â€” owner-scoped listings with draft/published/archived counts; create/edit/publish/archive via `GET /api/marketplace/my-listings`, `PATCH /api/marketplace/listings/:id`, `POST .../publish` (also restores archived listings), `POST .../archive` (idempotent). Draft-only editing is preserved; archived listings stay hidden publicly but remain manageable.
  - **Listing images + external sales** â€” image URLs are validated server-side (http(s) only, max 10, add/remove/reorder in the UI); optional `external_url` (http(s) only, `javascript:`/`data:` rejected) and `contact_info` identify the seller's external sales destination. No cart, checkout, shipping, orders, or payments â€” Discovery â†’ Message Seller â†’ External Transaction.
  - **Buyer library** (`#/coin-shop/library`) â€” purchased assets from `GET /api/coin-shop/purchases` with preview, creator, price, date, and ownership status. `profile_design` assets install via `POST /api/coin-shop/install/:id` into a buyer-owned draft design through the existing validated design system (creator snapshot untouched; buyer publishes via Creator Studio); other types show a clear not-installable state.
  - **Contextual messaging** â€” Message Seller / Message Creator deep-link to `#/messages?to=<username>&listing=<id>` (or `&asset=<id>`); the messages page resolves the recipient server-side from the published product record, shows a product context banner, and opens the existing conversation with a prefilled product reference. Fabricated parameters can never change the recipient.

  - `npm run test:marketplace-manage` runs the CREATOR-04 seller-management suite
  - `npm run test:coin-library` runs the CREATOR-04 buyer-library suite

- **Marketplace Seller Center & Coin Shop Manager** (CREATOR-05) â€” two separate selling systems:
  - **Seller Center** (`#/marketplace/seller`, alias `#/marketplace/manage`) â€” header with the seller's real profile identity (display name, not username), factual counts (All/Published/Drafts/Archived â€” no sales/revenue invention), server-authoritative search/status/category/sort over `GET /api/marketplace/my-listings`, draft preview modal, published dates, external-sale indicators, and Share on every status. Lifecycle unchanged: draft (edit/preview/publish/share) â†’ published (view/archive/share) â†’ archived (view/republish/share-link-stable). External URLs stay http(s)-only with `noopener noreferrer nofollow`; no cart/checkout/orders/payments.
  - **Coin Shop Manager** (`#/creator-studio/coin-shop`, linked from Creator Studio as "My Coin Shop") â€” built only on `creator_assets` (no duplicate table): per-status counts plus real sales/earned-Coins totals from `GET /api/creator/assets/sales` (sourced from `purchased_assets`, zero fabrication). Create flow per supported type (Profile Design snapshots from own designs, Theme color config, image URL + fit), positive-integer Coin pricing, realistic preview with a disabled Buy button, and an explicit "Publish to Coin Shop" confirmation. Published snapshots stay immutable; archived assets cannot be republished, matching the server contract. The Studio "Save as Asset" modal now targets Coin Shop sales with corrected copy and Coin Shop links.
  - Card alignment preserved from the CREATOR-04 UI fix (flex-column cards, balanced descriptions, bottom-anchored actions).

  - `npm run test:seller-center` runs the CREATOR-05 Seller Center suite
  - `npm run test:coin-shop-manager` runs the CREATOR-05 Coin Shop Manager suite
- **Creator Studio** â€” in-app visual editor (`#/creator-studio`) for profile designs: drag/resize/rotate components on a WYSIWYG canvas, snap-to-guides, eight-way handles, an elements panel, a live properties panel (geometry, appearance, per-type content), a layers panel with z-order operations (front/back/forward/backward, hide, lock, duplicate, delete, z-index field), undo/redo, and a preview mode; drafts are saved per design (Save Draft) and publishing (`designApi.publishDesign`) makes the design live on the owner's profile; the studio only edits the stored model through the existing validated API and never bypasses server checks
- **Creator Studio media upload + workspace (CREATOR-06)** â€” image/sticker components accept local JPG/JPEG/PNG/WEBP uploads (`POST /api/creator/media`, auth required) into a separate `uploads/creator/` store: Sharp validates actual file content, output is re-encoded WebP under generated safe filenames (GIF/text/oversized/unauthenticated rejected); the uploaded URL drops straight into the component with immediate canvas preview, preserving alt text and fit. Design/asset/listing validators accept same-origin `/uploads/` image URLs while `javascript:`/`data:` stay rejected. The editor uses a roomier three-column workspace (300px components/layers, 370px properties, taller scroll areas, larger grouped Position/Size/Layer/Transform/Appearance/Image controls) with the toolbar sticky; side panels collapse to one column under 960px. Every movable component exposes free X/Y positioning (precise numeric fields, direct mouse drag with snap guides, Arrow keys Â±1 and Shift+Arrow Â±10 outside text inputs), W/H resize (fields + 8 handles), rotation, and Layer controls (Z-index field plus explicit Move Up / Move Down buttons reusing the single z-order model, plus canvas Left/Center/Right/Top/Middle/Bottom align shortcuts)
- **Back navigation (CREATOR-06)** â€” shared `renderBackButton` helper with deterministic routes: Marketplace catalog â†’ Profile, Marketplace product â†’ Marketplace, Seller Center â†’ Marketplace, Coin Shop catalog â†’ Marketplace, Coin Shop product â†’ Coin Shop, Library â†’ Coin Shop, Coin Shop Manager â†’ Creator Studio/Coin Shop, Wallet â†’ Profile, Creator Studio â†’ Profile
- **Large, independent Profile Viewer workspace (CREATOR-07B)** â€” the Profile Viewer is the main editing area and its height is **completely independent of the side panels**. This fixes a real defect: the viewer used to be squeezed to roughly half height, because the grid stretched the stage to the tallest side panel (`.studio-panel` had `min-height: 480px` + `max-height: calc(100vh - 140px)` and the grid used `align-items: stretch`), and its height was additionally capped by a `viewportHeight - 200` "chrome" estimate. Both couplings are gone. `.studio-layout` now uses `align-items: start`, so the Properties and Profile Sections panels cannot contribute their height to the viewer's; they scroll internally instead. `#studio-stage` declares its own height, and `viewerHeight` is seeded with a **deliberate** `DEFAULT_VIEWER_HEIGHT` of 900px rather than `null`, so there is no state in which the stage has no height and inherits the grid row's. The `viewportHeight - chrome` ceiling was removed outright: `clampViewerHeight` no longer takes a viewport and is bounded only by a 320px usability floor and a generous 4000px hard ceiling, so a taller window never shortens the editing area and a downward drag can genuinely make the viewer taller than the window. Concretely: **left panel width â†’ center column width**, and **Profile Viewer height â†’ independent workspace state**, with no path from panel height to viewer height. The viewer still has **no width of its own** (it fills the center column) and its only size control is the invisible **bottom** boundary: drag **down** to make it taller, drag **up** to make it shorter, with no left/right/top/corner viewer grips and no viewer toolbar of any kind. Below 960px the layout goes single-column and the desktop handles are hidden, but the viewer **keeps** a usable height rather than collapsing to a `60vh` sliver, and the page gains no horizontal overflow.
- **A profile taller than the viewer stays fully editable (CREATOR-07B)** â€” the design canvas keeps its real authored dimensions (960Ã—1200); it is **never** auto-scaled down to fit the viewer (`zoom` stays 1 and no fit logic runs). A profile taller than the editing area is still reached by panning, with `overflow: hidden` throughout so no browser scrollbar ever appears. Resizing the viewer is an **editor-viewport** operation: it never modifies component X/Y, width, height, rotation or z-index, never changes saved design geometry, never marks the design dirty, never creates an undo entry, and never triggers Save or Publish. Component drag, component resize handles, property editing, arrow-key nudging, layer ordering and panning all continue to work after any workspace resize.
- **Resizable Creator Studio workspace (CREATOR-07A)** â€” the whole studio workspace is now resizable through its own **column boundaries** instead of the CREATOR-07 per-viewer edge grips, which are gone. Two invisible boundary handles sit in the gaps between the Components/Layers panel, the Viewer and the Properties panel (`ew-resize`, at least 8px wide), and a third grip on the viewer's bottom edge (`ns-resize`) changes its height. Dragging a column boundary resizes that side panel and lets the Viewer take up or give up the difference, so the Viewer still fills the whole center column and has **no width of its own**; dragging the bottom grip only changes height. The two panel widths are written to the layout element as the `--studio-col-left` / `--studio-col-right` custom properties that drive the CSS grid, and the height to the stage's inline height. All three are transient editor state held in the DOM-free `web/js/studioViewer.js` module (`clampPanelWidth` / `columnWidthsFromDrag` / `clampViewerHeight`), clamped so no panel or the viewer can ever collapse, and re-clamped when the window resizes. Resizing **never** touches component X/Y/width/height/rotation/z-index, never marks the design dirty, never pushes an undo entry and never saves or publishes â€” the dedicated `panel-resize` and `viewer-height` drag modes return before any component or history logic runs. Below 960px the layout is a single column, so the handles are hidden and the pinned column widths are released back to the stylesheet; below 760px the grab bands widen for touch.
- **Directly resizable Profile Viewer (CREATOR-07)** â€” superseded by CREATOR-07A, which replaced the eight invisible viewer grips with resizable workspace columns. The floating viewer toolbar remains **removed entirely**, with no replacement: there is no zoom âˆ’/+, no percentage readout, no **Fit**, no **100%**, no â† â†‘ â†“ â†’ pan pad and no numeric size fields â€” the viewer contains no buttons at all. (CREATOR-08 later added a separate zoom bar *above* the viewer, outside the viewer itself; it restores only zoom âˆ’/+ with a readout and Reset, and still carries no size controls, no **Fit** and no pan pad.)
- **Profile Viewer with no scrollbars (CREATOR-07)** â€” the viewer fills its workspace by default (`#studio-stage` is the positioning context, `#studio-viewer` is `position: absolute; inset: 0`) and clips rather than scrolls: `#studio-viewer`, `#studio-canvas-scroll` and `#studio-canvas-inner` all use `overflow: hidden`, so no horizontal or vertical scrollbar is ever rendered or reachable. A design larger than the viewer is reached by panning, not by a scrollbar, and the previous 560px canvas minimum is gone so the viewer is sized by the workspace rather than by its content. A pinned viewer height is no longer re-clamped against the window on resize (CREATOR-07B made the height independent workspace state), and the stacked single-column layout below 960px keeps the viewer at its own usable height so it still fills the stage. Empty-canvas panning, component dragging/resizing, layer ordering and property editing are unchanged.
- **Adjustable Profile Viewer (CREATOR-06)** â€” the Studio separates two independent coordinate systems. *Design coordinates* (`layout.components[].x/y/width/height/rotation/zIndex`) remain the saved, authoritative profile. *Viewer coordinates* (zoom, pan X/Y, viewer size) are ephemeral editor state held in a dedicated DOM-free module, `web/js/studioViewer.js`, and are never written to the design or sent to the server. Pan is bounded so the design can never be dragged fully out of reach (it re-centres when the profile fits). Dragging **empty canvas pans the viewer**; dragging a **component still moves that component** â€” the two gestures are handled by separate drag modes and never compete. Arrow keys move the selected component by Â±1 (Shift Â±10) and pan the viewer when nothing is selected; text/number inputs are excluded so typing and native number-stepping are never hijacked. Pointer-to-design conversion divides out zoom only, so panning can never corrupt component X/Y. (CREATOR-07 removed the CREATOR-06 zoom/Fit/100%/pan toolbar, but kept this coordinate separation, the pan bounds and the gesture isolation.)
- **Compact lower Layers section (CREATOR-06)** â€” the shared `.studio-panel` keeps its useful 480px editing height for the side editor panels, but `#studio-layers` drops to `min-height: 0` with a height-capped, scrollable layer list, so the lower panel no longer consumes vertical space. `#studio-stage` hosts the Profile Viewer, which takes the full flexible area of the middle column.
- **Arrow-key movement now refreshes the Properties panel (CREATOR-06)** â€” keyboard nudges previously moved the component but left the X/Y fields showing stale values, so the gesture looked like a no-op. The arrow-key branch now re-renders the properties panel alongside the canvas and layers.
- **Profile Viewer zoom controls (CREATOR-08)** â€” a compact zoom bar sits above the viewer with `âˆ’` / `+` stepping the zoom in 10% increments, a live percentage readout, and **Reset**, which restores 100% and re-centres the pan. Zoom is clamped to **25%â€“300%** and every change re-clamps the pan so the design can never be dragged out of reach. This is *viewer* state only, held in the same DOM-free `web/js/studioViewer.js` module as the pan: zooming **never** touches component X/Y/width/height/rotation/z-index, never marks the design dirty, never pushes an undo entry and never saves or publishes. The bar deliberately controls **zoom and pan only** â€” it carries no size controls, so the viewer keeps the CREATOR-07B rule that its height is independent workspace state changed solely by the bottom boundary grip, and the grid/panel sizes are unchanged.
- **One editable Profile Guide per design (CREATOR-08)** â€” every new design is created with **exactly one** full-canvas guide and there is no "Add guide" button: the guide is part of the design's starting state, not an optional extra. It is a real `profile_guide` component saved with the design, so it survives reload, Save Draft and Publish, and it is fully editable like any other element â€” select it from the Layers panel (`Guide â€” Default Profile`) or by clicking it once selected, then move it, resize it with the normal eight handles, and edit X/Y/W/H through the Properties panel. It ships **inset at (12, 12) sized 936Ã—1176** rather than at the exact 960Ã—1200 canvas edges, because the guide's own selection handles sit just outside its box and would otherwise straddle the canvas border where they cannot be grabbed.
- **The Profile Guide is a Studio-only aid (CREATOR-08)** â€” the guide is excluded from `CONTENT_COMPONENT_TYPES` and from `COMPONENT_SELECTORS` in `web/js/profileDesign.js`, so the public profile renderer silently skips it and it is never drawn on a real profile; Preview mode hides it too. Until it is selected the guide is `pointer-events: none`, so it never blocks editing a component underneath. Its pattern is chosen from a fixed allowlist of built-in layouts â€” `default`, `minimal` and `classic`, with `default` as the default â€” and swapping the pattern in Properties **replaces the layout in place**, preserving the guide's geometry, z-index and selection. Because a pattern is an id rather than authored markup, a stored guide can never carry arbitrary HTML, CSS or script.
- **The server validates guides strictly (CREATOR-08)** â€” `server/profileDesign.js` accepts `profile_guide` in the save and publish component-type list and validates the config against the same allowlist: a missing or unknown pattern id, a non-object config, or geometry outside the design bounds is rejected rather than silently normalised. A design with a valid guide round-trips unchanged through Save and Publish, and public rendering drops it.

### CREATOR-10 â€” The Profile Viewer is the real profile

The Profile Viewer used to be a plain surface with unrelated placeholder boxes floating on it, so a creator had no idea what their finished profile would actually look like. It is now a faithful, editable representation of the real KomuniPH public profile, and it doubles as the visual design guide.

- **The real profile layout, not a generic canvas** â€” the canvas draws the actual public profile structure: the outer **PROFILE BACKGROUND** area, the wide **MAIN PROFILE** column on the left and a separate **SIDEBAR** column on the right. The main column carries Profile Photo, Name, Alias, Bio, **Personal Information** and **Testimonials**; the sidebar carries **Friend Space, Photo Gallery, Video Box, Music, Scraps** and Communities. This mirrors `renderProfilePage()` in `web/js/profile.js` â€” the public renderer is the source of truth, not a second design system. The structure is defined once, as `PROFILE_LAYOUT` in `web/js/profileDesign.js`, and the guide patterns are *generated* from it, so the viewer and the guide can never drift apart.

- **Every sidebar feature is its own independent card** â€” Friend Space, Photo Gallery, Video Box, Music and Scraps are five separate cards, each with its own geometry. They are never merged into one giant sidebar block, and the sidebar is never drawn as a single container. Photo Gallery is a **sidebar** module on the real profile (`#photo-gallery-module`), so the main column deliberately has **no Gallery section** below Testimonials â€” inventing one there was the specific bug CREATOR-10 fixes.

- **Outer Profile Background from an uploaded image (JPG/JPEG/PNG/WEBP)** â€” the flow is *Upload Image â†’ Set as Profile Background*. The image becomes a background **layer** behind the entire profile: the main column, the sidebar and every individual sidebar card all sit on top of it. It is **not** a normal image card â€” it is design-level configuration on the design's theme, not an `image` component, so it can never be selected, dragged, resized or deleted on the canvas, and it never appears in the Layers list. Uploads go through the existing Creator Studio endpoint (`POST /api/creator/media`), so the server re-validates the real file content with Sharp exactly as it does for any other studio image. For a *design* the background URL is additionally validated against the same rule every other image field uses â€” `http(s)` or a same-origin `/uploads/` path â€” so `javascript:`, `data:` and protocol-relative URLs are rejected. Save Draft now persists the theme, and the public profile picks the background up through the existing `#profile-background-layer` / `applyProfileDesignAndTheme` path, so publishing carries it correctly. Size (cover/contain/stretch), position and repeat are exposed in Properties and validated server-side.

- **An uploaded background is now the profile's actual background (CREATOR-10B)** â€” a background could be active, correctly applied to `#profile-background-layer`, and still barely visible. The cause was not the layer: it was one value. `--theme-card-background` is a single, nearly opaque cream shared by every surface on the site, so on a profile it painted the whole content column as one continuous sheet and the picture survived only in the slivers between cards â€” an opaque screen sitting on top of a background rather than the profile's own background.

  The profile now resolves **three surfaces of its own** instead of reusing that one value, and lowers only the **alpha** of each, derived from the creator's own card colour:

  | Surface | Variable | Ceiling | Why it differs |
  |---|---|---|---|
  | Card body | `--profile-card-surface` | 0.62 | The largest area, so it is the one that has to get out of the way |
  | Card header | `--profile-card-header-surface` | 0.82 | A title still needs a readable ground over a photograph |
  | Status strip / footer | `--profile-status-surface` | 0.72 | A full-width band, but a single line of small text that must stay legible |

  Those are **ceilings, not values**: `Math.min(creatorCardOpacity, ceiling)` can only ever make a card *more* transparent, so a creator who deliberately chose an opaque card keeps exactly the card they asked for. Hue, border, radius, text colour and every theme control are untouched â€” nothing here overrides a custom theme, it only stops one shared value being reused where a different amount of transparency is wanted.

  The softened treatment is **opt-in**: `.profile-frame` carries `data-profile-surface="soft"` only when a background the visitor actually chose is behind the content (an uploaded picture, a custom gradient or a custom colour) and carries **no attribute at all** otherwise, so a profile with no custom background is left byte for byte as it was. The stock theme gradient deliberately does not count â€” softening cards for it would change every profile in the app to fix a problem only a chosen background has. Readability that the lower alpha costs is bought with a **`backdrop-filter`** on the card, which is a backdrop filter and never `opacity` on an ancestor: only the picture showing through the card is softened, while the card's own text, border, buttons and focus ring keep full opacity.

  **The Creator Studio shows the same thing (CREATOR-10B).** The first pass fixed the public profile and left the Studio's own preview just as washed out, because the Studio draws its own parallel copy of the profile structure. Two changes, both needed:

  - *The Studio's surfaces are delineated by border, not by fill.* They stack â€” outer background area, then a whole column, then a card per module, then a guide card on top â€” and at their previous alphas that compounded to roughly **80% white** across the entire content area, so a background was legible only in the margins. The background area now carries no fill at all (the uploaded image is already painted directly beneath it), a column is a boundary rather than a surface, and module cards and guide cards are barely tinted and lean on their border. Each label carries its own small light plate so it stays readable over any photograph.
  - *The background fills the viewer, and the canvas floats on top.* The backdrop is now a sibling of the canvas inside the clipping viewer, mirroring the published profile where it is a fixed full-viewport layer. The design canvas is untouched â€” still 960Ã—1200, still zoomed and panned by its own transform, still the saved coordinate system â€” and only its stacking against the backdrop changed. With no background active the backdrop is empty and the canvas keeps its own light surface, so a design without one looks exactly as it did.

  Two duplicate-selector problems found during the investigation were also resolved, because both made the real cause hard to see and any future edit to the wrong copy would silently do nothing: `.profile-module` and `.sidebar-module` were each declared **twice**, byte for byte identical, and `.profile-content-frame` was declared twice with **contradictory** `z-index` (`1` in the layout block, `2` further down, the later one winning). Each is now declared exactly once, in the block that owns it.

  The background architecture is untouched: the picture stays on the fixed `#profile-background-layer` at z 0, the effect layer stays above it at z 1, content at z 2, and the CREATOR-10 priority chain (uploaded image â†’ custom gradient â†’ custom colour â†’ theme gradient â†’ theme colour) is unchanged. The profile header stays `transparent`, and the five sidebar modules remain independent cards rather than one sidebar panel, so the background shows through the gaps between them as well as around them.

- **The active state is explicit, not inferred (CREATOR-10A)** â€” "an image has been uploaded" and "this image is your live profile background" are different things, so the Properties panel never leaves that to guesswork. A compact chip beside the section title names the current state outright:

  | State | Chip | What the creator sees |
  |---|---|---|
  | No background | `NOT SET` | an explicit "no Profile Background" message, Size/Position/Repeat greyed out, no Remove, and **no** `Set as Profile Background` button sitting there looking actionable |
  | Uploaded, not applied | `UPLOADED â€” NOT ACTIVE` | the staged image on its own row marked *not active yet*, the active preview still empty, and an enabled `Set as Profile Background` |
  | Background active | `âœ“ ACTIVE` (teal) | the preview image tagged `ACTIVE BACKGROUND`, an enabled Remove, and again **no** apply button â€” there is nothing left to apply |
  | Replacement staged | `REPLACEMENT READY` (amber) | the still-active background unchanged, the staged image marked *will replace, not applied yet*, and `Replace Profile Background` enabled |

  The chip colours are deliberately different â€” a staged upload is amber, never green, so it can never be mistaken for active â€” and the tests assert the *computed* colour rather than trusting the class. An upload alone never changes the background; the creator must apply it, and applying (or replacing, or removing) updates the panel immediately with no reload. The **active** state is derived from `theme.backgroundImage` alone, so it is always reconstructed from the saved design; the staged upload is deliberately *not* part of the design model and is discarded when the design is switched, so it can never follow a creator to another design as a phantom background. (That staged URL also lives at module scope rather than inside the properties closure: the closure is rebuilt on every re-render, so a closure-local value used to vanish the moment anything unrelated re-rendered.) Size/Position/Repeat stay scoped to the *active* background â€” disabled with no background, and titled to say so â€” so they never read as unrelated generic theme settings. This task changed only the Properties presentation: `theme.backgroundImage` storage semantics, the design-level (non-component) model, and the public profile pipeline are all untouched.



- **Image quality is never degraded** â€” the stored `imageUrl` is the single source of truth and the renderer hands it to a plain `<img>`, so the browser scales the original file and the source stays sharp. Nothing is rasterised, downsampled, re-encoded or converted to a canvas bitmap when an image is resized, and no CSS-background substitution is used. Fit (`cover` / `contain` / `fill`) is preserved across a resize, no fixed aspect ratio is forced, and the original resolution is never replaced.

- **Design coordinates and viewer coordinates stay separate** â€” the design canvas remains the saved **960Ã—1200** coordinate system, and drag/resize write only the real design fields `x`, `y`, `width`, `height`, `rotation` and `zIndex`. Zoom, pan, viewer width and viewer height are ephemeral viewer state, so changing zoom never moves an image, changing the viewer size never resizes one, and resizing a side panel never changes image or guide geometry.

- **The editable canvas is always centered (CREATOR-10)** â€” the Profile Viewer no longer leaves the design jammed against its top-left corner. A new pure helper `centeredPan()` in `web/js/studioViewer.js` computes the pan that puts the canvas in the middle of the viewer:

  ```text
  centerX = (viewportWidth  - scaledCanvasWidth ) / 2
  centerY = (viewportHeight - scaledCanvasHeight) / 2
  ```

  The same formula covers both cases, which is the point: a canvas **smaller** than the viewport gets a positive offset and floats with equal breathing room on all four sides, while a canvas **larger** than the viewport gets a negative offset that shows the middle of the design rather than pinning a corner into view. A centered offset always falls inside `clampPan()`'s reachable range, so the "the design can never be dragged out of reach" invariant is preserved rather than assumed. The centering is measured against the viewer's true **content box** â€” `#studio-canvas-scroll` carries a 1.25rem padding and a 1px border, so centring against the padding box would have skewed the canvas ~20px off and reintroduced the very edge-hugging look this removes.

  **Every action that re-establishes the view re-centers it**: zoom **âˆ’** and **+**, **Fit**, **Reset**, a left or right side-panel drag, a viewer-height drag, and a browser window resize. That is implemented by a `ResizeObserver` on the viewer rather than by hooking each call site, because a window resize event can arrive while the CSS grid is still laid out for the *previous* window width â€” centring in the event handler measures a stale viewport, and chasing it with an extra animation frame is a race rather than a guarantee. Observing the element's real size also covers relayouts nothing asked for: a scrollbar appearing, a sidebar re-flowing, or the layout flipping to single-column. Re-centring only ever writes a transform, never a size, so it cannot loop, and the observer settles after a single pass because it re-centers only when the measured size actually changed.

  **Reset** returns to `zoom = 100%` **and** re-centers, and it works after panel resizing, viewer resizing, browser resizing, previous zooming and previous panning. It is idempotent: from an already-centred 100% view it correctly changes nothing.

  **Manual panning is preserved.** Empty-canvas dragging still moves the viewer, and it still works when the design is larger than the viewer. Recentring is deliberately *not* called from `renderCanvas()`/`clampViewerPan()`, which run on every re-render â€” doing so would throw away a creator's pan during an ordinary component edit. Centering is an explicit action, and panning remains available in between.

  **Design model vs viewer model stay separate (CREATOR-10).** The saved design keeps `canvas`, `components[].x/y/width/height/rotation/zIndex` and the image source; the editor keeps `zoom`, `viewerPan`, viewport size, panel widths and viewer height. Centering, zooming, resetting, fitting and resizing the workspace are all viewer-only: they change no design coordinate, no image source, no rotation and no z-index, and they create **no undo history entry**. The design canvas remains **960Ã—1200** and is never auto-scaled to fit â€” the transform's scale stays exactly 1 and only its translate changes.

- **A new Fit control (zoom state, not a viewer-size control)** â€” the design canvas is 960px wide, but the centre column is whatever the two side panels leave over, which is usually narrower. At 100% the right-hand edge â€” where the profile **sidebar** lives â€” was clipped off-screen, so a creator genuinely could not see where the sidebar began. **Fit** scales the design down (never up) until the whole profile is visible, then re-centres. Like zoom and pan it is viewer state only: it never changes the canvas size, never touches component geometry, never marks the design dirty and never adds an undo entry. The CREATOR-07/07A/07B ban on viewer *sizing* controls still stands â€” the viewer's box is still sized only by the two column boundaries and its bottom grip.

- **Side panels still give and take space from the viewer** â€” widening the left or right Creator Studio panel narrows the centre viewer automatically and narrowing it widens the viewer again, with the centre column held at or above a usable minimum. There is no overlap, no hidden controls, no broken handles and no negative width, and resizing never dirties the design or adds undo history.

- **The guide is the real profile pattern, and stays Studio-only** â€” the default guide is generated from `PROFILE_LAYOUT`, so there is one card per real profile module, positioned exactly where the viewer draws that module. Guide cards are placement markers only: they are excluded from `CONTENT_COMPONENT_TYPES` and `COMPONENT_SELECTORS`, so the public profile renderer and Preview both skip them, and they never reach Marketplace listings or installed assets. They remain real, editable components (select, move, resize, delete, "Reset Guide" restores the default set), and an intentionally deleted guide card is never recreated.

  - `npm run test:studio-media` runs the CREATOR-06/07/07A/07B/08/10 upload/nav/viewer suite (42 checks, including a guard that **every named import in `creatorStudio.js` resolves** â€” a named import used only inside a function body is a runtime `ReferenceError` that `node --check` and a bare `import()` both pass, so nothing else would catch it until a creator clicked the affected control; this caught a real bug where Reset referenced `DEFAULT_ZOOM` without importing it, so Reset silently did nothing. It also asserts the guide covers all 12 real profile sections, that Photo Gallery is a sidebar module with no main-column Gallery, and that Fit and re-centring stay viewer-only zoom/pan state)
  - `npm run test:studio-media-e2e` runs the headless-browser E2E (59 checks, including CREATOR-10: the real profile structure being drawn with main/sidebar and one independent card per sidebar module, the guide agreeing with it card-for-card, the background being uploaded through the real endpoint and sitting behind the whole profile while never becoming a component or a Layers row, save/reload/publish carrying it, an uploaded image being dragged, corner- and edge-resized with all eight handles while the picture itself resizes, the source resolution never changing, and both side panels resizing the viewer without touching the design. It also verifies **centering** in a real browser: the canvas is centered at 100%, stays centered through zooming out, zooming in, a large zoom, a small zoom, Fit and manual panning; Reset re-centers from a genuinely off-centre view; left-panel, right-panel, viewer-height and browser-window resizes all re-center the canvas; re-centering persists nothing, changes no design data and adds no undo history; and an image component's geometry and source are untouched by every one of them)
  - `node tests/test_creator10_profile_viewer.mjs` runs the CREATOR-10 suite (24 checks: the real profile layout geometry, independent sidebar cards, the absence of a main-column Gallery, guide/structure agreement, clientâ€“server section agreement, sidebar guide sections round-tripping, unknown sections still rejected, background persistence and strict URL/presentation validation, the background being design-level rather than a component, the published profile receiving it, the guide surviving a save/reload with deletions preserved, `fitZoom` clamping, zoom/pan independence from design coordinates, the image fit model surviving a free resize, and the centering arithmetic â€” `centeredPan` insetting a small canvas and showing the middle of a large one, a centered pan surviving `clampPan` unchanged, zoom re-centring by recomputation rather than by preserving the old pan, and no zoom level across the whole supported range anchoring the canvas to a corner)

  - `npm run test:creator10a` runs the CREATOR-10A suite (9 checks: the background still being design-level theme and never a component, the four explicit states, a staged upload being editor state rather than stored design data, the apply action only appearing when it would actually do something, the active state being reconstructed from the saved design, removal leaving no stale value, storage semantics being unchanged from CREATOR-10, the chip/preview/pending wiring, and applying or removing updating the panel immediately)
 - `npm run test:creator10b` runs the CREATOR-10B suite (20 checks: the three-tier stacking and the CREATOR-10 priority chain being intact, the profile resolving its own surfaces, transparency being the surface and never a parent `opacity`, a creator who asked for an opaque card still getting one, the softened state being opt-in and the blur scoped to the cards, the header staying transparent, and the duplicate module rules being gone) **plus a real browser** that sets an identifiable red background, screenshots the page, and reads the actual pixels back â€” asserting the picture is visible both around the cards and through them, that the cards stay readable over it, that the main profile and the five independent sidebar cards survive, that image + effect + cards keep the right stacking, and that mobile/laptop/tablet widths keep the layout intact
  - `npm run test:creator10b-studio` runs the CREATOR-10B Studio suite (22 checks in a real browser): with no background the canvas keeps its own surface exactly as before, and with one the background layer is part of the canvas and covers exactly the 960x1200 document, the canvas stops painting over it, the design canvas is still 960x1200, the background is not a component, and a sampled grid proves the profile structure is genuinely drawn over the background without burying it

  - `npm run test:studio-media` runs the CREATOR-06/07/07A/07B/08 upload/nav/viewer suite (42 checks: upload security + formats, uploaded-URL integration, back navigation, workspace column/height resize geometry and clamping, viewer height independence from the panels and the window, workspace wiring, non-edit behavior, removed-toolbar and removed-grip regressions, zoom step/clamp/reset arithmetic and the rule that the guide is absent from the public component types and selectors, a guard that **every named import in `creatorStudio.js` resolves**, studio layout, responsive rules and the panel/viewer decoupling rules)
  - `npm run test:studio-media-e2e` runs the headless-browser E2E (69 checks, including the CREATOR-10 centered canvas and the CREATOR-11 font/animation/masking flows end to end)
  - `npm run test:creator11` runs the CREATOR-11 suite (21 checks: font/animation/mask validation, registry agreement, backward compatibility, rendering and persistence)
  - `npm run test:creator13` runs the CREATOR-13 Live View suite (44 checks in a real browser): the Live View exists with a real rendering surface and names the effect and engine; the live stage VISIBLY moves (two screenshots separated by an interval must differ); Pause makes them identical and Play makes them move again; Restart reinitialises and changes nothing in the design model; reduced motion keeps the effect visible, static, and never reports ACTIVE; snow reads pale, leaves read green and are not white dots, petals read pink; repeated effect switching leaves exactly one live surface and one canvas-preview surface; and play, pause, restart and resizing the Live View leave the design JSON, every component's geometry, the viewer zoom and the canvas size byte-for-byte identical
  - `npm run test:creator10c` runs the CREATOR-10C suite (51 checks in a real browser): the background and the effect are both layers OF the 960x1200 canvas and cover it exactly, the background is ordered before the effect and the effect before the profile structure, the design canvas is still 960x1200, and the background is neither a component nor in Layers nor interactive. Playback is proven twice over — the frame counter must climb under `prefers-reduced-motion: no-preference`, stay put under `reduce` while the effect remains visible, and climb again once motion is allowed, with the Studio panel reporting the playing state to match — and then by pixels, because a climbing counter does not prove a creator can SEE anything move: two screenshots 600ms apart must differ measurably, snow must render pale, and leaves must render green with no white dots, so an effect cannot silently regress to a still frame or to a different effect in different clothing
  - `npm run test:creator10b-studio` runs the CREATOR-10B Studio suite (22 checks in a real browser): with no background the canvas keeps its own surface exactly as before, and with one the background layer is part of the canvas and covers exactly the 960x1200 document, the canvas stops painting over it, the design canvas is still 960x1200, the background is not a component, and a sampled grid proves the profile structure is genuinely drawn over the background without burying it

### CREATOR-10C â€” Studio background layering and effect playback

The Profile Background image and the Profile Background Effect are **layers of the 960Ã—1200 design canvas**, not a viewer-wide backdrop. A creator sees their picture as the profile's own bounded background, with the profile structure, guide cards and components drawn over it, and the plain studio surface around the canvas. Neither layer is a component: no geometry, no `data-comp-id`, `pointer-events: none`, absent from Layers, no resize handles.

```
inside the 960Ã—1200 canvas, lowest first
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  Profile Background image      (z 0)
  Profile Background Effect     (z 1)
  Profile skeleton / guide outlines
  Creator components
  selection handles
```

- **Why it lives in the canvas.** Painting it across the whole viewer instead â€” an earlier iteration â€” made the image read as *escaping* the canvas and smeared it under the studio chrome, so the profile structure and guide labels became far harder to read over a busy picture. Confining it to the design keeps the canvas a clearly-bounded, identifiable editing surface and the viewer around it plain. The canvas size, zoom, pan, centring (`centeredPan`/`recentreViewer`/`clampPan`) and saved coordinates are entirely untouched â€” only where the decoration is painted changed.
- **The canvas still stops painting over its own background.** With a background active the canvas drops its own light surface so the picture *is* the canvas background; with no background it keeps that surface, so a design without one looks exactly as it did. The skeleton and guide cards keep their low-fill treatment either way, so the background is readable *through* the profile structure without the compounded opaque wash returning.
- **Playback is proven, not assumed.** Two frames of falling snow can look near-identical, so screenshots are a poor proof of motion. The renderer publishes a **frame counter** beside `data-motion="animated" | "static"`, so a browser test watches real animation frames advance rather than inferring motion from pixels. A bare counter â€” no state, no positions, nothing about the user. Under `prefers-reduced-motion: no-preference` it climbs (~60fps); under `reduce` it stays put while the effect remains visible as a still frame, and it climbs again once the preference is lifted, with no reload. Every engine reports the same observable state, so nothing downstream has to care which one it is looking at.
- **The Studio tells the truth about playback.** The Properties panel shows `ANIMATED â€” playing on your profile` or `STATIC â€” REDUCED MOTION (your device asks for less motion)`, read from the renderer's live state. This has to be live: the renderer decides reduced motion *after* it has sized and attached its canvas, which is after the panel was built, so sampling the state once at render time reported the opposite answer and then stuck. The panel watches the effect layer and refreshes only when the motion state genuinely changes; the frame counter is deliberately excluded, so playback never re-renders the panel or steals focus mid-edit.
- **Each effect looks like itself, and moves visibly (CREATOR-10C)** — a rising frame counter proves the animation loop runs, but it proves nothing about whether a creator can *see* movement or recognise the effect. Two things were wrong and are now fixed and tested:
  - *Speed was imperceptible.* The per-frame step was scaled down so far that a default effect drifted only a few pixels per second — mathematically animating, visually a still frame. The step is now scaled so a default fall reads clearly as motion, while the delta clamp still stops a backgrounded tab teleporting every particle on return.
  - *Leaves and petals were drawn as white dots*, indistinguishable from snow. They now have their own elongated, rotated, mid-ribbed shape and their own fixed palette (green for leaves, pink for petals), never a user-supplied colour. Snow stays pale, so the effects are genuinely distinguishable.

  The browser test proves both by rendering and reading pixels back: two screenshots 600ms apart must differ by a meaningful number of pixels (**visible motion**, not just a counter), snow's particles must read pale, and leaves must read green with no white dots among them.
- **Unchanged:** the background remains design-level theme configuration (`backgroundImage`/`Size`/`Position`/`Repeat`); zoom, Fit, Reset, pan and centring are untouched; the CREATOR-10A background states, CREATOR-11 fonts/animation/masking and the CREATOR-12 effect registry and `.kpeffect` support are all unaffected.

### CREATOR-13 — Live Effect View and real motion preview

The Background Effect editor now contains a genuine **Live View**: the selected effect really renders in the Properties panel, on the same neutral dark stage, through the same engine the public profile uses. It is not a mock, not a Studio-only animation, and not another status string — the point is that a creator can *see* whether the effect renders, moves, and looks like itself before publishing.

```
Background Effect
Snow (Built-in)            Engine: particles
+----------------------------------------+
|            .      .                    |  <- real rendering
|                 .          .          |
|      .                  .             |
+----------------------------------------+
● LIVE            Motion: ACTIVE
[ Pause ] [ Restart ]
```

- **One engine, two independent surfaces.** The Live View and the design canvas preview call the *same* `applyProfileBackgroundEffect()` with the *same* validated effect definition. To make that possible the renderer's playback state is owned **per layer** rather than per module: it used to be a single module-level controller, which works for a public profile (one layer) but meant starting the Live View would have torn down the effect already playing on the canvas. Keyed by layer, both animate independently and stopping one never touches the other. The engines themselves are unchanged — this is ownership bookkeeping, not a second renderer.
- **Motion status is a fact about pixels.** A rising `requestAnimationFrame` counter only proves a loop is being called; an effect that runs a loop but never moves anything would still report ACTIVE, which is exactly the failure a creator cannot see. So a lightweight probe samples a **small fixed region** of the live surface on an interval and compares it with the previous sample. It is deliberately bounded — a fixed 48×48 region, interval sampling rather than per-frame, `willReadFrequently`, and a `stop()` that detaches the timer — so it never becomes a performance problem and never runs inside the draw loop. It reports:
  - `Motion: ACTIVE` — sampled pixels genuinely changed
  - `Motion: PAUSED` — playback was paused
  - `Motion: REDUCED MOTION` — the browser asks for less motion
  - `Motion: NO MOVEMENT DETECTED` — it has rendered and run, but nothing visibly changed after the observation window. This state exists precisely to catch an effect that runs a loop and visually fails.
- **Play/Pause really stops the loop.** Pause cancels the `requestAnimationFrame` outright rather than leaving it running and simply not drawing; Resume restarts it and resets the clock so the first frame after a pause does not jump by the whole paused duration. The effect definition, configuration and design are untouched — pausing is a preview operation, not an edit.
- **Restart reinitialises cleanly.** It stops this layer's renderer, rebuilds it from the same definition, and starts again. Configuration is preserved and the design is not marked dirty.
- **Reduced motion is honoured and reported.** The stage still renders a representative static frame, the badge reads `STATIC`, and the Motion line says `REDUCED MOTION` — never `ACTIVE`.
- **Effect identity is shown.** The effect name (including a creator-defined `.kpeffect` name from its validated manifest) and its engine, read from the already-validated effect representation. No package metadata is injected as markup.
- **The effect is never a component.** It has no `data-comp-id`, no X/Y/W/H, no rotation, no z-index entry, no resize handles, and never appears in Layers.
- **The design model is never mutated.** Play, pause, restart, effect switching and resizing the Live View leave `layout.components[]`, the canvas size, viewer zoom and viewer pan byte-for-byte identical. A test captures the design JSON and every component's geometry before and after and compares them.

  The browser suite asserts on rendered pixels throughout: the live stage is screenshotted twice with a gap and the two must differ (motion is real), must be **identical** while paused (pause really stops it), and must be identical under reduced motion. Effects are told apart by counting pixels that match each effect's own colour family — snow pale, leaves green with no white dots, petals pink — rather than by averaging colours, which a mostly anti-aliased sprite turns grey regardless of its real colour. Repeated `Snow → Leaves → Petals → Snow → Leaves` switching is verified to leave exactly **one** live surface and **one** canvas-preview surface, so no animation loop is left accumulating.

### CREATOR-14 — Creator Studio Project Manager

Creator Studio gains a **Project Manager**: the entry point where a creator sees every project they own, opens one to edit it, and manages its lifecycle. The key architectural decision is that **a Creator Studio project IS a `profile_designs` row** — there is no parallel `creator_projects` table. The project manager is a lifecycle and navigation layer on top of the existing design table, so a project and a design are the same thing and no data is duplicated or migrated.

```
#/creator-studio/projects
+----------------------------------------+
|  <- Return to profile                  |
|  CREATOR STUDIO                        |
|  Projects                              |
|  [ New Project ]                       |
|  +----------+  +----------+            |
|  | thumb    |  | thumb    |  ...       |
|  | Draft    |  | Published|            |
|  | My Design|  | v3  2h   |            |
|  | [Open]   |  | [Open]   |            |
|  | [Rename] |  | [Rename] |            |
|  | [Dup]    |  | [Dup]    |            |
|  | [Archive]|  | [Archive]|            |
|  +----------+  +----------+            |
|  Archived Projects                     |
|  +----------+                          |
|  | Archived | [Restore] [Delete]      |
|  +----------+                          |
+----------------------------------------+
```

- **A project is a design.** Every project is a `profile_designs` row with the existing `layout_config` / `theme_config`. The project manager adds project metadata to that row — `description`, `thumbnail_url`, `archived_at`, `deleted_at` — and a lifecycle (`draft` / `published` / `archived`) on the existing `status` column. Designs created before CREATOR-14 simply have empty project metadata and behave exactly as before.
- **Lifecycle.** Create -> rename -> duplicate -> archive -> restore -> delete. **Delete is a soft delete** (`deleted_at`) and is only allowed on **archived** projects, so an active project can never be destroyed by accident — it must be archived first. Archive sets `status = 'archived'` and `archived_at`; restore returns it to `draft` and clears `archived_at`.
- **Ownership is absolute.** Every query is scoped by the authenticated user (`user.sub`). A second user never sees, opens, renames, duplicates, archives, restores or deletes another user's project — they get **404, not 403**, so project ids are not leaked. Unauthenticated requests are 401.
- **Duplicate is a deep clone.** The copy gets a new id, a new name (`<name> Copy`, with a uniqueness fallback), `version` reset to 1, `status` reset to `draft`, and a deep-cloned `layout_config` / `theme_config` — mutating the copy never touches the original.
- **Opening a project.** "Open" navigates to `#/creator-studio?project=<id>`. The Studio reads the `project` query parameter and loads that exact project instead of the first draft. The header shows **"Project: <name>"** so the creator always knows which project is open. Switching projects (via the design selector or "New Design") tears down the CREATOR-13 Live View, clears selection, undo/redo history, staged uploads and dirty state, so no animation loop, probe or timer from the previous project survives.
- **Validation.** Project name is required, non-empty, at most 100 characters, and rejected if it contains markup tags (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`). Description is optional and at most 500 characters. The stored layout is re-validated on read so stored data cannot break the Studio.
- **Version history is future work.** The `version` column already exists and increments on publish, but a full version-history browser is CREATOR-15+ work and is explicitly out of scope here.

  - `npm run test:creator14` runs the CREATOR-14 suite (23 checks: create with a valid default layout and draft status, name/description/markup/length validation, authentication required, list ordering and per-user isolation, get by id, cross-user 404 on get/rename/duplicate/archive/restore/delete, rename persisting to the database, duplicate producing an independent deep clone, archive/restore round-trip with `archived_at` set and cleared, delete only on archived projects (soft delete, hidden from list and get), active-project delete rejected, and database persistence of name/description/status/layout)

### CREATOR-11 â€” Fonts, animation, and Card / Image / Sticker masking

CREATOR-11 extends the validated design model. The same stored properties drive the Creator Studio canvas, the saved draft, the published design and the public profile renderer â€” there is no Studio-only typography or animation system, and no second public renderer.

**Fonts.** Text gained `fontFamily` and `fontStyle`. A design stores a **font id**, never a CSS `font-family` string: a raw string is a CSS-injection surface (`Georgia; background: url(...)`), and letting one reach `style.fontFamily` would defeat every other check in the validator. Each id maps to an application-owned CSS stack declared once in `web/js/profileDesign.js` and reused by both the Studio preview and the public renderer, so a saved design looks identical in both. The registry is 14 ids â€” the classic web-safe faces plus the CSS generic families (`system-ui`, `sans-serif`, `serif`, `monospace`), which are how a design stays legible on a device that lacks a named face. `fontStyle` is a controlled allowlist (`normal`, `italic`); there is no free-text style field. Both registries are asserted identical on client and server.

**Animation.** Animation is a real, validated design property with five explicit fields â€” `name`, `duration`, `delay`, `iteration`, `timing` â€” and is available on Text, Image, Sticker and Card. The name maps to an application-owned `@keyframes` rule (`komuniph-anim-*`); only the four bounded numbers come from the design, so there is no code path by which a stored value becomes a keyframes name or a CSS shorthand. The 13 supported effects are `none`, `fade`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `zoom-in`, `zoom-out`, `bounce`, `pulse`, `float`, `shake` and `swing`. Duration is bounded to 0.1â€“20s, delay to 0â€“60s, and iteration to an integer in 1â€“1000 or the exact string `infinite` â€” which is why the Studio's Repeat control is a dedicated field that translates its friendly labels ("2Ã—", "Infinite") into the model's real integer/`infinite` value. A controlled profile module (bio, gallery, â€¦) is **not** animatable in this milestone and the server rejects an `animation` on one, so a design cannot store a setting that would silently never play. Animation is presentation only: it never writes `x`, `y`, `width`, `height`, `rotation` or `zIndex`, and the Studio applies it after the element is built so a running animation cannot disturb geometry measurement.

**Reduced motion.** When `prefers-reduced-motion: reduce` is set, animations are switched off **at the rendering layer only**. The stored design is untouched, so switching the preference back off restores the animation â€” no design data is changed, downgraded or removed on the user's behalf. (Headless Chrome reports this preference by default, which is why the E2E sets it explicitly for each case rather than relying on the browser default.)

**Card as a real container.** `layout.components[]` is preserved; a child simply references its card through a controlled `parentId`, and its `x`/`y` become **local** coordinates measured from the card's top-left. The supported shape is exactly one level deep: `Card â†’ Image | Sticker`.

- **The relationship is in the model, not a CSS trick.** The child element is physically mounted inside the card's `.design-card-surface`, so clipping follows from the structure. The clip lives on that *surface* rather than on the card box because a component's resize handles sit 6px outside its own box â€” clipping the card directly would make its own handles unreachable. This is the same reason an image clips in `.design-image-inner`.
- **Content Mask** is a boolean `config.mask`, never a CSS clip value. On, the surface clips the children to the card; off, the relationship still exists but nothing is clipped. Because the surface inherits the card's own `border-radius`, a rounded card produces a rounded mask for free â€” 0px, small and large radii all work.
- **Masking is non-destructive.** The child keeps its original `imageUrl`; the mask is CSS clipping, never a re-render, a screenshot or a re-encoded bitmap. `cover` / `contain` / `fill` all keep working inside the mask.
- **Deterministic rules.** Resizing a **card** preserves the child's local coordinates unchanged and only changes the clip region â€” a child keeps its offset and size relative to the card, and resizing either never changes the image source. Moving a card moves its children visually (the child is not touched at all). Dragging or resizing a child is clamped to the **card**, not the canvas, and does not move the parent. Deleting a card **cascades** to its children: a surviving child would keep a dangling `parentId` that the server rejects, which would turn a valid design into one that cannot be saved. Because that is a single deterministic edit to the layout array, undo, redo, save and publish all agree.
- **Server-side relationships.** The server is the final authority: the parent must exist, must be a card, the child type must be `image` or `sticker`, a card may not itself be a child (so recursive nesting is impossible), and an explicit walk rejects circular chains and over-deep chains. Clients are not trusted on any of this.
- **Selection and Layers.** Clicking a child selects the child; the Layers panel shows the hierarchy with children indented under their card (never flattened), and Layers selection remains the way to pick a parent when children overlap. Move, visibility, selection and delete all still work on both levels.

**Backward compatibility.** Existing `text` / `image` / `card` / `sticker` designs with none of these fields are untouched and still save and publish. `fontFamily` falls back to the platform default at render time, `fontStyle` to `normal`, animation to none, and a component with no `parentId` to a top-level one. No migration is performed and no existing design is invalidated.

**Creator Studio vs public rendering.** The Studio adds only editing affordances on top of the same model: the Font/Style/Animation/Content Mask/Container controls, a nested-child marker in Layers, and a dashed outline on a selected masked card. The Studio-only profile structure and guide cards remain Studio-only and never reach a public profile, a published design or a Marketplace listing.

  - `npm run test:creator11` runs the CREATOR-11 suite (21 checks: every allowlisted font accepted, hostile and CSS-injection font strings rejected, `fontStyle` allowlist, pre-CREATOR-11 designs still loading with a safe default font, client/server font-stack agreement, every animation accepted for all four component types, invalid animation names/timings/durations/delays/iterations rejected, animation never becoming a raw CSS name, animation never mutating geometry, reduced motion leaving the design intact, cardâ†’image and cardâ†’sticker accepted, invalid and circular relationships rejected, `mask` as a boolean, masking never changing the image source, all three fit modes inside a mask, save/reload/publish preserving the relationship, and registry agreement)

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

Coin economy suite (COINS-01) â€” self-contained (temp DB, runs offline):

```bash
npm run test:coins
```

Coin gifting suite (COINS-02) â€” self-contained (temp DB, runs offline):

```bash
npm run test:coin-gift
```

Locked reward accounting suite (COINS-02A) â€” self-contained (temp DB, runs offline):

```bash
npm run test:coin-rewards
```

Profile design engine suite (CREATOR-01A) â€” self-contained (temp DB, runs offline):

```bash
npm run test:creator
```

Creator Studio integration suite (CREATOR-01B) â€” self-contained (temp DB, runs offline):

```bash
npm run test:studio
```

Creator Asset foundation suite (CREATOR-02A) â€” self-contained (temp DB, runs offline):

```bash
npm run test:assets
```

Marketplace & Coin Shop suite (CREATOR-03) â€” self-contained (temp DB, runs offline):

```bash
npm run test:marketplace
```

Marketplace seller-management suite (CREATOR-04) â€” self-contained (temp DB, runs offline):

```bash
npm run test:marketplace-manage
```

Coin Shop buyer-library suite (CREATOR-04) â€” self-contained (temp DB, runs offline):

```bash
npm run test:coin-library
```

Marketplace Seller Center suite (CREATOR-05) â€” self-contained (temp DB, runs offline):

```bash
npm run test:seller-center
```

Creator Studio Coin Shop Manager suite (CREATOR-05) â€” self-contained (temp DB, runs offline):

```bash
npm run test:coin-shop-manager
```

Creator Studio Project Manager suite (CREATOR-14) — self-contained (temp DB, runs offline):

```bash
npm run test:creator14
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
`requireAdmin` checks â€” no bypass, backdoor, or hardcoded credentials. It is a
no-op in production unless you explicitly enable it. This account was used to
verify the admin-gated endpoints during local testing.

