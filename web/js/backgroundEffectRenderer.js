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

// CREATOR-13: an effect's playback state is owned PER LAYER, not per module.
//
// This used to be a single module-level controller, which works for a public
// profile (one layer) but cannot host two: starting the Studio's Live View would
// tear down the effect already playing on the design canvas, and vice versa. Keyed
// by layer, several surfaces can render independently and each one is stopped by
// touching only its own layer.
//
// The engine is unchanged — this is ownership bookkeeping, not a second renderer.
const layerControllers = new WeakMap();
const layerMotion = new WeakMap();

function stopLayerEffect(target) {
  if (!target) return;
  const controller = layerControllers.get(target);
  if (controller && controller.stop) controller.stop();
  layerControllers.delete(target);
  const motion = layerMotion.get(target);
  if (motion && motion.mql && motion.handler && typeof motion.mql.removeEventListener === 'function') {
    motion.mql.removeEventListener('change', motion.handler);
  }
  layerMotion.delete(target);
}

/** True when the visitor (or the Studio) has asked for reduced motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Stop this layer's effect and empty it. Other layers are untouched.
 * Safe to call when there is no layer.
 */
export function clearProfileBackgroundEffect(layer) {
  const target = layer || document.getElementById(EFFECT_LAYER_ID);
  stopLayerEffect(target);
  if (target) {
    target.replaceChildren();
    // Never leave a stale frame count or motion marker behind: a cleared layer
    // must not keep claiming an animation is running.
    delete target.dataset.frame;
    delete target.dataset.motion;
  }
  return target;
}

/** The controller for a layer, so a caller can pause/resume/restart it. */
export function getEffectController(layer) {
  const target = layer || document.getElementById(EFFECT_LAYER_ID);
  return target ? (layerControllers.get(target) || null) : null;
}

/**
 * CREATOR-13: a lightweight probe that answers "is anything actually MOVING on
 * this surface?" using the rendered pixels rather than a frame counter.
 *
 * A climbing frame counter only proves `requestAnimationFrame` is being called —
 * an effect that runs a loop but never moves the particles would still report
 * ACTIVE, which is exactly the failure a creator cannot see. So this samples a
 * SMALL fixed region of the surface on an interval and compares it with the
 * previous sample.
 *
 * It is deliberately cheap and bounded:
 *   • a fixed small region (not the whole canvas), so cost does not scale with
 *     canvas size;
 *   • an interval timer, not per-frame, so it never runs inside the draw loop;
 *   • `willReadFrequently`, so the browser does not fight the readback;
 *   • `stop()` detaches the timer and drops the stored state.
 *
 * It reports a *fact about pixels*, not an opinion: `moved` is true only when the
 * sampled region genuinely differs from the previous sample.
 */
export function createMotionProbe(canvas, { sampleSize = 48, intervalMs = 220 } = {}) {
  let timer = null;
  let previous = null;
  let moved = false;
  let samples = 0;

  const readRegion = () => {
    if (!canvas || !canvas.width || !canvas.height) return null;
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const w = Math.min(sampleSize, canvas.width);
      const h = Math.min(sampleSize, canvas.height);
      // A region in the middle of the surface, where particles are densest.
      const x = Math.max(0, Math.floor((canvas.width - w) / 2));
      const y = Math.max(0, Math.floor((canvas.height - h) / 2));
      const data = ctx.getImageData(x, y, w, h).data;
      // A compact signature: total alpha-weighted brightness across the region,
      // plus a coarse checksum, so both "things moved" and "things appeared"
      // register without retaining the whole buffer.
      let sum = 0;
      let checksum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2] + data[i + 3];
        checksum = (checksum + data[i] * 3 + data[i + 3] * 7) % 1000003;
      }
      return `${sum}:${checksum}`;
    } catch {
      return null;
    }
  };

  const tick = () => {
    const sig = readRegion();
    if (sig === null) return;
    if (previous !== null && sig !== previous) moved = true;
    previous = sig;
    samples += 1;
  };

  return {
    start() {
      this.stop();
      moved = false;
      samples = 0;
      previous = null;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    reset() { moved = false; samples = 0; previous = null; },
    /** True once a sample differed from the previous one. */
    get moved() { return moved; },
    get samples() { return samples; },
  };
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
  //
  // Keyed by layer, so a Live View and the design canvas each keep their own.
  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = () => reapply();
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handler);
        layerMotion.set(target, { mql, handler });
      }
    } catch { /* the preference is simply not observable here */ }
  }

  // Remember how to re-enter this effect, so Pause/Resume and Restart are
  // preview operations that never touch the design. Engines overwrite
  // pause/resume/playing with their own loop-aware implementations.
  const request = { effect, creatorEffect, reducedMotion, bounds };
  const controller = {
    /** Re-apply from scratch: this layer's renderer is stopped and rebuilt. */
    restart() { applyProfileBackgroundEffect(request.effect, { layer: target, ...request }); },
    pause() { target.dataset.motion = 'paused'; },
    resume() { target.dataset.motion = 'animated'; },
    playing: false,
    stop() {},
  };
  layerControllers.set(target, controller);

  if (resolved.engine === 'particles') {
    renderParticles(target, resolved, config, reduce, bounds, reapply, controller);
    return true;
  }
  if (resolved.engine === 'atmosphere') return renderAtmosphere(target, config, reduce);
  if (resolved.engine === 'lighting') return renderLighting(target, config, reduce);
  if (resolved.engine === 'overlay') return renderOverlay(target, config);
  return false;
}

