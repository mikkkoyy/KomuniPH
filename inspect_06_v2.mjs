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

(async () => {
  const token = await login();
  console.log('Got token:', token.substring(0, 30) + '...');

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, token);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // Get the full HTML of profile-frame's direct structure
  const structure = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const cf = document.querySelector('.profile-content-frame');
    return {
      frameHTML: frame.outerHTML.substring(0, 3000),
      cfHTML: cf ? cf.outerHTML.substring(0, 2000) : 'not found',
      frameChildren: Array.from(frame.children).map(c => c.tagName + '.' + c.className + (c.id ? '#' + c.id : '')),
      cfChildren: cf ? Array.from(cf.children).map(c => c.tagName + (c.id ? '#' + c.id : '') + '.' + c.className) : []
    };
  });
  console.log('=== DOM STRUCTURE ===');
  console.log('Frame children:', structure.frameChildren);
  console.log('Content-frame children:', structure.cfChildren);

  // Get CSS rules
  const cssRules = await page.evaluate(() => {
    const results = [];
    const sheets = Array.from(document.styleSheets);
    sheets.forEach(sheet => {
      try {
        const rules = Array.from(sheet.cssRules || []);
        rules.forEach(rule => {
          if (rule.selectorText && (rule.selectorText.includes('profile-frame') || rule.selectorText.includes('profile-content-frame') || rule.selectorText.includes('profile-header') || rule.selectorText.includes('profile-nav') || rule.selectorText.includes('profile-status-strip'))) {
            results.push(`${rule.selectorText} { ${rule.style.cssText} }`);
          }
        });
      } catch(e) {}
    });
    return results;
  });
  console.log('\n=== CSS RULES ===');
  cssRules.forEach(r => console.log(r));

  // Check applied inline styles
  const inlineStyles = await page.evaluate(() => {
    const frame = document.getElementById('profile-frame');
    const h = document.querySelector('.profile-header');
    const n = document.querySelector('.profile-nav');
    const s = document.getElementById('profile-status-strip');
    return {
      frame: frame.getAttribute('style'),
      header: h ? h.getAttribute('style') : null,
      nav: n ? n.getAttribute('style') : null,
      statusStrip: s ? s.getAttribute('style') : null
    };
  });
  console.log('\n=== INLINE STYLES ===');
  console.log('Frame:', inlineStyles.frame?.substring(0, 500));
  console.log('Header:', inlineStyles.header);
  console.log('Nav:', inlineStyles.nav);
  console.log('Status:', inlineStyles.statusStrip);

  await page.screenshot({ path: '/tmp/06-inspect3.png', fullPage: true });
  console.log('\nScreenshot saved: /tmp/06-inspect3.png');

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
