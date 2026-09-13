import puppeteer from 'puppeteer';
import { spawn } from 'child_process';

const BASE = 'http://localhost:3000';
const stamp = Date.now();
const testEmail = `radius${stamp}@test.com`;
const testUser = `radius${stamp}`;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (cond, label) => {
    if (cond) { pass++; console.log('  PASS:', label); }
    else { fail++; console.log('  FAIL:', label); }
  };

  console.log('=== Registration ===');
  const regRes = await curl('/api/auth/register', 'POST', { email: testEmail, username: testUser, password: 'Password123!' });
  const accessToken = regRes?.access_token;
  assert(accessToken, 'Registration succeeds');

  // Reset custom_theme_config to null for clean test
  await curl('/api/profile/theme', 'PATCH', {
    cardBorderRadius: null
  }, accessToken);

  console.log('\n=== Setting up browser ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument((key, value) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, 'komuniph_auth_tokens', { access: accessToken, refresh: regRes.refresh_token });

  console.log('\n=== TEST: Login -> Profile ===');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.location.hash === '/login', { timeout: 5000 }).catch(() => {});

  await page.evaluate(() => { window.location.hash = '/profile'; });
  await page.waitForFunction(() => window.location.hash === '/profile', { timeout: 5000 }).catch(() => {});
  await page.waitForSelector('#profile-frame', { timeout: 10000 }).catch(() => {});
  await wait(2000);

  let profileFrame = await page.$('#profile-frame');
  assert(!!profileFrame, 'Profile page renders');

  console.log('\n=== TEST: Open Customization ===');
  await page.click('button[onclick="window.openCustomization()"]');
  await wait(500);

  const sliderValueBefore = await page.evaluate(() => document.getElementById('theme-cardBorderRadius')?.value);
  console.log('  Slider value before change:', sliderValueBefore);
  assert(sliderValueBefore === '1', `Default slider value is 1 (parseInt('1.75rem')=1, got ${sliderValueBefore})`);

  console.log('\n=== TEST: Set Corner Radius = 35 ===');
  await page.evaluate(() => {
    const slider = document.getElementById('theme-cardBorderRadius');
    if (slider) {
      slider.value = '35';
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    }
  });
  await wait(500);

  const cssVarAfterSet = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('profile-frame')).getPropertyValue('--theme-card-radius');
  });
  console.log('  CSS --theme-card-radius after setting 35 in preview:', cssVarAfterSet);
  assert(cssVarAfterSet.trim() === '35px', `Live preview shows "35px" (got "${cssVarAfterSet}")`);

  console.log('\n=== TEST: Save ===');
  await page.click('.theme-panel-footer .btn-primary');
  await wait(3000);

  const cssVarAfterSave = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('profile-frame')).getPropertyValue('--theme-card-radius');
  });
  console.log('  CSS --theme-card-radius after save:', cssVarAfterSave);
  assert(cssVarAfterSave.trim() === '35px', `After Save, CSS var is "35px" (got "${cssVarAfterSave}")`);

  console.log('\n=== TEST: Reopen Customization ===');
  await page.click('button[onclick="window.openCustomization()"]');
  await wait(500);

  const sliderValueAfterSave = await page.evaluate(() => document.getElementById('theme-cardBorderRadius')?.value);
  const radiusValueDisplay = await page.evaluate(() => document.getElementById('theme-cardBorderRadius-value')?.textContent);
  console.log('  Slider value after reopen:', sliderValueAfterSave);
  console.log('  Radius display after reopen:', radiusValueDisplay);
  assert(sliderValueAfterSave === '35', `Slider shows 35 after reopen (got ${sliderValueAfterSave})`);
  assert(radiusValueDisplay === '35px', `Display shows "35px" after reopen (got "${radiusValueDisplay}")`);

  console.log('\n=== TEST: Close & F5 ===');
  await page.click('.theme-panel-close');
  await wait(500);

  await page.reload({ waitUntil: 'networkidle0' });
  await wait(2000);

  const cssVarAfterReload = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('profile-frame')).getPropertyValue('--theme-card-radius');
  });
  console.log('  CSS --theme-card-radius after F5:', cssVarAfterReload);
  assert(cssVarAfterReload.trim() === '35px', `After F5, CSS var is "35px" (got "${cssVarAfterReload}")`);

  console.log('\n=== TEST: Visible Card Radius ===');
  const cardInfo = await page.evaluate(() => {
    const card = document.querySelector('.profile-module');
    if (!card) return { found: false };
    return {
      found: true,
      borderRadius: getComputedStyle(card).borderRadius,
      themeRadius: getComputedStyle(card).getPropertyValue('--theme-card-radius')
    };
  });
  console.log('  Card border-radius:', cardInfo.borderRadius);
  console.log('  Card --theme-card-radius:', cardInfo.themeRadius);
  assert(cardInfo.found, 'Profile module found');
  assert(cardInfo.borderRadius === '35px', `Profile module borderRadius is "35px" (got "${cardInfo.borderRadius}")`);

  console.log('\n=== TEST: Public Profile ===');
  const publicProfile = await curl(`/api/profile/${testUser}`);
  const publicCardRadius = publicProfile?.theme?.config?.cardBorderRadius;
  console.log('  Public profile cardBorderRadius:', publicCardRadius);
  assert(publicCardRadius === 35, `Public profile has cardBorderRadius=35 (got ${publicCardRadius})`);

  console.log('\n=== TEST: Reset to Default ===');
  await page.click('button[onclick="window.openCustomization()"]');
  await wait(500);
  await page.click('button[onclick="window.resetCustomization()"]');
  await wait(3000);

  // Check CSS var before reopening (updatePreview overwrites it)
  const cssVarAfterReset = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('profile-frame')).getPropertyValue('--theme-card-radius');
  });
  console.log('  CSS --theme-card-radius after reset (before reopen):', cssVarAfterReset);
  assert(cssVarAfterReset.trim() === '1.75rem', `After reset, CSS var is "1.75rem" (got "${cssVarAfterReset}")`);

  // Reopen to check slider value
  await page.click('button[onclick="window.openCustomization()"]');
  await wait(500);
  const sliderValueAfterReset = await page.evaluate(() => document.getElementById('theme-cardBorderRadius')?.value);
  console.log('  Slider value after reset:', sliderValueAfterReset);
  assert(sliderValueAfterReset === '1', `Slider returns to 1 after reset (got ${sliderValueAfterReset})`);

  console.log('\n=== TEST: Change to 50, Save, Verify DB ===');
  await page.evaluate(() => {
    const slider = document.getElementById('theme-cardBorderRadius');
    if (slider) {
      slider.value = '50';
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    }
  });
  await wait(500);
  await page.click('.theme-panel-footer .btn-primary');
  await wait(3000);

  const profileAfter50 = await curl('/api/profile', 'GET', null, accessToken);
  const dbCardRadius = profileAfter50?.theme?.config?.cardBorderRadius;
  console.log('  DB profile cardBorderRadius:', dbCardRadius);
  assert(dbCardRadius === 50, `DB stores cardBorderRadius=50 (got ${dbCardRadius})`);

  console.log('\n=== TEST: Invalid Values ===');
  const invalidResp = await curl('/api/profile/theme', 'PATCH', { cardBorderRadius: -1 }, accessToken);
  assert(invalidResp?.error, 'Backend rejects cardBorderRadius=-1');

  const invalidResp2 = await curl('/api/profile/theme', 'PATCH', { cardBorderRadius: 101 }, accessToken);
  assert(invalidResp2?.error, 'Backend rejects cardBorderRadius=101');

  console.log('\n=== TEST: Background Regression ===');
  const frameStyles = await page.evaluate(() => {
    const f = document.getElementById('profile-frame');
    return {
      backgroundSize: getComputedStyle(f).backgroundSize,
      backgroundPosition: getComputedStyle(f).backgroundPosition,
      backgroundRepeat: getComputedStyle(f).backgroundRepeat,
      backgroundAttachment: getComputedStyle(f).backgroundAttachment,
      minHeight: getComputedStyle(f).minHeight,
      backgroundImage: getComputedStyle(f).backgroundImage,
    };
  });
  console.log('  Frame styles:', JSON.stringify(frameStyles, null, 2));
  assert(frameStyles.backgroundAttachment === 'scroll', `backgroundAttachment is "scroll" (got "${frameStyles.backgroundAttachment}")`);
  assert(frameStyles.minHeight !== '0px', `minHeight is set (got "${frameStyles.minHeight}")`);

  await browser.close();

  console.log(`\n=== RESULTS: ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