// ── Engine: particles ────────────────────────────────────────────────────────
function renderParticles(target, resolved, config, reduce, bounds, reapply, controller) {
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
  // Leaves and petals are their own shapes and their own palettes. Falling
  // back to the generic white dot made them indistinguishable from snow, which
  // is exactly what a creator would report as "it does not look like leaves".
  const isLeaves = resolved.effectId === 'builtin.leaves';
  const isPetals = resolved.effectId === 'builtin.petals';
  // Fixed palettes, chosen per effect, never a user-supplied colour.
  const LEAF_COLOURS = ['#4f7a28', '#6b8f2e', '#3f6320', '#7fa23a', '#587f26'];
  const PETAL_COLOURS = ['#f4a7c3', '#f8c4d8', '#e88ab0', '#fbe0ea', '#ef96b6'];

  // Speed is in CSS pixels per (scaled) frame-step, and the delta below is
  // normalised so a value of 1 reads as a clearly perceptible fall rather than an
  // imperceptible crawl. These factors were previously half again smaller, which
  // made a default effect drift only a few pixels per second: mathematically
  // animating, visually indistinguishable from a still frame.
  const speed = config.speed;
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
      // A stable per-particle colour, so a leaf is a leaf rather than a dot.
      c: isLeaves
        ? LEAF_COLOURS[Math.floor(rand(0, LEAF_COLOURS.length))]
        : (isPetals ? PETAL_COLOURS[Math.floor(rand(0, PETAL_COLOURS.length))] : null),
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
      } else if (isLeaves || isPetals) {
        // A leaf and a petal are elongated, not round: an ellipse twice as long
        // as it is wide, drawn with the particle's own rotation so the tumble
        // reads as a leaf turning over rather than a dot sliding down.
        ctx.fillStyle = p.c;
        ctx.beginPath();
        const rx = sz * 0.62;
        const ry = sz * 0.26;
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // A darker midrib, so the shape is legible against a busy background.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.lineWidth = Math.max(0.6, sz * 0.05);
        ctx.beginPath();
        ctx.moveTo(-rx, 0);
        ctx.lineTo(rx, 0);
        ctx.stroke();
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
    // The marker makes that decision observable to the Studio and to tests, and
    // a frame count of 0 is the honest "nothing is playing" signal.
    target.dataset.motion = 'static';
    target.dataset.frame = '0';
    return true;
  }

  let last = 0;
  let raf = 0;
  // CREATOR-10C: a monotonically increasing frame counter on the layer.
  //
  // Without it, "the effect works" can only be shown by comparing screenshots,
  // and two frames of falling snow can easily look near-identical — a flaky
  // proof at best. Counting real animation frames proves the rAF loop is
  // actually running, which is the thing that can genuinely break (a throttled
  // background tab, a hidden document). It is a bare counter: no state, no
  // positions, nothing about the user.
  let frameCount = 0;
  const frame = (now) => {
    if (!last) last = now;
    // Clamp the delta so a backgrounded tab does not teleport every particle, and
    // scale it so the default speeds are plainly visible.
    const delta = Math.min(50, now - last) * 0.12;
    last = now;
    draw(delta);
    frameCount += 1;
    target.dataset.frame = String(frameCount);
    raf = requestAnimationFrame(frame);
  };
  target.dataset.motion = 'animated';
  target.dataset.frame = '0';
  raf = requestAnimationFrame(frame);
  // The Studio's canvas is resized when the viewer or the panels change, so the
  // effect re-measures with it rather than drifting out of the design area.
  const onResize = () => { resize(); if (reduce) draw(0); };
  window.addEventListener('resize', onResize);

  // Pause/Resume own the loop: cancelling the rAF is what actually stops the
  // animation, rather than leaving it running and simply not drawing. Resuming
  // resets `last` so the first frame after a pause does not jump by the whole
  // paused duration.
  const stopLoop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const startLoop = () => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  controller.pause = () => {
    stopLoop();
    target.dataset.motion = 'paused';
  };
  controller.resume = () => {
    if (reduce) return;
    startLoop();
    target.dataset.motion = 'animated';
  };
  controller.stop = () => {
    stopLoop();
    window.removeEventListener('resize', onResize);
  };
  controller.playing = !!raf;

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
  // CSS-animated engines report the same observable state as the particle one, so a
  // caller never has to care which engine it is looking at. No rAF loop here, so
  // the frame counter stays at 0.
  target.dataset.motion = reduce ? 'static' : 'animated';
  target.dataset.frame = '0';
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
    target.dataset.frame = '0';
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
  target.dataset.motion = 'static';
  target.dataset.frame = '0';
  return true;
}
