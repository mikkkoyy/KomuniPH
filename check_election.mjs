import { getDb } from './server/database.js';
const db = getDb();
const elections = db.prepare('SELECT id, community_id, year, month, nomination_start, nomination_end, voting_start, voting_end, runoff_end, term_start, term_end, winner_id FROM community_elections').all();
for (const e of elections) {
    console.log('Election:', JSON.stringify(e));
}
const now = Date.now();
console.log('Now:', now, new Date(now).toISOString());
db.close();
