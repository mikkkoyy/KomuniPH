import puppeteer from 'puppeteer';
import http from 'http';

const IMAGE_PATH = 'C:\\Users\\Administrator\\Desktop\\New folder (2)\\aa.jpg';

function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ identifier: 'verify06', password: 'Testpass123' });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/auth/login',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let body = ''; res.on('data', d => body += d); res.on('end', () => {
        try { resolve(JSON.parse(body).access_token); } catch(e) { reject(e); }
      });
    });
    req.write(data); req.end();
  });
}

function apiCall(token, method, path, bodyData) {
  return new Promise((resolve, reject) => {
    const data = bodyData ? JSON.stringify(bodyData) : null;
    const headers = { 'Authorization': 'Bearer ' + token };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api' + path, method, headers }, res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const token = await login();
  console.log('Token acquired');

  // Reset theme to default first (clear any existing background)
  console.log('Resetting theme...');
  try {
    await apiCall(token, 'PATCH', '/profile/theme', {
      backgroundImage: null, backgroundGradient: null, backgroundColor: null,
      backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
    });
    console.log('Theme reset');
  } catch(e) { console.log('Reset error:', e.message); }

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // Step 1: Open customization panel
  console.log('\n=== STEP 1: Open customization panel ===');
  const customizeBtn = await page.$('#profile-actions .profile-action-btn[onclick*="openCustomization"]');
  if (!customizeBtn) {
    // Try alternate selector
    const buttons = await page.$$('#profile-actions .profile-action-btn');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent, btn);
      console.log('Button text:', text);
    }
  }
  if (customizeBtn) await customizeBtn.click();
  await new Promise(r => setTimeout(r, 1000));

  // Step 2: Select Background Image radio
  console.log('\n=== STEP 2: Select Background Image ===');
  const imageRadio = await page.$('input[name="bg-type"][value="image"]');
  if (imageRadio) {
    await imageRadio.click();
    console.log('Selected Background Image radio');
  } else {
    console.log('ERROR: Background Image radio not found');
  }
  await new Promise(r => setTimeout(r, 500));

  // Step 3: Upload aa.jpg
  console.log('\n=== STEP 3: Upload aa.jpg ===');
  console.log('File:', IMAGE_PATH);
  const fileInput = await page.$('#theme-background-input');
  if (!fileInput) {
    console.log('ERROR: File input not found');
    console.log('Available inputs:', await page.evaluate(() => Array.from(document.querySelectorAll('input[type="file"]')).map(i => i.id)));
    await browser.close();
    return;
  }

  // Make the input visible if needed
  await page.evaluate(() => {
    const input = document.getElementById('theme-background-input');
    if (input) {
      input.style.display = 'block';
      input.style.visibility = 'visible';
      input.style.opacity = '1';
    }
  });

  await fileInput.uploadFile(IMAGE_PATH);
  console.log('File uploaded via Puppeteer');

  // Wait for upload to complete
  await new Promise(r => setTimeout(r, 3000));

  // Check if upload succeeded
  const uploadStatus = await page.evaluate(() => {
    const status = document.getElementById('theme-background-status');
    return status ? status.textContent + ' (' + status.className + ')' : 'not found';
  });
  console.log('Upload status:', uploadStatus);

  // Step 4: Check background is applied
  console.log('\n=== STEP 4: Verify background applied ===');
  const bgAfterUpload = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgColor: c.backgroundColor,
      bgSize: c.backgroundSize,
      bgPosition: c.backgroundPosition,
      bgRepeat: c.backgroundRepeat,
      inlineStyle: frame.getAttribute('style')
    };
  });
  console.log('Background after upload:', JSON.stringify(bgAfterUpload, null, 2));

  // Step 5: Save customization
  console.log('\n=== STEP 5: Save customization ===');
  const saveBtn = await page.$('#theme-customization-panel button[onclick*="saveCustomization"]');
  if (!saveBtn) {
    console.log('Save button not found, searching...');
    const allButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#theme-customization-panel button')).map(b => ({
        text: b.textContent.trim(),
        onclick: b.getAttribute('onclick')
      }));
    });
    console.log('Panel buttons:', JSON.stringify(allButtons, null, 2));
  }
  if (saveBtn) {
    await saveBtn.click();
    console.log('Save button clicked');
  }
  await new Promise(r => setTimeout(r, 3000));

  // Step 6: Verify background after save
  console.log('\n=== STEP 6: Verify background after save ===');
  const bgAfterSave = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgColor: c.backgroundColor,
      bgSize: c.backgroundSize,
      inlineStyle: frame.getAttribute('style')?.substring(0, 300)
    };
  });
  console.log('Background after save:', JSON.stringify(bgAfterSave, null, 2));

  // Step 7: Screenshot before refresh
  await page.screenshot({ path: '/tmp/06-uploaded-before-refresh.png' });
  console.log('Screenshot: /tmp/06-uploaded-before-refresh.png');

  // Step 8: Reload and verify persistence
  console.log('\n=== STEP 7: Reload page ===');
  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  const bgAfterReload = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgColor: c.backgroundColor,
      bgSize: c.backgroundSize,
      bgPosition: c.backgroundPosition,
      bgRepeat: c.backgroundRepeat,
      inlineStyle: frame.getAttribute('style')?.substring(0, 300)
    };
  });
  console.log('Background after reload:', JSON.stringify(bgAfterReload, null, 2));

  // Step 9: Screenshot after refresh
  await page.screenshot({ path: '/tmp/06-uploaded-after-refresh.png' });
  console.log('Screenshot: /tmp/06-uploaded-after-refresh.png');

  // Step 10: Check what image file was saved on server
  console.log('\n=== STEP 8: Verify server-side persistence ===');
  const profile = await apiCall(token, 'GET', '/profile');
  console.log('Profile theme:', JSON.stringify(profile?.theme || 'no theme', null, 2));

  // Step 11: Verify background covers entire frame
  console.log('\n=== STEP 9: Frame coverage check ===');
  const frameCheck = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const r = frame.getBoundingClientRect();
    const vp = { width: window.innerWidth, height: window.innerHeight };
    return {
      frameWidth: r.width,
      viewportWidth: vp.width,
      frameStartsAtLeft: r.x === 0,
      fillsViewportWidth: r.width >= vp.width,
      bgSize: c.backgroundSize,
      bgRepeat: c.backgroundRepeat,
      bgPosition: c.backgroundPosition,
      hasBgImage: c.backgroundImage && c.backgroundImage !== 'none'
    };
  });
  console.log('Frame coverage:', JSON.stringify(frameCheck, null, 2));

  console.log('\n=== TEST COMPLETE ===');
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
