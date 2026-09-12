/** Replacement stress tester: sequential replacement uploads with server-liveness checks. */
import { readFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const seq = [
  ['.tmp-test/test-big.jpg', 'r1.jpg', 'image/jpeg'],
  ['.tmp-test/test-big-png.png', 'r2.png', 'image/png'],
  ['.tmp-test/test.webp', 'r3.webp', 'image/webp'],
  ['.tmp-test/test-big-png.png', 'r4.png', 'image/png'],
  ['.tmp-test/test-big.jpg', 'r5.jpg', 'image/jpeg'],
  ['.tmp-test/test-small.png', 'r6.png', 'image/png'],
];

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'feed06repro@test.com', password: 'Password123!' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('login failed');
  return j.access_token;
}

async function up(tok, p, n, t) {
  const fd = new FormData();
  fd.append('photo', new Blob([readFileSync(p)], { type: t }), n);
  const r = await fetch(`${BASE}/api/profile/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fd,
  });
  return { status: r.status, text: (await r.text()).slice(0, 90) };
}

async function main() {
  const tok = await login();
  let failAt = null;
  for (let i = 0; i < seq.length; i++) {
    const [p, n, t] = seq[i];
    try {
      const r = await up(tok, p, n, t);
      console.log(`step ${i + 1} ${n} -> status ${r.status}`);
      if (r.status !== 200) {
        failAt = { step: i + 1, name: n, status: r.status };
        break;
      }
    } catch (e) {
      console.log(`step ${i + 1} ${n} -> NETWORK ERROR ${e.message}`);
      failAt = { step: i + 1, name: n, networkError: e.message };
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // liveness check
  try {
    const h = await fetch(`${BASE}/api/health`);
    const alive = h.status === 200;
    console.log('server alive after sequence:', alive);
    if (failAt) console.log('FAILED AT:', JSON.stringify(failAt));
    else if (!alive) console.log('FAILED AT: server died but all uploads OK');
    else console.log('FULL SEQUENCE PASSED');
    process.exit(failAt ? 1 : alive ? 0 : 1);
  } catch (e) {
    console.log('SERVER NOT ALIVE after sequence');
    console.log('FAILED AT:', JSON.stringify(failAt));
    process.exit(1);
  }
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(2); });