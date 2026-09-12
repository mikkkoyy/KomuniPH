/**
 * Isolation test: batches of sharp (+ optional better-sqlite3) operations.
 *
 * MODES:
 *   A : triple sharp call (meta -> resize/webp -> meta) + DB statements  [new code]
 *   P : single sharp pipeline (resize/webp) + DB statements               [old code]
 *   D : double sharp call (meta -> resize/webp) + DB statements
 *   N : triple sharp call, NO db statements
 */
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';

const mode = process.argv[2] || 'A';
console.log('MODE:', mode);

const db = mode === 'N' ? null : new Database('./data/komuniph.db');
if (db) db.pragma('journal_mode = WAL');

function dbOp() {
  if (!db) return;
  const s1 = db.prepare('SELECT profile_photo_url FROM profiles WHERE user_id = ?');
  s1.get('no-such-user-0000');
  const s2 = db.prepare("UPDATE profiles SET updated_at = datetime('now') WHERE 0 = 1");
  s2.run();
}

async function batch(filePath, label) {
  const data = readFileSync(filePath);
  if (mode !== 'P') {
    const m = await sharp(data).metadata();
    if (!m.format) throw new Error('no format');
  }
  const out = await sharp(data)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  if (mode === 'A' || mode === 'N') {
    const om = await sharp(out).metadata();
    if (!om.format) throw new Error('no out format');
  }
  dbOp();
  console.log('ok:', label);
}

const files = [
  ['.tmp-test/test-big.jpg', 'jpeg'],
  ['.tmp-test/test-big-png.png', 'png'],
  ['.tmp-test/test.webp', 'webp'],
  ['.tmp-test/test-small.png', 'small'],
  ['.tmp-test/test-big.jpg', 'again'],
];

async function main() {
  for (let i = 0; i < 3; i++) {
    for (const [f, label] of files) {
      await batch(f, label);
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('--- round', i + 1, 'complete ---');
  }
  console.log('ALL BATCHES PASSED in mode', mode);
}

main().then(() => process.exit(0)).catch((e) => { console.error('ISOLATION STOPPED:', e.message); process.exit(2); });