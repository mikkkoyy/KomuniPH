/**
 * KomuniPH Lite - Marketplace Foundation (CREATOR-03)
 *
 * Server-side handlers for:
 *   - Normal Marketplace listings (products, services, digital, local)
 *   - Creator Coin Shop (published creator asset discovery + Buy)
 *   - Purchased asset ownership tracking
 *
 * Security:
 *   - Ownership always derived from authenticated user (user.sub)
 *   - Cross-user reads return 404 (ownership intentionally hidden)
 *   - Unauthenticated protected routes return 401
 *   - Published-only public visibility
 *   - Draft/archived never exposed publicly
 *   - Atomic coin operations for Coin Shop purchases
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { jsonResponse, errorResponse, generateId, now, parseBody } from './utils.js';
import { requireAuth } from './auth.js';
import { serializeAssetRow } from './creatorAssets.js';
import { validateDesignPayload, HTTP_URL_RE, DANGEROUS_CONFIG_RE } from './profileDesign.js';

const ASSET_SELECT = `
  SELECT id, creator_user_id, name, description, asset_type, status, version,
         preview_data, asset_data, price_coins, source_design_id,
         published_at, archived_at, created_at, updated_at
  FROM creator_assets`;

// ─── Normal Marketplace ────────────────────────────────────────────────

const LISTING_SELECT = `
  SELECT ml.id, ml.seller_user_id, ml.title, ml.description, ml.category, ml.price_display,
         ml.images, ml.external_url, ml.contact_info, ml.status, ml.created_at, ml.updated_at,
         ml.published_at, ml.archived_at,
         u.username AS seller_username, p.display_name AS seller_display_name,
         p.profile_photo_url AS seller_avatar
  FROM marketplace_listings ml
  JOIN users u ON u.id = ml.seller_user_id
  LEFT JOIN profiles p ON p.user_id = ml.seller_user_id`;

function validateListingPayload(body, { partial = false } = {}) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be a JSON object'], data: null };
  }
  const data = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) {
      errors.push('Title must be a non-empty string of at most 200 characters');
    } else {
      data.title = body.title.trim();
    }
  } else if (!partial) {
    errors.push('Title is required');
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 5000) {
      errors.push('Description must be at most 5000 characters');
    } else {
      data.description = body.description;
    }
  } else if (!partial) {
    data.description = '';
  }

  if (body.category !== undefined) {
    const validCategories = new Set(['products', 'services', 'digital', 'local', 'all']);
    if (!validCategories.has(body.category)) {
      errors.push(`Invalid category: ${body.category}`);
    } else {
      data.category = body.category;
    }
  } else if (!partial) {
    errors.push('Category is required');
  }

  if (body.price_display !== undefined) {
    if (typeof body.price_display !== 'string' || !body.price_display.trim()) {
      errors.push('price_display must be a non-empty string');
    } else if (body.price_display.trim().length > 50) {
      errors.push('price_display must be at most 50 characters');
    } else {
      data.price_display = body.price_display.trim();
    }
  } else if (!partial) {
    data.price_display = '0';
  }

  if (body.images !== undefined) {
    if (!Array.isArray(body.images)) {
      errors.push('images must be an array');
    } else if (body.images.length > 10) {
      errors.push('Maximum 10 images');
    } else {
      const bad = body.images.find(img =>
        typeof img !== 'string' || !img.trim() || img.trim().length > 500 || !HTTP_URL_RE.test(img.trim())
      );
      if (bad !== undefined) {
        errors.push('Each image must be an http(s) URL of at most 500 characters');
      } else {
        data.images = body.images.map(img => img.trim());
      }
    }
  } else if (!partial) {
    data.images = [];
  }

  // CREATOR-04: external sales/contact destination. Optional. URLs must be
  // http(s) — dangerous schemes (javascript:, data:, …) are rejected.
  // No payment is processed; this is a discovery pointer only.
  if (body.external_url !== undefined) {
    if (body.external_url === null || body.external_url === '') {
      data.external_url = null;
    } else if (typeof body.external_url !== 'string' || !HTTP_URL_RE.test(body.external_url.trim()) || body.external_url.trim().length > 500) {
      errors.push('external_url must be an http(s) URL of at most 500 characters');
    } else {
      data.external_url = body.external_url.trim();
    }
  } else if (!partial) {
    data.external_url = null;
  }

  if (body.contact_info !== undefined) {
    if (body.contact_info === null || body.contact_info === '') {
      data.contact_info = null;
    } else if (typeof body.contact_info !== 'string' || body.contact_info.trim().length > 500) {
      errors.push('contact_info must be a string of at most 500 characters');
    } else if (DANGEROUS_CONFIG_RE.test(body.contact_info)) {
      errors.push('contact_info must not contain markup tags');
    } else {
      data.contact_info = body.contact_info.trim();
    }
  } else if (!partial) {
    data.contact_info = null;
  }

  return { errors, data };
}

function findPublishedListing(id) {
  return queryOne(`${LISTING_SELECT} WHERE ml.id = ? AND ml.status = 'published'`, [id]);
}

function findOwnedListing(id, userId) {
  return queryOne(`${LISTING_SELECT} WHERE ml.id = ? AND ml.seller_user_id = ?`, [id, userId]);
}

function serializeListingRow(row) {
  if (!row) return null;
  try {
    const images = row.images ? JSON.parse(row.images) : [];
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      category: row.category,
      price_display: row.price_display,
      images: images,
      external_url: row.external_url || null,
      contact_info: row.contact_info || null,
      status: row.status,
      seller_user_id: row.seller_user_id,
      seller_username: row.seller_username || null,
      seller_display_name: row.seller_display_name || row.seller_username || null,
      seller_avatar: row.seller_avatar || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      published_at: row.published_at,
      archived_at: row.archived_at,
    };
  } catch {
    return null;
  }
}

/**
 * Serialize a creator asset row for public Coin Shop responses.
 * Attaches creator identity (user id + public profile fields) so cards
 * can link Visit Profile / Message Creator to the real KomuniPH profile.
 */
