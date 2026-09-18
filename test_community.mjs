import http from 'http';

const BASE_HOST = 'localhost';
const BASE_PORT = 3000;
const stamp = Date.now().toString().slice(-6);
const testPass = 'Password123!';

const userA = `comA${stamp}`;
const userB = `comB${stamp}`;

function api(path, method = 'GET', body = null, token = null) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      headers,
    }, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk.toString());
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

const loginResults = {};
const listResults = {};
const accessResults = {};
const membershipResults = {};
const privacyResults = {};
const feedResults = {};

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label, category = 'general') => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
    if (category === 'login') loginResults[label] = cond;
    if (category === 'list') listResults[label] = cond;
    if (category === 'access') accessResults[label] = cond;
    if (category === 'membership') membershipResults[label] = cond;
    if (category === 'privacy') privacyResults[label] = cond;
    if (category === 'feed') feedResults[label] = cond;
  };

  console.log('=== COMMUNITY-01 TEST SUITE ===');

  console.log('\n--- Setup: register users + set locations ---');
  const regA = await api('/api/auth/register', 'POST', {
    email: `${userA}@test.com`, username: userA, password: testPass
  });
  assert(regA.status === 201 && regA.body.access_token, 'Register user A', 'login');

  const regB = await api('/api/auth/register', 'POST', {
    email: `${userB}@test.com`, username: userB, password: testPass
  });
  assert(regB.status === 201 && regB.body.access_token, 'Register user B', 'login');

  const tokenA = regA.body.access_token;
  const tokenB = regB.body.access_token;

  // User A: Philippines, Manila, Intramuros. User B: Philippines, Quezon City, Diliman.
  const profileA = await api('/api/profile', 'PATCH', {
    first_name: 'Alice', last_name: 'Anderson', display_name: 'Alice Anderson',
    country: 'Philippines', city: 'Manila', barangay: 'Intramuros',
  }, tokenA);
  assert(profileA.status === 200, 'Set profile location for A (Manila)', 'login');

  const profileB = await api('/api/profile', 'PATCH', {
    first_name: 'Bob', last_name: 'Brown', display_name: 'Bob Brown',
    country: 'Philippines', city: 'Quezon City', barangay: 'Diliman',
  }, tokenB);
  assert(profileB.status === 200, 'Set profile location for B (Quezon City)', 'login');

  console.log('\n--- LIST: directory is location-scoped ---');
  const listA = await api('/api/communities', 'GET', null, tokenA);
  assert(
    listA.status === 200 && Array.isArray(listA.body.communities),
    'GET /api/communities returns a list',
    'list'
  );

  const phNationwide = listA.body.communities.find(c => c.type === 'nationwide');
  assert(
    !!phNationwide && phNationwide.membership === 'member' && phNationwide.eligibility === true,
    'Nationwide community auto-joined for eligible user',
    'list'
  );

  const manilaCity = listA.body.communities.find(c => c.type === 'city' && c.city === 'Manila');
  assert(!!manilaCity, 'Manila city community exists for A', 'list');

  const intraBarangay = listA.body.communities.find(c => c.type === 'barangay' && c.barangay === 'Intramuros');
  assert(!!intraBarangay, 'Intramuros barangay community exists for A', 'list');

  const listB = await api('/api/communities', 'GET', null, tokenB);
  assert(
    !listB.body.communities.some(c => (c.type === 'city' && c.city === 'Manila') || (c.type === 'barangay' && c.barangay === 'Intramuros')),
    'B does not see Manila/Intramuros communities',
    'list'
  );

  console.log('\n--- ACCESS: eligibility enforced on detail/members/posts ---');
  const manilaDetailA = await api(`/api/communities/${manilaCity.id}`, 'GET', null, tokenA);
  assert(
    manilaDetailA.status === 200 && manilaDetailA.body.eligibility === true,
    'Eligible user can view community detail',
    'access'
  );

  const manilaDetailB = await api(`/api/communities/${manilaCity.id}`, 'GET', null, tokenB);
  assert(manilaDetailB.status === 403, 'Ineligible user blocked from detail (403)', 'access');

  const manilaMembersB = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenB);
  assert(manilaMembersB.status === 403, 'Ineligible user blocked from members (403)', 'access');

  const manilaPostsB = await api(`/api/communities/${manilaCity.id}/posts`, 'GET', null, tokenB);
  assert(manilaPostsB.status === 403, 'Ineligible user blocked from community feed (403)', 'access');

  const unknown = await api(`/api/communities/nonexistent-id`, 'GET', null, tokenA);
  assert(unknown.status === 404, 'Unknown community returns 404', 'access');

  console.log('\n--- MEMBERSHIP: join/leave/duplicate ---');
  const membersBeforeJoin = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenA);
  const countBeforeJoin = membersBeforeJoin.body.members.length;

  const alreadyMember = membersBeforeJoin.body.members.some(m => m.username.toLowerCase() === userA.toLowerCase());
  const joinA = await api(`/api/communities/${manilaCity.id}/join`, 'POST', null, tokenA);
  assert(
    joinA.status === 200 && joinA.body.membership === 'member',
    'Eligible user can join city community',
    'membership'
  );

  const membersAfterJoin = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenA);
  const aRows = membersAfterJoin.body.members.filter(m => m.username.toLowerCase() === userA.toLowerCase());
  assert(
    !alreadyMember && aRows.length === 1 || alreadyMember && aRows.length === 1,
    'Membership is unique (single row per user)',
    'membership'
  );
  assert(
    joinA.body.member_count === countBeforeJoin + (alreadyMember ? 0 : 1),
    'Member count increments by exactly one on join',
    'membership'
  );

  const joinAgain = await api(`/api/communities/${manilaCity.id}/join`, 'POST', null, tokenA);
  assert(
    joinAgain.body.member_count === countBeforeJoin + (alreadyMember ? 0 : 1),
    'Duplicate join does not create duplicate membership',
    'membership'
  );

  const joinB = await api(`/api/communities/${manilaCity.id}/join`, 'POST', null, tokenB);
  assert(joinB.status === 403, 'Ineligible user cannot join (403)', 'membership');

  // Forged city in body must be rejected — join does not accept client location.
  const forgedJoin = await api(`/api/communities/${manilaCity.id}/join`, 'POST', { city: 'Manila' }, tokenB);
  assert(forgedJoin.status === 403, 'Forged location on join rejected (403)', 'membership');

  const leaveA = await api(`/api/communities/${manilaCity.id}/leave`, 'POST', null, tokenA);
  assert(leaveA.status === 200 && leaveA.body.left === true, 'Member can leave city community', 'membership');

  const leaveAgain = await api(`/api/communities/${manilaCity.id}/leave`, 'POST', null, tokenA);
  assert(leaveAgain.body.membership === 'non-member', 'Repeated leave is safe', 'membership');

  const leaveNW = await api(`/api/communities/${phNationwide.id}/leave`, 'POST', null, tokenA);
  assert(leaveNW.status === 400, 'Nationwide community cannot be left (400)', 'membership');

  // Rejoin so A is a member for subsequent feed/member tests.
  await api(`/api/communities/${manilaCity.id}/join`, 'POST', null, tokenA);

  const manilaAfterJoin = await api(`/api/communities/${manilaCity.id}`, 'GET', null, tokenA);
  assert(
    manilaAfterJoin.body.member_count === countBeforeJoin + (alreadyMember ? 0 : 1) &&
    manilaAfterJoin.body.membership === 'member',
    'Member count reflects joined user',
    'membership'
  );

  console.log('\n--- PRIVACY: real name gated by real_name_visible ---');
  const members = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenA);
  assert(
    members.status === 200 && Array.isArray(members.body.members),
    'Members list loads for eligible member',
    'privacy'
  );

  const aRow = members.body.members.find(m => m.username.toLowerCase() === userA.toLowerCase());
  assert(
    !!aRow && !!aRow.username && aRow.display_name === 'Alice Anderson',
    'Display Name remains the public identity in members list',
    'privacy'
  );
  assert(aRow.real_name === null, 'Real name hidden by default', 'privacy');

  // Enable real name visibility for A.
  const updateA = await api('/api/profile', 'PATCH', {
    real_name: 'Alice Marie Anderson', real_name_visible: true,
  }, tokenA);
  assert(updateA.status === 200, 'Enable Real Name visibility for A', 'privacy');

  const membersVisible = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenA);
  const aRowVisible = membersVisible.body.members.find(m => m.username.toLowerCase() === userA.toLowerCase());
  assert(
    !!aRowVisible && aRowVisible.real_name === 'Alice Marie Anderson' && aRowVisible.display_name === 'Alice Anderson',
    'Real name shown when real_name_visible enabled',
    'privacy'
  );

  const updateA2 = await api('/api/profile', 'PATCH', { real_name_visible: false }, tokenA);
  assert(updateA2.status === 200, 'Hide Real Name again for A', 'privacy');

  const membersHidden = await api(`/api/communities/${manilaCity.id}/members`, 'GET', null, tokenA);
  const aRowHidden = membersHidden.body.members.find(m => m.username.toLowerCase() === userA.toLowerCase());
  assert(aRowHidden.real_name === null, 'Real name hidden again when disabled', 'privacy');

  console.log('\n--- FEED: community posting gated by membership + eligibility ---');
  const postOK = await api('/api/feed/posts', 'POST', {
    content: 'Hello Manila community!', community_id: manilaCity.id,
  }, tokenA);
  assert(
    postOK.status === 201 && postOK.body.author && postOK.body.author.username.toLowerCase() === userA.toLowerCase(),
    'Member can post to community feed',
    'feed'
  );

  const communityFeed = await api(`/api/communities/${manilaCity.id}/posts`, 'GET', null, tokenA);
  assert(
    communityFeed.status === 200 &&
    communityFeed.body.posts.some(p => p.content === 'Hello Manila community!' && p.author.username.toLowerCase() === userA.toLowerCase()),
    'Community feed returns the post',
    'feed'
  );

  // B is not a member of Manila -> cannot post there.
  const postNotMember = await api('/api/feed/posts', 'POST', {
    content: 'Sneak post', community_id: manilaCity.id,
  }, tokenB);
  assert(postNotMember.status === 403, 'Non-member cannot post to community (403)', 'feed');

  const qcCity = listB.body.communities.find(c => c.type === 'city' && c.city === 'Quezon City');
  await api(`/api/communities/${qcCity.id}/join`, 'POST', null, tokenB);
  const postQC = await api('/api/feed/posts', 'POST', {
    content: 'Hello QC community!', community_id: qcCity.id,
  }, tokenB);
  assert(
    postQC.status === 201,
    'Member can post to their own city community',
    'feed'
  );

  // Tampered community_id.
  const tampered = await api('/api/feed/posts', 'POST', {
    content: 'Tamper', community_id: 'does-not-exist',
  }, tokenA);
  assert(tampered.status === 404, 'Unknown community_id rejected (404)', 'feed');

  // Ineligible-but-member stale membership: B changes location away from QC,
  // then tries to post again to QC community -> blocked by eligibility even
  // though the old membership row still exists.
  await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Manila', barangay: 'Intramuros',
  }, tokenB);
  const stalePost = await api('/api/feed/posts', 'POST', {
    content: 'After move', community_id: qcCity.id,
  }, tokenB);
  assert(stalePost.status === 403, 'Stale membership does not grant posting (403)', 'feed');

  console.log('\n=== FINAL SUMMARY ===');
  const summarize = (name, results) => {
    console.log(`\n${name}:`);
    Object.entries(results).forEach(([k, v]) => console.log(`  ${v ? 'PASS' : 'FAIL'}: ${k}`));
  };
  summarize('Login/setup', loginResults);
  summarize('List', listResults);
  summarize('Access', accessResults);
  summarize('Membership', membershipResults);
  summarize('Privacy', privacyResults);
  summarize('Feed', feedResults);

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });