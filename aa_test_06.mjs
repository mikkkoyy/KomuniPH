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

function colorName(r, g, b) {
  if (r > 240 && g > 230 && b > 220) return 'cream';
  if (r > 230 && g < 120 && b < 120) return 'red';
  if (r > 150 && g > 100 && b < 100) return 'orange';
  if (r === g && g === b) return 'gray';
  return null; // Not a uniform color - likely image content
}

function hasNonUniformColor(screenshotBuffer, width, height, samplePoints) {
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(screenshotBuffer);
  const data = png.data;
  const results = [];
  const step = 20;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const name = colorName(r, g, b);
      if (name) {
        results.push({ x, y, r, g, b, name });
      }
    }
  }
  return results;
}

(async () => {
  // First, let's check if aa.jpg exists
  console.log('Image exists:', fs.existsSync(IMAGE_PATH));

  const token = await login();

  // First reset theme
  const data = JSON.stringify({
    backgroundImage: null, backgroundGradient: null, backgroundColor: null,
    backgroundPosition: null, backgroundRepeat: null, backgroundSize: null
  });
  const req = http.request({
    hostname: 'localhost', port: 3000, path: '/api/profile/theme',
    method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': data.length }
  }, res => { let body=''; res.on('data', d => body += d); res.on('end', () => console.log('Theme reset:', body)); });
  req.write(data); req.end();

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  // Open customization and upload
  const customizeBtn = await page.$('#profile-actions .profile-action-btn[onclick*="openCustomization"]');
  if (customizeBtn) await customizeBtn.click();
  await new Promise(r => setTimeout(r, 1000));

  const imageRadio = await page.$('input[name="bg-type"][value="image"]');
  if (imageRadio) await imageRadio.click();
  await new Promise(r => setTimeout(r, 500));

  const fileInput = await page.$('#theme-background-input');
  await page.evaluate(() => {
    const input = document.getElementById('theme-background-input');
    if (input) { input.style.display = 'block'; input.style.visibility = 'visible'; input.style.opacity = '1'; }
  });
  await fileInput.uploadFile(IMAGE_PATH);
  console.log('Uploaded aa.jpg');
  await new Promise(r => setTimeout(r, 4000));

  // Save customization
  const saveBtn = await page.$('#theme-customization-panel button[onclick*="saveCustomization"]');
  if (saveBtn) await saveBtn.click();
  console.log('Saved customization');
  await new Promise(r => setTimeout(r, 3000));

  // Screenshot BEFORE refresh
  await page.screenshot({ path: '/tmp/06-aa-before-refresh.png' });
  console.log('Screenshot before refresh: /tmp/06-aa-before-refresh.png');

  // Get background info before refresh
  const bgBefore = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgColor: c.backgroundColor,
      bgSize: c.backgroundSize,
      bgPosition: c.backgroundPosition,
      bgRepeat: c.backgroundRepeat,
      frameBounds: frame.getBoundingClientRect()
    };
  });
  console.log('Background before refresh:', JSON.stringify(bgBefore, null, 2));

  // Reload
  console.log('\n=== Reloading page ===');
  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  // Screenshot AFTER refresh
  await page.screenshot({ path: '/tmp/06-aa-after-refresh.png' });
  console.log('Screenshot after refresh: /tmp/06-aa-after-refresh.png');

  // Get background info after refresh
  const bgAfter = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      bgColor: c.backgroundColor,
      bgSize: c.backgroundSize,
      bgPosition: c.backgroundPosition,
      bgRepeat: c.backgroundRepeat,
      frameBounds: frame.getBoundingClientRect()
    };
  });
  console.log('Background after refresh:', JSON.stringify(bgAfter, null, 2));

  // Open new tab
  console.log('\n=== Opening new tab ===');
  const newPage = await browser.newPage();
  await newPage.setViewport({ width: 1280, height: 800 });
  await newPage.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);
  await newPage.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  const bgNewTab = await newPage.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    return {
      bgImage: c.backgroundImage,
      hasImage: c.backgroundImage !== 'none'
    };
  });
  console.log('Background in new tab:', JSON.stringify(bgNewTab, null, 2));

  await newPage.screenshot({ path: '/tmp/06-aa-new-tab.png' });
  console.log('Screenshot new tab: /tmp/06-aa-new-tab.png');

  // Now analyze pixel data from the screenshots
  console.log('\n=== Pixel analysis of aa.jpg ===');
  // Load the screenshot and analyze
  const screenshot1 = fs.readFileSync('/tmp/06-aa-before-refresh.png');
  const screenshot2 = fs.readFileSync('/tmp/06-aa-after-refresh.png');
  
  // Use puppeteer's page.screenshot with encoding to get raw data, then analyze with canvas
  // Actually let's use a different approach - get pixel colors via evaluate
  
  const pixelData = await page.evaluate(() => {
    // Create canvas to sample
    const canvas = document.createElement('canvas');
    const rect = document.getElementById('profile-frame').getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    
    // Can't use drawWindow in regular context, use screenshot data instead
    // Instead, check CSS properties
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    
    return {
      cssCheck: {
        width: c.width,
        minWidth: c.minWidth,
        minHeight: c.minHeight,
        backgroundSize: c.backgroundSize,
        backgroundPosition: c.backgroundPosition,
        backgroundRepeat: c.backgroundRepeat,
        backgroundImage: c.backgroundImage ? 'SET' : 'NONE',
        hasGradient: c.backgroundImage && c.backgroundImage.startsWith('linear-gradient')
      }
    };
  });
  console.log('CSS checks:', JSON.stringify(pixelData, null, 2));

  // Also test with different image ratios
  console.log('\n=== Testing different viewports ===');
  await page.setViewport({ width: 1920, height: 1080 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/06-aa-wide.png' });
  console.log('Wide screenshot: /tmp/06-aa-wide.png');

  await page.setViewport({ width: 400, height: 600 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/06-aa-small.png' });
  console.log('Small screenshot: /tmp/06-aa-small.png');

  // Reset viewport
  await page.setViewport({ width: 1280, height: 800 });

  console.log('\n=== ALL TESTS COMPLETE ===');
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
