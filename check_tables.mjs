import { getDb } from './server/database.js';
const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'community_%'").all();
console.log('Community tables:', JSON.stringify(tables, null, 2));
const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('All tables:', JSON.stringify(allTables.map(t => t.name)));
db.close();
