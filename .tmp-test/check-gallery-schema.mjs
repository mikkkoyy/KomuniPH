/**
 * Temporary diagnostic: verify gallery/album schema + data are intact.
 */
import Database from 'better-sqlite3';

const db = new Database('./data/komuniph.db', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('TABLES:', tables.join(', '));

const photoAlbumCols = db.prepare('PRAGMA table_info(photo_albums)').all().map(c => c.name);
console.log('photo_albums columns:', photoAlbumCols.join(', '));

const profilePhotoCols = db.prepare('PRAGMA table_info(profile_photos)').all().map(c => c.name);
console.log('profile_photos columns:', profilePhotoCols.join(', '));

console.log('has album_id on profile_photos:', profilePhotoCols.includes('album_id'));
console.log('photo_albums count:', db.prepare('SELECT COUNT(*) AS c FROM photo_albums').get().c);
console.log('profile_photos count:', db.prepare('SELECT COUNT(*) AS c FROM profile_photos').get().c);
console.log('profile_photos with album_id:', db.prepare('SELECT COUNT(*) AS c FROM profile_photos WHERE album_id IS NOT NULL').get().c);

console.log('album types:', JSON.stringify(db.prepare('SELECT type, COUNT(*) AS c FROM photo_albums GROUP BY type').all()));

const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('photo_albums','profile_photos')").all().map(r => r.name);
console.log('indexes:', indexes.join(', '));

db.close();
