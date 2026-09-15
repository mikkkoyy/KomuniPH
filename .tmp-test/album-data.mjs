import Database from 'better-sqlite3';
const db = new Database('./data/komuniph.db', { readonly: true });
const us = db.prepare(
  "SELECT u.username,(SELECT COUNT(*) FROM profile_photos p WHERE p.profile_user_id=u.id AND p.status='active') AS photos FROM users u ORDER BY photos DESC LIMIT 5"
).all();
console.log(JSON.stringify(us));
const top = us[0].username;
const alb = db.prepare(
  "SELECT a.id,a.name,a.type,(SELECT COUNT(*) FROM profile_photos p WHERE p.album_id=a.id AND p.status='active') AS c FROM photo_albums a WHERE a.user_id=(SELECT id FROM users WHERE username=?)"
).all(top);
console.log(top, JSON.stringify(alb));
db.close();
