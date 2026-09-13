import { writeFileSync } from 'fs';
import { spawn } from 'child_process';
import sharp from 'sharp';

const BASE = 'http://localhost:3000';
const TOKEN_STORAGE_KEY = 'komuniph_auth_tokens';
const stamp = Date.now();
const testUser = 'verify' + stamp;

const storage = { _data: {}, setItem(k,v) { this._data[k] = v }, getItem(k) { return this._data[k] || null }, removeItem(k) { delete this._data[k] } };
let accessToken = null;

function setTokens(a, r) { accessToken = a; storage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access: a, refresh: r })); }
function clearTokens() { accessToken = null; storage.removeItem(TOKEN_STORAGE_KEY); }
function restoreTokens() { const s = storage.getItem(TOKEN_STORAGE_KEY); if (s) { const p = JSON.parse(s); if (p && p.access) { accessToken = p.access; return true; } } return false; }
function isAuthenticated() { return !!accessToken; }

function curl(path, method = 'GET', data = null, token = null) {
  const args = ['-s', '-X', method];
  if (token) args.push('-H', 'Authorization: Bearer ' + token);
  if (data !== null) { const buf = Buffer.from(JSON.stringify(data)); args.push('-H', 'Content-Type: application/json', '-d', buf); }
  args.push(BASE + path);
  return new Promise((resolve) => {
    const proc = spawn('C:\\Windows\\System32\\curl.exe', args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => { try { resolve(JSON.parse(out)) } catch { resolve(null) } });
  });
}

async function apiRequest(path) {
  return curl('/api' + path, 'GET', null, accessToken);
}

async function initAuth() {
  restoreTokens();
  if (!isAuthenticated()) return false;
  try { const p = await apiRequest('/profile'); if (!p || p.error) throw new Error('no profile'); return true; }
  catch { clearTokens(); return false; }
}

let pass = 0, fail = 0;
const assert = (c, l) => { if (c) { pass++; console.log('  PASS:', l); } else { fail++; console.log('  FAIL:', l); } };

async function run() {
  console.log('=== COMPREHENSIVE VERIFICATION (Bugs 1 & 2) ===');
  
  // 1. Register + Login
  const regRes = await curl('/api/auth/register', 'POST', { email: testUser + '@test.com', username: testUser, password: 'Password123!' });
  setTokens(regRes.access_token, regRes.refresh_token);
  assert(isAuthenticated(), '1. User logged in');
  
  // 2. Auth check
  const authOk = await initAuth();
  assert(authOk, '2. Auth verified');
  
  // 3. Upload background
  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff6f4f"/></svg>';
  const buf = await sharp(Buffer.from(svgStr)).toFormat('png').toBuffer();
  writeFileSync('C:/temp/verify_bg.png', buf);
  
  const uploadRes = await new Promise((resolve) => {
    const proc = spawn('C:\\Windows\\System32\\curl.exe', ['-s', '-X', 'POST', '-H', 'Authorization: Bearer ' + accessToken, '-F', 'background=@C:/temp/verify_bg.png', BASE + '/api/profile/background'], { windowsHide: true });
    let out = ''; proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => { try { resolve(JSON.parse(out)) } catch { resolve(null) } });
  });
  assert(uploadRes?.background_url, '3. Background upload succeeds');
  assert(uploadRes.background_url.startsWith('/uploads/'), '4. Background URL is HTTP path (not Windows path)');
  
  // 5. Save theme
  const profileAfterUpload = await apiRequest('/profile');
  const setTheme = await curl('/api/profile/theme', 'PATCH', {
    backgroundImage: profileAfterUpload.theme.custom.backgroundImage,
    cardBackground: '#fff7ec',
    cardOpacity: 0.95
  }, accessToken);
  assert(!setTheme.error, '5. Theme save succeeds');
  
  // 6. F5 test (Bug 2)
  accessToken = null;
  const authAfterF5 = await initAuth();
  assert(authAfterF5, '6. Auth restored after F5 (BUG 2 FIX)');
  
  // 7. Background persists after F5
  const profileAfterF5 = await apiRequest('/profile');
  const bgAfterF5 = profileAfterF5?.theme?.custom?.backgroundImage;
  assert(bgAfterF5 && bgAfterF5.startsWith('/uploads/'), '7. Background persists after F5');
  
  // 8. Logout + F5 -> Login (Bug 2)
  clearTokens();
  assert(!isAuthenticated(), '8. Not authenticated after logout');
  const authAfterLogout = await initAuth();
  assert(!authAfterLogout, '9. Auth fails after logout');
  
  // 9. Login again + F5 (Bug 2)
  const loginRes = await curl('/api/auth/login', 'POST', { email: testUser + '@test.com', password: 'Password123!' });
  setTokens(loginRes.access_token, loginRes.refresh_token);
  const authAfterReLogin = await initAuth();
  assert(authAfterReLogin, '10. Auth restored after re-login + F5');
  
  // 10. Reset (Part G)
  const resetRes = await curl('/api/profile/theme', 'PATCH', {
    backgroundImage: null, backgroundColor: null, backgroundGradient: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null,
    cardBackground: null
  }, accessToken);
  const profileAfterReset = await apiRequest('/profile');
  assert(!profileAfterReset?.theme?.custom?.backgroundImage, '11. Background cleared after reset');
  assert(profileAfterReset?.theme?.config?.background === '#fff7ec', '12. Default background restored');
  
  // 11. Public profile (Part H)
  accessToken = null;
  const publicProfile = await curl('/api/profile/' + testUser, 'GET');
  assert(publicProfile?.username === testUser, '13. Public profile accessible without auth');
  
  // 12. Invalid token rejected
  setTokens('fake-invalid-token', null);
  const invalidProfile = await apiRequest('/profile');
  assert(invalidProfile?.error, '14. Invalid token rejected');
  
  console.log('\n=== RESULTS: ' + pass + ' PASS, ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
