import http from 'http';
import { getDb } from './server/database.js';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const username = 'dv' + stamp;

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
  const reg = await api('/api/auth/register', 'POST', {
    email: username + '@test.com',
    username: username,
    password: 'Password123!',
  });
  console.log('Register:', reg.status, reg.body);
  
  const token = reg.body.access_token;
  
  const prof = await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Quezon City', barangay: 'Cubao',
  }, token);
  console.log('Profile:', prof.status);
  
  const list = await api('/api/communities', 'GET', null, token);
  const community = list.body.communities.find((c) => c.type === 'barangay' && c.barangay === 'Cubao');
  const cid = community ? community.id : null;
  console.log('Community:', cid);
  
  if (!cid) return;
  
  const join = await api(`/api/communities/${cid}/join`, 'POST', null, token);
  console.log('Join:', join.status, join.body.membership);
  
  const election = await api(`/api/communities/${cid}/election`, 'GET', null, token);
  console.log('Election phase:', election.body.election.status, 'round:', election.body.election.round);
  console.log('Election voting_end:', election.body.election.voting_end);
  console.log('Election voting_start:', election.body.election.voting_start);
  
  const db = getDb();
  const eid = election.body.election.id;
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  function iso(d) { return new Date(d).toISOString(); }
  
  db.prepare(`UPDATE community_elections SET nomination_start = ?, nomination_end = ?, voting_start = ?, voting_end = ? WHERE id = ?`)
    .run(iso(now - 1 * DAY), iso(now - 1 * HOUR), iso(now - 1 * HOUR), iso(now + 10 * DAY), eid);
  
  const election2 = await api(`/api/communities/${cid}/election`, 'GET', null, token);
  console.log('Election after setDates:', election2.body.election.status, 'round:', election2.body.election.round);
  console.log('Election voting_end:', election2.body.election.voting_end);
  console.log('Election voting_start:', election2.body.election.voting_start);
  
  const vote = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: username }, token);
  console.log('Vote:', vote.status, JSON.stringify(vote.body));
  
  db.close();
}

main().catch(console.error);
