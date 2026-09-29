/**
 * CREATOR-12 — the Profile Background Effect renderer.
 *
 * ONE renderer, used by BOTH the public profile and the Creator Studio preview,
 * so a creator sees in the Studio exactly what a visitor will see. The Studio
 * never gets a "fake" preview and the public profile never gets a second,
 * divergent implementation.
 *
 * ── Layering (the invariant) ──────────────────────────────────────────────────
 *   background image  →  effect  →  profile content  →  sidebar
 *
 * The effect lives in its own layer element that is a sibling of the background
 * layer and a PARENT of nothing: it is positioned over the background and under
 * the content, is `pointer-events: none`, and is `aria-hidden`. It is a fixed
 * viewport overlay, so it can never participate in document layout.
 *
 * ── Bounded by construction ───────────────────────────────────────────────────
 *   • one effect per profile, never a stack
 *   • particle count clamped to EFFECT_LIMITS.maxParticles
 *   • a SINGLE <canvas>, so an effect costs one element rather than hundreds
 *   • the canvas is the effect's own drawing surface; profile content is never
 *     drawn into it, so nothing is rasterised and no DOM is captured
 *   • the rAF loop is owned and torn down by the caller on every re-render
 *
 * ── Degradation ───────────────────────────────────────────────────────────────
 * Any problem — an unknown effect, a missing creator install, a config that does
 * not match a schema — resolves to "no effect". A profile must always render.
 */

import { clampEffectConfig, resolveEffectConfig, EFFECT_LIMITS } from './backgroundEffects.js';

export const EFFECT_LAYER_ID = 'profile-background-effect-layer';

let activeController = null;
let activeMotionQuery = null;
let activeMotionHandler = null;

function detachMotionListener() {
  if (activeMotionQuery && typeof activeMotionQuery.removeEventListener === 'function' && activeMotionHandler) {
    activeMotionQuery.removeEventListener('change', activeMotionHandler);
  }
  activeMotionQuery = null;
  activeMotionHandler = null;
}

/** True when the visitor (or the Studio) has asked for reduced motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Remove any running effect and empty the layer. Safe to call when absent. */
export function clearProfileBackgroundEffect(layer) {
  if (activeController && activeController.stop) {
    activeController.stop();
    activeController = null;
  }
  detachMotionListener();
  const target = layer || document.getElementById(EFFECT_LAYER_ID);
  if (target) target.replaceChildren();
  return target;
}

/**
 * Resolve an effect reference to something renderable.
 * `creatorEffect` is the INSTALLED, VALIDATED definition row (or null). An
 * effect id the registry does not know, and a creator effect that is not
 * installed, both resolve to null.
 */
export function resolveEffect(effect, creatorEffect) {
  if (!effect || effect.enabled === false) return null;
  const effectId = effect.effectId;
  if (typeof effectId !== 'string' || !effectId) return null;

  if (effect.source === 'creator' || String(effectId).indexOf('creator.') === 0) {
    if (!creatorEffect) return null;
    let definition = {};
    try {
      definition = JSON.parse(creatorEffect.definition_json || '{}');
    } catch { return null; }
    return {
      effectId,
      name: creatorEffect.name || effectId,
      engine: creatorEffect.engine || definition.engine,
      config: resolveEffectConfig(
        { engine: creatorEffect.engine || definition.engine, defaultConfig: definition.config || {} },
        effect.config,
      ),
      textureUrl: creatorEffect.preview_path || null,
    };
  }

  // Built-in: the registry is the only source, imported statically.
  const builtin = BUILTIN_LOOKUP[effectId];
  if (!builtin) return null;
  return {
    effectId,
    name: builtin.name,
    engine: builtin.engine,
    config: resolveEffectConfig(builtin, effect.config),
    palette: builtin.palette || null,
  };
}

// Imported values are re-bound here so the lookup table above stays a plain
// object; this keeps BUILTIN_EFFECTS out of the caller's namespace.
import { BUILTIN_EFFECTS } from './backgroundEffects.js';
const BUILTIN_LOOKUP = BUILTIN_EFFECTS;

/**
 * Render a background effect into its layer.
 * @returns {boolean} whether an effect was actually drawn
 */
