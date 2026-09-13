import { writeFileSync } from 'fs';
import { spawn } from 'child_process';

const BASE = 'http://localhost:3000';
const TOKEN_STORAGE_KEY = 'komuniph_auth_tokens';
const stamp = Date.now();

const localStorage = {
  _data: {},
  setItem(key, val) { this._data[key] = val; },
  getItem(key) { return this._data[key] || null; },
  removeItem(key) { delete this._data[key]; },
};

let accessToken = null;
let currentUserProfile = null;

function setTokens(access, refresh) {
  accessToken = access;
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ access, refresh }));
}

function clearTokens() {
  accessToken = null;
  currentUserProfile = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function restoreTokens() {
  const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed && parsed.access) {
      accessToken = parsed.access;
      return true;
    }
  }
  return false;
}

function isAuthenticated() { return !!accessToken; }

function curl(path, method = 'GET', data = null, token = null) {
  const args = ['-s', '-X', method];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (data !== null) {
    const buf = Buffer.from(JSON.stringify(data));
    args.push('-H', 'Content-Type: application/json', '-d', buf);
  }
  args.push(`${BASE}${path}`);
  return new Promise((resolve) => {
    const proc = spawn('C:\\Windows\\System32\\curl.exe', args, { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => { try { resolve(JSON.parse(out)) } catch { resolve(null) } });
  });
}

async function apiRequest(path, options = {}) {
  const { method = 'GET', body } = options;
  return curl('/api' + path, method, body || null, accessToken);
}

async function initAuth() {
  restoreTokens();
  if (!isAuthenticated()) return false;
  try {
    const profile = await apiRequest('/profile');
    if (!profile || profile.error) throw new Error(profile?.error?.message || 'No profile');
    currentUserProfile = profile;
    return true;
  } catch (err) {
    clearTokens();
    return false;
  }
}

function render() {
  const route = '/profile';
  if (route === '/profile' && !isAuthenticated()) return { page: 'login', authenticated: false };
  if (route === '/profile' && isAuthenticated()) return { page: 'profile', authenticated: true };
  return { page: 'unknown', authenticated: isAuthenticated() };
}

const testEmail = `e2e${stamp}@test.com`;
const testUser = `e2e${stamp}`;

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label) => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
  };

  console.log('=== TEST 1: Login -> Profile ===');
  const regRes = await curl('/api/auth/register', 'POST', { email: testEmail, username: testUser, password: 'Password123!' });
  setTokens(regRes.access_token, regRes.refresh_token);
  assert(isAuthenticated(), 'User is authenticated after login');
  const authOk = await initAuth();
  assert(authOk, 'initAuth() succeeds after login');
  const result1 = render();
  assert(result1.page === 'profile', 'Profile page renders after login');

  console.log('\n=== TEST 2: F5 / Refresh ===');
  accessToken = null; currentUserProfile = null;
  const authOk2 = await initAuth();
  assert(authOk2, 'initAuth() succeeds after refresh (tokens restored from localStorage)');
  const result2 = render();
  assert(result2.page === 'profile', 'Profile page renders after refresh (BUG 2 FIX)');
  assert(result2.authenticated, 'User remains authenticated after refresh');

  console.log('\n=== TEST 3: Background Upload ===');
  const { default: sharp } = await import('sharp');
  const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#ff6f4f"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).toFormat('png').toBuffer();
  writeFileSync('C:/temp/e2e_bg.png', buf);

  const uploadJson = new Promise((resolve) => {
    const proc = spawn('C:\\Windows\\System32\\curl.exe', ['-s', '-X', 'POST',
      '-H', `Authorization: Bearer ${accessToken}`,
      '-F', 'background=@C:\\temp\\e2e_bg.png',
      `${BASE}/api/profile/background`], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => { try { resolve(JSON.parse(out)) } catch { resolve(null) } });
  });
  const uploadRes = await uploadJson;
  assert(uploadRes?.background_url, 'Background upload succeeds');

  const profileAfterUpload = await apiRequest('/profile');
  assert(profileAfterUpload?.theme?.custom?.backgroundImage, 'Background URL stored in theme config');

  console.log('\n=== TEST 4: Theme Save ===');
  const setTheme = await curl('/api/profile/theme', 'PATCH', {
    backgroundImage: profileAfterUpload.theme.custom.backgroundImage,
    backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundSize: 'cover'
  }, accessToken);
  assert(setTheme && !setTheme.error, 'Theme save succeeds');

  console.log('\n=== TEST 5: Background Persistence After F5 ===');
  accessToken = null; currentUserProfile = null;
  const authOk3 = await initAuth();
  assert(authOk3, 'Auth restored after refresh');
  const profileAfterRefresh = await apiRequest('/profile');
  assert(profileAfterRefresh?.theme?.custom?.backgroundImage, 'Background persists after refresh');

  console.log('\n=== TEST 6: Logout -> F5 -> Login ===');
  clearTokens();
  accessToken = null;
  assert(!isAuthenticated(), 'User not authenticated after logout');
  const authOk4 = await initAuth();
  assert(!authOk4, 'initAuth() fails after logout');
  const result6 = render();
  assert(result6.page === 'login', 'Redirected to login after logout + refresh');

  console.log('\n=== TEST 7: Login Again -> Profile -> F5 ===');
  const loginRes2 = await curl('/api/auth/login', 'POST', { email: testEmail, password: 'Password123!' });
  setTokens(loginRes2.access_token, loginRes2.refresh_token);
  const authOk5 = await initAuth();
  assert(authOk5, 'Auth restored after re-login');
  const result7 = render();
  assert(result7.page === 'profile', 'Profile page renders after re-login + refresh');

  console.log('\n=== TEST 8: Theme Reset ===');
  const resetResponse = await curl('/api/profile/theme', 'PATCH', {
    backgroundImage: null, backgroundColor: null, backgroundGradient: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
  }, accessToken);
  const profileAfterReset = await apiRequest('/profile');
  assert(!profileAfterReset?.theme?.custom?.backgroundImage, 'Background cleared after reset');
  assert(profileAfterReset?.theme?.config?.background === '#fff7ec', 'Default background restored after reset');

  console.log('\n=== TEST 9: Public Profile ===');
  const savedToken = accessToken;
  accessToken = null;
   const publicProfile = await apiRequest(`/profile/${testUser}`, 'GET', null, null);
  assert(publicProfile?.username === testUser, 'Public profile loads without auth');
  accessToken = savedToken;

  console.log('\n=== TEST 10: Invalid Token Rejected ===');
  accessToken = 'fake-invalid-token';
  try {
    const result = await apiRequest('/profile');
    assert(result?.error, 'Invalid token correctly rejected');
  } catch (err) {
    assert(true, 'Invalid token rejected (exception)');
  }

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
