/** Probe: exercise the .kpeffect importer against real ZIP archives. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { buildZip, goodManifest, goodDefinition } from './_zip.js';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'c12-imp-')), 't.db');
process.env.UPLOAD_CREATOR_EFFECT_DIR = './uploads-test-creator-effects';
const mod = (rel) => pathToFileURL(new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
const db = await import(mod('../server/database.js'));
db.initDatabase();
const eff = await import(mod('../server/creatorEffects.js'));

const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 200, g: 220, b: 255, alpha: 1 } } }).png().toBuffer();

const valid = buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest({ preview: 'preview.png' })) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ texture: 'assets/flake.png' })) },
  { name: 'assets/flake.png', data: png },
  { name: 'preview.png', data: png },
]);

let pass = 0, fail = 0;
const check = async (name, fn, expectOk) => {
  try {
    const r = await fn();
    if (expectOk) { pass++; console.log(`  ok   ${name}${r ? ' -> ' + r : ''}`); }
    else { fail++; console.log(`  FAIL ${name} -> should have been rejected: ${r}`); }
  } catch (e) {
    if (!expectOk) { pass++; console.log(`  ok   ${name} (rejected: ${e.message.slice(0, 70)})`); }
    else { fail++; console.log(`  FAIL ${name} -> ${e.message}`); }
  }
};

await check('valid package passes inspection', async () => {
  const r = await eff.inspectPackage(valid);
  return `${r.manifest.id} / ${r.definition.engine}`;
}, true);

await check('missing manifest', () => eff.inspectPackage(buildZip([
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
])), false);

await check('missing effect definition', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
])), false);

await check('malformed manifest JSON', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: '{not json' },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
])), false);

await check('path traversal entry', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: '../../evil.txt', data: 'x' },
])), false);

await check('absolute path entry', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: '/etc/passwd', data: 'x' },
])), false);

await check('javascript file in package', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: 'assets/evil.js', data: 'alert(1)' },
])), false);

await check('wasm file in package', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  { name: 'assets/evil.wasm', data: Buffer.from([0, 97, 115, 109]) },
])), false);

await check('unsafe svg asset', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ texture: 'assets/x.svg' })) },
  { name: 'assets/x.svg', data: '<svg onload="alert(1)"></svg>' },
  { name: 'assets/x.png', data: png },
])), false);

await check('external asset URL in definition', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ texture: 'https://evil.test/x.png' })) },
  { name: 'assets/flake.png', data: png },
])), false);

await check('unknown engine', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ engine: 'wasm-runner' })) },
])), false);

await check('out-of-range config value', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ config: { count: 999999 } })) },
])), false);

await check('unknown config key', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ config: { count: 10, evil: 1 } })) },
])), false);

await check('texture not present in package', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition({ texture: 'assets/missing.png' })) },
])), false);

await check('too many files', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest()) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
  ...Array.from({ length: 40 }, (_, i) => ({ name: `assets/f${i}.png`, data: png })),
])), false);

await check('declared preview missing from package', () => eff.inspectPackage(buildZip([
  { name: 'manifest.json', data: JSON.stringify(goodManifest({ preview: 'preview.png' })) },
  { name: 'effect/effect.json', data: JSON.stringify(goodDefinition()) },
])), false);

await check('not a zip at all', () => eff.inspectPackage(Buffer.from('this is definitely not a zip archive')), false);
await check('empty buffer', () => eff.inspectPackage(Buffer.alloc(0)), false);

console.log(`\n${pass}/${pass + fail} import probes behaved as expected`);
process.exit(fail ? 1 : 0);
