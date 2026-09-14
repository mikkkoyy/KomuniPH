import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxIn0.eyJzdWIiOiIyNTUwN2MyOS0yNDNlLTQ4MDMtODk4OS04NTNjYTEzY2Y2MzYiLCJ0eXBlIjoiYWNjZXNzIiwiaXNzIjoia29tdW5pcGgiLCJhdWQiOiJrb211bmlwaC1jbGllbnRzIiwianRpIjoiY2Y1MThkMmYtYmEyYS00MzljLTgzMmQtNGNiZWI2MzdmNTFlIiwiaWF0IjoxNzg5MzU0ODk2LCJleHAiOjE3ODkzNTU3OTZ9.1s2x_GRwQQpYs8z5ImDQfC7cLmcmhdSvX4A8bO46xaw';

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, TOKEN);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // Full inspection
  const info = await page.evaluate(() => {
    const results = {};

    ['profile-frame', 'profile-header', 'profile-nav', 'profile-status-strip'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const c = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        results[id] = {
          selector: '#' + id,
          bounds: { x: r.x, y: r.y, w: r.width, h: r.height },
          bgImage: c.backgroundImage,
          bgColor: c.backgroundColor,
          bgSize: c.backgroundSize,
          bgPosition: c.backgroundPosition,
          bgRepeat: c.backgroundRepeat,
          zIndex: c.zIndex,
          className: el.className,
          inlineStyle: el.getAttribute('style') || '(none)',
          parentTag: el.parentElement ? el.parentElement.tagName + '#' + (el.parentElement.id || '') + '.' + el.parentElement.className : 'none',
          parentChildrenCount: el.parentElement ? el.parentElement.children.length : 0
        };
      }
    });

    // Also check .profile-content-frame
    const cf = document.querySelector('.profile-content-frame');
    if (cf) {
      const c = window.getComputedComputedStyle ? window.getComputedStyle(cf) : window.getComputedStyle(cf);
      const r = cf.getBoundingClientRect();
      results['profile-content-frame'] = {
        selector: '.profile-content-frame',
        bounds: { x: r.x, y: r.y, w: r.width, h: r.height },
        bgImage: c.backgroundImage,
        bgColor: c.backgroundColor,
        bgSize: c.backgroundSize,
        inlineStyle: cf.getAttribute('style') || '(none)'
      };
    }

    // Walk up from header
    const headerAncestors = [];
    let el = document.querySelector('.profile-header');
    while (el) { headerAncestors.push(el.tagName + '#' + el.id + '.' + el.className); el = el.parentElement; }
    results['headerAncestorChain'] = headerAncestors;

    // Walk up from nav
    const navAncestors = [];
    el = document.querySelector('.profile-nav');
    while (el) { navAncestors.push(el.tagName + '#' + el.id + '.' + el.className); el = el.parentElement; }
    results['navAncestorChain'] = navAncestors;

    // Check for sidebar elements
    const sidebarElements = [];
    const allChildren = document.querySelectorAll('.profile-frame > *');
    allChildren.forEach((child, i) => {
      sidebarElements.push(child.tagName + '#' + child.id + '.' + child.className);
    });
    results['profileFrameDirectChildren'] = sidebarElements;

    return results;
  });

  console.log('=== DOM INSPECTION ===');
  console.log(JSON.stringify(info, null, 2));

  // Screenshot
  await page.screenshot({ path: '/tmp/06-inspect.png', fullPage: true });

  await browser.close();
  console.log('\nDone. Screenshot: /tmp/06-inspect.png');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