export function applyProfileBackgroundEffect(effect, { layer, creatorEffect, reducedMotion, bounds } = {}) {
  const target = clearProfileBackgroundEffect(layer);
  if (!target) return false;

  const resolved = resolveEffect(effect, creatorEffect);
  if (!resolved) {
    target.dataset.profileEffect = 'none';
    return false;
  }
  target.dataset.profileEffect = resolved.effectId;
  target.dataset.profileEffectEngine = resolved.engine;

  const reduce = reducedMotion === undefined ? prefersReducedMotion() : reducedMotion;
  const config = clampEffectConfig(resolved.engine, resolved.config);

  // Re-apply with the same inputs. Built here, in the scope that has them, and
  // handed to the engine — an engine must never reach for an argument it does
  // not have.
  const reapply = () => applyProfileBackgroundEffect(effect, { layer: target, creatorEffect, reducedMotion, bounds });

  // A visitor who changes their OS "reduce motion" setting should see the effect
  // respond immediately, in BOTH directions, without reloading. The listener is
  // attached here — for every engine and for the still-frame case too — because
  // a still frame is exactly the state that most needs a way to start animating
  // again when the preference is lifted.
  if (typeof window.matchMedia === 'function') {
    try {
      activeMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      activeMotionHandler = () => reapply();
      if (typeof activeMotionQuery.addEventListener === 'function') {
        activeMotionQuery.addEventListener('change', activeMotionHandler);
      }
    } catch { /* the preference is simply not observable here */ }
  }

  if (resolved.engine === 'particles') return renderParticles(target, resolved, config, reduce, bounds, reapply);
  if (resolved.engine === 'atmosphere') return renderAtmosphere(target, config, reduce);
  if (resolved.engine === 'lighting') return renderLighting(target, config, reduce);
  if (resolved.engine === 'overlay') return renderOverlay(target, config);
  return false;
}

