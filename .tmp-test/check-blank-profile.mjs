const BASE = 'http://localhost:3000';

async function check() {
  // Register a test user
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'blanktest@test.com', username: 'blanktest', password: 'Password123!' })
  });
  const regJson = await reg.json();
  const token = regJson.access_token;

  // Get own profile
  const profileRes = await fetch(`${BASE}/api/profile`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const profileJson = await profileRes.json();
  console.log('OWN PROFILE STATUS:', profileRes.status);
  console.log('OWN PROFILE THEME:', JSON.stringify(profileJson.theme, null, 2));
  console.log('OWN PROFILE DISPLAY_NAME:', profileJson.display_name);
  console.log('OWN PROFILE USERNAME:', profileJson.username);

  // Get public profile
  const publicRes = await fetch(`${BASE}/api/profile/blanktest`);
  const publicJson = await publicRes.json();
  console.log('PUBLIC PROFILE STATUS:', publicRes.status);
  console.log('PUBLIC PROFILE THEME:', JSON.stringify(publicJson.theme, null, 2));
  console.log('PUBLIC PROFILE DISPLAY_NAME:', publicJson.display_name);

  // Test theme update
  const themeRes = await fetch(`${BASE}/api/profile/theme`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ backgroundColor: '#111827', textColor: '#ffffff' })
  });
  const themeJson = await themeRes.json();
  console.log('THEME UPDATE STATUS:', themeRes.status);
  console.log('THEME UPDATE THEME:', JSON.stringify(themeJson.theme, null, 2));

  // Get profile after theme update
  const afterRes = await fetch(`${BASE}/api/profile`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const afterJson = await afterRes.json();
  console.log('AFTER UPDATE THEME:', JSON.stringify(afterJson.theme, null, 2));
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
