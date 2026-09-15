/**
 * Temporary diagnostic: find duplicate top-level declarations / risky references
 * in web/js/profile.js and web/js/app.js.
 */
import { readFileSync } from 'fs';

const files = ['web/js/profile.js', 'web/js/app.js', 'web/js/api.js'];
const report = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const decls = new Map();

  lines.forEach((line, idx) => {
    const m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)
      || line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/)
      || line.match(/^\s*window\.([A-Za-z0-9_$]+)\s*=/);
    if (m) {
      if (!decls.has(m[1])) decls.set(m[1], []);
      decls.get(m[1]).push(idx + 1);
    }
  });

  const dups = [...decls.entries()].filter(([, l]) => l.length > 1);
  report.push(`${file}: ${decls.size} top-level declarations`);
  report.push(dups.length
    ? 'DUPLICATES:\n' + dups.map(([n, l]) => `  ${n} -> lines ${l.join(', ')}`).join('\n')
    : '  no duplicate declarations');
}

report.push('\n--- risky reference scan (profile.js) ---');
const profile = readFileSync('web/js/profile.js', 'utf8');
const lines = profile.split('\n');
const refs = ['window.navigate', 'navigate(', 'albumsApi.getAlbumPhotos', 'is_own_album', 'getAlbumPhotos', 'getGalleryUploadAlbumId', 'cover_photo_url', 'cover_thumbnail_url', 'is_profile_pictures', 'galleryAlbumId'];
for (const ref of refs) {
  const hits = lines.map((l, i) => (l.includes(ref) ? i + 1 : 0)).filter(Boolean);
  report.push(`${ref} -> ${hits.join(', ') || 'none'}`);
}

report.push('\n--- api.js albumsApi surface ---');
const apiLines = readFileSync('web/js/api.js', 'utf8').split('\n');
apiLines.forEach((l, i) => {
  if (/\basync [a-zA-Z]+\(/.test(l)) report.push(`  ${i + 1}: ${l.trim()}`);
});

import { writeFileSync } from 'fs';
writeFileSync('.tmp-test/dup-report.txt', report.join('\n'), 'utf8');
console.log('ok');
