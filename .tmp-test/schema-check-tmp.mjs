import { getDb } from '../server/database.js';
const db = getDb();
const cols = db.prepare('PRAGMA table_info(profiles)').all();
console.log(JSON.stringify(cols.map(c => c.name + ':' + c.type)));
const rows = db.prepare('SELECT alias, COUNT(*) c FROM profiles GROUP BY alias').all();
console.log(JSON.stringify(rows.slice(0, 20)));
