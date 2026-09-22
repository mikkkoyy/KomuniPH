/**
 * IDENTITY-01 — Identity Verification foundation.
 *
 * Builds the verification state machine and the private verification record
 * store, plus the minimal integration point for the first KYC reward:
 * successful first verification awards 15 Coins once through the Coin ledger.
 *
 * This module is intentionally standalone for now. It does not implement the
 * Coin wallet, Marketplace, or Creator Studio. It only stores verification
 * records, resolves risk signals, and defines the Coin reward contract.
 */

import { queryOne, queryAll, execute, transaction } from './database.js';
import { generateId, now, jsonResponse, errorResponse, parseBody, isValidEmail } from './utils.js';

export const VERIFICATION_STATES = [
  'unverified',
  'pending',
  'review_required',
  'verified',
  'rejected',
];

export const MINOR_AGE_CUTOFF = 15;
export const FIRST_VERIFICATION_REWARD_COINS = 15;

export function normalizeField(value, type) {
  if (value == null || value === '') return null;
  if (type === 'string') return String(value).trim();
  if (type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function validateVerificationPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return [{ field: 'body', message: 'Verification data is required' }];
  }

  const legalName = normalizeField(body.legal_name, 'string');
  const birthday = normalizeField(body.birthday, 'string');
  const address = normalizeField(body.address, 'string');

  if (!legalName) {
    errors.push({ field: 'legal_name', message: 'Legal name is required' });
  } else if (legalName.length < 2 || legalName.length > 120) {
    errors.push({ field: 'legal_name', message: 'Legal name must be 2-120 characters' });
  }

  const birthdate = birthday ? birthday.trim() : null;
  if (!birthdate) {
    errors.push({ field: 'birthday', message: 'Birthday is required' });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
    errors.push({ field: 'birthday', message: 'Birthday must be YYYY-MM-DD' });
  } else {
    const d = new Date(birthdate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) {
      errors.push({ field: 'birthday', message: 'Birthday is not a valid date' });
    } else if (d.getFullYear() < 1901 || d.getFullYear() > new Date().getFullYear()) {
      errors.push({ field: 'birthday', message: 'Birthday year must be realistic' });
    }
  }

  if (!address) {
    errors.push({ field: 'address', message: 'Address is required' });
  } else if (address.length < 10 || address.length > 500) {
    errors.push({ field: 'address', message: 'Address must be 10-500 characters' });
  }

  return errors;
}

export function ageFromBirthday(birthday) {
  if (!birthday) return null;
  const d = new Date(birthday + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const nowD = new Date();
  let age = nowD.getFullYear() - d.getFullYear();
  const m = nowD.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && nowD.getDate() < d.getDate())) age -= 1;
  return age;
}

export function computeVerificationRiskSignals(submitted, existingVerified) {
  const signals = [];
  if (!existingVerified) return signals;
  if (submitted.legal_name && submitted.legal_name.toLowerCase() === existingVerified.legal_name.toLowerCase()) {
    signals.push('name_match');
  }
  if (submitted.birthday && existingVerified.birthday && submitted.birthday.toLowerCase() === existingVerified.birthday.toLowerCase()) {
    signals.push('birthday_match');
  }
  if (submitted.address && existingVerified.address && submitted.address.toLowerCase() === existingVerified.address.toLowerCase()) {
    signals.push('address_match');
  }
  return signals;
}

export function getVerifiedRecordForUser(userId) {
  return queryOne(
    `SELECT id, user_id, legal_name, birthday, address, status, submitted_at,
            verified_at, reward_awarded, review_notes
     FROM identity_verifications
     WHERE user_id = ? AND status = 'verified'
     LIMIT 1`,
    [userId]
  );
}

export function getPendingVerificationForUser(userId) {
  return queryOne(
    `SELECT id, status, submitted_at FROM identity_verifications
     WHERE user_id = ? AND status IN ('pending','review_required')
     ORDER BY submitted_at DESC
     LIMIT 1`,
    [userId]
  );
}

export function countVerifiedMatches({ legal_name, birthday, address }) {
  const conditions = [];
  const params = [];
  if (legal_name) {
    conditions.push('LOWER(legal_name) = LOWER(?)');
    params.push(legal_name);
  }
  if (birthday) {
    conditions.push('birthday = ?');
    params.push(birthday);
  }
  if (address) {
    conditions.push('LOWER(address) = LOWER(?)');
    params.push(address);
  }
  if (!conditions.length) return 0;
  const sql = `SELECT COUNT(*) as c FROM identity_verifications WHERE status = 'verified' AND (${conditions.join(' OR ')})`;
  const row = queryOne(sql, params);
  return row ? row.c : 0;
}
