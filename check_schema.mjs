import Database from 'better-sqlite3';
const db = new Database('D:\\FILES\\project\\KomuniPH\\data\\komuniph.db');

console.log('=== photo_albums schema ===');
const albumSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='photo_albums'").get();
console.log(albumSchema ? albumSchema.sql : 'NOT FOUND');

console.log('\n=== profile_photos schema ===');
const photoSchema = db.prepare("SELECT sql FROM sqlite_master WHERE name='profile_photos'").get();
console.log(photoSchema ? photoSchema.sql : 'NOT FOUND');

console.log('\n=== photo_albums columns ===');
const albumCols = db.prepare("PRAGMA table_info(photo_albums)").all();
console.log(albumCols);

console.log('\n=== profile_photos columns ===');
const photoCols = db.prepare("PRAGMA table_info(profile_photos)").all();
console.log(photoCols);