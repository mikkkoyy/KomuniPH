const https = (await import('http')).default;

const ts = Date.now();

function api(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = data.length;
    const req = https.request({ hostname: 'localhost', port: 3000, path, method, headers }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        try { resolve(JSON.parse(b)); } catch(e) { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  // Register
  const reg = await api('/api/auth/register', 'POST', {
    email: 'bgtest' + ts + '@test.com',
    username: 'bgtest' + ts,
    password: 'Password123!'
  });
  const token = reg.access_token;
  console.log('1. Registration:', token ? 'OK' : 'FAIL');

  // Test solid color background
  const solidBg = await api('/api/profile/theme', 'PATCH', {
    backgroundColor: '#ff0000',
    backgroundImage: null,
    backgroundGradient: null
  }, token);
  console.log('2. Solid color theme:', solidBg.theme?.config?.backgroundColor === '#ff0000' ? 'OK' : 'FAIL');

  // Test gradient background
  const gradientBg = await api('/api/profile/theme', 'PATCH', {
    backgroundColor: null,
    backgroundImage: null,
    backgroundGradient: 'linear-gradient(135deg, #ff0000, #0000ff)'
  }, token);
  console.log('3. Gradient theme:', gradientBg.theme?.config?.backgroundGradient ? 'OK' : 'FAIL');

  // Verify persistence after reload
  const profile = await api('/api/profile', 'GET', null, token);
  console.log('4. Background persists:', profile.theme?.config?.backgroundGradient ? 'OK' : 'FAIL');

  // Test invalid country rejected
  const badCountry = await api('/api/profile', 'PATCH', {
    country: 'Mars',
    city: 'New York'
  }, token);
  console.log('5. Invalid country rejected:', badCountry.error ? 'OK' : 'FAIL', badCountry.error?.message || '');

  // Test valid location with empty fields
  const validLoc = await api('/api/profile', 'PATCH', {
    country: 'Philippines',
    city: 'Marikina',
    barangay: 'Parang'
  }, token);
  console.log('6. Valid location:', validLoc.country === 'Philippines' && validLoc.city === 'Marikina' && validLoc.barangay === 'Parang' ? 'OK' : 'FAIL');

  // Test barangay not in city rejected
  const badBrgy = await api('/api/profile', 'PATCH', {
    country: 'Philippines',
    city: 'Marikina',
    barangay: 'Cubao'
  }, token);
  console.log('7. Invalid barangay rejected:', badBrgy.error ? 'OK' : 'FAIL', badBrgy.error?.message || '');
}

run().catch(console.error);
