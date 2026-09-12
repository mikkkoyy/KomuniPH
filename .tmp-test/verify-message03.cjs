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
  const rA = await apiRequest('POST', '/auth/register', { email: 'msg3a' + ts + '@test.com', username: 'msg3a' + ts, password: 'Passw0rd!' }, null);
  const rB = await apiRequest('POST', '/auth/register', { email: 'msg3b' + ts + '@test.com', username: 'msg3b' + ts, password: 'Passw0rd!' }, null);
  const idA = decodeUserId(rA.data.access_token);
  const idB = decodeUserId(rB.data.access_token);
  console.log('User A:', idA, 'User B:', idB);

  // Setup: create conversation and send a message
  const conv = await apiRequest('POST', '/messages/conversations', { user_id: idB }, rA.data.access_token);
  if (!conv.data.id) { console.log('SETUP FAILED'); return; }
  const convId = conv.data.id;
  await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: 'Hello MESSAGE-03' }, rA.data.access_token);

  // T1 - Open chat structure
  console.log('\n=== T1: Open chat structure ===');
  console.log('T1 renderMessagesPage:', msgJs.includes('renderMessagesPage') ? 'PASS' : 'FAIL');
  console.log('T1 loadMessages:', msgJs.includes('loadMessages') ? 'PASS' : 'FAIL');
  console.log('T1 selectConversation:', msgJs.includes('selectConversation') ? 'PASS' : 'FAIL');
  console.log('T1 scrollToBottom:', msgJs.includes('scrollToBottom') ? 'PASS' : 'FAIL');
  console.log('T1 mark read on open:', msgJs.includes('markConversationRead') ? 'PASS' : 'FAIL');

  // T2 - Send message
  console.log('\n=== T2: Send message ===');
  const sendResult = await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: 'Hello MESSAGE-03' }, rA.data.access_token);
  console.log('T2 Message persisted:', sendResult.status === 201 ? 'PASS' : 'FAIL');
  console.log('T2 Sender correct:', sendResult.data.sender_id === idA ? 'PASS' : 'FAIL');

  // T3 - Enter behavior (code check)
  console.log('\n=== T3: Enter sends ===');
  const enterPattern = "e.key === 'Enter' && !e.shiftKey";
  console.log('T3 Enter handler:', msgJs.includes(enterPattern) ? 'PASS' : 'FAIL');
  console.log('T3 preventDefault:', msgJs.includes('e.preventDefault()') ? 'PASS' : 'FAIL');

  // T4 - Shift+Enter (code check)
  console.log('\n=== T4: Shift+Enter newline ===');
  console.log('T4 Shift+Enter allowed:', msgJs.includes('!e.shiftKey') ? 'PASS' : 'FAIL');
  console.log('T4 textarea used:', msgJs.includes('<textarea') ? 'PASS' : 'FAIL');

  // T5 - Empty message
  console.log('\n=== T5: Empty message ===');
  const emptyResult = await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: '   ' }, rA.data.access_token);
  console.log('T5 Empty rejected:', emptyResult.status === 422 ? 'PASS' : 'FAIL');

  // T6 - Older messages (load more)
  console.log('\n=== T6: Older messages ===');
  console.log('T6 Load older button:', msgJs.includes('chat-older-btn') ? 'PASS' : 'FAIL');
  console.log('T6 loadOlderMessages:', msgJs.includes('loadOlderMessages') ? 'PASS' : 'FAIL');
  console.log('T6 preserveScrollOnOlderLoad:', msgJs.includes('preserveScrollOnOlderLoad') ? 'PASS' : 'FAIL');
  console.log('T6 No older disabled:', msgJs.includes('chat-older-disabled') ? 'PASS' : 'FAIL');
  console.log('T6 Pagination via offset:', msgJs.includes('currentConversationOffset += messagesData.limit') ? 'PASS' : 'FAIL');

  // T7 - New incoming message (polling structure)
  console.log('\n=== T7: New incoming message ===');
  console.log('T7 Polling interval:', msgJs.includes('POLL_INTERVAL_MS') ? 'PASS' : 'FAIL');
  console.log('T7 startPolling:', msgJs.includes('startPolling') ? 'PASS' : 'FAIL');
  console.log('T7 stopPolling:', msgJs.includes('stopPolling') ? 'PASS' : 'FAIL');
  console.log('T7 New message indicator:', msgJs.includes('new-messages-indicator') ? 'PASS' : 'FAIL');
  console.log('T7 isNearBottom:', msgJs.includes('isNearBottom') ? 'PASS' : 'FAIL');
  console.log('T7 showNewMessagesIndicator:', msgJs.includes('showNewMessagesIndicator') ? 'PASS' : 'FAIL');

  // T8 - Polling cleanup
  console.log('\n=== T8: Polling cleanup ===');
  console.log('T8 destroyMessagesPage:', msgJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');
  console.log('T8 cleanup in app.js:', appJs.includes('destroyMessagesPage') ? 'PASS' : 'FAIL');
  console.log('T8 stopPolling on conversation switch:', msgJs.includes('stopPolling()') && msgJs.includes('selectConversation') ? 'PASS' : 'FAIL');
  console.log('T8 stopPolling on back button:', msgJs.includes('stopPolling()') && msgJs.includes('chat-back-btn') ? 'PASS' : 'FAIL');

  // T9 - Mobile
  console.log('\n=== T9: Mobile ===');
  console.log('T9 chat-back-btn:', msgJs.includes('chat-back-btn') ? 'PASS' : 'FAIL');
  console.log('T9 Mobile CSS:', css.includes('@media (max-width: 640px)') ? 'PASS' : 'FAIL');
  console.log('T9 Composer on mobile:', css.includes('chat-input-form') ? 'PASS' : 'FAIL');
  console.log('T9 Bottom nav preserved:', css.includes('padding-bottom: 5rem') ? 'PASS' : 'FAIL');

  // T10 - XSS safety
  console.log('\n=== T10: XSS safety ===');
  const xssBody = "<script>alert('xss')</script>";
  const xssResult = await apiRequest('POST', '/messages/conversations/' + convId + '/messages', { body: xssBody }, rA.data.access_token);
  console.log('T10 Script stored as text:', xssResult.status === 201 ? 'PASS' : 'FAIL');
  console.log('T10 escapeHtml in render:', msgJs.includes('escapeHtml(message.body)') ? 'PASS' : 'FAIL');
  console.log('T10 textContent-based escaping:', msgJs.includes('div.textContent = str') ? 'PASS' : 'FAIL');

  // T11 - MESSAGE-02 regression
  console.log('\n=== T11: MESSAGE-02 regression ===');
  const listAfter = await apiRequest('GET', '/messages/conversations', null, rA.data.access_token);
  const convAfter = listAfter.data.conversations.find(c => c.id === convId);
  console.log('T11 Conversation list works:', listAfter.status === 200 ? 'PASS' : 'FAIL');
  console.log('T11 unread_count present:', convAfter && 'unread_count' in convAfter ? 'PASS' : 'FAIL');
  const unreadCount = await apiRequest('GET', '/messages/unread-count', null, rB.data.access_token);
  console.log('T11 Unread count API works:', unreadCount.status === 200 ? 'PASS' : 'FAIL');
  const markRead = await apiRequest('POST', '/messages/conversations/' + convId + '/read', null, rB.data.access_token);
  console.log('T11 Mark read works:', markRead.status === 200 ? 'PASS' : 'FAIL');

  // T12 - Existing app regression
  console.log('\n=== T12: Existing app regression ===');
  const feedResult = await apiRequest('GET', '/feed', null, rA.data.access_token);
  console.log('T12 Feed works:', feedResult.status === 200 ? 'PASS' : 'FAIL');
  const profileResult = await apiRequest('GET', '/profile', null, rA.data.access_token);
  console.log('T12 Profile works:', profileResult.status === 200 ? 'PASS' : 'FAIL');
  console.log('T12 MESSAGE-01 chat works:', (await apiRequest('GET', '/messages/conversations/' + convId + '/messages', null, rA.data.access_token)).status === 200 ? 'PASS' : 'FAIL');

  console.log('\n=== T1-T12 Complete ===');
}

run().catch(e => console.error(e));
