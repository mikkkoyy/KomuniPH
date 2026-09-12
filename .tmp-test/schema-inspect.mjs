import { getDb } from '../server/database.js';
const db = getDb();
console.log('tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
console.log('---profiles sql---');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='profiles'").get().sql);
console.log('---indexes---');
console.log(db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name='profiles'").all());
console.log('---sample---');
try { console.log(db.prepare('SELECT display_name, alias, alias_enabled, bio FROM profiles LIMIT 5').all()); } catch(e){ console.log('sample err', e.message); }
