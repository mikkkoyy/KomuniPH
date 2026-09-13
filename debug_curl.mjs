import { spawn } from 'child_process';
const BASE = 'http://localhost:3000';

async function curl(path, method = 'GET', data = null, token = null) {
  const args = ['-s', '-X', method];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (data !== null) {
    const buf = Buffer.from(JSON.stringify(data));
    args.push('-H', 'Content-Type: application/json', '-d', buf);
  }
  args.push(`${BASE}${path}`);
  console.log('curl args:', args);
  return new Promise((resolve, reject) => {
    const proc = spawn('C:\\Windows\\System32\\curl.exe', args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', (code) => {
      console.log('curl exit code:', code);
      console.log('stdout:', out.substring(0, 200));
      console.log('stderr:', err.substring(0, 200));
      try { resolve(JSON.parse(out)) } catch { resolve(null) }
    });
  });
}

const stamp = Date.now();
const testData = { email: `debug${stamp}@test.com`, username: `debug${stamp}`, password: 'Password123!' };
console.log('Testing register...');
const regRes = await curl('/api/auth/register', 'POST', testData);
console.log('Register result:', regRes);
if (regRes && regRes.access_token) {
  console.log('Testing profile fetch...');
  const profile = await curl('/api/profile', 'GET', null, regRes.access_token);
  console.log('Profile result:', profile);
}
