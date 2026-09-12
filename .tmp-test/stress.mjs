/** Concurrency stress: many uploads with concurrency 3 across 3 users. */
import { readFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const FILES = [
  ['.tmp-test/test-big.jpg', 'image/jpeg'],
  ['.tmp-test/test-big-png.png', 'image/png'],
  ['.tmp-test/test.webp', 'image/webp'],
  ['.tmp-test/test-small.png', 'image/png'],
];

async function regLogin(email, username) {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password: 'Password123!' }),
  });
  let json = null;
  try { json = await reg.json(); } catch { /* noop */ }
  if (json?.access_token) return json.access_token;
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  return (await login.json()).access_token;
}

async function up(tok, idx) {
  const [p, t] = FILES[idx % FILES.length];
  const n = `conc-${idx}.${p.split('.').pop()}`;
  const fd = new FormData();
  fd.append('photo', new Blob([readFileSync(p)], { type: t }), n);
  const r = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fd,
  });
  const text = await r.text().catch(() => '');
  return { idx, status: r.status, text: text.slice(0, 60) };
}

async function main() {
  const tokens = [];
  for (let i = 0; i < 3; i++) {
    tokens.push(await regLogin(`stress${i}@test.com`, `stressuser${i}`));
  }
  console.log('3 users ready');

  let failed = 0;
  let concurrent = 3;
  let q = [];
  const TOTAL = 24;
  for (let i = 0; i < TOTAL; i++) {
    const tok = tokens[i % tokens.length];
    q.push(up(tok, i));
    if (q.length >= concurrent) {
      const results = await Promise.allSettled(q);
      for (const res of results) {
        if (res.status === 'rejected') { failed++; console.log('REJECTED:', res.reason?.message); }
        else if (res.value.status !== 200) { failed++; console.log('NON200:', JSON.stringify(res.value)); }
      }
      q = [];
    }
  }
  const results = await Promise.allSettled(q);
  for (const res of results) {
    if (res.status === 'rejected') { failed++; console.log('REJECTED:', res.reason?.message); }
    else if (res.value.status !== 200) { failed++; console.log('NON200:', JSON.stringify(res.value)); }
  }

  const alive = await fetch(`${BASE}/api/health`).then((r) => r.status === 200).catch(() => false);
  console.log('total', TOTAL, 'failed', failed, 'server alive:', alive);
  process.exit(alive && failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('STRESS ERROR:', e.message); process.exit(2); });