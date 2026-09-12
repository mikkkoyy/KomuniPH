/** Minimal two-upload reproducer: upload JPEG then PNG, same as the crash pattern. */
import { readFileSync } from 'fs';

const BASE = 'http://localhost:3000';

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'feed06repro@test.com', password: 'Password123!' }),
  });
  const json = await res.json();
  return json.access_token;
}

async function upload(tok, path, name, type) {
  const fd = new FormData();
  fd.append('photo', new Blob([readFileSync(path)], { type }), name);
  const res = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fd,
  });
  const text = await res.text();
  console.log(name, '-> status', res.status, text.slice(0, 120));
  return res.status;
}

async function main() {
  const tok = await login();
  console.log('logged in');
  let s1 = await upload(tok, '.tmp-test/test-big.jpg', 'u1.jpg', 'image/jpeg');
  await new Promise((r) => setTimeout(r, 300));
  let s2 = await upload(tok, '.tmp-test/test-big-png.png', 'u2.png', 'image/png');
  await new Promise((r) => setTimeout(r, 300));
  let s3 = await upload(tok, '.tmp-test/test.webp', 'u3.webp', 'image/webp');
  await new Promise((r) => setTimeout(r, 300));
  let s4 = await upload(tok, '.tmp-test/test-small.png', 'u4.png', 'image/png');
  await new Promise((r) => setTimeout(r, 300));
  let s5 = await upload(tok, '.tmp-test/test-big.jpg', 'u5.jpg', 'image/jpeg');
  await new Promise((r) => setTimeout(r, 300));
  const pass = [s1, s2, s3, s4, s5].every((s) => s === 200);
  console.log(pass ? 'ALL 5 UPLOADS PASSED' : 'SOME UPLOADS FAILED');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });