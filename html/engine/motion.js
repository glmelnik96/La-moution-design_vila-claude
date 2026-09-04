// motion.js — a deterministic, seekable timeline for HTML motion (no dependencies).
//
// Why not CSS animations / WAAPI / GSAP: a review-and-render pipeline needs `seek(t)` to be
// exact and side-effect free, so every frame can be screenshotted headlessly and every beat
// judged as a still. This engine computes all property values from `t` on every seek; nothing
// depends on wall-clock time except play().
//
//   const tl = Motion.timeline({ fps: 25, duration: 6 });
//   tl.fromTo(el, { y: [40, 0], opacity: [0, 1] }, { at: 0.3, dur: 0.4, ease: 'enter' });
//   tl.fromTo(cells, { opacity: [0, 1] }, { at: 1.1, dur: 0.2, stagger: 0.03 });   // arrays stagger
//   tl.scene('title', 0, 4, sceneEl);                                                // visibility window
//   Motion.mount(tl);            // exposes window.__motion for html/render/render.js, adds controls
//
// Props: x y (px) · scale scaleX scaleY · rotate (deg) · opacity · width height (px) ·
//        clipL clipR clipT clipB (% hidden per edge → clip-path: inset) · any custom prop
//        via opts.set(el, values, props)  — e.g. Brand.counter / Brand.drawOn
// Eases: token names from tokens.js (enter, exit, move, wipe, count, ui, linear), a
//        [x1,y1,x2,y2] array, 'steps(n)', or a function t→u.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.MotionTokens || (typeof require === 'function' ? require('./tokens.js') : null));
  else root.Motion = factory(root.MotionTokens);
})(typeof self !== 'undefined' ? self : this, function (TOKENS) {
  'use strict';

  // ───────── easing ─────────
  function cubicBezier(x1, y1, x2, y2) {
    // Newton–Raphson on the x(t) curve, then evaluate y(t). Accurate to ~1e-6.
    function A(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function B(a1, a2) { return 3 * a2 - 6 * a1; }
    function C(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; }
    function slope(t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); }
    function tForX(x) {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      // bisection fallback for robustness
      if (t < 0 || t > 1 || Math.abs(calc(t, x1, x2) - x) > 1e-4) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (calc(t, x1, x2) < x) lo = t; else hi = t; }
      }
      return t;
    }
    const fn = function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      if (x1 === y1 && x2 === y2) return x;             // linear
      return calc(tForX(x), y1, y2);
    };
    fn.bezier = [x1, y1, x2, y2];
    return fn;
  }
  function steps(n, jumpStart) {
    return function (x) {
      if (x >= 1) return 1;
      const k = Math.floor(x * n) + (jumpStart ? 1 : 0);
      return Math.min(1, k / n);
    };
  }
  // ───────── springs (closed-form damped oscillator, mass 1, from 0 to 1, v0 = 0) ─────────
  // Shared with the AE lib (M.springBake) — identical math, so a spring tuned here lands the same in AE.
  function springSolver(stiffness, zeta) {
    const w0 = Math.sqrt(stiffness);
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return function (t) { return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)); };
    }
    if (zeta === 1) return function (t) { return 1 - Math.exp(-w0 * t) * (1 + w0 * t); };
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    return function (t) { return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1); };
  }
  // Returns a TIME-based ease: fn(seconds) → progress, with fn.duration = settle time (|1−x| < 0.001).
  function spring(cfg) {
    let c = cfg;
    if (typeof cfg === 'string') {
      const key = cfg.replace(/^spring:/, '');
      c = TOKENS && TOKENS.spring && TOKENS.spring[key];
      if (!c) throw new Error('unknown spring: ' + cfg);
    }
    const k = c.stiffness || 300, z = c.damping != null ? c.damping : 0.87;
    const f = springSolver(k, z);
    let settle = 0;
    for (let t = 0; t <= 10; t += 0.001) {
      if (Math.abs(1 - f(t)) < 0.001 && Math.abs(f(t + 0.016) - f(t)) < 0.0005) { settle = t; break; }
      settle = t;
    }
    const fn = function (t) { if (t <= 0) return 0; if (t >= settle) return 1; return f(t); };
    fn.timeBased = true;
    fn.duration = Math.ceil(settle * 1000) / 1000;
    fn.spring = { stiffness: k, damping: z };
    return fn;
  }
  const FALLBACK_EASES = {
    enter: [0.16, 1, 0.3, 1], exit: [0.7, 0, 0.84, 0], move: [0.65, 0, 0.35, 1], wipe: [0.87, 0, 0.13, 1],
    count: [0.1, 0.9, 0.2, 1], ui: [0.2, 0, 0.38, 0.9], linear: [0, 0, 1, 1]
  };
  const easeCache = {};
  function ease(spec) {
    if (typeof spec === 'function') return spec;
    if (Array.isArray(spec)) return cubicBezier(spec[0], spec[1], spec[2], spec[3]);
    if (spec && typeof spec === 'object' && spec.stiffness) return spring(spec);
    const name = spec || 'enter';
    if (/^spring:/.test(name)) return (easeCache[name] = easeCache[name] || spring(name));
    if (easeCache[name]) return easeCache[name];
    const m = /^steps\((\d+)\)$/.exec(name);
    if (m) return (easeCache[name] = steps(Number(m[1])));
    const tok = TOKENS && TOKENS.ease && TOKENS.ease[name] ? TOKENS.ease[name].bezier : FALLBACK_EASES[name];
    if (!tok) throw new Error('unknown ease: ' + name);
    return (easeCache[name] = cubicBezier(tok[0], tok[1], tok[2], tok[3]));
  }

  // ───────── helpers ─────────
  function toArray(x) {
    if (x == null) return [];
    if (Array.isArray(x)) return x;
    if (typeof x.length === 'number' && typeof x !== 'string' && !x.style) return Array.prototype.slice.call(x);
    return [x];
  }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function ms(v) { return v / 1000; }
  const TRANSFORM_PROPS = { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0 };
  const CLIP_PROPS = { clipL: 0, clipR: 0, clipT: 0, clipB: 0 };
  function fmt(n) { return Math.abs(n) < 1e-6 ? '0' : String(Math.round(n * 1000) / 1000); }

  // Apply a resolved state object to an element's style. Only touches what the state carries.
  function applyState(el, st, custom) {
    const s = el.style;
    let hasT = false;
    for (const k in TRANSFORM_PROPS) { if (k in st) { hasT = true; break; } }
    if (hasT) {
      const x = st.x || 0, y = st.y || 0;
      const sx = 'scaleX' in st ? st.scaleX : ('scale' in st ? st.scale : 1);
      const sy = 'scaleY' in st ? st.scaleY : ('scale' in st ? st.scale : 1);
      const r = st.rotate || 0, rx = st.rotateX || 0, ry = st.rotateY || 0, z = st.z || 0;
      let t = (rx || ry || z) ? 'perspective(1200px) ' : '';
      t += 'translate3d(' + fmt(x) + 'px, ' + fmt(y) + 'px, ' + fmt(z) + 'px)';
      if (sx !== 1 || sy !== 1) t += ' scale(' + fmt(sx) + ', ' + fmt(sy) + ')';
      if (r) t += ' rotate(' + fmt(r) + 'deg)';
      if (rx) t += ' rotateX(' + fmt(rx) + 'deg)';
      if (ry) t += ' rotateY(' + fmt(ry) + 'deg)';
      s.transform = t;
    }
    if ('opacity' in st) s.opacity = fmt(Math.max(0, Math.min(1, st.opacity)));
    if ('blur' in st || 'mblur' in st) {
      const b = Math.max(0, (st.blur || 0) + (st.mblur || 0));
      s.filter = b > 0.05 ? 'blur(' + fmt(b) + 'px)' : '';
    }
    if ('letterSpacing' in st) s.letterSpacing = fmt(st.letterSpacing) + 'em';
    if ('width' in st) s.width = fmt(st.width) + 'px';
    if ('height' in st) s.height = fmt(st.height) + 'px';
    let hasC = false;
    for (const k in CLIP_PROPS) { if (k in st) { hasC = true; break; } }
    if (hasC) {
      s.clipPath = 'inset(' + fmt(st.clipT || 0) + '% ' + fmt(st.clipR || 0) + '% ' + fmt(st.clipB || 0) + '% ' + fmt(st.clipL || 0) + '%)';
    }
    if (custom) custom.forEach(function (c) { c.set(el, st, c.props); });
  }

  // ───────── Timeline ─────────
  function Timeline(opts) {
    opts = opts || {};
    this.fps = opts.fps || 25;
    this.duration = opts.duration || 0;
    this.loop = !!opts.loop;
    this.tweens = [];          // {el, props:{name:[from,to]}, at, dur, easeFn, set}
    this.scenes = [];          // {name, t0, t1, el}
    this.labels = {};
    this.beats = [];           // notable times (auto-collected)
    this._targets = [];        // unique elements in insertion order
    this._playing = false;
    this._t = 0;
    this.time = 0;
  }
  Timeline.prototype._reg = function (el) { if (this._targets.indexOf(el) === -1) this._targets.push(el); };
  Timeline.prototype.label = function (name, t) { this.labels[name] = t; return this; };
  Timeline.prototype.at = function (x) { return typeof x === 'string' ? this.labels[x] : x; };
  Timeline.prototype._resolveAt = function (opts) {
    let t = opts.at != null ? this.at(opts.at) : this._t;
    if (opts.delay) t += opts.delay;
    return t;
  };
  // fromTo(targets, { x:[0,40], opacity:[0,1] }, { at, dur, ease, stagger, from, delay, set })
  Timeline.prototype.fromTo = function (targets, props, opts) {
    opts = opts || {};
    const els = toArray(targets);
    const n = els.length;
    const at0 = this._resolveAt(opts);
    const easeFn = ease(opts.ease);
    const dur = opts.dur != null ? opts.dur : (easeFn.timeBased ? easeFn.duration : 0.4);
    const stag = opts.stagger || 0;
    let last = at0;
    for (let i = 0; i < n; i++) {
      let order = i;
      if (opts.from === 'end') order = n - 1 - i;
      else if (opts.from === 'center') order = Math.abs(i - (n - 1) / 2);
      const at = at0 + order * stag;
      const tw = { el: els[i], props: props, at: at, dur: dur, easeFn: easeFn, set: opts.set || null, index: i, mblur: opts.mblur || 0 };
      this.tweens.push(tw);
      this._reg(els[i]);
      last = Math.max(last, at + dur);
      if (i === 0 || i === n - 1) { this.beats.push(at); this.beats.push(at + dur); }
    }
    this._t = last;
    this.duration = Math.max(this.duration, last);
    return this;
  };
  // set(targets, {x: 40}, at) — an instant state change (HOLD key)
  Timeline.prototype.set = function (targets, values, at) {
    const props = {};
    for (const k in values) props[k] = [values[k], values[k]];
    return this.fromTo(targets, props, { at: at != null ? at : this._t, dur: 0, ease: 'linear' });
  };
  // scene(name, t0, t1, el): el is displayed only for t0 <= t < t1
  Timeline.prototype.scene = function (name, t0, t1, el) {
    this.scenes.push({ name: name, t0: t0, t1: t1, el: el });
    this.labels[name] = t0;
    this.beats.push(t0);
    this.duration = Math.max(this.duration, t1);
    return this;
  };
  // Resolve the state of every target at time t (pure; no DOM).
  Timeline.prototype.stateAt = function (t) {
    const self = this;
    const out = new Map();
    const byEl = new Map();
    this.tweens.forEach(function (tw) {
      if (!byEl.has(tw.el)) byEl.set(tw.el, []);
      byEl.get(tw.el).push(tw);
    });
    byEl.forEach(function (list, el) {
      list.sort(function (a, b) { return a.at - b.at; });
      const st = {};
      const customs = [];
      // per prop: the latest tween that has started wins; before any started → first tween's from
      const seen = {};
      const fps = self.fps;
      function progress(tw, tt) {
        if (tt < tw.at) return 0;
        if (tw.dur <= 0 || tt >= tw.at + tw.dur) return 1;
        return tw.easeFn.timeBased ? tw.easeFn(tt - tw.at) : tw.easeFn((tt - tw.at) / tw.dur);
      }
      let mblur = 0;
      list.forEach(function (tw) {
        for (const p in tw.props) {
          const pair = tw.props[p];
          if (!(p in seen)) { seen[p] = true; st[p] = pair[0]; }        // default = first tween's from
          if (t >= tw.at) {
            st[p] = lerp(pair[0], pair[1], progress(tw, t));
            // velocity-driven motion blur (px per frame above the 30 px/frame threshold → blur px)
            if (tw.mblur && (p === 'x' || p === 'y') && t < tw.at + tw.dur) {
              const prev = lerp(pair[0], pair[1], progress(tw, t - 1 / fps));
              const v = Math.abs(st[p] - prev);
              mblur = Math.max(mblur, Math.min(12, Math.max(0, (v - 30) / 12) * tw.mblur));
            }
          }
        }
        if (tw.set && customs.indexOf(tw.set) === -1) customs.push(tw.set);
      });
      if (mblur > 0 || list.some(function (tw) { return tw.mblur; })) st.mblur = mblur;
      out.set(el, { state: st, customs: customs.map(function (fn) { return { set: fn, props: null }; }) });
    });
    return out;
  };
  Timeline.prototype.seek = function (t) {
    t = Math.max(0, Math.min(this.duration, t));
    this.time = t;
    const states = this.stateAt(t);
    states.forEach(function (v, el) { applyState(el, v.state, v.customs); });
    this.scenes.forEach(function (sc) {
      if (!sc.el) return;
      const on = t >= sc.t0 && t < sc.t1;
      sc.el.style.display = on ? '' : 'none';
    });
    return this;
  };
  Timeline.prototype.seekFrame = function (f) { return this.seek(f / this.fps); };
  Timeline.prototype.frames = function () { return Math.round(this.duration * this.fps); };
  Timeline.prototype.play = function () {
    if (typeof requestAnimationFrame !== 'function') return this;
    const self = this;
    if (self._playing) return self;
    self._playing = true;
    let last = performance.now();
    function tick(now) {
      if (!self._playing) return;
      const dt = (now - last) / 1000; last = now;
      let t = self.time + dt;
      if (t >= self.duration) { if (self.loop) t = 0; else { t = self.duration; self._playing = false; } }
      self.seek(t);
      if (self.onFrame) self.onFrame(t);
      if (self._playing) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return self;
  };
  Timeline.prototype.pause = function () { this._playing = false; return this; };
  Timeline.prototype.toggle = function () { return this._playing ? this.pause() : this.play(); };
  // Beat times for review stills. 'scenes' (default): per scene — first frame, +0.6 s (entrances
  // landing), midpoint, last frame. 'all': every tween edge and scene start. Sorted, de-duplicated.
  Timeline.prototype.beatList = function (mode) {
    const self = this;
    const seen = {};
    const out = [];
    function push(b) { const k = Math.round(b * 1000); if (k < 0 || k > self.duration * 1000) return; if (!seen[k]) { seen[k] = true; out.push(k / 1000); } }
    if (mode === 'all') { this.beats.forEach(push); }
    else if (this.scenes.length) {
      this.scenes.forEach(function (sc) {
        const fd = 1 / self.fps;
        push(sc.t0 + fd); push(sc.t0 + 0.6); push(Math.min(sc.t1 - fd, sc.t0 + 1.4)); push((sc.t0 + sc.t1) / 2); push(sc.t1 - fd);
      });
    } else { push(0); push(this.duration * 0.25); push(this.duration * 0.5); push(this.duration * 0.75); push(this.duration - 1 / this.fps); }
    return out.sort(function (a, b) { return a - b; });
  };

  function timeline(opts) { return new Timeline(opts); }

  // ───────── mount: expose to the renderer, optional dev controls ─────────
  function mount(tl, opts) {
    opts = opts || {};
    const g = (typeof window !== 'undefined') ? window : globalThis;
    g.__motion = {
      ready: true,
      fps: tl.fps,
      duration: tl.duration,
      frames: tl.frames(),
      beats: tl.beatList(),
      beatsAll: tl.beatList('all'),
      seek: function (t) { tl.pause(); tl.seek(t); return tl.time; },
      seekFrame: function (f) { tl.pause(); tl.seekFrame(f); return tl.time; },
      play: function () { tl.play(); }, pause: function () { tl.pause(); }
    };
    tl.seek(0);
    const render = g.__RENDER__ || (typeof location !== 'undefined' && /[?&]render\b/.test(location.search));
    if (!render && opts.controls !== false && typeof document !== 'undefined') controls(tl);
    if (!render && opts.autoplay !== false) tl.play();
    return tl;
  }
  function controls(tl) {
    const bar = document.createElement('div');
    bar.className = 'cr-controls';
    bar.innerHTML = '<button data-act="toggle">▶︎ / ❚❚</button><input type="range" min="0" step="1"><span class="t"></span>';
    const range = bar.querySelector('input');
    const label = bar.querySelector('.t');
    range.max = String(tl.frames());
    function update(t) {
      range.value = String(Math.round(t * tl.fps));
      label.textContent = t.toFixed(2) + 's · f' + Math.round(t * tl.fps) + '/' + tl.frames();
    }
    tl.onFrame = update;
    range.addEventListener('input', function () { tl.pause(); tl.seekFrame(Number(range.value)); update(tl.time); });
    bar.querySelector('button').addEventListener('click', function () { tl.toggle(); });
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); tl.toggle(); }
      if (e.code === 'ArrowRight') { tl.pause(); tl.seekFrame(Math.round(tl.time * tl.fps) + 1); update(tl.time); }
      if (e.code === 'ArrowLeft') { tl.pause(); tl.seekFrame(Math.round(tl.time * tl.fps) - 1); update(tl.time); }
      if (e.code === 'Home') { tl.pause(); tl.seek(0); update(0); }
    });
    document.body.appendChild(bar);
    update(0);
  }

  return { cubicBezier: cubicBezier, steps: steps, spring: spring, springSolver: springSolver, ease: ease, timeline: timeline, Timeline: Timeline,
           applyState: applyState, mount: mount, lerp: lerp, ms: ms, toArray: toArray, tokens: TOKENS };
});
