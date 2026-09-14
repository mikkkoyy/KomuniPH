import puppeteer from 'puppeteer';
import http from 'http';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYxIn0.eyJzdWIiOiIyNTUwN2MyOS0yNDNlLTQ4MDMtODk4OS04NTNjYTEzY2Y2MzYiLCJ0eXBlIjoiYWNjZXNzIiwiaXNzIjoia29tdW5pcGgiLCJhdWQiOiJrb211bmlwaC1jbGllbnRzIiwianRpIjoiYWJmMzBhOGYtN2U3Ni00YmE0LThmMDctYjE4NTA1NWEwNmU2IiwiaWF0IjoxNzg5MzU0MDQ2LCJleHAiOjE3ODkzNTQ5NDZ9.sPU9-xyztF5LN2sFh4aRuHUJ3QSC9XvTjfOvdpQTNgc';

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.evaluateOnNewDocument(token => {
    localStorage.setItem('komuniph_auth_tokens', JSON.stringify({ access: token, refresh: token }));
  }, TOKEN);

  await page.goto('http://localhost:3000/#/profile', { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('#profile-frame', { timeout: 10000 });

  // === COMPREHENSIVE DOM INSPECTION ===
  console.log('=== DOM HIERARCHY INSPECTION ===');

  const domInfo = await page.evaluate(() => {
    // Walk the entire DOM from body
    function walkElement(el, depth = 0) {
      if (depth > 3) return null;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? '#' + el.id : '';
      const cls = el.className ? '.' + el.className.split(' ').filter(c => c).join('.') : '';
      const name = tag + id + cls;
      const children = [];
      for (const child of el.children) {
        const childInfo = walkElement(child, depth + 1);
        if (childInfo) children.push(childInfo);
      }
      return { name: name, depth, children: children.length > 0 ? children : undefined };
    }

    // Top-level structure
    const app = document.getElementById('app');
    const appChildren = app ? Array.from(app.children).map(child => {
      const tag = child.tagName.toLowerCase();
      const id = child.id ? '#' + child.id : '';
      const cls = child.className ? '.' + child.className.split(' ').filter(c => c).join('.') : '';
      return tag + id + cls;
    }) : [];

    // Detailed info for key elements
    function inspectElement(selector) {
      const el = document.querySelector(selector);
      if (!el) return { found: false, selector };
      const c = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const parent = el.parentElement ? (el.parentElement.tagName + (el.parentElement.id ? '#' + el.parentElement.id : '') + (el.parentElement.className ? '.' + el.parentElement.className.split(' ').filter(c => c).join('.') : '')) : 'null';
      return {
        found: true,
        selector,
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        parentName: parent,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        computed: {
          backgroundColor: c.backgroundColor,
          backgroundImage: c.backgroundImage ? c.backgroundImage.substring(0, 80) : 'none',
          backgroundSize: c.backgroundSize,
          backgroundPosition: c.backgroundPosition,
          backgroundRepeat: c.backgroundRepeat,
          position: c.position,
          zIndex: c.zIndex,
          display: c.display,
          margin: c.margin,
          padding: c.padding,
          border: c.border,
          boxSizing: c.boxSizing
        }
      };
    }

    // Also walk from profile-frame upward
    const frame = document.querySelector('#profile-frame');
    const ancestors = [];
    if (frame) {
      let el = frame.parentElement;
      while (el) {
        const c = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        ancestors.push({
          name: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').filter(c => c && c !== 'dark').join('.') : ''),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          backgroundColor: c.backgroundColor,
          backgroundImage: c.backgroundImage ? c.backgroundImage.substring(0, 60) : 'none',
          position: c.position,
          overflow: c.overflow,
          padding: c.padding
        });
        el = el.parentElement;
      }
    }

    // Also check for any nav element outside profile-frame
    const allNavs = Array.from(document.querySelectorAll('nav')).map(nav => {
      const c = window.getComputedStyle(nav);
      const r = nav.getBoundingClientRect();
      const inFrame = nav.closest('#profile-frame') !== null;
      return {
        className: nav.className,
        id: nav.id,
        inProfileFrame: inFrame,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        backgroundColor: c.backgroundColor
      };
    });

    return {
      appChildren,
      ancestorsFromProfileFrame: ancestors,
      keyElements: {
        profileFrame: inspectElement('#profile-frame'),
        profileHeader: inspectElement('.profile-header'),
        profileNav: inspectElement('.profile-nav'),
        profileContentFrame: inspectElement('.profile-content-frame'),
        profileStatusStrip: inspectElement('.profile-status-strip'),
        profileContent: inspectElement('.profile-content')
      },
      allNavs,
      bodyBg: window.getComputedStyle(document.body).background,
      htmlBg: window.getComputedStyle(document.documentElement).background,
      appBg: (function() {
        const app = document.getElementById('app');
        return app ? window.getComputedStyle(app).background : 'not found';
      })()
    };
  });

  console.log('Application children:', JSON.stringify(domInfo.appChildren, null, 2));
  console.log('\\nAncestors from #profile-frame upward:');
  domInfo.ancestorsFromProfileFrame.forEach(a => console.log('  ', JSON.stringify(a)));
  console.log('\\nKey elements:');
  console.log(JSON.stringify(domInfo.keyElements, null, 2));
  console.log('\\nAll nav elements:');
  console.log(JSON.stringify(domInfo.allNavs, null, 2));
  console.log('\\nBody bg:', domInfo.bodyBg);
  console.log('HTML bg:', domInfo.htmlBg);
  console.log('App bg:', domInfo.appBg);

  await page.screenshot({ path: '/tmp/06-dom-inspection.png', fullPage: true });
  console.log('\\nScreenshot saved: /tmp/06-dom-inspection.png');

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
