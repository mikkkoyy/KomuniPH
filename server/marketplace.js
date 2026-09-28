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

const ASSET_SELECT = `
  SELECT id, creator_user_id, name, description, asset_type, status, version,
         preview_data, asset_data, price_coins, source_design_id,
         published_at, archived_at, created_at, updated_at
  FROM creator_assets`;

// ─── Normal Marketplace ────────────────────────────────────────────────

const LISTING_SELECT = `
  SELECT ml.id, ml.seller_user_id, ml.title, ml.description, ml.category, ml.price_display,
         ml.images, ml.status, ml.created_at, ml.updated_at, ml.published_at, ml.archived_at,
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
      const validImages = body.images.every(img => typeof img === 'string' && img.trim().length > 0);
      if (!validImages) {
        errors.push('Each image must be a non-empty string');
      } else {
        data.images = body.images;
      }
    }
  } else if (!partial) {
    data.images = [];
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
        (id, seller_user_id, title, description, category, price_display, images, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [id, user.sub, data.title, data.description, data.category, data.price_display,
       JSON.stringify(data.images), ts, ts]
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
    if (existing.status !== 'draft') return errorResponse(res, 409, 'Only draft listings can be published');

    const ts = now();
    execute(
      `UPDATE marketplace_listings SET status = 'published', published_at = ?, updated_at = ? WHERE id = ? AND seller_user_id = ?`,
      [ts, ts, params.id, user.sub]
    );

    const updated = findOwnedListing(params.id, user.sub);
    jsonResponse(res, 200, { listing: serializeListingRow(updated) });
  } catch (err) {
    console.error('[MARKETPLACE] Publish listing error:', err);
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


