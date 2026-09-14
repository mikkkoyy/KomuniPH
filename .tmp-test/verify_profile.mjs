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
  // 1. Register
  const reg = await api('/api/auth/register', 'POST', {
    email: 'valtest' + ts + '@test.com',
    username: 'valtest' + ts,
    password: 'Password123!'
  });
  const token = reg.access_token;
  console.log('1. Registration:', token ? 'OK' : 'FAIL');

  // 2. Valid location update (Marikina -> Parang)
  const validUpdate = await api('/api/profile', 'PATCH', {
    first_name: 'Test', last_name: 'User',
    country: 'Philippines', city: 'Marikina', barangay: 'Parang'
  }, token);
  console.log('2. Valid loc update:', validUpdate.first_name === 'Test' && validUpdate.country === 'Philippines' && validUpdate.city === 'Marikina' && validUpdate.barangay === 'Parang' ? 'OK' : 'FAIL');

  // 3. Invalid barangay for city (Parang is in Marikina, not Quezon City)
  const invalidUpdate = await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Quezon City', barangay: 'Parang'
  }, token);
  console.log('3. Invalid brgy for QC:', invalidUpdate.error ? 'OK-rejected' : 'FAIL', invalidUpdate.error?.message || '');

  // 4. Invalid country
  const invalidCity = await api('/api/profile', 'PATCH', {
    country: 'United States', city: 'Manila'
  }, token);
  console.log('4. Invalid country:', invalidCity.error ? 'OK-rejected' : 'FAIL', invalidCity.error?.message || '');

  // 5. Invalid barangay for city (Sta. Elena is in Marikina, not Pasig)
  const invalidBrgy = await api('/api/profile', 'PATCH', {
    country: 'Philippines', city: 'Pasig', barangay: 'Sta. Elena'
  }, token);
  console.log('5. Invalid brgy for Pasig:', invalidBrgy.error ? 'OK-rejected' : 'FAIL', invalidBrgy.error?.message || '');

  // 6. Locations API - check Marikina barangays
  const locs = await api('/api/locations', 'GET');
  console.log('6. Marikina barangays:', locs.barangays.Philippines.Marikina.join(', '));

  // 7. Cities API returns strings
  const cities = await api('/api/locations/cities/Philippines', 'GET');
  console.log('7. Cities API:', Array.isArray(cities) && typeof cities[0] === 'string' ? 'Strings OK' : 'FAIL');
  console.log('   Cities sample:', cities.slice(0, 10).join(', '));

  // 8. Empty location fields
  const emptyLoc = await api('/api/profile', 'PATCH', {
    country: null, city: null, barangay: null
  }, token);
  console.log('8. Clear locs:', emptyLoc.country === null && emptyLoc.city === null && emptyLoc.barangay === null ? 'OK' : 'FAIL');
}

run().catch(console.error);
