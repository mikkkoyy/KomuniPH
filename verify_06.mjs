import puppeteer from 'puppeteer';
import http from 'http';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxIn0.eyJzdWIiOiIyNTUwN2MyOS0yNDNlLTQ4MDMtODk4OS04NTNjYTEzY2Y2MzYiLCJ0eXBlIjoiYWNjZXNzIiwiaXNzIjoia29tdW5pcGgiLCJhdWQiOiJrb211bmlwaC1jbGllbnRzIiwianRpIjoiMTRmMTc0M2ItMTI4MS00YzhhLTgzOGUtMTQ2MTAxMzQyYWMyIiwiaWF0IjoxNzg5MzUyODU0LCJleHAiOjE3ODkzNTM3NTR9.sPU9-xyztF5LN2sFh4aRuHUJ3QSC9XvTjfOvdpQTNgc';

function apiCall(method, path, bodyData) {
  return new Promise((resolve, reject) => {
    const data = bodyData ? JSON.stringify(bodyData) : null;
    const headers = { 'Authorization': 'Bearer ' + TOKEN };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api' + path, method, headers }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch(e) { resolve(b); }
      });
    });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', msg => console.log('PAGE:', msg.text()));

  // Track network responses for cache headers
  const networkLog = [];
  page.on('response', response => {
    const url = response.url();
    if (url.includes('styles.css') || url.includes('profile.js')) {
      networkLog.push({
        url: url.split('/').pop(),
        cacheControl: response.headers()['cache-control']
      });
    }
  });

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, TOKEN);

  console.log('=== STEP 1: Load profile page (image background already set) ===');
  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // === DOM Structure Verification ===
  console.log('\n=== STEP 2: DOM Structure ===');
  const domInfo = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const app = document.getElementById('app');
    const appChildren = app ? Array.from(app.children).map(c => c.tagName + (c.id ? '#' + c.id : '') + (c.className ? '.' + c.className : '')) : [];
    
    const header = document.querySelector('.profile-header');
    const nav = document.querySelector('.profile-nav');
    const statusStrip = document.querySelector('.profile-status-strip');
    const contentFrame = document.querySelector('.profile-content-frame');
    
    // Walk ancestors from header upward
    const headerAncestors = [];
    let el = header;
    while (el) {
      headerAncestors.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className : ''));
      el = el.parentElement;
    }
    
    // Walk ancestors from nav upward
    const navAncestors = [];
    el = nav;
    while (el) {
      navAncestors.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className : ''));
      el = el.parentElement;
    }
    
    // Check if nav is inside profile-frame
    const navInFrame = nav ? !!nav.closest('#profile-frame') : false;
    const headerInFrame = header ? !!header.closest('#profile-frame') : false;
    
    return {
      appChildren,
      navInProfileFrame: navInFrame,
      headerInProfileFrame: headerInFrame,
      headerAncestors,
      navAncestors,
      contentFrameExists: !!contentFrame
    };
  });
  console.log('DOM structure:', JSON.stringify(domInfo, null, 2));
  console.log('Nav inside #profile-frame:', domInfo.navInProfileFrame);
  console.log('Header inside #profile-frame:', domInfo.headerInProfileFrame);

  // === Computed Styles Verification ===
  console.log('\n=== STEP 3: Computed Styles ===');
  const computed = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const header = document.querySelector('.profile-header');
    const nav = document.querySelector('.profile-nav');
    const statusStrip = document.querySelector('.profile-status-strip');
    const contentFrame = document.querySelector('.profile-content-frame');
    
    const frameC = window.getComputedStyle(frame);
    const frameR = frame.getBoundingClientRect();
    
    const headerC = header ? window.getComputedStyle(header) : null;
    const navC = nav ? window.getComputedStyle(nav) : null;
    const stripC = statusStrip ? window.getComputedStyle(statusStrip) : null;
    
    return {
      frame: {
        rect: { x: frameR.x, y: frameR.y, width: frameR.width, height: frameR.height },
        backgroundImage: frameC.backgroundImage,
        backgroundColor: frameC.backgroundColor,
        backgroundSize: frameC.backgroundSize,
        backgroundPosition: frameC.backgroundPosition,
        backgroundRepeat: frameC.backgroundRepeat
      },
      header: headerC ? { backgroundColor: headerC.backgroundColor, backgroundImage: headerC.backgroundImage } : null,
      nav: navC ? { backgroundColor: navC.backgroundColor, backgroundImage: navC.backgroundImage } : null,
      statusStrip: stripC ? { backgroundColor: stripC.backgroundColor } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  console.log(JSON.stringify(computed, null, 2));
  console.log('Header transparent:', computed.header.backgroundColor === 'rgba(0, 0, 0, 0)');
  console.log('Nav transparent:', computed.nav.backgroundColor === 'rgba(0, 0, 0, 0)');
  console.log('Frame fills viewport:', computed.frame.rect.width >= computed.viewport.width);
  console.log('Frame starts at top-left:', computed.frame.rect.x === 0 && computed.frame.rect.y === 0);

  // === Screenshot ===
  console.log('\n=== STEP 4: Screenshots ===');
  await page.screenshot({ path: '/tmp/06-full.png', fullPage: true });
  await page.screenshot({ path: '/tmp/06-viewport.png' });
  console.log('Saved: 06-full.png (full page), 06-viewport.png (viewport)');

  // === TEST A: Normal F5 refresh ===
  console.log('\n=== STEP 5: TEST A - Normal F5 Refresh ===');
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  const afterF5 = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const r = frame.getBoundingClientRect();
    return {
      fillsViewport: r.width >= window.innerWidth,
      hasBgImage: c.backgroundImage && c.backgroundImage !== 'none',
      bgSize: c.backgroundSize,
      frameWidth: r.width
    };
  });
  console.log(JSON.stringify(afterF5, null, 2));
  console.log('PASS F5:', afterF5.fillsViewport && afterF5.hasBgImage);

  // === TEST B: Ctrl+Shift+R ===
  console.log('\n=== STEP 6: TEST B - Ctrl+Shift+R ===');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('R');
  await page.keyboard.up('Control');
  await page.keyboard.up('Shift');
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  const afterHardRefresh = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const r = frame.getBoundingClientRect();
    const h = document.querySelector('.profile-header');
    return {
      fillsViewport: r.width >= window.innerWidth,
      hasBgImage: c.backgroundImage && c.backgroundImage !== 'none',
      bgSize: c.backgroundSize,
      frameWidth: r.width,
      headerBg: h ? window.getComputedStyle(h).backgroundColor : 'not found'
    };
  });
  console.log(JSON.stringify(afterHardRefresh, null, 2));
  console.log('PASS Ctrl+Shift+R:', afterHardRefresh.fillsViewport && afterHardRefresh.hasBgImage);

  // === Cache headers in network responses ===
  console.log('\n=== STEP 7: Network Cache Headers ===');
  console.log('Network responses captured:', networkLog.length);
  networkLog.forEach(r => console.log('  ', r.url, '-> Cache-Control:', r.cacheControl));

  // === TEST: Solid color background ===
  console.log('\n=== STEP 8: Solid Color Background ===');
  await apiCall('PATCH', '/profile/theme', {
    backgroundImage: null, backgroundGradient: null, backgroundColor: '#ff6f4f',
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  const solidResult = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const r = frame.getBoundingClientRect();
    const h = document.querySelector('.profile-header');
    const n = document.querySelector('.profile-nav');
    return {
      fillsViewport: r.width >= window.innerWidth,
      bgColor: c.backgroundColor,
      headerBg: window.getComputedStyle(h).backgroundColor,
      navBg: window.getComputedStyle(n).backgroundColor
    };
  });
  console.log(JSON.stringify(solidResult, null, 2));
  console.log('PASS solid:', solidResult.fillsViewport && solidResult.headerBg === 'rgba(0, 0, 0, 0)' && solidResult.navBg === 'rgba(0, 0, 0, 0)');

  // === TEST: Image background ===
  console.log('\n=== STEP 9: Image Background ===');
  await apiCall('PATCH', '/profile/theme', {
    backgroundImage: 'https://images.unsplash.com/photo-1506260817572-a8006592c9b5?w=1920',
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat'
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  const imageResult = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const r = frame.getBoundingClientRect();
    const h = document.querySelector('.profile-header');
    const n = document.querySelector('.profile-nav');
    return {
      fillsViewport: r.width >= window.innerWidth,
      hasBgImage: c.backgroundImage && c.backgroundImage !== 'none',
      bgSize: c.backgroundSize,
      headerBg: window.getComputedStyle(h).backgroundColor,
      navBg: window.getComputedStyle(n).backgroundColor
    };
  });
  console.log(JSON.stringify(imageResult, null, 2));
  console.log('PASS image:', imageResult.fillsViewport && imageResult.hasBgImage && imageResult.headerBg === 'rgba(0, 0, 0, 0)' && imageResult.navBg === 'rgba(0, 0, 0, 0)');

  // === TEST: Edit Profile ===
  console.log('\n=== STEP 10: Edit Profile Flow ===');
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  await page.click('#profile-actions .profile-action-btn');
  await new Promise(r => setTimeout(r, 1000));

  const editFormState = await page.evaluate(() => {
    const editDiv = document.getElementById('profile-edit');
    const viewDiv = document.getElementById('profile-view');
    return {
      editVisible: editDiv ? window.getComputedStyle(editDiv).display !== 'none' : false,
      viewHidden: viewDiv ? window.getComputedStyle(viewDiv).display === 'none' : false,
      inputCount: editDiv ? editDiv.querySelectorAll('input, select, textarea').length : 0
    };
  });
  console.log('Edit form state:', JSON.stringify(editFormState));

  // Fill first name and last name (required)
  await page.type('#edit-first-name', 'VerifyTest');
  await page.type('#edit-last-name', 'User06');

  // Click Save Changes
  const saveBtn = await page.$('#profile-edit button');
  if (saveBtn) await saveBtn.click();
  await new Promise(r => setTimeout(r, 2000));

  const postSave = await page.evaluate(() => {
    const editDiv = document.getElementById('profile-edit');
    const viewDiv = document.getElementById('profile-view');
    const nameEl = document.getElementById('profile-name');
    return {
      editHidden: editDiv ? window.getComputedStyle(editDiv).display === 'none' : false,
      viewVisible: viewDiv ? window.getComputedStyle(viewDiv).display !== 'none' : false,
      nameText: nameEl ? nameEl.textContent : 'not found'
    };
  });
  console.log('Post-save:', JSON.stringify(postSave));
  console.log('PASS Edit Profile:', editFormState.editVisible && postSave.editHidden && postSave.viewVisible && postSave.nameText.includes('VerifyTest'));

  // === Serving project check ===
  console.log('\n=== STEP 11: Serving Project Path ===');
  const servingPath = await page.goto('http://localhost:3000/css/styles.css');
  const cssContent = await servingPath.text();
  const has100vw = cssContent.includes('width: 100vw');
  const hasOverflowHidden = cssContent.includes('overflow-x: hidden');
  console.log('CSS contains width: 100vw:', has100vw);
  console.log('CSS contains overflow-x: hidden:', hasOverflowHidden);

  console.log('\n=== ALL VERIFICATION TESTS COMPLETE ===');
  await page.screenshot({ path: '/tmp/06-final.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
