/**
 * KomuniPH COMMUNITY-04 focused test suite (discovery + join only).
 *
 * Requires a running server on localhost:3000 (same convention as
 * tests/test_community.mjs). Registers fresh throwaway accounts at two unused
 * real barangays in different cities, then exercises ONLY the COMMUNITY-04
 * discovery/search/filter/pagination/eligibility/recommended/join endpoints.
 * Removes every row it created so re-runs start from a clean slate.
 */

import http from 'http';
import { getDb } from '../server/database.js';
import { getAllLocations } from '../server/locations.js';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const P = 'Password123!';

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

const db = getDb();

let pass = 0;
let fail = 0;

function assert(cond, label, extra) {
  if (cond) {
    pass++;
    console.log('  PASS:', label);
  } else {
    fail++;
    console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

const log = (m) => console.log('\n' + m);

/** Pick an unused real (city, barangay) pair. */
function pickFreshLocation(excludeCity = null) {
  const { countries, barangays } = getAllLocations();
  const country = 'Philippines';
  const cityList = countries.includes(country) ? barangays[country] : {};
  const hasBarangay = (c, b) => !!db.prepare(
    "SELECT id FROM communities WHERE type = 'barangay' AND country = ? AND city = ? AND barangay = ?"
  ).get(country, c, b);
  for (const city of Object.keys(cityList)) {
    if (city === excludeCity) continue;
    for (const b of cityList[city] || []) {
      if (!hasBarangay(city, b)) return { country, city, barangay: b };
    }
  }
  return null;
}

async function register(username, profile) {
  const reg = await api('/api/auth/register', 'POST', {
    email: `${username}@test.com`,
    username,
    password: P,
  });
  if (reg.status !== 201) return null;
  const token = reg.body.access_token;
  const prof = await api('/api/profile', 'PATCH', profile, token);
  if (prof.status !== 200) return null;
  return token;
}

function communityIdByScope(type, loc) {
  if (type === 'nationwide') {
    const row = db.prepare("SELECT id FROM communities WHERE type = 'nationwide' AND country = ?").get(loc.country);
    return row ? row.id : null;
  }
  const row = db.prepare("SELECT id FROM communities WHERE type = ? AND country = ? AND city = ? AND barangay = ?")
    .get(type, loc.country, loc.city, loc.barangay);
  return row ? row.id : null;
}

function communityIdByCity(loc) {
  const row = db.prepare("SELECT id FROM communities WHERE type = 'city' AND country = ? AND city = ? AND barangay IS NULL")
    .get(loc.country, loc.city);
  return row ? row.id : null;
}

let loc1Ref = null;
let loc2Ref = null;

async function runTests() {
  console.log('=== COMMUNITY-04 DISCOVERY TEST SUITE ===');

  log('--- Setup: two fresh users in different cities ---');
  loc1Ref = pickFreshLocation(null);
  assert(!!loc1Ref, 'Found an unused real barangay (user A)', loc1Ref);
  if (!loc1Ref) return false;
  loc2Ref = pickFreshLocation(loc1Ref.city);
  assert(!!loc2Ref && loc2Ref.city !== loc1Ref.city, 'Found a second unused barangay in a different city (user B)', loc2Ref);
  if (!loc2Ref) return false;
  log(`User A location: ${loc1Ref.city} / ${loc1Ref.barangay}`);
  log(`User B location: ${loc2Ref.city} / ${loc2Ref.barangay}`);

  const uA = `discA${stamp}`;
  const uB = `discB${stamp}`;
  const tA = await register(uA, {
    first_name: 'Dis', last_name: 'Cover', display_name: 'Discovery Tester',
    country: loc1Ref.country, city: loc1Ref.city, barangay: loc1Ref.barangay,
  });
  const tB = await register(uB, {
    first_name: 'Dis', last_name: 'Cover', display_name: 'Discovery Tester',
    country: loc2Ref.country, city: loc2Ref.city, barangay: loc2Ref.barangay,
  });
  assert(!!tA, 'User A registered with location');
  assert(!!tB, 'User B registered with location');
  if (!tA || !tB) return false;

  // Materialize communities for both users (discover creates them + auto-join nationwide).
  const first = await api('/api/communities/discover', 'GET', null, tA);
  await api('/api/communities/discover', 'GET', null, tB);
  assert(first.status === 200, 'GET /api/communities/discover returns 200', first.status);

  const nationwideId = communityIdByScope('nationwide', loc1Ref);
  const cityAId = communityIdByCity(loc1Ref);
  const brgyAId = communityIdByScope('barangay', loc1Ref);
  const cityBId = communityIdByCity(loc2Ref);
  const brgyBId = communityIdByScope('barangay', loc2Ref);
  assert(!!nationwideId && !!cityAId && !!brgyAId && !!cityBId && !!brgyBId,
    'All expected communities exist (nationwide + 2x city/barangay)');

  const ids1 = (first.body.communities || []).map((c) => c.id);

  log('--- Discovery shape ---');
  assert(Array.isArray(first.body.communities), 'Response has communities array');
  assert(first.body.limit === 20, 'Default limit is 20', first.body.limit);
  assert(first.body.offset === 0, 'Default offset is 0');
  assert(typeof first.body.has_more === 'boolean', 'has_more is boolean');
  const shapeOk = (first.body.communities || []).every((c) =>
    'id' in c && 'name' in c && 'type' in c && typeof c.member_count === 'number'
    && typeof c.post_count === 'number'
    && (c.last_post_at === null || typeof c.last_post_at === 'string')
    && typeof c.joined === 'boolean' && typeof c.eligible === 'boolean');
  assert(shapeOk, 'Discovery cards expose member_count/post_count/last_post_at/joined/eligible');
  assert(ids1.includes(nationwideId), 'Nationwide community in discovery');
  assert(ids1.includes(cityAId), 'Own city community in discovery');
  assert(ids1.includes(brgyAId), 'Own barangay community in discovery');
  assert(!ids1.includes(cityBId), 'Other city community NOT in discovery (eligibility)');
  assert(!ids1.includes(brgyBId), 'Other barangay community NOT in discovery (eligibility)');
  const allFirst = first.body.communities || [];
  const natRow = allFirst.find((c) => c.id === nationwideId);
  assert(natRow && natRow.joined === true, 'Nationwide auto-join reflected in discovery');

  log('--- Search ---');
  const qBarangay = await api(`/api/communities/discover?q=${encodeURIComponent(loc1Ref.barangay)}`, 'GET', null, tA);
  assert(qBarangay.status === 200, 'Search by barangay name returns 200');
  assert((qBarangay.body.communities || []).some((c) => c.id === brgyAId),
    'Search by barangay name finds the barangay community');
  const qCity = await api(`/api/communities/discover?q=${encodeURIComponent(loc1Ref.city)}`, 'GET', null, tA);
  assert(qCity.status === 200 && (qCity.body.communities || []).some((c) => c.id === cityAId),
    'Search by city name finds the city community');
  const qNone = await api('/api/communities/discover?q=zzqxnope123', 'GET', null, tA);
  assert(qNone.status === 200 && (qNone.body.communities || []).length === 0,
    'No-results search returns empty list');
  const qInject = await api(`/api/communities/discover?q=${encodeURIComponent("x%' OR 1=1 --")}`, 'GET', null, tA);
  assert(qInject.status === 200 && (qInject.body.communities || []).every((c) => ids1.includes(c.id)),
    'SQL-injection-style search is parameterized (no unexpected rows)');
  const qWild = await api(`/api/communities/discover?q=${encodeURIComponent('100%')}`, 'GET', null, tA);
  assert(qWild.status === 200, 'LIKE wildcards in query do not crash search');

  log('--- Filters ---');
  const fBrgy = await api('/api/communities/discover?type=barangay', 'GET', null, tA);
  assert(fBrgy.status === 200
    && (fBrgy.body.communities || []).every((c) => c.type === 'barangay')
    && (fBrgy.body.communities || []).some((c) => c.id === brgyAId),
    'type=barangay filter works');
  const fNat = await api('/api/communities/discover?type=nationwide', 'GET', null, tA);
  assert(fNat.status === 200 && (fNat.body.communities || []).every((c) => c.type === 'nationwide'),
    'type=nationwide filter works');
  const fBad = await api('/api/communities/discover?type=planet', 'GET', null, tA);
  assert(fBad.status === 422, 'Invalid type filter returns 422', fBad.status);
  const fBadJoined = await api('/api/communities/discover?joined=maybe', 'GET', null, tA);
  assert(fBadJoined.status === 422, 'Invalid joined filter returns 422', fBadJoined.status);
  const fNotJoined = await api('/api/communities/discover?joined=false', 'GET', null, tA);
  assert(fNotJoined.status === 200 && (fNotJoined.body.communities || []).some((c) => c.id === cityAId),
    'joined=false includes not-yet-joined city community before join');
  const fJoined = await api('/api/communities/discover?joined=true', 'GET', null, tA);
  assert(fJoined.status === 200 && !(fJoined.body.communities || []).some((c) => c.id === cityAId),
    'joined=true excludes city community before joining');

  log('--- Pagination ---');
  const p1 = await api('/api/communities/discover?limit=1', 'GET', null, tA);
  assert(p1.status === 200 && (p1.body.communities || []).length <= 1 && p1.body.has_more === true
    && p1.body.limit === 1, 'limit=1 respects page size and reports has_more');
  const pBig = await api('/api/communities/discover?limit=999', 'GET', null, tA);
  assert(pBig.status === 200 && pBig.body.limit === 50, 'limit=999 clamped to 50', pBig.body.limit);
  const pOff = await api('/api/communities/discover?offset=1', 'GET', null, tA);
  assert(pOff.status === 200 && (pOff.body.communities || [])[0] && (pOff.body.communities || [])[0].id === ids1[1],
    'offset=1 skips the first row');
  const pNeg = await api('/api/communities/discover?offset=-5', 'GET', null, tA);
  assert(pNeg.status === 200 && pNeg.body.offset === 0, 'Negative offset clamped to 0');

  log('--- Eligibility authority (no bypass) ---');
  const directGet = await api(`/api/communities/${cityBId}`, 'GET', null, tA);
  assert(directGet.status === 403, 'Direct GET of ineligible community returns 403', directGet.status);
  const directJoin = await api(`/api/communities/${cityBId}/join`, 'POST', null, tA);
  assert(directJoin.status === 403, 'Direct join of ineligible community returns 403', directJoin.status);
  const paramManip = await api(`/api/communities/discover?city=${encodeURIComponent(loc2Ref.city)}&barangay=${encodeURIComponent(loc2Ref.barangay)}`, 'GET', null, tA);
  assert(paramManip.status === 200 && !(paramManip.body.communities || []).some((c) => c.id === cityBId || c.id === brgyBId),
    'Location query params cannot surface ineligible communities');
  const asB = await api('/api/communities/discover', 'GET', null, tB);
  assert(asB.status === 200 && (asB.body.communities || []).some((c) => c.id === cityBId)
    && (asB.body.communities || []).some((c) => c.id === brgyBId)
    && !(asB.body.communities || []).some((c) => c.id === brgyAId),
    'User B sees own eligible communities and not user A barangay');

  log('--- Recommended Communities (deterministic) ---');
  const rec1 = await api('/api/communities/recommended', 'GET', null, tA);
  assert(rec1.status === 200, 'GET /api/communities/recommended returns 200');
  const recIds1 = (rec1.body.communities || []).map((c) => c.id);
  assert(!recIds1.includes(cityBId) && !recIds1.includes(brgyBId),
    'Recommended excludes ineligible communities');
  assert(recIds1[0] === brgyAId, 'Recommended ranks own barangay community first', recIds1);
  const rec2 = await api('/api/communities/recommended', 'GET', null, tA);
  assert(JSON.stringify((rec2.body.communities || []).map((c) => c.id)) === JSON.stringify(recIds1),
    'Recommended ordering is deterministic across calls');
  const recLim = await api('/api/communities/recommended?limit=1', 'GET', null, tA);
  assert(recLim.status === 200 && (recLim.body.communities || []).length === 1,
    'Recommended respects limit');
  const recBig = await api('/api/communities/recommended?limit=999', 'GET', null, tA);
  assert(recBig.status === 200 && (recBig.body.communities || []).length <= 50,
    'Recommended clamps limit to 50');

  log('--- Join directly from discovery (existing contract) ---');
  const cityRowBefore = first.body.communities.find((c) => c.id === cityAId);
  const mcBefore = cityRowBefore ? cityRowBefore.member_count : 0;
  const join = await api(`/api/communities/${cityAId}/join`, 'POST', null, tA);
  assert(join.status === 200, 'Eligible join from discovery returns 200', join.status);
  assert(join.body.community_id === cityAId && join.body.joined === true
    && join.body.membership === 'member' && Number.isInteger(join.body.member_count),
    'Join response matches existing contract (community_id/joined/membership/member_count)');
  assert(join.body.member_count === mcBefore + 1,
    'Join response member_count incremented', { before: mcBefore, after: join.body.member_count });
  const after = await api('/api/communities/discover', 'GET', null, tA);
  const cityRowAfter = (after.body.communities || []).find((c) => c.id === cityAId);
  assert(cityRowAfter && cityRowAfter.joined === true && cityRowAfter.member_count === mcBefore + 1,
    'Discovery card reflects joined state and updated member count');
  const fJoinedAfter = await api('/api/communities/discover?joined=true', 'GET', null, tA);
  assert((fJoinedAfter.body.communities || []).some((c) => c.id === cityAId),
    'joined=true includes city community after joining');
  const fNotJoinedAfter = await api('/api/communities/discover?joined=false', 'GET', null, tA);
  assert(!(fNotJoinedAfter.body.communities || []).some((c) => c.id === cityAId),
    'joined=false excludes city community after joining');
  const natJoin = await api(`/api/communities/${nationwideId}/join`, 'POST', null, tA);
  assert(natJoin.status === 200 && natJoin.body.joined === true,
    'Nationwide join behavior unchanged', natJoin.status);

  console.log(`\n=== COMMUNITY-04 DISCOVERY RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  return fail === 0;
}

async function cleanup() {
  try {
    const users = [`discA${stamp}`, `discB${stamp}`];
    const userIds = [];
    for (const u of users) {
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
      if (row) userIds.push(row.id);
    }
    const placeholders = userIds.map(() => '?').join(',');
    const cids = [];
    for (const loc of [loc1Ref, loc2Ref]) {
      if (!loc) continue;
      const row = db.prepare(
        "SELECT id FROM communities WHERE type = 'barangay' AND country = ? AND city = ? AND barangay = ?"
      ).get(loc.country, loc.city, loc.barangay);
      if (row) cids.push(row.id);
    }

    const run = (sql, ...params) => {
      try { db.prepare(sql).run(...params); } catch (e) { /* best-effort */ }
    };

    db.transaction(() => {
      for (const cid of cids) {
        run('DELETE FROM community_members WHERE community_id = ?', cid);
        run('DELETE FROM community_events WHERE community_id = ?', cid);
        run('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE community_id = ?)', cid);
        run('DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE community_id = ?)', cid);
        run('DELETE FROM posts WHERE community_id = ?', cid);
      }
      if (placeholders) {
        run(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (${placeholders}))`, ...userIds);
        run(`DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (${placeholders}))`, ...userIds);
        run(`DELETE FROM posts WHERE author_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM community_election_votes WHERE voter_user_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM community_election_candidates WHERE user_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM moderator_terms WHERE user_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM community_events WHERE created_by IN (${placeholders})`, ...userIds);
        run(`DELETE FROM community_members WHERE user_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM profiles WHERE user_id IN (${placeholders})`, ...userIds);
        run(`DELETE FROM users WHERE id IN (${placeholders})`, ...userIds);
      }
    })();

    for (const cid of cids) {
      try { db.prepare('DELETE FROM communities WHERE id = ?').run(cid); } catch (e) { /* ignore */ }
    }
    console.log('[cleanup] Removed discovery test users, memberships, and test barangay communities.');
    db.close();
  } catch (e) {
    try { db.close(); } catch (e2) { /* ignore */ }
    console.error('[cleanup] Failed to fully clean test data:', e.message);
  }
}

runTests()
  .then(async (ok) => {
    await cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup();
    process.exit(2);
  });