// ── Engine: particles ────────────────────────────────────────────────────────
function renderParticles(target, resolved, config, reduce, bounds, reapply) {
  const canvas = document.createElement('canvas');
  canvas.className = 'profile-bg-effect-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  target.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const count = Math.max(1, Math.min(EFFECT_LIMITS.maxParticles, Math.round(config.count)));
  const isRain = resolved.effectId === 'builtin.rain';
  const isFire = resolved.palette === 'fire' || resolved.effectId === 'builtin.fire';
  const isSparkle = resolved.effectId === 'builtin.sparkles';
  const isStar = resolved.effectId === 'builtin.stars';

  const speed = config.speed * 0.5;
  const size = config.size;
  const opacity = config.opacity;
  const rotate = config.rotation && config.rotationSpeed > 0;
  const rotSpeed = (config.rotationSpeed * Math.PI) / 180;
  const drift = config.drift / 100;
  const spread = config.spread / 100;

  const rand = (min, max) => min + Math.random() * (max - min);
  const particles = [];
  // On a public profile the surface is the viewport. In the Studio the surface is
  // the DESIGN CANVAS, so the creator previews the effect over the same
  // coordinates that will be published rather than merely something similar.
  const width = () => (bounds && bounds.width ? bounds.width : window.innerWidth);
  const height = () => (bounds && bounds.height ? bounds.height : window.innerHeight);
  const resize = () => {
    const w = width();
    const h = height();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  for (let i = 0; i < count; i += 1) {
    // Seed ACROSS the visible area, not entirely above it. A continuous emitter
    // that starts empty looks broken for the first second and takes the effect's
    // full fall time to fill in; seeding in view means the effect is correct the
    // moment it is applied. Rising effects (fire, stars) still seed anywhere.
    const rising = isFire || isStar;
    particles.push({
      x: rand(0, width()),
      y: rising ? rand(0, height()) : rand(0, height()),
      z: rand(0.5, 1.5),
      r: rand(0, Math.PI * 2),
      s: rand(size * 0.5, size) * (isSparkle || isStar ? 1 : 1),
    });
  }

  const draw = (delta) => {
    const w = width();
    const h = height();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = opacity;
    for (const p of particles) {
      p.y += speed * p.z * delta;
      p.x += (Math.random() - 0.5) * drift * 3;
      if (rotate) p.r += rotSpeed * delta;
      if (p.y > h + 20 || p.x < -40 || p.x > w + 40) {
        p.y = isFire || isStar ? rand(0, h) : rand(-h, -20);
        p.x = rand(-spread * w, w + spread * w);
      }
      const sz = Math.max(1, p.s * p.z);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (rotate) ctx.rotate(p.r);
      if (isFire) {
        // A warm, fixed palette. Not a config value, so it cannot become CSS.
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz);
        g.addColorStop(0, 'rgba(255, 214, 130, 0.95)');
        g.addColorStop(0.5, 'rgba(255, 138, 60, 0.55)');
        g.addColorStop(1, 'rgba(255, 80, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, sz, 0, Math.PI * 2);
        ctx.fill();
      } else if (isRain) {
        ctx.strokeStyle = 'rgba(200, 225, 255, 0.75)';
        ctx.lineWidth = Math.max(1, sz * 0.18);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, sz * 3);
        ctx.stroke();
      } else if (isStar || isSparkle) {
        ctx.fillStyle = isStar ? 'rgba(255, 255, 240, 0.9)' : 'rgba(255, 250, 200, 0.95)';
        ctx.beginPath();
        ctx.arc(0, 0, sz * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, sz * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // Draw immediately, before the first animation frame. An effect must be
  // visible the instant it is applied: waiting for rAF means a blank layer for a
  // frame, and a blank layer forever if rAF is throttled (a backgrounded tab, a
  // headless browser), which would read as "the effect did nothing".
  draw(0);

  if (reduce) {
    // Deterministic still frame: the effect is visible, nothing moves. Repeated
    // motion is exactly what a motion-sensitive visitor asked us not to do.
    // The marker makes that decision observable to the Studio and to tests.
    target.dataset.motion = 'static';
    return true;
  }

  let last = 0;
  let raf = 0;
  const frame = (now) => {
    if (!last) last = now;
    // Clamp the delta so a backgrounded tab does not teleport every particle.
    const delta = Math.min(50, now - last) * 0.06;
    last = now;
    draw(delta);
    raf = requestAnimationFrame(frame);
  };
  target.dataset.motion = 'animated';
  raf = requestAnimationFrame(frame);
  // The Studio's canvas is resized when the viewer or the panels change, so the
  // effect re-measures with it rather than drifting out of the design area.
  const onResize = () => { resize(); if (reduce) draw(0); };
  window.addEventListener('resize', onResize);

  // A visitor who turns on "reduce motion" at the OS level should see the effect
  // stop WITHOUT reloading the page. Re-apply on the preference change and drop
  // the running loop, so the change is immediate rather than waiting for
  // whatever re-render happens to come next.
  let mql = null;
  const onMotionChange = () => {
    clearProfileBackgroundEffect(target);
    reapply();
  };
  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onMotionChange);
  }

  activeController = {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      if (mql && typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onMotionChange);
    },
  };
  return true;
}

// ── Engine: atmosphere ────────────────────────────────────────────────────────
function renderAtmosphere(target, config, reduce) {
  const wrap = document.createElement('div');
  wrap.className = 'profile-bg-effect-atmosphere';
  wrap.setAttribute('aria-hidden', 'true');
  const layers = Math.max(1, Math.min(EFFECT_LIMITS.maxAtmosphereLayers, Math.round(config.layers)));
  const anims = [];
  for (let i = 0; i < layers; i += 1) {
    const puff = document.createElement('span');
    const scale = config.scale * (0.7 + i * 0.25);
    puff.style.width = `${scale}%`;
    puff.style.height = `${scale * 0.8}%`;
    puff.style.opacity = String(config.opacity / layers);
    puff.style.filter = `blur(${config.blur}px)`;
    puff.style.left = `${(i * 37) % 70}%`;
    puff.style.top = `${(i * 53) % 70}%`;
    wrap.appendChild(puff);
    anims.push(puff);
  }
  target.replaceChildren(wrap);
  target.dataset.motion = reduce ? 'static' : 'animated';
  if (reduce) return true;

  const duration = Math.max(6, 26 / Math.max(0.1, config.speed));
  anims.forEach((puff, i) => {
    puff.style.animation = `komuniph-effect-drift ${duration + i * 2}s ease-in-out ${i * 1.3}s infinite alternate`;
  });
  return true;
}

// ── Engine: lighting ──────────────────────────────────────────────────────────
function renderLighting(target, config, reduce) {
  const flash = document.createElement('div');
  flash.className = 'profile-bg-effect-lightning';
  flash.setAttribute('aria-hidden', 'true');
  flash.style.backgroundColor = config.color;
  target.replaceChildren(flash);
  if (reduce) {
    // A single still tint instead of repeated flashes.
    target.dataset.motion = 'static';
    flash.style.opacity = String(config.intensity * 0.25);
    return true;
  }
  const period = Math.max(0.4, 60 / Math.max(1, config.frequency));
  flash.style.animation = `komuniph-effect-flash ${period}s steps(1, end) infinite`;
  flash.style.setProperty('--kp-flash-ms', `${config.duration}ms`);
  return true;
}

// ── Engine: overlay ───────────────────────────────────────────────────────────
function renderOverlay(target, config) {
  const wash = document.createElement('div');
  wash.className = 'profile-bg-effect-overlay';
  wash.setAttribute('aria-hidden', 'true');
  wash.style.backgroundColor = config.color;
  wash.style.opacity = String(config.opacity);
  target.replaceChildren(wash);
  return true;
}
