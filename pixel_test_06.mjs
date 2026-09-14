import puppeteer from 'puppeteer';
import http from 'http';

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

function getPixel(viewport, x, y) {
  const idx = (y * viewport.width + x) * 4;
  return [viewport.data[idx], viewport.data[idx+1], viewport.data[idx+2], viewport.data[idx+3]];
}

function colorName(r, g, b) {
  if (r > 240 && g > 230 && b > 220) return 'cream';
  if (r > 240 && g > 100 && b > 70 && r > g + 30 && r > b + 30) return 'red/orange';
  if (r > 200 && g > 150 && b < 100) return 'orange/amber';
  if (r < 200 && g < 200 && b < 200 && r === g && g === b) return 'gray';
  return `rgb(${r},${g},${b})`;
}

(async () => {
  const token = await login();
  console.log('Token acquired');

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // Get pixel data at various positions
  const viewport = await page.viewport();
  
  // Sample points across the top of the viewport (y=50 - should show background image or red)
  console.log('\n=== Top edge samples (y=50) ===');
  for (let x = 0; x < viewport.width; x += 100) {
    const pixel = await page.screenshot({ encoding: 'binary' });
    // Actually let me use a different approach - evaluate JS to get pixel colors
  }

  // Let me use a canvas approach instead
  const pixels = await page.evaluate((vp) => {
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawWindow(window, 0, 0, vp.width, vp.height, 'white');
    
    const samples = [];
    const positions = [
      // Top edge
      {x: 0, y: 50, desc: 'top-left corner'},
      {x: 50, y: 50, desc: 'top-left inner'},
      {x: 200, y: 50, desc: 'top nav area'},
      {x: 640, y: 50, desc: 'top center'},
      {x: 1230, y: 50, desc: 'top-right corner'},
      {x: 640, y: 150, desc: 'below nav'},
      {x: 120, y: 200, desc: 'status strip left'},
      {x: 640, y: 200, desc: 'status strip center'},
      {x: 120, y: 300, desc: 'content left'},
      {x: 640, y: 300, desc: 'content center'},
    ];
    
    for (const pos of positions) {
      const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
      samples.push({
        x: pos.x, y: pos.y, desc: pos.desc,
        r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3]
      });
    }
    return samples;
  }, viewport);

  console.log('Color samples at y=50 (top):');
  pixels.filter(p => p.y === 50).forEach(p => {
    console.log(`  x=${p.x} (${p.desc}): rgba(${p.r},${p.g},${p.b},${p.a}) -> ${colorName(p.r, p.g, p.b)}`);
  });
  
  console.log('\nColor samples at y=200 (content area):');
  pixels.filter(p => p.y >= 200 && p.y < 300).forEach(p => {
    console.log(`  x=${p.x} y=${p.y} (${p.desc}): rgba(${p.r},${p.g},${p.b},${p.a}) -> ${colorName(p.r, p.g, p.b)}`);
  });
  
  console.log('\nColor samples at y=300 (main content):');
  pixels.filter(p => p.y === 300).forEach(p => {
    console.log(`  x=${p.x} (${p.desc}): rgba(${p.r},${p.g},${p.b},${p.a}) -> ${colorName(p.r, p.g, p.b)}`);
  });

  // Also check the actual background image being used
  const bgInfo = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const c = window.getComputedStyle(frame);
    const bg = c.backgroundImage;
    const bgColor = c.backgroundColor;
    const bgSize = c.backgroundSize;
    return { bgImage: bg, bgColor: bgColor, bgSize: bgSize, bgPosition: c.backgroundPosition, bgRepeat: c.backgroundRepeat };
  });
  console.log('\nBackground info:', bgInfo);

  await page.screenshot({ path: '/tmp/06-pixel-test.png' });
  console.log('\nScreenshot: /tmp/06-pixel-test.png');

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
