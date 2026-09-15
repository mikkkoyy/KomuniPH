/**
 * One-off cleanup: remove the superseded draft gallery-page implementation
 * (renderAlbumCardsHtml / renderGalleryPage / initGalleryPage /
 *  refreshGalleryPage / renderGalleryPageData) that references the
 * undefined renderGalleryGridHtml(). Asserts exact line boundaries first.
 */
import { readFileSync, writeFileSync } from 'fs';

const path = 'web/js/profile.js';
const src = readFileSync(path, 'utf8');
const lines = src.split('\n');

const expect = {
  2205: '/**',
  2206: ' * Render the album cards for the dedicated gallery page.',
  2371: '}',
  2372: '',
  2373: '/**',
  2374: ' * State shared by the dedicated gallery and album pages.',
};

let ok = true;
for (const [lineNo, text] of Object.entries(expect)) {
  const actual = lines[Number(lineNo) - 1];
  if (actual !== text) {
    ok = false;
    console.error(`MISMATCH line ${lineNo}\n  expected: ${JSON.stringify(text)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

if (!ok) {
  console.error('Aborting: boundaries do not match.');
  process.exit(1);
}

const removed = lines.splice(2205 - 1, 2372 - 2205 + 1);
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`Removed ${removed.length} lines (2205-2372). New line count: ${lines.length}`);