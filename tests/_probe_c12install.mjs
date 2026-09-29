/** Probe: full install + duplicate/ownership/isolation behaviour. */
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { buildZip, goodManifest, goodDefinition } from './_zip.js';

const EFFECT_DIR = join(mkdtempSync(join(tmpdir(), 'c12-store-')), 'creator-effects');
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'c12-imp2-')), 't.db');
process.env.UPLOAD_CREATOR_EFFECT_DIR = EFFECT_DIR;
const mod = (rel) => pathToFileURL(new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
const db = await import(mod('../server/database.js'));
db.initDatabase();
const eff = await import(mod('../server/creatorEffects.js'));

const png = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 255, g: 240, b: 200, alpha: 1 } } }).png().toBuffer();
const mkUser = (id) => db.execute(
  'INSERT OR IGNORE INTO users (id, username, email, password_hash, role, created_at) VALUES (?,?,?,?,?,datetime(\'now\'))',
  [id, `u_${id}`, `${id}@t.local`, 'x', 'user'],
);

mkUser('userA');
mkUser('userB');
const userA = { id: 'userA' };
const userB = { id: 'userB' };

const zip = buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest({ preview: 'preview.png', thumbnail: 'assets/flake.png' })) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ texture: 'assets/flake.png' })) },
  { name: 'assets/flake.png', data: png },
  { name: 'preview.png', data: png },
]);

const res = await eff.installPackage(userA, zip);
console.log('installed:', res.effectId, '| status:', res.status, '| preview:', res.previewPath);

const dir = join(EFFECT_DIR, `${userA.id}_${res.id}`);
const files = readdirSync(dir);
console.log('extracted files:', files.join(', '));
console.log('all webp (no archive passthrough):', files.every(f => f.endsWith('.webp')));
console.log('no original names kept:', !files.includes('flake.png') && !files.includes('preview.png'));

const def = JSON.parse(db.queryOne('SELECT definition_json FROM creator_effects WHERE id = ?', [res.id]).definition_json);
console.log('stored texture rewritten to generated name:', def.texture && def.texture.endsWith('.webp') && def.texture !== 'assets/flake.png');
console.log('stored config clamped:', JSON.stringify(def.config));

// Duplicate id for the SAME creator must be refused.
try { await eff.installPackage(userA, zip); console.log('PROBLEM: duplicate accepted'); }
catch (e) { console.log('duplicate for same creator rejected:', e.status === 409); }

// A DIFFERENT creator may install the same effect id.
const resB = await eff.installPackage(userB, zip);
console.log('different creator can install same id:', resB.effectId === res.effectId);
const dirB = join(EFFECT_DIR, `${userB.id}_${resB.id}`);
console.log('isolated storage dirs:', dir !== dirB, '| both exist:', existsSync(dir) && existsSync(dirB));

// Archiving is owner-scoped.
try { eff.archiveEffect(userB, res.id); console.log('PROBLEM: cross-owner archive allowed'); }
catch (e) { console.log('cross-owner archive rejected:', e.status === 404); }
const archived = eff.archiveEffect(userA, res.id);
console.log('owner archive works:', archived.status === 'archived');
console.log('published list for A after archive:', eff.listPublishedCreatorEffects('userA').length, '| for B:', eff.listPublishedCreatorEffects('userB').length);

// A rejected package must not create any directory at all.
try {
  await eff.installPackage(userA, buildZip([
    { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
    { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
    { name: 'assets/evil.js', data: 'alert(1)' },
  ]));
  console.log('PROBLEM: executable package accepted');
} catch (e) {
  const after = readdirSync(EFFECT_DIR);
  console.log('rejected package left no directory:', after.length === 2, '| dirs:', after.length);
}
