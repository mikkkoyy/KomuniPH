/**
 * KomuniPH Lite - PayMongo Client
 * Backend-only integration for GCash/Maya via PayMongo Sources API.
 * Users only ever see "GCash" / "Maya" — PayMongo is an internal detail.
 */

import crypto from 'crypto';
import config from './config.js';

const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

/**
 * Build Basic auth header from the PayMongo secret key.
 * Format: base64("<secret_key>:")
 */
function authHeader() {
  const key = config.paymongo.secretKey;
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

/**
 * Create a PayMongo Source for GCash or Maya.
 *
 * @param {object} opts
 * @param {number} opts.amount       – PHP whole-number amount (e.g. 50)
 * @param {'gcash'|'maya'} opts.type – payment method
 * @param {string} opts.successUrl   – redirect after successful payment
 * @param {string} opts.failedUrl    – redirect after failed payment
 * @returns {Promise<{id:string, redirectUrl:string, status:string}>}
 */
export async function createSource({ amount, type, successUrl, failedUrl }) {
  // PayMongo expects amount in centavos (PHP × 100)
  const centavos = Math.round(amount * 100);

  const body = JSON.stringify({
    data: {
      attributes: {
        amount: centavos,
        currency: 'PHP',
        type,
        redirect: {
          success: successUrl,
          failed: failedUrl,
        },
      },
    },
  });

  const res = await fetch(`${PAYMONGO_BASE}/sources`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  const json = await res.json();

  if (!res.ok) {
    const msg = json?.errors?.map(e => e.detail).join('; ') || `PayMongo API error ${res.status}`;
    throw new Error(msg);
  }

  const src = json.data;
  return {
    id: src.id,
    redirectUrl: src.attributes.redirect?.checkout_url || src.attributes.redirect?.url || '',
    status: src.attributes.status, // "pending" initially
  };
}

/**
 * Retrieve a PayMongo Source by ID.
 *
 * @param {string} sourceId
 * @returns {Promise<{id:string, status:string, amount:number, type:string}>}
 */
export async function getSource(sourceId) {
  const res = await fetch(`${PAYMONGO_BASE}/sources/${sourceId}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
    },
  });

  const json = await res.json();

  if (!res.ok) {
    const msg = json?.errors?.map(e => e.detail).join('; ') || `PayMongo API error ${res.status}`;
    throw new Error(msg);
  }

  const src = json.data;
  return {
    id: src.id,
    status: src.attributes.status,
    amount: src.attributes.amount, // centavos
    type: src.attributes.type,
  };
}

/**
 * Verify PayMongo webhook signature (HMAC-SHA256).
 *
 * PayMongo sends:
 *   X-PayMongo-Signature: v1=<hex>,t=<timestamp>
 *
 * The signed payload is: "<timestamp>.<rawBody>"
 *
 * @param {string} rawBody   – raw request body string
 * @param {string} signature – value of X-PayMongo-Signature header
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = config.paymongo.webhookSecret;
  if (!secret) {
    console.error('[PAYMONGO] No webhook secret configured — rejecting webhook');
    return false;
  }

  if (!signature) return false;

  // Parse "v1=<hex>,t=<timestamp>" (order may vary)
  const parts = {};
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }

  const v1 = parts['v1'];
  const t = parts['t'];
  if (!v1 || !t) return false;

  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const v1Buf = Buffer.from(v1, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (v1Buf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(v1Buf, expectedBuf);
}