function serializePublicAsset(row) {
  const base = serializeAssetRow(row);
  if (!base) return null;
  return {
    ...base,
    creator_user_id: row.creator_user_id,
    creator_username: row.creator_username || null,
    creator_display_name: row.creator_display_name || row.creator_username || null,
    creator_avatar: row.creator_avatar || null,
  };
}

const ASSET_PUBLIC_SELECT = `
  SELECT ca.id, ca.creator_user_id, ca.name, ca.description, ca.asset_type, ca.status, ca.version,
         ca.preview_data, ca.asset_data, ca.price_coins, ca.source_design_id,
         ca.published_at, ca.archived_at, ca.created_at, ca.updated_at,
         u.username AS creator_username, p.display_name AS creator_display_name,
         p.profile_photo_url AS creator_avatar
  FROM creator_assets ca
  JOIN users u ON u.id = ca.creator_user_id
  LEFT JOIN profiles p ON p.user_id = ca.creator_user_id`;

// ─── Normal Marketplace Handlers ──────────────────────────────────────

export async function handleListMarketplaceListings(req, res, user) {
  try {
    const url = req.url || '';
    const queryString = url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    const page = Math.max(1, parseInt(params.get('page') || '1', 10));
    const limit = Math.min(Math.max(1, parseInt(params.get('limit') || '20', 10)), 50);
    const search = params.get('search') || '';
    const category = params.get('category') || '';

    let where = "WHERE status = 'published'";
    let paramsList = [];

    if (category && category !== 'all') {
      where += ' AND category = ?';
      paramsList.push(category);
    }
    if (search && search.length > 0) {
      where += ' AND (title LIKE ? OR description LIKE ?)';
      const sp = `%${search}%`;
      paramsList.push(sp, sp);
    }

    const totalResult = queryOne(
      `SELECT COUNT(*) AS c FROM marketplace_listings ${where}`,
      paramsList
    );
    const total = totalResult ? Math.max(0, totalResult.c) : 0;
    const offset = (page - 1) * limit;

    const rows = queryAll(
      `${LISTING_SELECT} ${where} ORDER BY ml.created_at DESC LIMIT ? OFFSET ?`,
      [...paramsList, limit, offset]
    );

    const listings = rows.map(serializeListingRow).filter(Boolean);

    jsonResponse(res, 200, {
      listings,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: total > page * limit,
      search,
      category,
    });
  } catch (err) {
    console.error('[MARKETPLACE] List listings error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleCreateListing(req, res, user) {
  try {
    const body = await parseBody(req);
    const { errors, data } = validateListingPayload(body);
    if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));

    const id = generateId();
    const ts = now();
    execute(
      `INSERT INTO marketplace_listings
        (id, seller_user_id, title, description, category, price_display, images, external_url, contact_info, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [id, user.sub, data.title, data.description, data.category, data.price_display,
       JSON.stringify(data.images), data.external_url, data.contact_info, ts, ts]
    );

    const listing = findOwnedListing(id, user.sub);
    jsonResponse(res, 201, { listing: serializeListingRow(listing) });
  } catch (err) {
    console.error('[MARKETPLACE] Create listing error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleGetListing(req, res, user, params) {
  try {
    const listing = findPublishedListing(params.id);
    if (!listing) return errorResponse(res, 404, 'Listing not found');
    jsonResponse(res, 200, { listing: serializeListingRow(listing) });
  } catch (err) {
    console.error('[MARKETPLACE] Get listing error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleUpdateListing(req, res, user, params) {
  try {
    const existing = findOwnedListing(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Listing not found');
    if (existing.status !== 'draft') return errorResponse(res, 409, 'Only draft listings can be edited');

    const body = await parseBody(req);
    const { errors, data } = validateListingPayload(body, { partial: true });
    if (errors.length > 0) return errorResponse(res, 400, errors.join('; '));
    if (Object.keys(data).length === 0) return errorResponse(res, 400, 'Nothing to update');

    const ts = now();
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(data)) {
      if (key === 'images') {
        fields.push('images = ?');
        values.push(JSON.stringify(val));
      } else {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }
    fields.push('updated_at = ?');
    values.push(ts);
    values.push(params.id, user.sub);

    execute(
      `UPDATE marketplace_listings SET ${fields.join(', ')} WHERE id = ? AND seller_user_id = ?`,
      values
    );

    const updated = findOwnedListing(params.id, user.sub);
    jsonResponse(res, 200, { listing: serializeListingRow(updated) });
  } catch (err) {
    console.error('[MARKETPLACE] Update listing error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handlePublishListing(req, res, user, params) {
  try {
    const existing = findOwnedListing(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Listing not found');
    // CREATOR-04: publish from draft, or re-publish (restore) from archived.
    // Published listings stay published (409) — no silent data rewrite.
    if (existing.status !== 'draft' && existing.status !== 'archived') {
      return errorResponse(res, 409, 'Only draft or archived listings can be published');
    }

    const ts = now();
    execute(
      `UPDATE marketplace_listings SET status = 'published', published_at = ?, archived_at = NULL, updated_at = ? WHERE id = ? AND seller_user_id = ?`,
      [ts, ts, params.id, user.sub]
    );

    const updated = findOwnedListing(params.id, user.sub);
    jsonResponse(res, 200, { listing: serializeListingRow(updated) });
  } catch (err) {
    console.error('[MARKETPLACE] Publish listing error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/marketplace/listings/:id/archive — owner archives a draft or
 * published listing. Archived listings are never publicly visible.
 * Idempotent: archiving an archived listing returns it unchanged.
 */
export async function handleArchiveListing(req, res, user, params) {
  try {
    const existing = findOwnedListing(params.id, user.sub);
    if (!existing) return errorResponse(res, 404, 'Listing not found');

    if (existing.status === 'archived') {
      return jsonResponse(res, 200, { listing: serializeListingRow(existing) });
    }

    const ts = now();
    execute(
      `UPDATE marketplace_listings SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ? AND seller_user_id = ?`,
      [ts, ts, params.id, user.sub]
    );

    const updated = findOwnedListing(params.id, user.sub);
    jsonResponse(res, 200, { listing: serializeListingRow(updated) });
  } catch (err) {
    console.error('[MARKETPLACE] Archive listing error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/marketplace/my-listings — seller dashboard source. Returns the
 * authenticated seller's listings (all statuses) plus global per-status
 * counts. Supports server-authoritative ?search= (title), ?status=
 * (draft|published|archived), ?category=, and ?sort=
 * (newest|oldest|title). Counts always reflect the full inventory, not the
 * filtered view. Ownership comes from user.sub only.
 */
export async function handleListOwnListings(req, res, user) {
  try {
    const url = req.url || '';
    const queryString = url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    const search = params.get('search') || '';
    const status = params.get('status') || '';
    const category = params.get('category') || '';
    const sort = params.get('sort') || 'newest';

    const allRows = queryAll(
      `${LISTING_SELECT} WHERE ml.seller_user_id = ? ORDER BY ml.updated_at DESC`,
      [user.sub]
    );
    const all = allRows.map(serializeListingRow).filter(Boolean);
    const counts = { total: all.length, draft: 0, published: 0, archived: 0 };
    for (const l of all) {
      if (l.status === 'draft') counts.draft += 1;
      else if (l.status === 'published') counts.published += 1;
      else if (l.status === 'archived') counts.archived += 1;
    }

    let listings = all;
    if (status && ['draft', 'published', 'archived'].includes(status)) {
      listings = listings.filter(l => l.status === status);
    }
    if (category && category !== 'all') {
      listings = listings.filter(l => l.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      listings = listings.filter(l =>
        (l.title || '').toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q)
      );
    }
    if (sort === 'oldest') {
      listings = [...listings].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    } else if (sort === 'title') {
      listings = [...listings].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    } else {
      listings = [...listings].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }

    jsonResponse(res, 200, { listings, counts, search, status, category, sort });
  } catch (err) {
    console.error('[MARKETPLACE] List own listings error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/creator/assets/sales — real purchase statistics for the
 * authenticated creator's own assets. Source of truth is purchased_assets;
 * only genuinely recorded purchases are counted. No revenue is fabricated:
 * earned_coins is the sum of actual purchase prices.
 */
export async function handleCreatorSalesSummary(req, res, user) {
  try {
    const rows = queryAll(
      `SELECT ca.id AS asset_id, ca.name AS asset_name, ca.asset_type, ca.status, ca.price_coins,
              COUNT(pa.id) AS sales, COALESCE(SUM(pa.price_coins), 0) AS earned_coins
       FROM creator_assets ca
       LEFT JOIN purchased_assets pa ON pa.asset_id = ca.id
       WHERE ca.creator_user_id = ?
       GROUP BY ca.id
       ORDER BY sales DESC, ca.created_at DESC`,
      [user.sub]
    );
    const assets = rows.map(r => ({
      asset_id: r.asset_id,
      asset_name: r.asset_name,
      asset_type: r.asset_type,
      status: r.status,
      price_coins: Number(r.price_coins) || 0,
      sales: Number(r.sales) || 0,
      earned_coins: Number(r.earned_coins) || 0,
    }));
    const totals = {
      assets: assets.length,
      sales: assets.reduce((n, a) => n + a.sales, 0),
      earned_coins: assets.reduce((n, a) => n + a.earned_coins, 0),
    };
    jsonResponse(res, 200, { assets, totals });
  } catch (err) {
    console.error('[COINSHOP] Sales summary error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

// ─── Coin Shop ─────────────────────────────────────────────────────────

/**
 * Get a single published creator asset for the Coin Shop.
 * Reuses the existing creator_assets table as the product source.
 */
export async function handleGetCoinShopProduct(req, res, user, params) {
  try {
    const asset = queryOne(
      `${ASSET_PUBLIC_SELECT} WHERE ca.id = ? AND ca.status = 'published'`,
      [params.id]
    );
    if (!asset) return errorResponse(res, 404, 'Product not found');
    jsonResponse(res, 200, { product: serializePublicAsset(asset) });
  } catch (err) {
    console.error('[COINSHOP] Get product error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Buy a creator asset from the Coin Shop.
 * Atomic wallet/ledger operation with duplicate-purchase protection.
 */
export async function handleBuyAsset(req, res, user, params) {
  try {
    const buyerId = user.sub;
    const assetId = params.id;

    // Find the published asset
    const asset = queryOne(
      `SELECT id, creator_user_id, name, price_coins, status, asset_data
       FROM creator_assets WHERE id = ? AND status = 'published'`,
      [assetId]
    );
    if (!asset) return errorResponse(res, 404, 'Product not found');

    // Buyer cannot purchase their own asset
    if (asset.creator_user_id === buyerId) {
      return errorResponse(res, 403, 'Cannot purchase your own asset');
    }

    // Check if already purchased (idempotent)
    const existingPurchase = queryOne(
      'SELECT id FROM purchased_assets WHERE buyer_user_id = ? AND asset_id = ?',
      [buyerId, assetId]
    );
    if (existingPurchase) {
      return errorResponse(res, 409, 'Already purchased');
    }

    const price = Number(asset.price_coins);
    if (price <= 0) {
      return errorResponse(res, 400, 'This asset is not for sale');
    }

    // Atomic wallet check and coin movement
    const result = transaction(() => {
      // Get buyer wallet (missing wallet = 0 balance = insufficient)
      let wallet = queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [buyerId]);
      if (!wallet) {
        execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [buyerId]);
        wallet = { balance: 0 };
      }
      if (wallet.balance < price) {
        throw new Error('Insufficient coins');
      }

      // Get seller wallet (ensure it exists)
      let sellerWallet = queryOne('SELECT user_id FROM user_wallets WHERE user_id = ?', [asset.creator_user_id]);
      if (!sellerWallet) {
        execute('INSERT INTO user_wallets (user_id, balance, frozen_balance) VALUES (?, 0, 0)', [asset.creator_user_id]);
      }

      const ts = now();
      const purchaseId = generateId();

      // Debit buyer
      execute(
        'UPDATE user_wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ?',
        [price, ts, buyerId]
      );
      execute(
        'INSERT INTO coin_transactions (id, user_id, amount, direction, type, reference_type, reference_id, description, balance_before, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [generateId(), buyerId, price, 'debit', 'spend', 'purchased_asset', purchaseId,
         `Purchased ${asset.name}`, wallet.balance, wallet.balance - price, ts]
      );

      // Credit seller (creator_payout)
      const sellerBalance = queryOne('SELECT balance FROM user_wallets WHERE user_id = ?', [asset.creator_user_id]);
      execute(
        'UPDATE user_wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?',
        [price, ts, asset.creator_user_id]
      );
      execute(
        'INSERT INTO coin_transactions (id, user_id, amount, direction, type, reference_type, reference_id, description, balance_before, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [generateId(), asset.creator_user_id, price, 'credit', 'creator_payout', 'purchased_asset', purchaseId,
         `Sale of ${asset.name}`, sellerBalance.balance, sellerBalance.balance + price, ts]
      );

      // Record purchase
      execute(
        'INSERT INTO purchased_assets (id, buyer_user_id, asset_id, price_coins, purchased_at) VALUES (?, ?, ?, ?, ?)',
        [purchaseId, buyerId, assetId, price, ts]
      );

      return { purchaseId, price };
    });

    jsonResponse(res, 200, {
      purchase: {
        id: result.purchaseId,
        asset_id: assetId,
        asset_name: asset.name,
        price_coins: result.price,
        purchased_at: now(),
      }
    });
  } catch (err) {
    if (err.message === 'Insufficient coins') {
      return errorResponse(res, 402, 'Insufficient coins');
    }
    if (err.message === 'Already purchased') {
      return errorResponse(res, 409, 'Already purchased');
    }
    console.error('[COINSHOP] Buy asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * List assets purchased by the authenticated buyer.
 */
export async function handleListPurchasedAssets(req, res, user) {
  try {
    const rows = queryAll(
      `SELECT pa.id, pa.asset_id, pa.price_coins, pa.purchased_at, ca.name, ca.asset_type, ca.preview_data
       FROM purchased_assets pa
       JOIN creator_assets ca ON pa.asset_id = ca.id
       WHERE pa.buyer_user_id = ?
       ORDER BY pa.purchased_at DESC`,
      [user.sub]
    );

    const purchases = rows.map(row => {
      let previewData = null;
      try { previewData = JSON.parse(row.preview_data || '{}'); } catch { previewData = null; }
      return {
        id: row.id,
        asset_id: row.asset_id,
        asset_name: row.name,
        asset_type: row.asset_type,
        price_coins: row.price_coins,
        purchased_at: row.purchased_at,
        preview_data: previewData,
      };
    });

    jsonResponse(res, 200, { purchases });
  } catch (err) {
    console.error('[COINSHOP] List purchased error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * Check if buyer has already purchased a specific asset.
 */
export async function handleCheckPurchased(req, res, user, params) {
  try {
    const purchase = queryOne(
      'SELECT id FROM purchased_assets WHERE buyer_user_id = ? AND asset_id = ?',
      [user.sub, params.id]
    );
    jsonResponse(res, 200, { purchased: !!purchase });
  } catch (err) {
    console.error('[COINSHOP] Check purchased error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/coin-shop/install/:id — install a PURCHASED creator asset into
 * the buyer's own profile-design state.
 *
 * CREATOR-04 boundary: only `profile_design` assets are installable, because
 * only that type has a complete buyer-side contract (a buyer-owned draft
 * design created through the existing validated design validator). The
 * creator snapshot is never modified; the buyer publishes via the existing
 * profile-design API. theme/background/sticker/decoration return 422 with a
 * clear not-installable message — no fabricated behavior.
 *
 * Security: purchase ownership comes from user.sub; the asset row must exist
 * and its immutable snapshot must re-validate. No ownership transfer via
 * request parameters is possible.
 */
export async function handleInstallAsset(req, res, user, params) {
  try {
    const buyerId = user.sub;
    const assetId = params.id;

    const purchase = queryOne(
      'SELECT id FROM purchased_assets WHERE buyer_user_id = ? AND asset_id = ?',
      [buyerId, assetId]
    );
    if (!purchase) return errorResponse(res, 403, 'Asset not purchased by you');

    const asset = queryOne(
      'SELECT id, creator_user_id, name, asset_type, status, asset_data FROM creator_assets WHERE id = ?',
      [assetId]
    );
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    if (asset.status !== 'published' && asset.status !== 'archived') {
      return errorResponse(res, 404, 'Asset is not available');
    }
    if (asset.asset_type !== 'profile_design') {
      return errorResponse(res, 422, `Asset type "${asset.asset_type}" cannot be installed yet`);
    }

    let snapshot = null;
    try {
      snapshot = JSON.parse(asset.asset_data || '{}');
    } catch {
      return errorResponse(res, 422, 'Asset snapshot is invalid');
    }

    const { errors, data } = validateDesignPayload(
      { name: asset.name, layout: snapshot.layout, theme: snapshot.theme },
      { partial: false }
    );
    if (errors.length > 0) return errorResponse(res, 422, errors.join('; '));

    const id = generateId();
    const ts = now();
    const designName = `Installed: ${asset.name}`.slice(0, 100);
    execute(
      `INSERT INTO profile_designs (id, user_id, name, status, version, layout_config, theme_config, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 1, ?, ?, ?, ?)`,
      [id, buyerId, designName, JSON.stringify(data.layout), data.theme ? JSON.stringify(data.theme) : null, ts, ts]
    );

    const created = queryOne('SELECT * FROM profile_designs WHERE id = ? AND user_id = ?', [id, buyerId]);
    let layout = null;
    let theme = null;
    try { layout = JSON.parse(created.layout_config || '{}'); } catch { layout = null; }
    try { theme = created.theme_config ? JSON.parse(created.theme_config) : null; } catch { theme = null; }
    jsonResponse(res, 201, {
      design: {
        id: created.id, name: created.name, status: created.status, version: 1,
        layout, theme, created_at: created.created_at, updated_at: created.updated_at,
      },
      asset_id: assetId,
    });
  } catch (err) {
    console.error('[COINSHOP] Install asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

// ─── Coin Shop Discovery (published creator_assets) ────────────────────
// Kept for backward compatibility with /api/marketplace/assets routes.
// Only status='published' assets are visible. Draft/submitted/archived/
// rejected are never exposed.

export async function handleListMarketplaceAssets(req, res, user) {
  try {
    const url = req.url || '';
    const queryString = url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    const page = Math.max(1, parseInt(params.get('page') || '1', 10));
    const limit = Math.min(Math.max(1, parseInt(params.get('limit') || '20', 10)), 50);
    const search = params.get('search') || '';
    const category = params.get('category') || '';

    let where = "WHERE ca.status = 'published'";
    const paramsList = [];
    if (category && category !== 'all') {
      where += ' AND ca.asset_type = ?';
      paramsList.push(category);
    }
    if (search && search.length > 0) {
      where += ' AND (ca.name LIKE ? OR ca.description LIKE ?)';
      const sp = `%${search}%`;
      paramsList.push(sp, sp);
    }

    const totalResult = queryOne(
      `SELECT COUNT(*) AS c FROM creator_assets ca ${where}`,
      paramsList
    );
    const total = totalResult ? Math.max(0, totalResult.c) : 0;
    const offset = (page - 1) * limit;
    const rows = queryAll(
      `${ASSET_PUBLIC_SELECT} ${where} ORDER BY ca.created_at DESC LIMIT ? OFFSET ?`,
      [...paramsList, limit, offset]
    );
    const assets = rows.map(serializePublicAsset).filter(Boolean);
    jsonResponse(res, 200, {
      assets, total, page,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: total > page * limit,
      search,
    });
  } catch (err) {
    console.error('[MARKETPLACE] List assets error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}

export async function handleGetMarketplaceAsset(req, res, user, params) {
  try {
    const id = params && params.id ? params.id : null;
    if (!id) return errorResponse(res, 404, 'Asset not found');
    const asset = queryOne(`${ASSET_PUBLIC_SELECT} WHERE ca.id = ? AND ca.status = 'published'`, [id]);
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    jsonResponse(res, 200, { asset: serializePublicAsset(asset) });
  } catch (err) {
    console.error('[MARKETPLACE] Get asset error:', err);
    errorResponse(res, 500, 'Internal server error');
  }
}


