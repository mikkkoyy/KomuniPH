/**
 * PROFILE-PHOTO-SPA: real-browser measurement of the main profile header photo
 * across SPA navigation paths (direct / gallery-return / album-return /
 * browser-back / home-return / refresh-return), plus a public-visitor control.
 * Usage: node .tmp-test/profile-photo-spa.mjs [label]
 */
import http from 'http';
import { writeFileSync } from 'fs';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const BASE = 'http://localhost:3000';
const LABEL = process.argv[2] || 'run';
const stamp = Date.now().toString().slice(-8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function api(path, method = 'GET', body = null, token = null) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (data) headers['Content-Length'] = Buffer.byteLength(data);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c.toString()));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: { raw: b } }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadMultipart(path, fileBuffer, filename, fieldname, token) {
  const boundary = '----spa' + Date.now();
  const parts = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="${fieldname}"; filename="${filename}"\r\n`),
    Buffer.from(`Content-Type: image/jpeg\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': parts.length,
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c.toString()));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: { raw: b } }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    req.write(parts);
    req.end();
  });
}

const measureFn = () => {
  const frame = document.getElementById('profile-frame');
  if (!frame) return { error: 'no #profile-frame' };
  const own = frame.querySelector('img.profile-photo-large');
  const pub = frame.querySelector('img.profile-photo-public');
  let target = own || pub;
  if (!target) {
    const header = frame.querySelector('#profile-header') || frame;
    const imgs = [...header.querySelectorAll('img')];
    target = imgs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  }
  if (!target) return { error: 'no photo img' };
  const cs = getComputedStyle(target);
  const r = target.getBoundingClientRect();
  return {
    mode: own ? 'own(profile-photo-large)' : (pub ? 'public(profile-photo-public)' : 'fallback'),
    className: String(target.className),
    width: Math.round(r.width),
    height: Math.round(r.height),
    borderRadius: cs.borderRadius,
    cameraClasses: [...frame.querySelectorAll('[class*="camera"]')].map((e) => e.className).slice(0, 4),
    fileInputs: frame.querySelectorAll('input[type="file"]').length,
    viewAllButton: !!document.getElementById('photo-gallery-view-all'),
  };
};

async function waitFor(page, selector, timeout = 8000) {
  try { await page.waitForSelector(selector, { timeout }); return true; }
  catch { return false; }
}

async function measure(page, label, steps) {
  await sleep(700);
  const m = await page.evaluate(measureFn).catch((e) => ({ error: String(e) }));
  steps[label] = m;
  console.log(`[${LABEL}] ${label}:`, JSON.stringify(m));
  return m;
}

async function clickByText(page, text, scope = '#profile-frame') {
  return page.evaluate((text, scope) => {
    const root = document.querySelector(scope) || document;
    const els = [...root.querySelectorAll('a,button')];
    const el = els.find((e) => e.textContent.trim().toLowerCase() === text.toLowerCase())
      || els.find((e) => e.textContent.trim().toLowerCase().includes(text.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, text, scope);
}

async function navByText(page, text, fallbackHash, scope = '#profile-frame') {
  const clicked = await clickByText(page, text, scope);
  if (!clicked && fallbackHash) {
    await page.evaluate((h) => { window.location.hash = h; }, fallbackHash);
  }
  await sleep(500);
}

// PART2
