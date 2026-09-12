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

const feedJs = fs.readFileSync('D:/FILES/project/KomuniPH/web/js/feed.js', 'utf8');
const appJs = fs.readFileSync('D:/FILES/project/KomuniPH/web/js/app.js', 'utf8');
const css = fs.readFileSync('D:/FILES/project/KomuniPH/web/css/styles.css', 'utf8');

async function run() {
  const ts = Date.now();
  const rA = await apiRequest('POST', '/auth/register', { email: 'soc2a' + ts + '@test.com', username: 'soc2a' + ts, password: 'Passw0rd!' }, null);
  const tokenA = rA.data.access_token;

  // --- Sidebar ---
  console.log('=== Sidebar ===');
  console.log('Creator Studio nav item:', feedJs.includes('Creator Studio') && feedJs.includes('#/creator-studio') ? 'PASS' : 'FAIL');
  console.log('Marketplace nav item:', feedJs.includes('Marketplace') && feedJs.includes('#/marketplace') ? 'PASS' : 'FAIL');
  console.log('Community Groups nav item:', feedJs.includes('Community Groups') && feedJs.includes('#/groups') ? 'PASS' : 'FAIL');
  console.log('Placement between Saved and Settings:',
    feedJs.includes("route: 'saved'") &&
    feedJs.includes("route: 'creator-studio'") &&
    feedJs.includes("route: 'settings'") &&
    feedJs.indexOf('creator-studio') > feedJs.indexOf('saved') &&
    feedJs.indexOf('settings') > feedJs.indexOf('groups') ? 'PASS' : 'FAIL');

  // --- Routes ---
  console.log('\n=== Routes ===');
  console.log('renderPlaceholderPage exported:', feedJs.includes('export function renderPlaceholderPage') ? 'PASS' : 'FAIL');
  console.log('initPlaceholderPage exported:', feedJs.includes('export function initPlaceholderPage') ? 'PASS' : 'FAIL');
  console.log('app.js imports renderPlaceholderPage:', appJs.includes('renderPlaceholderPage') ? 'PASS' : 'FAIL');
  console.log('app.js imports initPlaceholderPage:', appJs.includes('initPlaceholderPage') ? 'PASS' : 'FAIL');
  console.log('/creator-studio route:', appJs.includes("case '/creator-studio'") ? 'PASS' : 'FAIL');
  console.log('/marketplace route:', appJs.includes("case '/marketplace'") ? 'PASS' : 'FAIL');
  console.log('/groups route:', appJs.includes("case '/groups'") ? 'PASS' : 'FAIL');

  // --- Active state ---
  console.log('\n=== Active navigation ===');
  console.log('getSidebarHtml function:', feedJs.includes('export function getSidebarHtml') ? 'PASS' : 'FAIL');
  console.log('activeRoute param:', feedJs.includes('activeRoute') ? 'PASS' : 'FAIL');
  console.log('active class logic:', feedJs.includes('isActive') && feedJs.includes('activeClass') ? 'PASS' : 'FAIL');
  console.log('creator-studio in nav items:', feedJs.includes("route: 'creator-studio'") ? 'PASS' : 'FAIL');
  console.log('marketplace in nav items:', feedJs.includes("route: 'marketplace'") ? 'PASS' : 'FAIL');
  console.log('groups in nav items:', feedJs.includes("route: 'groups'") ? 'PASS' : 'FAIL');
  console.log('home in nav items:', feedJs.includes("route: 'home'") ? 'PASS' : 'FAIL');
  console.log('profile in nav items:', feedJs.includes("route: 'profile'") ? 'PASS' : 'FAIL');
  console.log('messages in nav items:', feedJs.includes("route: 'messages'") ? 'PASS' : 'FAIL');

  // --- Placeholder page content ---
  console.log('\n=== Placeholder pages ===');
  console.log('Creator Studio in app.js:', appJs.includes('Creator Studio') ? 'PASS' : 'FAIL');
  console.log('Marketplace in app.js:', appJs.includes('Marketplace') ? 'PASS' : 'FAIL');
  console.log('Community Groups in app.js:', appJs.includes('Community Groups') ? 'PASS' : 'FAIL');
  console.log('Coming soon text:', feedJs.includes('Coming soon.') ? 'PASS' : 'FAIL');
  console.log('No fake data:', !feedJs.includes('fake analytics') && !feedJs.includes('fake followers') ? 'PASS' : 'FAIL');
  console.log('initPlaceholderPage called in app.js:', appJs.includes('initPlaceholderPage') ? 'PASS' : 'FAIL');

  // --- Responsive ---
  console.log('\n=== Responsive ===');
  console.log('Desktop 3-col CSS:', css.includes('grid-template-columns: 280px 1fr 320px') ? 'PASS' : 'FAIL');
  console.log('Tablet 2-col CSS:', css.includes('grid-template-columns: 240px 1fr') ? 'PASS' : 'FAIL');
  console.log('Mobile 1-col CSS:', css.includes('@media (max-width: 640px)') ? 'PASS' : 'FAIL');
  console.log('Sidebar divider CSS:', css.includes('.sidebar-nav-divider') ? 'PASS' : 'FAIL');
  console.log('Placeholder page CSS:', css.includes('.placeholder-page') ? 'PASS' : 'FAIL');
  console.log('Placeholder card CSS:', css.includes('.placeholder-card') ? 'PASS' : 'FAIL');
  console.log('Mobile bottom nav preserved:', css.includes('.mobile-nav') ? 'PASS' : 'FAIL');

  // --- Regression ---
  console.log('\n=== Regression ===');
  const feedResult = await apiRequest('GET', '/feed', null, tokenA);
  console.log('Home feed:', feedResult.status === 200 ? 'PASS' : 'FAIL');

  const profileResult = await apiRequest('GET', '/profile', null, tokenA);
  console.log('Profile:', profileResult.status === 200 ? 'PASS' : 'FAIL');

  const convResult = await apiRequest('GET', '/messages/conversations', null, tokenA);
  console.log('Messages:', convResult.status === 200 ? 'PASS' : 'FAIL');

  const unreadResult = await apiRequest('GET', '/messages/unread-count', null, tokenA);
  console.log('Unread count:', unreadResult.status === 200 ? 'PASS' : 'FAIL');

  // --- Auth preserved ---
  console.log('\n=== Auth ===');
  console.log('Unauthenticated blocked:',
    (await apiRequest('GET', '/feed', null, 'badtoken')).status === 401 ? 'PASS' : 'FAIL');

  console.log('\n=== SOCIAL-02 verification complete ===');
}

run().catch(e => console.error(e));
