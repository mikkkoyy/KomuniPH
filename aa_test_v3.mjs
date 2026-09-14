import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';

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

// Check if aa.jpg is a landscape, portrait, or square
function getImageInfo() {
  return new Promise((resolve) => {
    const data = fs.readFileSync(IMAGE_PATH);
    // Check JPEG headers
    if (data[0] === 0xFF && data[1] === 0xD8) {
      // Parse JPEG SOF marker for dimensions
      let i = 2;
      while (i < data.length - 10) {
        if (data[i] === 0xFF) {
          const marker = data[i+1];
          if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            const height = (data[i+5] << 8) | data[i+6];
            const width = (data[i+7] << 8) | data[i+8];
            resolve({ width, height, ratio: width/height, type: width > height ? 'landscape' : width < height ? 'portrait' : 'square' });
            return;
          }
          const segLen = (data[i+2] << 8) | data[i+3];
          i += 2 + segLen;
        } else {
          i++;
        }
      }
    }
    resolve({ width: 'unknown', height: 'unknown', type: 'unknown' });
  });
}

(async () => {
  const info = await getImageInfo();
  console.log('aa.jpg dimensions:', info);

  const token = await login();

  // Reset theme to clear background
  let resetData = JSON.stringify({
    backgroundImage: null, backgroundGradient: null, backgroundColor: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
  });
  let req = http.request({
    hostname: 'localhost', port: 3000, path: '/api/profile/theme',
    method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': resetData.length }
  }, res => { let body=''; res.on('data', d => body += d); res.on('end', () => console.log('Theme reset OK')); });
  req.write(resetData); req.end();
  await new Promise(r => setTimeout(r, 1000));

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  // Open customization
  const customizeBtn = await page.$('#profile-actions .profile-action-btn[onclick*="openCustomization"]');
  if (customizeBtn) await customizeBtn.click();
  await new Promise(r => setTimeout(r, 1000));

  // Select image type
  const imageRadio = await page.$('input[name="bg-type"][value="image"]');
  if (imageRadio) await imageRadio.click();
  await new Promise(r => setTimeout(r, 500));

  // Upload aa.jpg
  const fileInput = await page.$('#theme-background-input');
  await page.evaluate(() => {
    const input = document.getElementById('theme-background-input');
    if (input) { input.style.display = 'block'; input.style.visibility = 'visible'; input.style.opacity = '1'; }
  });
  await fileInput.uploadFile(IMAGE_PATH);
  console.log('Uploaded aa.jpg');
  await new Promise(r => setTimeout(r, 4000));

  // Save
  const saveBtn = await page.$('#theme-customization-panel button[onclick*="saveCustomization"]');
  if (saveBtn) await saveBtn.click();
  console.log('Saved');
  await new Promise(r => setTimeout(r, 3000));

  // NOW: Take screenshot and analyze pixels
  await page.screenshot({ path: '/tmp/06-aa-full.png' });
  console.log('Screenshot: /tmp/06-aa-full.png');

  // Pixel analysis - sample key positions across the screen
  const pixelAnalysis = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const rect = frame.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    // Key check: does the frame cover full viewport width?
    return {
      viewport: { width: vw, height: vh },
      frameRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frameCoversWidth: rect.width >= vw,
      frameStartsAtLeft: rect.x === 0,
      bgImage: c.backgroundImage,
      bgSize: c.backgroundSize,
      bgRepeat: c.backgroundRepeat,
      bgPosition: c.backgroundPosition
    };
  });
  console.log('Frame analysis:', JSON.stringify(pixelAnalysis, null, 2));

  // Sample background colors at corners and edges
  const cornerColors = await page.evaluate(() => {
    const positions = [
      { x: 0, y: 0, desc: 'top-left' },
      { x: 0, y: 50, desc: 'top-left (50px down)' },
      { x: 0, y: 400, desc: 'left-center' },
      { x: 0, y: 750, desc: 'bottom-left' },
      { x: 1280, y: 0, desc: 'top-right' },
      { x: 1280, y: 50, desc: 'top-right (50px down)' },
      { x: 1280, y: 400, desc: 'right-center' },
      { x: 1280, y: 750, desc: 'bottom-right' },
      { x: 640, y: 0, desc: 'top-center' },
      { x: 640, y: 750, desc: 'bottom-center' },
      { x: 100, y: 100, desc: 'header area' },
      { x: 640, y: 100, desc: 'header center' },
      { x: 1200, y: 100, desc: 'header right' },
    ];
    
    // Use getComputedStyle on the body and profile-frame
    const body = document.body;
    const frame = document.getElementById('profile-frame');
    const bodyStyle = window.getComputedStyle(body);
    const frameStyle = window.getComputedStyle(frame);
    
    // Check if the frame's background-color is visible (i.e., not covered by image)
    // If the background-image is set and covers the element, the color should be hidden
    const frameRect = frame.getBoundingClientRect();
    
    // Check overflow
    const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
    
    return {
      bodyBgColor: bodyStyle.backgroundColor,
      bodyMargin: bodyStyle.margin,
      bodyPadding: bodyStyle.padding,
      frameBgColor: frameStyle.backgroundColor,
      frameBgImage: frameStyle.backgroundImage,
      frameHasVerticalScroll: frameRect.height > window.innerHeight,
      documentHasHorizontalScroll: hasHorizontalScroll,
      // Check element that's at the right edge of viewport
      elementAtRightEdge: (() => {
        const el = document.elementFromPoint(vw - 5, 50);
        return el ? el.tagName + '#' + el.id + '.' + el.className : 'none';
      })(),
      // Check element at left edge
      elementAtLeftEdge: (() => {
        const el = document.elementFromPoint(5, 50);
        return el ? el.tagName + '#' + el.id + '.' + el.className : 'none';
      })(),
      // Check element at top
      elementAtTop: (() => {
        const el = document.elementFromPoint(vw/2, 10);
        return el ? el.tagName + '#' + el.id + '.' + el.className : 'none';
      })()
    };
  });
  
  console.log('\nCorner/element analysis:', JSON.stringify(cornerColors, null, 2));

  // Reload and verify persistence
  console.log('\n=== RELOAD ===');
  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  const afterReload = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgSize: c.backgroundSize,
      bgRepeat: c.backgroundRepeat,
      bgPosition: c.backgroundPosition
    };
  });
  console.log('After reload:', JSON.stringify(afterReload, null, 2));

  await page.screenshot({ path: '/tmp/06-aa-reloaded.png' });

  // Open new tab
  console.log('\n=== NEW TAB ===');
  const newPage = await browser.newPage();
  await newPage.setViewport({ width: 1280, height: 800 });
  await newPage.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);
  await newPage.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  const newTabBg = await newPage.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return { bgImage: c.backgroundImage, bgSize: c.backgroundSize, bgRepeat: c.backgroundRepeat };
  });
  console.log('New tab:', JSON.stringify(newTabBg, null, 2));
  await newPage.screenshot({ path: '/tmp/06-aa-newtab.png' });
  await newPage.close();

  console.log('\n=== TESTS COMPLETE ===');
  console.log('Screenshots: /tmp/06-aa-full.png, /tmp/06-aa-reloaded.png, /tmp/06-aa-newtab.png');

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
