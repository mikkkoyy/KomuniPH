/**
 * Consolidate web/js/profile.js: the file currently contains TWO merged gallery
 * implementations, which produces "SyntaxError: Identifier 'renderGalleryPage'
 * has already been declared" and prevents the whole module graph from loading.
 *
 * This deletes ONLY the duplicated Block A implementation, keeping the Block B
 * implementation that web/js/app.js actually calls (gallery-albums-grid ids,
 * owner multi-upload, album-photos-grid).
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';

const FILE = 'web/js/profile.js';
copyFileSync(FILE, '.tmp-test/profile.js.bak');

const lines = readFileSync(FILE, 'utf8').split('\n');

/** line index (0-based) of the `/**` whose next line contains `marker` */
function commentStart(marker, occurrence = 1) {
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '/**' && (lines[i + 1] || '').includes(marker)) {
      seen++;
      if (seen === occurrence) return i;
    }
  }
  throw new Error(`anchor not found: ${marker} (#${occurrence})`);
}

const anchors = {
  albumCards: commentStart('Render the album cards for the dedicated gallery page.'),
  renderGalleryA: commentStart('Render the dedicated Photo Gallery page.'),
  initGalleryA: commentStart('Initialize the dedicated Photo Gallery page'),
  refreshGalleryA: commentStart('Load (or reload) the dedicated gallery page data'),
  pageDataA: commentStart('Render loaded gallery page data'),
  state: commentStart('State shared by the dedicated gallery and album pages.'),
};

console.log('anchors (0-based):', anchors);

const ranges = [
  [anchors.albumCards, anchors.renderGalleryA],      // renderAlbumCardsHtml
  [anchors.renderGalleryA, anchors.initGalleryA],    // duplicate renderGalleryPage
  [anchors.initGalleryA, anchors.refreshGalleryA],   // duplicate initGalleryPage
  [anchors.refreshGalleryA, anchors.pageDataA],      // duplicate refreshGalleryPage
  [anchors.pageDataA, anchors.state],                // renderGalleryPageData
];

// Verify each range starts and ends where expected.
for (const [start, end] of ranges) {
  console.log(`delete lines ${start + 1}..${end} :: first="${lines[start].trim()}" :: boundary="${lines[end].trim()}"`);
}

const drop = new Set();
for (const [start, end] of ranges) {
  for (let i = start; i < end; i++) drop.add(i);
}

const kept = lines.filter((_, i) => !drop.has(i));
writeFileSync(FILE, kept.join('\n'), 'utf8');
console.log(`\n${lines.length} -> ${kept.length} lines (removed ${drop.size})`);