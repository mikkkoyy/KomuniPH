/**
 * KomuniPH COMMUNITY-01 + COMMUNITY-02 automated test suite.
 *
 * Requires a running server on localhost:3000 (same convention as the other
 * root test scripts). Registers fresh throwaway accounts at a real, currently
 * unused barangay, exercises the full community + election feature set, then
 * removes every row it created (users, posts, memberships, election data,
 * events, and the test community itself) so re-runs start from a clean slate.
 *
 * Election phase coverage uses deterministic database time-shifting on the
 * live election row (boundaries are relative to "now" and never require
 * waiting for real calendar dates).
 */

import http from 'http';
import { getDb } from '../server/database.js';
import { getAllLocations } from '../server/locations.js';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const P = 'Password123!';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(d) {
  return new Date(d).toISOString();
}

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

/**
 * Pick a real (city, barangay) pair that has a city community already seeded
 * but NO barangay community yet. This guarantees the run creates exactly one
 * fresh test community whose first joiner becomes the owner, with no
 * interference from pre-existing members.
 */
function pickFreshLocation() {
  const { countries, barangays } = getAllLocations();
  const country = 'Philippines';
  const cityList = countries.includes(country) ? barangays[country] : {};
  const hasCity = (c) => {
    const row = db.prepare(
      "SELECT id FROM communities WHERE type = 'city' AND country = ? AND city = ?"
    ).get(country, c);
    return !!row;
  };
  const hasBarangay = (c, b) => {
    const row = db.prepare(
      "SELECT id FROM communities WHERE type = 'barangay' AND country = ? AND city = ? AND barangay = ?"
    ).get(country, c, b);
    return !!row;
  };
  for (const city of Object.keys(cityList)) {
    if (!hasCity(city)) continue;
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

async function runTests() {
  console.log('=== COMMUNITY TEST SUITE (COMMUNITY-01 + COMMUNITY-02) ===');

  log('--- Setup: register fresh test users at an unused barangay ---');
  const loc = pickFreshLocation();
  assert(!!loc, 'Found an unused real barangay for the test', getAllLocations().barangays);
  if (!loc) {
    console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
    process.exit(fail ? 1 : 0);
  }
  log(`Test location: ${loc.city} / ${loc.barangay} (${loc.country})`);

  const users = {
    A: `comA${stamp}`,
    B: `comB${stamp}`,
    C: `comC${stamp}`,
    D: `comD${stamp}`,
    E: `comE${stamp}`,
  };
  let tA, tB, tC, tD, tE;

  tA = await register(users.A, {
    first_name: 'Ava', last_name: 'Aguilar', display_name: 'Ava Aguilar',
    country: loc.country, city: loc.city, barangay: loc.barangay,
  });
  tB = await register(users.B, {
    first_name: 'Ben', last_name: 'Bautista', display_name: 'Ben Bautista',
    country: loc.country, city: loc.city, barangay: loc.barangay,
  });
  tC = await register(users.C, {
    first_name: 'Cara', last_name: 'Castro', display_name: 'Cara Castro',
    country: loc.country, city: loc.city, barangay: loc.barangay,
  });
  tD = await register(users.D, {
    first_name: 'Dan', last_name: 'Dela Cruz', display_name: 'Dan Dela Cruz',
    country: loc.country, city: loc.city, barangay: loc.barangay,
  });
  // E is a deliberate outsider (Manila) for negative/eligibility checks.
  tE = await register(users.E, {
    first_name: 'Eve', last_name: 'Espino', display_name: 'Eve Espino',
    country: 'Philippines', city: 'Manila', barangay: 'Quiapo',
  });
  assert(tA && tB && tC && tD && tE, 'All 5 test users registered at chosen locations');

  const listA = await api('/api/communities', 'GET', null, tA);
  const community = listA.body.communities.find(
    (c) => c.type === 'barangay' && c.barangay === loc.barangay
  );
  const cityCommunity = listA.body.communities.find(
    (c) => c.type === 'city' && c.city === loc.city
  );
  assert(!!community && !!cityCommunity, 'Barangay + city communities exist after profile is set');
  const cid = community.id;
  assert(!!cid, 'Test community id resolved');

  /* -----------------------------------------------------------------------
   * COMMUNITY-01 coverage
   * -------------------------------------------------------------------- */
  log('--- LIST: directory is location-scoped ---');
  const phNationwide = listA.body.communities.find((c) => c.type === 'nationwide');
  assert(
    !!phNationwide && phNationwide.membership === 'member' && phNationwide.eligibility === true,
    'Nationwide community auto-joined for eligible user'
  );
  assert(
    listA.body.communities.some((c) => c.type === 'barangay' && c.barangay === loc.barangay),
    'Test barangay community visible to eligible user A'
  );

  const listE = await api('/api/communities', 'GET', null, tE);
  assert(
    !listE.body.communities.some(
      (c) => c.type === 'barangay' && c.barangay === loc.barangay
    ),
    'Outsider E does not see the test barangay community'
  );

  log('--- ACCESS: eligibility enforced on detail/members/posts/election ---');
  const detailOk = await api(`/api/communities/${cid}`, 'GET', null, tA);
  assert(detailOk.status === 200 && detailOk.body.eligibility === true, 'Eligible user can view detail');
  const detailB = await api(`/api/communities/${cid}`, 'GET', null, tE);
  assert(detailB.status === 403, 'Ineligible user blocked from detail (403)');
  const membersB = await api(`/api/communities/${cid}/members`, 'GET', null, tE);
  assert(membersB.status === 403, 'Ineligible user blocked from members (403)');
  const postsB = await api(`/api/communities/${cid}/posts`, 'GET', null, tE);
  assert(postsB.status === 403, 'Ineligible user blocked from community feed (403)');
  const elecB = await api(`/api/communities/${cid}/election`, 'GET', null, tE);
  assert(
    elecB.status === 403 || (elecB.status === 200 && elecB.body.election.viewer.is_member === false),
    'Ineligible user blocked from election (403 or not a member)',
    { status: elecB.status }
  );
  const unknown = await api(`/api/communities/nonexistent-id`, 'GET', null, tA);
  assert(unknown.status === 404, 'Unknown community returns 404');

  log('--- MEMBERSHIP: join/leave, ownership, duplicates ---');
  const beforeJoin = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  const countBefore = beforeJoin.body.members.length;

  const joinA = await api(`/api/communities/${cid}/join`, 'POST', null, tA);
  assert(
    joinA.status === 200 && joinA.body.membership === 'member',
    'Eligible user A joins the test community'
  );
  assert(
    joinA.body.member_count === countBefore + 1,
    'Member count increments by exactly one on first join',
    { before: countBefore, after: joinA.body.member_count }
  );

  const joinAgain = await api(`/api/communities/${cid}/join`, 'POST', null, tA);
  assert(
    joinAgain.body.member_count === joinA.body.member_count,
    'Duplicate join does not create duplicate membership'
  );

  const joinB = await api(`/api/communities/${cid}/join`, 'POST', null, tB);
  const joinC = await api(`/api/communities/${cid}/join`, 'POST', null, tC);
  const joinD = await api(`/api/communities/${cid}/join`, 'POST', null, tD);
  assert(
    joinB.status === 200 && joinC.status === 200 && joinD.status === 200,
    'B, C, D join the test community'
  );
  const joinE = await api(`/api/communities/${cid}/join`, 'POST', null, tE);
  assert(joinE.status === 403, 'Ineligible user cannot join (403)');
  const forgedJoin = await api(`/api/communities/${cid}/join`, 'POST', { city: loc.city }, tE);
  assert(forgedJoin.status === 403, 'Forged location on join rejected (403)');

  log('--- ROLES: first member is owner, members listed with roles ---');
  const detailRoles = await api(`/api/communities/${cid}`, 'GET', null, tA);
  assert(
    detailRoles.status === 200 && detailRoles.body.role === 'owner' && detailRoles.body.can_moderate === true,
    'A sees role=owner + can_moderate on detail',
    detailRoles.body.role
  );

  const membersRoles = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  assert(
    membersRoles.body.members[0].role === 'owner' && membersRoles.body.members[0].username.toLowerCase() === users.A.toLowerCase(),
    'Owner listed first in members list',
    membersRoles.body.members.map((m) => `${m.username}:${m.role}`).join(',')
  );
  assert(
    membersRoles.body.members.every((m, i) => m.role === (i === 0 ? 'owner' : 'member')),
    'Member roles: owner then plain members (no moderator yet)'
  );

  log('--- PRIVACY: real name gated by real_name_visible ---');
  const aRow = membersRoles.body.members.find((m) => m.username.toLowerCase() === users.A.toLowerCase());
  assert(aRow && aRow.display_name === 'Ava Aguilar' && aRow.real_name === null, 'Real name hidden by default');
  const enableReal = await api('/api/profile', 'PATCH', {
    real_name: 'Ava Marie Aguilar', real_name_visible: true,
  }, tA);
  assert(enableReal.status === 200, 'Enable real name visibility for A');
  const membersVisible = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  const aVisible = membersVisible.body.members.find((m) => m.username.toLowerCase() === users.A.toLowerCase());
  assert(aVisible.real_name === 'Ava Marie Aguilar', 'Real name shown when enabled');
  await api('/api/profile', 'PATCH', { real_name_visible: false }, tA);
  const membersHidden = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  const aHidden = membersHidden.body.members.find((m) => m.username.toLowerCase() === users.A.toLowerCase());
  assert(aHidden.real_name === null, 'Real name hidden again when disabled');

  log('--- MEMBERSHIP: leave is bounded for non-nationwide communities ---');
  const leaveA = await api(`/api/communities/${cid}/leave`, 'POST', null, tA);
  assert(leaveA.status === 200 && leaveA.body.left === true, 'Member can leave the community');
  const leaveAgain = await api(`/api/communities/${cid}/leave`, 'POST', null, tA);
  assert(leaveAgain.body.membership === 'non-member', 'Repeated leave is safe');
  const leaveNW = await api(`/api/communities/${phNationwide.id}/leave`, 'POST', null, tA);
  assert(leaveNW.status === 400, 'Nationwide community cannot be left (400)');
  await api(`/api/communities/${cid}/join`, 'POST', null, tA);
  const rejoinDetail = await api(`/api/communities/${cid}`, 'GET', null, tA);
  assert(rejoinDetail.body.membership === 'member', 'A re-joins for subsequent tests');

  log('--- FEED: community posting gated by membership + eligibility ---');
  const postA = await api('/api/feed/posts', 'POST', {
    content: `Hello ${loc.barangay} community`, community_id: cid,
  }, tA);
  assert(
    postA.status === 201 && postA.body.author.username.toLowerCase() === users.A.toLowerCase(),
    'Member A can post to the community feed'
  );
  const cFeed = await api(`/api/communities/${cid}/posts`, 'GET', null, tA);
  assert(
    cFeed.status === 200 &&
    cFeed.body.posts.some((p) => p.id === postA.body.id && p.author.username.toLowerCase() === users.A.toLowerCase()),
    'Community feed returns the post'
  );
  const outsiderPost = await api('/api/feed/posts', 'POST', {
    content: 'Sneak', community_id: cid,
  }, tE);
  assert(outsiderPost.status === 403, 'Non-member cannot post to community (403)');
  const tampered = await api('/api/feed/posts', 'POST', {
    content: 'Tamper', community_id: 'does-not-exist',
  }, tA);
  assert(tampered.status === 404, 'Unknown community_id rejected (404)');

  /* -----------------------------------------------------------------------
   * COMMUNITY-02 coverage
   * -------------------------------------------------------------------- */
  log('--- Election: auto-created for the current month (voting phase) ---');
  const election = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(election.status === 200 && election.body.election && election.body.election.id, 'GET /election returns an election');
  assert(
    election.body.election.status === 'voting' && election.body.election.round === 1,
    'Election auto-created for the current month in voting phase',
    `${election.body.election.status} r${election.body.election.round}`
  );
  const idempotent = await api(`/api/communities/${cid}/election`, 'GET', null, tB);
  assert(
    idempotent.body.election.id === election.body.election.id,
    'Re-request returns the same election (no duplicates)'
  );
  assert(election.body.election.viewer.can_vote === true, 'Member A can vote');
  const eid = election.body.election.id;

  const setDates = (patch) => {
    const now = Date.now();
    const base = {
      nomination_start: iso(now - 2 * DAY),
      nomination_end: iso(now - 1 * DAY),
      voting_start: iso(now - 1 * DAY),
      voting_end: iso(now + 10 * DAY),
      runoff_end: iso(now + 20 * DAY),
      term_start: iso(now + 11 * DAY),
      term_end: iso(now + 40 * DAY),
    };
    const merged = { ...base, ...patch };
    const cols = ['nomination_start', 'nomination_end', 'voting_start', 'voting_end', 'runoff_end', 'term_start', 'term_end'];
    db.prepare(`UPDATE community_elections SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => merged[c]), eid);
  };

  log('--- Election: upcoming phase ---');
  setDates({ nomination_start: iso(Date.now() + 1 * DAY) });
  const up = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(up.body.election.status === 'upcoming' && up.body.election.phase === 'nomination', 'Upcoming phase detected');
  assert(up.body.election.viewer.can_nominate === false, 'No nominations before the window opens');

  log('--- Election: nominations + nomination rules ---');
  setDates({ nomination_end: iso(Date.now() + 1 * HOUR) });
  const nom = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(nom.body.election.status === 'nominations' && nom.body.election.phase === 'nomination', 'Nominations phase detected');

  const nB = await api(`/api/communities/${cid}/election/nominate`, 'POST', {}, tB);
  assert(nB.status === 201 && nB.body.election.viewer.is_candidate === true, 'B self-nominates (201)');
  const nC = await api(`/api/communities/${cid}/election/nominate`, 'POST', {}, tC);
  assert(nC.status === 201, 'C self-nominates (201)');
  const nA = await api(`/api/communities/${cid}/election/nominate`, 'POST', {}, tA);
  assert(nA.status === 201, 'A (owner) self-nominates (201)');
  const nE = await api(`/api/communities/${cid}/election/nominate`, 'POST', {}, tE);
  assert(nE.status === 403, 'Ineligible outsider cannot nominate (403)');
  const dupNom = await api(`/api/communities/${cid}/election/nominate`, 'POST', {}, tB);
  assert(dupNom.status === 409, 'Duplicate nomination rejected (409)');

  const afterNoms = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(afterNoms.body.election.candidates.length === 3, '3 candidates after nominations');

  log('--- Election: voting round 1 + one-vote rule ---');
  setDates({ nomination_end: iso(Date.now() - 1 * HOUR), voting_start: iso(Date.now() - 1 * HOUR) });
  const voting1 = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(voting1.body.election.status === 'voting' && voting1.body.election.round === 1, 'Voting round 1 detected');
  assert(voting1.body.election.candidates.every((c) => c.votes === null), 'Votes hidden while voting is open');

  const vA_B = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tA);
  assert(vA_B.status === 201, 'A votes for B (201)');
  const vB_A = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.A }, tB);
  assert(vB_A.status === 201, 'B votes for A (201)');
  const vC_A = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.A }, tC);
  assert(vC_A.status === 201, 'C votes for A (201)');
  const vD_B = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tD);
  assert(vD_B.status === 201, 'D votes for B (201)');
  // Tally: A=2 (B,C), B=2 (A,D) -> tie -> runoff between A and B.

  const dupVote = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tD);
  assert(dupVote.status === 409, 'Duplicate vote in a round rejected (409)');
  const nonCandidate = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.D }, tA);
  assert(nonCandidate.status === 400, 'Vote for a non-candidate rejected (400)');
  const ineligibleVote = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tE);
  assert(ineligibleVote.status === 403, 'Ineligible outsider cannot vote (403)');

  log('--- Election: runoff round 2 ---');
  setDates({ nomination_end: iso(Date.now() - 2 * HOUR), voting_start: iso(Date.now() - 2 * HOUR), voting_end: iso(Date.now() - 1 * HOUR) });
  const runoff = await api(`/api/communities/${cid}/election`, 'GET', null, tC);
  assert(
    runoff.body.election.status === 'voting' && runoff.body.election.round === 2 && runoff.body.election.runoff === true,
    'Runoff round 2 detected',
    `${runoff.body.election.status} r${runoff.body.election.round}`
  );
  assert(runoff.body.election.phase === 'runoff', 'Phase label = runoff');

  const rc = runoff.body.election.runoff_candidates;
  const aUserId = afterNoms.body.election.candidates.find((c) => c.username.toLowerCase() === users.A.toLowerCase()).user_id;
  const bUserId = afterNoms.body.election.candidates.find((c) => c.username.toLowerCase() === users.B.toLowerCase()).user_id;
  assert(
    rc.length === 2 && rc.includes(aUserId) && rc.includes(bUserId),
    'Runoff contains only the tied candidates A and B',
    rc
  );

  const excludedVote = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.C }, tC);
  assert(excludedVote.status === 400, 'Vote for an excluded candidate blocked (400)');

  // Round-2 votes that produce a persistent tie (A=2, B=2).
  const r2a = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tA);
  const r2b = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.A }, tB);
  const r2c = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.A }, tC);
  const r2d = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tD);
  assert(r2a.status === 201 && r2b.status === 201 && r2c.status === 201 && r2d.status === 201, 'Round-2 votes recorded');
  const dupR2 = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tD);
  assert(dupR2.status === 409, 'Duplicate round-2 vote rejected (409)');

  log('--- Election: persistent tie -> closed with no winner ---');
  setDates({ voting_end: iso(Date.now() - 2 * HOUR), runoff_end: iso(Date.now() - 1 * HOUR), term_start: iso(Date.now() - 1 * HOUR) });
  const tie = await api(`/api/communities/${cid}/election`, 'GET', null, tA);
  assert(tie.body.election.status === 'closed' && tie.body.election.winner === null, 'Tie closes with no winner');
  assert(tie.body.election.phase === 'completed', 'Phase label = completed (tie)');
  assert(
    tie.body.election.viewer.can_vote === false && tie.body.election.viewer.can_nominate === false,
    'No further actions after close'
  );
  assert(tie.body.election.candidates.every((c) => typeof c.votes === 'number'), 'Votes visible after close');

  const membersNoMod = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  assert(
    membersNoMod.body.members.every((m) => m.username.toLowerCase() !== users.B.toLowerCase() || m.role === 'member'),
    'No moderator term created on a tie (B stays a member)'
  );

  log('--- Election: decisive runoff result + moderator term ---');
  db.prepare('DELETE FROM community_election_votes WHERE election_id = ? AND round = 2').run(eid);
  const rvA_B = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tA);
  const rvB_A = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.A }, tB);
  const rvC_B = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tC);
  const rvD_B = await api(`/api/communities/${cid}/election/vote`, 'POST', { candidate_user_id: users.B }, tD);
  assert(
    rvA_B.status === 201 && rvB_A.status === 201 && rvC_B.status === 201 && rvD_B.status === 201,
    'Decisive round-2 votes recorded (B=3, A=1)'
  );

  const result = await api(`/api/communities/${cid}/election`, 'GET', null, tB);
  assert(
    result.body.election.status === 'closed' &&
    result.body.election.winner &&
    result.body.election.winner.username.toLowerCase() === users.B.toLowerCase(),
    'Election result: B elected moderator',
    result.body.election.winner
  );
  assert(result.body.election.phase === 'result', 'Phase label = result');

  const membersMod = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  const bRole = membersMod.body.members.find((m) => m.username.toLowerCase() === users.B.toLowerCase()).role;
  assert(bRole === 'moderator', 'B became moderator role');
  assert(
    membersMod.body.members.find((m) => m.username.toLowerCase() === users.A.toLowerCase()).role === 'owner',
    'A remains owner'
  );
  assert(
    result.body.election.moderator && result.body.election.moderator.username.toLowerCase() === users.B.toLowerCase(),
    'Active moderator shows B'
  );

  log('--- Election history ---');
  const hist = await api(`/api/communities/${cid}/election/history`, 'GET', null, tA);
  const hEntry = hist.body.elections && hist.body.elections.find((e) => e.id === eid);
  assert(!!hEntry, 'History includes the current election');
  assert(hEntry && hEntry.winner && hEntry.winner.username.toLowerCase() === users.B.toLowerCase(), 'History winner = B');
  assert(
    hEntry && hEntry.candidates.every((c) => typeof c.votes_round_1 === 'number'),
    'History records round-1 tallies'
  );
  assert(
    hEntry && hEntry.candidates.some((c) => c.votes_round_2 === 3),
    'History records round-2 tallies (B=3)'
  );
  assert(
    hEntry && !JSON.stringify(hEntry).includes('voter_user_id'),
    'History never exposes voter identities'
  );
  const histOutsider = await api(`/api/communities/${cid}/election/history`, 'GET', null, tE);
  assert(histOutsider.status === 403, 'Ineligible user cannot view history (403)');

  log('--- Moderator powers: feature/unfeature/delete ---');
  const memberFeat = await api(`/api/communities/${cid}/posts/${postA.body.id}/feature`, 'POST', null, tD);
  assert(memberFeat.status === 403, 'Plain member cannot feature (403)');
  const ownerFeat = await api(`/api/communities/${cid}/posts/${postA.body.id}/feature`, 'POST', null, tA);
  assert(ownerFeat.status === 200 && ownerFeat.body.featured === true, 'Owner features post (200)');

  const featuredList = await api(`/api/communities/${cid}/posts?featured=true`, 'GET', null, tA);
  assert(
    featuredList.body.posts.some((p) => p.id === postA.body.id),
    'Featured feed lists the featured post'
  );
  const featuredVisible = featuredList.body.posts.find((p) => p.id === postA.body.id);
  assert(featuredVisible && featuredVisible.is_featured === true && featuredVisible.can_moderate === true,
    'Featured post exposes is_featured + can_moderate to moderator');

  const postC = await api('/api/feed/posts', 'POST', {
    content: `C posts in community ${stamp}`, community_id: cid,
  }, tC);
  assert(postC.status === 201, 'C posts to the community');

  const modUnfeat = await api(`/api/communities/${cid}/posts/${postA.body.id}/feature`, 'DELETE', null, tB);
  assert(modUnfeat.status === 200 && modUnfeat.body.featured === false, 'Moderator B unfeatures (200)');

  // Comment moderation: C comments on A's post; moderator B deletes it; member D cannot.
  const cmtC = await api(`/api/feed/posts/${postA.body.id}/comments`, 'POST', { content: 'comment by member C' }, tC);
  assert(cmtC.status === 201 && cmtC.body.id, 'C comments on A\u2019s post');
  const delCmtByMember = await api(`/api/feed/comments/${cmtC.body.id}`, 'DELETE', null, tD);
  assert(delCmtByMember.status === 403, 'Plain member cannot delete a comment (403)');
  const delCmtByMod = await api(`/api/feed/comments/${cmtC.body.id}`, 'DELETE', null, tB);
  assert(delCmtByMod.status === 200, 'Moderator deletes a member comment (200)');

  // Post deletion: member D cannot delete C's post; moderator B can.
  const delByMember = await api(`/api/feed/posts/${postC.body.id}`, 'DELETE', null, tD);
  assert(delByMember.status === 403, 'Plain member cannot delete a community post (403)');
  const delByMod = await api(`/api/feed/posts/${postC.body.id}`, 'DELETE', null, tB);
  assert(delByMod.status === 200, 'Moderator deletes a community post (200)');

  // Moderator powers do not leak outside the community.
  const globalPost = await api('/api/feed/posts', 'POST', { content: 'global post' }, tA);
  const delGlobal = await api(`/api/feed/posts/${globalPost.body.id}`, 'DELETE', null, tB);
  assert(delGlobal.status === 403, 'Moderator cannot delete a global post (403)');

  log('--- Events ---');
  const evA = await api(`/api/communities/${cid}/events`, 'POST', {
    title: 'Barangay meetup', description: 'Demo event', location: 'Plaza', event_date: iso(Date.now() + 30 * DAY),
  }, tA);
  assert(evA.status === 201 && evA.body.event && evA.body.event.id, 'Owner creates an event (201)');
  const evE = await api(`/api/communities/${cid}/events`, 'POST', {
    title: 'outsider event', event_date: iso(Date.now() + 30 * DAY),
  }, tE);
  assert(evE.status === 403, 'Non-member cannot create an event (403)');
  const evB = await api(`/api/communities/${cid}/events`, 'POST', {
    title: 'moderator meetup', event_date: iso(Date.now() + 40 * DAY),
  }, tB);
  assert(evB.status === 201, 'Moderator B creates an event (201)');
  const evList = await api(`/api/communities/${cid}/events`, 'GET', null, tC);
  assert(evList.status === 200 && evList.body.events.length === 2, 'Events listed (2)');
  const evAId = evA.body && evA.body.event && evA.body.event.id;
  const evBId = evB.body && evB.body.event && evB.body.event.id;
  assert(!!evAId && !!evBId, 'Both event ids resolved before delete checks');
  const delEvByMember = await api(`/api/communities/${cid}/events/${evAId}`, 'DELETE', null, tD);
  assert(delEvByMember.status === 403, 'Plain member cannot delete an event (403)');
  const delEvByOwner = await api(`/api/communities/${cid}/events/${evBId}`, 'DELETE', null, tA);
  assert(delEvByOwner.status === 200, 'Owner/moderator can delete an event (200)');

  log('--- Media ---');
  const imgPost = await api('/api/feed/posts', 'POST', {
    content: `media ${stamp} https://media.example.com/a.png and more https://media.example.com/b.jpg`,
    community_id: cid,
  }, tC);
  assert(imgPost.status === 201, 'Media-bearing post created');
  const media = await api(`/api/communities/${cid}/media`, 'GET', null, tB);
  assert(media.status === 200 && media.body.media.length === 2, 'Media endpoint extracts the 2 image URLs', media.body.media);
  const mediaOutsider = await api(`/api/communities/${cid}/media`, 'GET', null, tE);
  assert(mediaOutsider.status === 403, 'Ineligible user cannot view media (403)');

  log('--- Moderator term expiry demotes back to member ---');
  db.prepare('UPDATE moderator_terms SET term_end = ? WHERE community_id = ? AND user_id = ?')
    .run(iso(Date.now() - 1 * DAY), cid, (await memberUserId(users.B, db)));
  const expired = await api(`/api/communities/${cid}/members`, 'GET', null, tA);
  assert(
    expired.body.members.find((m) => m.username.toLowerCase() === users.B.toLowerCase()).role === 'member',
    'B demoted to member after term expiry'
  );

  log('--- Stale membership does not grant posting ---');
  await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Manila', barangay: 'Quiapo',
  }, tD);
  const stalePost = await api('/api/feed/posts', 'POST', {
    content: 'After moving away', community_id: cid,
  }, tD);
  assert(stalePost.status === 403, 'Stale (ineligible) membership cannot post (403)');

  /* -----------------------------------------------------------------------
   * COMMUNITY-03 coverage
   * -------------------------------------------------------------------- */
  // D moved to Manila for the stale-membership check above; restore D to the
  // test barangay so the COMMUNITY-03 member-action checks run as a member.
  await api('/api/profile', 'PATCH', {
    country: loc.country, city: loc.city, barangay: loc.barangay,
  }, tD);
  log('--- Rules: create/read/update/delete ---');
  const rulesList = await api(`/api/communities/${cid}/rules`, 'GET', null, tA);
  assert(rulesList.status === 200, 'Rules list readable by member');
  assert(Array.isArray(rulesList.body.rules), 'Rules list is array');

  const createRuleA = await api(`/api/communities/${cid}/rules`, 'POST', {
    title: 'Be respectful',
    description: 'No harassment.',
  }, tA);
  assert(createRuleA.status === 201 && createRuleA.body.rule.id, 'Owner can create rule');
  const createRuleB = await api(`/api/communities/${cid}/rules`, 'POST', {
    title: 'No spam',
  }, tB);
  assert(createRuleB.status === 403, 'Plain member cannot create rule');
  const ruleId = createRuleA.body.rule.id;

  const readRule = await api(`/api/communities/${cid}/rules`, 'GET', null, tC);
  assert(readRule.body.rules.some(r => r.id === ruleId && r.title === 'Be respectful'), 'Rule readable by another member');

  const updateRule = await api(`/api/communities/${cid}/rules/${ruleId}`, 'PUT', {
    title: 'Be respectful and kind',
  }, tA);
  assert(updateRule.status === 200 && updateRule.body.rule.title === 'Be respectful and kind', 'Owner can update rule');
  const updateRuleMember = await api(`/api/communities/${cid}/rules/${ruleId}`, 'PUT', { title: 'Hacked' }, tC);
  assert(updateRuleMember.status === 403, 'Member cannot update rule');

  const deleteRule = await api(`/api/communities/${cid}/rules/${ruleId}`, 'DELETE', null, tA);
  assert(deleteRule.status === 200 && deleteRule.body.deleted === true, 'Owner can delete rule');
  const afterDelete = await api(`/api/communities/${cid}/rules`, 'GET', null, tA);
  assert(!afterDelete.body.rules.some(r => r.id === ruleId), 'Rule is gone after delete');

  log('--- Pinned posts: pin/unpin and limits ---');
  const pinPost = await api(`/api/communities/${cid}/posts/${postA.body.id}/pin`, 'POST', null, tA);
  assert(pinPost.status === 200 && pinPost.body.is_pinned === true, 'Owner can pin post');

  const memberPin = await api(`/api/communities/${cid}/posts/${postC.body.id}/pin`, 'POST', null, tD);
  assert(memberPin.status === 403, 'Member cannot pin post');

  const unpinPost = await api(`/api/communities/${cid}/posts/${postA.body.id}/unpin`, 'POST', null, tA);
  assert(unpinPost.status === 200 && unpinPost.body.is_pinned === false, 'Owner can unpin post');

  log('--- Reports: create, duplicate protection, invalid targets ---');
  const reportPost = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: postA.body.id, reason: 'Spam', details: 'Looks spammy',
  }, tD);
  assert(reportPost.status === 201 && reportPost.body.report.id, 'Member can report post');
  const duplicateReport = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: postA.body.id, reason: 'Spam',
  }, tD);
  assert(duplicateReport.status === 409, 'Duplicate open report rejected');

  const badReport = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: 'does-not-exist', reason: 'Spam',
  }, tD);
  assert(badReport.status === 404, 'Nonexistent post report rejected');

  const invalidReason = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: postA.body.id, reason: 'Not a real reason',
  }, tD);
  assert(invalidReason.status === 422, 'Invalid report reason rejected');

  const outsiderReport = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: postA.body.id, reason: 'Spam',
  }, tE);
  assert(outsiderReport.status === 403, 'Outsider cannot report');

  const publicReports = await api(`/api/communities/${cid}/reports`, 'GET', null, tD);
  assert(publicReports.status === 403, 'Member cannot view moderation queue');

  log('--- Moderation queue and actions ---');
  const modQueue = await api(`/api/communities/${cid}/reports`, 'GET', null, tA);
  assert(modQueue.status === 200 && modQueue.body.reports.length >= 1, 'Moderator sees reports');
  const reportId = modQueue.body.reports[0].id;

  const resolve = await api(`/api/communities/${cid}/reports/${reportId}/resolve`, 'POST', null, tA);
  assert(resolve.status === 200 && resolve.body.report.status === 'resolved', 'Moderator can resolve report');

  const dismiss = await api(`/api/communities/${cid}/reports`, 'POST', {
    target_type: 'post', target_id: postA.body.id, reason: 'Spam',
  }, tB);
  assert(dismiss.status === 201, 'Moderator can create report');
  const dismissId = dismiss.body.report.id;
  const dismissAction = await api(`/api/communities/${cid}/reports/${dismissId}/dismiss`, 'POST', null, tA);
  assert(dismissAction.status === 200 && dismissAction.body.report.status === 'dismissed', 'Moderator can dismiss report');

  log('--- Settings: read/update/persistence ---');
  const settingsRead = await api(`/api/communities/${cid}/settings`, 'GET', null, tA);
  assert(settingsRead.status === 200 && settingsRead.body.settings, 'Settings readable by member');

  const settingsUpdate = await api(`/api/communities/${cid}/settings`, 'PUT', {
    allow_member_posts: false,
    allow_events: true,
  }, tA);
  assert(settingsUpdate.status === 200 && settingsUpdate.body.settings.allow_member_posts === 0, 'Owner can update settings');
  const memberSettingsUpdate = await api(`/api/communities/${cid}/settings`, 'PUT', {
    allow_member_posts: true,
  }, tD);
  assert(memberSettingsUpdate.status === 403, 'Member cannot update settings');

  const persisted = await api(`/api/communities/${cid}/settings`, 'GET', null, tA);
  assert(persisted.body.settings.allow_member_posts === 0, 'Settings persist across reads');

  console.log(`\n=== COMMUNITY TEST RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  return fail === 0;
}

async function memberUserId(username, database) {
  const row = database.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  return row ? row.id : null;
}

async function cleanup(loc, users) {
  try {
    const userIds = [];
    for (const u of Object.values(users)) {
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
      if (row) userIds.push(row.id);
    }
    const placeholders = userIds.map(() => '?').join(',');
    const communityRow = loc
      ? db.prepare("SELECT id FROM communities WHERE type = 'barangay' AND country = ? AND city = ? AND barangay = ?")
          .get(loc.country, loc.city, loc.barangay)
      : null;
    const cids = [communityRow && communityRow.id].filter(Boolean);

    const run = (sql, ...params) => {
      try { db.prepare(sql).run(...params); } catch (e) { /* best-effort */ }
    };

    db.transaction(() => {
      for (const cid of cids) {
        run('DELETE FROM community_election_votes WHERE election_id IN (SELECT id FROM community_elections WHERE community_id = ?)', cid);
        run('DELETE FROM community_election_candidates WHERE election_id IN (SELECT id FROM community_elections WHERE community_id = ?)', cid);
        run('DELETE FROM community_elections WHERE community_id = ?', cid);
        run('DELETE FROM moderator_terms WHERE community_id = ?', cid);
        run('DELETE FROM community_events WHERE community_id = ?', cid);
        run('DELETE FROM community_members WHERE community_id = ?', cid);
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
    console.log('[cleanup] Removed test users, community rows, posts, memberships, and election data.');
    db.close();
  } catch (e) {
    try { db.close(); } catch (e2) { /* ignore */ }
    console.error('[cleanup] Failed to fully clean test data:', e.message);
  }
}

let locRef = null;
try {
  locRef = pickFreshLocation();
  locRef = locRef; // resolved below inside runTests again
} catch (e) { /* handled */ }

runTests()
  .then(async (ok) => {
    await cleanup(locRef, {
      A: `comA${stamp}`, B: `comB${stamp}`, C: `comC${stamp}`, D: `comD${stamp}`, E: `comE${stamp}`,
    });
    process.exit(ok ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup(locRef, {
      A: `comA${stamp}`, B: `comB${stamp}`, C: `comC${stamp}`, D: `comD${stamp}`, E: `comE${stamp}`,
    });
    process.exit(2);
  });