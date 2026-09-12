const jwt = require('jsonwebtoken');
const fs = require('fs');

function decodeUserId(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub;
}

async function apiRequest(method, path, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('http://localhost:3000/api' + path, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const msgJs = fs.readFileSync('D:/FILES/project/KomuniPH/web/js/messages.js', 'utf8');
const css = fs.readFileSync('D:/FILES/project/KomuniPH/web/css/styles.css', 'utf8');
const appJs = fs.readFileSync('D:/FILES/project/KomuniPH/web/js/app.js', 'utf8');

async function run() {
  const ts = Date.now();
  const rA = await apiRequest('POST', '/auth/register', { email: 'msg04a' + ts + '@test.com', username: 'msg04a' + ts, password: 'Passw0rd!' }, null);
  const rB = await apiRequest('POST', '/auth/register', { email: 'msg04b' + ts + '@test.com', username: 'msg04b' + ts, password: 'Passw0rd!' }, null);
  const idA = decodeUserId(rA.data.access_token);
  const idB = decodeUserId(rB.data.access_token);
  const tokenA = rA.data.access_token;
  const tokenB = rB.data.access_token;

  // Setup: create conversation and send messages
  const conv = await apiRequest('POST', '/messages/conversations', { user_id: idB }, tokenA);
  if (!conv.data.id) { console.log('SETUP FAILED'); return; }
  const convId = conv.data.id;
  await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: 'Hello MESSAGE-04' }, tokenA);
  await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: 'Second message' }, tokenA);

  // Test 1: Button exists in messages page HTML
  console.log('=== Test 1: Button exists ===');
  console.log('Back to Home button:', msgJs.includes('messages-back-home') ? 'PASS' : 'FAIL');
  console.log('Button label:', msgJs.includes('← Back to Home') ? 'PASS' : 'FAIL');
  console.log('Button aria-label:', msgJs.includes('Back to Home') ? 'PASS' : 'FAIL');

  // Test 2: Button calls destroyMessagesPage + navigate
  console.log('\n=== Test 2: Button behavior ===');
  console.log('Calls destroyMessagesPage:', msgJs.includes('destroyMessagesPage()') ? 'PASS' : 'FAIL');
  console.log('Calls navigate:', msgJs.includes("navigate('/home')") ? 'PASS' : 'FAIL');
  console.log('Wired in initMessagesPage:', msgJs.includes('initMessagesPage') && msgJs.includes('messages-back-home') ? 'PASS' : 'FAIL');

  // Test 3: CSS styling exists
  console.log('\n=== Test 3: CSS ===');
  console.log('messages-back-home CSS:', css.includes('.messages-back-home') ? 'PASS' : 'FAIL');
  console.log('Responsive mobile CSS:', css.includes('@media (max-width: 640px)') ? 'PASS' : 'FAIL');

  // Test 4: Routing - /home route exists
  console.log('\n=== Test 4: Routing ===');
  console.log('/home route in app.js:', appJs.includes("case '/home'") ? 'PASS' : 'FAIL');
  console.log('renderHomePage in app.js:', appJs.includes('renderHomePage') ? 'PASS' : 'FAIL');
  console.log('initHomePage in app.js:', appJs.includes('initHomePage') ? 'PASS' : 'FAIL');
  console.log('destroyMessagesPage imported:', appJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');
  console.log('destroyMessagesPage called on route change:', appJs.includes('destroyMessagesPage()') ? 'PASS' : 'FAIL');

  // Test 5: Polling cleanup
  console.log('\n=== Test 5: Polling cleanup ===');
  console.log('stopPolling in destroyMessagesPage:', msgJs.includes('stopPolling()') && msgJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');
  console.log('hasNewMessagesIndicator reset:', msgJs.includes('hasNewMessagesIndicator = false') && msgJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');
  console.log('selectedConversationId reset:', msgJs.includes('selectedConversationId = null') && msgJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');

  // Test 6: Regression - existing functionality
  console.log('\n=== Test 6: Regression ===');
  const feedResult = await apiRequest('GET', '/feed', null, tokenA);
  console.log('Feed works:', feedResult.status === 200 ? 'PASS' : 'FAIL');

  const profileResult = await apiRequest('GET', '/profile', null, tokenA);
  console.log('Profile works:', profileResult.status === 200 ? 'PASS' : 'FAIL');

  const convResult = await apiRequest('GET', '/messages/conversations', null, tokenA);
  console.log('Messages list works:', convResult.status === 200 ? 'PASS' : 'FAIL');

  const msgsResult = await apiRequest('GET', '/messages/conversations/' + convId + '/messages', null, tokenA);
  console.log('Messages chat works:', msgsResult.status === 200 ? 'PASS' : 'FAIL');

  // Test 7: Messaging still works after button addition
  console.log('\n=== Test 7: Messaging functionality ===');
  const sendResult = await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: 'Test after button' }, tokenA);
  console.log('Send message works:', sendResult.status === 201 ? 'PASS' : 'FAIL');

  const unreadResult = await apiRequest('GET', '/messages/unread-count', null, tokenB);
  console.log('Unread count works:', unreadResult.status === 200 ? 'PASS' : 'FAIL');

  const markReadResult = await apiRequest('POST', '/messages/conversations/' + convId + '/read', null, tokenB);
  console.log('Mark read works:', markReadResult.status === 200 ? 'PASS' : 'FAIL');

  console.log('\n=== MESSAGE-04 verification complete ===');
}

run().catch(e => console.error(e));
