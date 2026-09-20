import http from 'http';
import { getDb } from './server/database.js';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;

function api(path, method = 'GET', body = null, token = null) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: BASE_HOST, port: BASE_PORT, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (chunk) => (b += chunk.toString()));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { parsed = { raw: b }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // Register a test user
  const reg = await api('/api/auth/register', 'POST', {
    email: 'debug@test.com',
    username: 'debuguser',
    password: 'Password123!',
  });
  console.log('Register:', reg.status, reg.body);
  
  const token = reg.body.access_token;
  
  // Update profile
  const prof = await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Quezon City', barangay: 'Cubao',
  }, token);
  console.log('Profile:', prof.status, prof.body);
  
  // Get communities
  const list = await api('/api/communities', 'GET', null, token);
  const community = list.body.communities.find((c) => c.type === 'barangay' && c.barangay === 'Cubao');
  console.log('Community:', community ? community.id : 'NOT FOUND');
  
  if (!community) return;
  
  const cid = community.id;
  
  // Join community
  const join = await api(`/api/communities/${cid}/join`, 'POST', null, token);
  console.log('Join:', join.status, join.body);
  
  // Get election
  const election = await api(`/api/communities/${cid}/election`, 'GET', null, token);
  console.log('Election:', election.status, JSON.stringify(election.body.election));
  
  // Set dates
  const db = getDb();
  const eid = election.body.election.id;
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  function iso(d) { return new Date(d).toISOString(); }
  
  db.prepare(`UPDATE community_elections SET nomination_start = ?, nomination_end = ?, voting_start = ?, voting_end = ? WHERE id = ?`)
    .run(iso(now - 1 * DAY), iso(now - 1 * HOUR), iso(now - 1 * HOUR), iso(now + 10 * DAY), eid);
  
  // Verify dates
  const election2 = await api(`/api/communities/${cid}/election`, 'GET', null, token);
  console.log('Election after setDates:', JSON.stringify(election2.body.election));
  
  // Try to vote
  const vote = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: 'debuguser' }, token);
  console.log('Vote:', vote.status, JSON.stringify(vote.body));
  
  db.close();
}

main().catch(console.error);
