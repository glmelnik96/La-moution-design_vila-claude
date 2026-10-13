// GoCloud Tech 2026 — animated deck runtime + the seven slides.
//
// Every slide is rebuilt from its Figma frame (wPZx91jtPPRJ7tCdOSEqI2) in frame units (2304 x 1280) and owns
// one seekable Motion timeline (lib/motion.js): the build plays when the slide opens, the timeline's last
// frame is the Figma frame. Beat sheet: BEATS.md.
//
//   → Space PgDn Enter click   next slide        ← PgUp Backspace   previous (rest frame)
//   R  replay   F  fullscreen   B / .  black screen   Home End   1–7   H  help
//   ?render&slide=N            one slide for html/render/render.js (window.__motion)
//   ?slide=N&t=T               one slide frozen at T seconds (T = end → rest frame)
(function () {
  'use strict';
  const W = 2304, H = 1280;
  const M = window.Motion;
  const Q = new URLSearchParams(location.search);
  const RENDER = Q.has('render') || !!window.__RENDER__;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const IMG = window.DECK_IMG || {
    taxi_car: 'img/taxi_car.webp', taxi_rim: 'img/taxi_rim.webp', cube: 'img/cube.webp', dash: 'img/dash.webp'
  };

  // ───────── eases (brand tokens + two helpers) ─────────
  const EZ = {
    enter: [0.16, 1, 0.3, 1], exit: [0.7, 0, 0.84, 0], move: [0.65, 0, 0.35, 1], wipe: [0.87, 0, 0.13, 1],
    count: [0.1, 0.9, 0.2, 1], quint: [0.22, 1, 0.36, 1], push: [0.25, 1, 0.5, 1], ein: [0.5, 0, 0.9, 0.5], lin: [0, 0, 1, 1]
  };
  const F = {};
  for (const k in EZ) F[k] = M.cubicBezier(EZ[k][0], EZ[k][1], EZ[k][2], EZ[k][3]);
  const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const lerp = (a, b, u) => a + (b - a) * u;

  // ───────── DOM helpers ─────────
  function E(tag, parent, cls, css, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) for (const k in css) e.style[k] = css[k];
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function S(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const px = (v) => r3(v) + 'px';
  function div(parent, x, y, w, h, css) {
    const e = E('div', parent, 'a', css);
    e.style.left = px(x); e.style.top = px(y);
    if (w != null) e.style.width = px(w);
    if (h != null) e.style.height = px(h);
    return e;
  }
  function svg(parent, x, y, w, h, inner) {
    const e = S('svg', { class: 'a', width: w, height: h, viewBox: '0 0 ' + w + ' ' + h }, parent);
    e.style.left = px(x); e.style.top = px(y);
    if (inner) e.innerHTML = inner;
    return e;
  }
  function img(parent, src, css) {
    const e = E('img', parent, 'a', Object.assign({ width: W + 'px', height: H + 'px' }, css || {}));
    e.decoding = 'sync'; e.draggable = false; e.alt = '';
    e.src = src;
    return e;
  }

  // Text on its Figma box. `lines` = Figma's own line breaks; each line sits in a mask (clip-path) so it can
  // rise from under its line box. Gradient fills span the whole text node (background sized to the node).
  function text(parent, o) {
    const n = o.lines.length;
    const root = div(parent, o.x, o.y, o.w || null, o.lh * n);
    root.classList.add('t');
    if (o.op != null) root.style.opacity = o.op;
    const out = o.lines.map(function (s, i) {
      const wrap = E('div', root, 'ln', { top: px(i * o.lh), height: px(o.lh), fontSize: px(o.size), width: o.w ? '100%' : 'auto' });
      // the mask only cuts below the line box (+ room for descenders); sideways it is open
      if (o.mask !== false) wrap.style.clipPath = o.clip || 'inset(-60% -4000px -0.32em -0.4em)';
      const t = E('div', wrap, 'lt t', {
        fontSize: px(o.size), lineHeight: px(o.lh), fontWeight: String(o.wt || 400),
        letterSpacing: o.fitW ? fitSpacing(s, o) : (o.ls || 0) + 'em', textTransform: o.upper ? 'uppercase' : 'none'
      }, s);
      if (o.grad) {
        t.classList.add('grad');
        t.style.backgroundImage = o.grad;
        t.style.backgroundSize = px(o.gw) + ' ' + px(o.gh);
        t.style.backgroundPosition = '0px ' + px(-i * o.lh);
        t.style.width = px(o.gw);
      } else t.style.color = o.color || '#fff';
      t._lh = o.lh; t._size = o.size;
      return t;
    });
    out.root = root;
    return out;
  }
  // line reveal: each line rises from under its own line box (brand: mask per line, never per letter)
  function reveal(tl, lines, at, o) {
    o = o || {};
    lines.forEach(function (t, i) {
      tl.fromTo(t, { y: [t._lh + 0.34 * t._size + 4, 0] },
        { at: at + i * (o.stagger != null ? o.stagger : 0.08), dur: o.dur || 0.7, ease: o.ease || EZ.enter });
    });
  }
  // premium entrance: opacity + rise + scale (+ blur), together
  function premium(tl, el, at, o) {
    o = o || {};
    const p = { y: [o.rise != null ? o.rise : 48, 0], opacity: [0, 1] };
    if (o.scale !== false) p.scale = [o.scale || 0.96, 1];
    if (o.blur) p.blur = [o.blur, 0];
    tl.fromTo(el, p, { at: at, dur: o.dur || 0.8, ease: o.ease || EZ.enter });
  }
  function fadeUp(tl, el, at, o) {
    o = o || {};
    tl.fromTo(el, { y: [o.rise || 14, 0], opacity: [0, 1] }, { at: at, dur: o.dur || 0.5, ease: EZ.enter });
  }

  // Figma PATTERN fill "PATTERN core" (node 1:7): a 12 x 12 tile with 1-unit lines on its right and bottom
  // edges, scaled by s, painted at 40 % LINEAR_DODGE of #505050 over the #222 fill → #424242 lines on #222.
  // Tiles start at the node's top-left. Drawn as exact rectangles (an SVG <pattern> drifts at fractional pitch).
  function grid(parent, x, y, w, h, s, nobase) {
    const P = 12 * s;
    let d = '';
    for (let k = 1; k * P - s < w; k++) d += 'M' + r3(k * P - s) + ' 0h' + r3(s) + 'v' + h + 'h' + r3(-s) + 'z';
    for (let k = 1; k * P - s < h; k++) d += 'M0 ' + r3(k * P - s) + 'h' + w + 'v' + r3(s) + 'h' + -w + 'z';
    return svg(parent, x, y, w, h, (nobase ? '' : '<rect width="' + w + '" height="' + h + '" fill="#222222"/>') +
      '<path d="' + d + '" fill="#424242"/>');
  }
  // a soft-edged sweep (CSS mask) — 'r' left→right, 'u' bottom→top; prop sw: 0 → 112
  function sweep(dir) {
    return function (el, st) {
      const p = st.sw;
      if (p >= 112) { el.style.webkitMaskImage = el.style.maskImage = ''; return; }
      const g = 'linear-gradient(' + (dir === 'u' ? '0deg' : '90deg') + ', #000 ' + r3(p - 12) + '%, transparent ' + r3(p) + '%)';
      el.style.webkitMaskImage = el.style.maskImage = g;
    };
  }
  // stroke draw-on for an SVG shape with el._len; prop draw: 0 → 1
  function drawOn(el, st) {
    const L = el._len;
    el.style.strokeDasharray = r3(L) + ' ' + r3(L + 20);
    el.style.strokeDashoffset = r3(L * (1 - st.draw));
  }
  // Figma kerns «/с» (Manrope Bold) 0.05 em tighter than Chrome does with the webfont: measured 5 px at 100 px,
  // every other glyph of both bit-rate lines lands within 1 px with the file's own letter-spacing (quirk 241)
  function kernSlashEs(span) { span.style.marginLeft = '-0.05em'; return span; }
  function hex2rgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mixHex(a, b, u) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return 'rgb(' + Math.round(lerp(A[0], B[0], u)) + ',' + Math.round(lerp(A[1], B[1], u)) + ',' + Math.round(lerp(A[2], B[2], u)) + ')';
  }
  let measureCtx = null;
  function advance(str, font, lsPx) {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(str).width + lsPx * str.length;
  }
  // Single-line auto-width Figma nodes: spread the browser's glyph advances to Figma's measured width
  // (Figma's box excludes the trailing tracking; the webfont and Figma's instance differ by a few px per line).
  function fitSpacing(s, o) {
    const str = o.upper ? s.toUpperCase() : s;
    const A = advance(str, (o.wt || 400) + ' ' + o.size + 'px Manrope', 0);
    const n = Array.from(str).length;
    return r3((o.fitW - A) / Math.max(1, n - 1)) + 'px';
  }

  // ───────── stage + slides ─────────
  const stage = document.getElementById('stage');
  const slides = [];
  let stageK = 1;
  function slide(name, build) {
    const el = E('section', stage, 'slide');
    el.dataset.name = name;
    const tl = M.timeline({ fps: 60 });
    const s = { name: name, el: el, tl: tl, resize: null };
    build(el, tl, s);
    slides.push(s);
    return s;
  }

  // ═════════ 1 · ×5 в год / 35 тысяч лет (3529:419) ═════════
  function buildX5(el, tl) {
    const bg = grid(el, 0, 0, W, H, 3.4956507682800293);
    tl.fromTo(bg, { sw: [0, 112] }, { at: 0, dur: 1.0, ease: EZ.move, set: sweep('r') });

    // dark card (Union) + the growth chart masked into it ("Mask group" 3529:428)
    const UNION = 'M1012.08 971H0V460H0.414062V0H1012.5V460H1012.08V971Z';
    const AREA = 'M-0.909729 837.142L-163 956.624V1716H1195V-37L1154.15 120.556L1073.43 263.983L927.156 379.022L835.239 548.65L656.346 656.989L316.352 731.279L261.334 800.616L-0.909729 837.142Z';
    const LINE = 'M-163 956.624L-0.909729 837.142L261.334 800.616L316.352 731.279L656.346 656.989L835.239 548.65L927.156 379.022L1073.43 263.983L1154.15 120.556L1195 -37';
    const card = svg(el, 119, 120, 1012.5, 971,
      '<defs>' +
      '<linearGradient id="s1u" x1="555" y1="34" x2="1266.32" y2="1393.24" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#494949"/></linearGradient>' +
      '<linearGradient id="s1a" x1="271.434" y1="756.949" x2="589.013" y2="1379.65" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#404040"/></linearGradient>' +
      '<linearGradient id="s1s" x1="-163" y1="592.295" x2="1192.03" y2="592.295" gradientUnits="userSpaceOnUse"><stop stop-color="#26D07C"/><stop offset="1" stop-color="#E8FFF4"/></linearGradient>' +
      '<clipPath id="s1c"><path d="' + UNION + '"/></clipPath>' +
      // the area under the curve follows the pen through a feathered mask (no hard vertical edge)
      '<linearGradient id="s1mg" x1="-400" y1="0" x2="-300" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' +
      '<mask id="s1m" maskUnits="userSpaceOnUse" x="-400" y="-200" width="2000" height="2400"><rect x="-400" y="-200" width="2000" height="2400" fill="url(#s1mg)"/></mask>' +
      '</defs>' +
      '<path d="' + UNION + '" fill="url(#s1u)"/>' +
      '<g clip-path="url(#s1c)"><g mask="url(#s1m)"><path d="' + AREA + '" fill="url(#s1a)"/></g>' +
      '<path id="s1line" d="' + LINE + '" fill="none" stroke="url(#s1s)" stroke-width="4" stroke-miterlimit="10"/></g>');
    card.style.transformOrigin = '506px 971px';
    premium(tl, card, 0.12, { dur: 0.85 });

    const line = card.querySelector('#s1line'), feather = card.querySelector('#s1mg');
    const LEN = line.getTotalLength();
    function lenAtX(x) { let lo = 0, hi = LEN; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (line.getPointAtLength(m).x < x) lo = m; else hi = m; } return lo; }
    const A0 = lenAtX(-2), A1 = lenAtX(1014);
    line.style.strokeDasharray = r3(LEN) + ' ' + r3(LEN + 20);
    tl.fromTo(line, { draw: [0, 1] }, {
      at: 0.85, dur: 1.6, ease: EZ.move, set: function (e, st) {
        const len = st.draw >= 1 ? LEN : A0 + (A1 - A0) * st.draw;
        e.style.strokeDashoffset = r3(LEN - len);
        const x = st.draw >= 1 ? 4000 : e.getPointAtLength(Math.min(len, LEN)).x;
        feather.setAttribute('x1', r3(x - 170)); feather.setAttribute('x2', r3(x + 2));
      }
    });

    // green card (two rects, as in the file) + its flat line
    const green = svg(el, 1151, 120, 1012.5, 971,
      '<rect x="0" y="480" width="1012.08" height="491" fill="#26D07C"/><rect x="0.4140625" y="0" width="1012.08" height="506" fill="#26D07C"/>');
    tl.fromTo(green, { clipR: [100, 0] }, { at: 0.3, dur: 0.75, ease: EZ.wipe });
    const flat = svg(el, 1137, 978, 1046, 4,
      '<defs><linearGradient id="s1f" x1="0" y1="0" x2="1043.72" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>' +
      '<line x1="1046" y1="2" x2="0" y2="2" stroke="url(#s1f)" stroke-width="4"/>');
    flat.style.clipPath = 'inset(0 19.92px 0 14px)';
    const fl = flat.querySelector('line');
    tl.fromTo(fl, { fd: [0, 1] }, {
      at: 0.95, dur: 1.6, ease: EZ.move, set: function (e, st) {
        // the path runs right → left in the file; reveal it left → right
        e.style.strokeDasharray = '1046 1100';
        e.style.strokeDashoffset = r3(-1046 * (1 - st.fd));
      }
    });

    // texts
    const t1 = text(el, { x: 203, y: 180, w: 757, size: 44.77366638183594, lh: 53.728397369384766, ls: -0.01, wt: 500, color: '#fff', lines: ['Вычисления для обучения', 'передовых моделей'] });
    reveal(tl, t1, 0.55, { stagger: 0.08 });
    const t4 = text(el, { x: 1240, y: 180, w: 757, size: 44.77366638183594, lh: 53.728397369384766, ls: -0.01, wt: 500, color: '#000', lines: ['Мозг человека в нынешней форме'] });
    reveal(tl, t4, 0.75);

    // ×5: "x" lands, the digit rolls 1 → 5 in step with the curve (detents: hold, then roll)
    const G5 = 'linear-gradient(101.0952887486837deg, #fff 4.8915%, #999 54.018%)';
    const x5 = div(el, 200, 276, 995.651, 462); x5.classList.add('t');
    const f5 = { fontSize: '420px', lineHeight: '462px', fontWeight: '400', letterSpacing: '-0.03em' };
    const xg = E('div', x5, 'lt t grad', Object.assign({ backgroundImage: G5, backgroundSize: '995.651px 462px', backgroundPosition: '0px 0px', width: '995.651px' }, f5), 'x');
    const xw = advance('x', '400 420px Manrope', -12.6);
    // the roll window hugs the digit (ink y 364–673 on the slide): digits slot in and out below the caption
    const win = div(x5, xw, 0, 560, 462, { clipPath: 'inset(64px -10% 38px -10%)' });
    const col = div(win, 0, 0, 560, 462 * 5);
    const digits = [1, 2, 3, 4, 5].map(function (d, i) {
      return E('div', col, 'a t grad', Object.assign({ top: px(i * 462), width: '560px', backgroundImage: G5, backgroundSize: '995.651px 462px' }, f5), String(d));
    });
    x5.style.transformOrigin = '200px 380px';
    premium(tl, x5, 0.75, { rise: 60, blur: 6, dur: 0.9 });
    tl.fromTo(col, { roll: [0, 1] }, {
      at: 0.85, dur: 1.6, ease: EZ.move, set: function (e, st) {
        const u = st.roll * 4, k = Math.min(3, Math.floor(u)), f = u - k;
        const r = st.roll >= 1 ? 4 : k + F.quint(c01((f - 0.35) / 0.65));
        const ty = -r * 462;
        e.style.transform = 'translate(0px, ' + r3(ty) + 'px)';
        digits.forEach(function (dg, i) { dg.style.backgroundPosition = px(-xw) + ' ' + px(-(i * 462 + ty)); });
      }
    });
    const vgod = text(el, { x: 692.5078125, y: 343.46484375, w: 313.277, size: 54, lh: 59.4, ls: -0.02, wt: 600, grad: 'linear-gradient(115.7886423338069deg, #fff 4.8915%, #999 54.018%)', gw: 313.277, gh: 59, lines: ['в год'] });
    reveal(tl, vgod, 2.45, { dur: 0.6 });

    // 35 — heavy, still: it does not count
    const n35 = text(el, { x: 1216, y: 276, w: 552.307, size: 420, lh: 462, ls: -0.05, wt: 400, mask: false, grad: 'linear-gradient(76.44932869913853deg, #222 13.215%, #494949 84.796%)', gw: 552.307, gh: 462, lines: ['35'] });
    n35.root.style.transformOrigin = '200px 380px';
    premium(tl, n35.root, 1.0, { rise: 60, blur: 6, dur: 0.9 });
    const tys = text(el, { x: 1708.5078125, y: 343.46484375, w: 313.277, size: 54, lh: 59.4, ls: -0.02, wt: 600, grad: 'linear-gradient(61.842424155793594deg, #222 13.215%, #494949 84.796%)', gw: 313.277, gh: 118, lines: ['тысяч', 'лет'] });
    reveal(tl, tys, 1.25, { dur: 0.6, stagger: 0.07 });

    const src1 = text(el, { x: 1240, y: 1028, size: 24, lh: 24, wt: 400, color: '#000', op: 0.8, mask: false, fitW: 454, lines: ['Источник: Epoch AI · Max Planck Institute'] });
    const src2 = text(el, { x: 1709, y: 1189, size: 24, lh: 24, wt: 400, color: '#c8c8c8', op: 0.8, mask: false, fitW: 454, lines: ['Источник: Epoch AI · Max Planck Institute'] });
    fadeUp(tl, src1[0], 2.6); fadeUp(tl, src2[0], 2.68);
  }

  // ═════════ 2 · Интеллект — фильтр (3529:461), rebuilt as vectors ═════════
  function buildFilter(el, tl) {
    // 24 lines from the file's raster (fitted), all forced through one point P; output on y = 763
    const P = [1362.4, 763];
    const ANCHOR_X = 251;
    const ANCHOR_Y = [152.91, 230.2, 292.01, 347.83, 378.44, 448.16, 480.06, 515.99, 571.17, 619.67, 668.55, 715.65,
      763.08, 810.91, 858.75, 909.97, 953.3, 968.7, 1022.42, 1072.91, 1108.14, 1144.62, 1202.27, 1262.8];
    const COL = '#6ECD8E';
    const L = svg(el, 0, 0, W, H);
    const gl = S('g', {}, L), gp = S('g', {}, L);
    const rnd = mulberry(7);
    const lines = ANCHOR_Y.map(function (ay, i) {
      const dx = ANCHOR_X - P[0], dy = (i === 12 ? P[1] : ay) - P[1];
      // entry point into the frame (left edge, or top / bottom for the steep ones), 8 px outside
      let t = (-8 - P[0]) / dx;
      let sx = P[0] + dx * t, sy = P[1] + dy * t;
      if (sy < -8) { t = (-8 - P[1]) / dy; sx = P[0] + dx * t; sy = -8; }
      if (sy > H + 8) { t = (H + 8 - P[1]) / dy; sx = P[0] + dx * t; sy = H + 8; }
      const ln = S('line', { x1: r3(sx), y1: r3(sy), x2: P[0], y2: P[1], stroke: COL, 'stroke-width': 3 }, gl);
      ln._len = Math.hypot(P[0] - sx, P[1] - sy);
      tl.fromTo(ln, { draw: [0, 1] }, { at: 0.4 + rnd() * 0.6, dur: 1.15, ease: EZ.quint, set: drawOn });
      return { ln: ln, sx: sx, sy: sy, len: ln._len };
    });
    // pulses: pale dashes running into the funnel, accelerating
    const order = lines.map(function (_, i) { return i; }).sort(function () { return rnd() - 0.5; });
    order.slice(0, 14).forEach(function (i, k) {
      const o = lines[i];
      const pl = S('line', { x1: r3(o.sx), y1: r3(o.sy), x2: P[0], y2: P[1], stroke: '#E8FFF4', 'stroke-width': 3 }, gp);
      const seg = 90;
      tl.fromTo(pl, { pp: [0, 1] }, {
        at: 1.15 + k * 0.085 + rnd() * 0.12, dur: 0.85, ease: EZ.ein, set: function (e, st) {
          e.style.strokeDasharray = seg + ' ' + r3(o.len + seg * 2);
          e.style.strokeDashoffset = r3(seg - st.pp * (o.len + seg));
          e.style.opacity = st.pp <= 0 || st.pp >= 1 ? '0' : '1';
        }
      });
    });
    // output: one line, one bit
    const out = S('line', { x1: P[0], y1: P[1], x2: W + 10, y2: P[1], stroke: COL, 'stroke-width': 4 }, L);
    out._len = W + 10 - P[0];
    tl.fromTo(out, { draw: [0, 1] }, { at: 2.15, dur: 0.7, ease: EZ.enter, set: drawOn });
    const bit = div(el, 1730, 749, 28, 28, { background: '#fff' });
    tl.fromTo(bit, { x: [P[0] - 14 - 1730, 0] }, { at: 2.2, dur: 0.95, ease: EZ.move });
    tl.fromTo(bit, { scale: [0, 1] }, { at: 2.2, dur: 0.3, ease: EZ.enter });

    // plates (#222) mask the lines under the texts, as in the file (faded in so they never cover the
    // outgoing slide during the transition; the lines reach them later)
    [div(el, 104.39, 220, 995.609, 67.07, { background: '#222' }),
      div(el, 103, 287.07, 997.81, 117.781, { background: '#222' }),
      div(el, 1720, 287, 483, 100, { background: '#222' })].forEach(function (p) {
      tl.fromTo(p, { opacity: [0, 1] }, { at: 0, dur: 0.3, ease: EZ.lin });
    });

    const title = text(el, { x: 104, y: 86, size: 44, lh: 60, wt: 600, upper: true, color: '#fff', fitW: 484, lines: ['Интеллект — фильтр'] });
    reveal(tl, title, 0);
    const inT = text(el, { x: 124.39, y: 220, size: 36, lh: 36, wt: 400, color: '#fff', fitW: 234, lines: ['входит в мозг'] });
    reveal(tl, inT, 0.2, { dur: 0.6 });

    // 1 000 000 000 бит/с — odometer: every column spins and lands, the leading one on 1
    const LH = 100.11715698242188;
    const num = div(el, 116.905, 287.07, null, LH);
    num.classList.add('t');
    Object.assign(num.style, { fontSize: px(LH), lineHeight: px(LH), fontWeight: '700', color: '#a6efcb', whiteSpace: 'pre', letterSpacing: '-0.01em' });
    const STR = '1 000 000 000';
    let j = 0;
    const ncol = STR.replace(/ /g, '').length;
    for (const ch of STR) {
      if (ch === ' ') { num.appendChild(document.createTextNode(' ')); continue; }
      const od = E('span', num, 'od');
      E('span', od, 'of', null, ch);
      const n = 14 + 3 * j;
      const fin = +ch, seq = [];
      for (let k = 0; k < n; k++) seq.push(((fin - (n - 1 - k)) % 10 + 10) % 10);
      const oc = E('span', od, 'oc', { lineHeight: px(LH) }, seq.join('\n'));
      tl.fromTo(oc, { k: [0, n - 1] }, {
        at: 0.35 + (ncol - 1 - j) * 0.012, dur: 1.45 + j * 0.03, ease: EZ.count, set: function (e, st) {
          e.style.transform = 'translate(0px, ' + r3(-st.k * LH) + 'px)';
        }
      });
      j++;
    }
    num.appendChild(document.createTextNode(' бит/'));
    kernSlashEs(E('span', num, null, null, 'с'));
    num.style.transformOrigin = '0 50%';
    tl.fromTo(num, { opacity: [0, 1], y: [24, 0] }, { at: 0.3, dur: 0.5, ease: EZ.enter });

    const outT = text(el, { x: 1744, y: 220, size: 38, lh: 38, wt: 400, color: '#fff', fitW: 291, lines: ['выходит наружу'] });
    reveal(tl, outT, 2.75, { dur: 0.6 });
    const ten = text(el, { x: 1730, y: 287, size: 100, lh: 100, ls: -0.01, wt: 700, color: '#fff', mask: false, lines: ['~10 бит/'] });
    kernSlashEs(E('span', ten[0], null, null, 'с'));
    ten.root.style.transformOrigin = '0 70%';
    premium(tl, ten.root, 2.85, { blur: 6, dur: 0.8 });
    const src = text(el, { x: 1708, y: 1189, size: 24, lh: 24, wt: 400, color: 'rgba(200,200,200,0.5)', op: 0.8, mask: false, fitW: 459, lines: ['Источник: Zheng & Meister, Neuron, 2024'] });
    fadeUp(tl, src[0], 3.2);
  }

  // ═════════ 3 · Такси (3529:401) ═════════
  function buildTaxi(el, tl) {
    const cam = div(el, 0, 0, W, H);
    cam.style.transformOrigin = '1000px 520px';
    tl.fromTo(cam, { scale: [1.06, 1] }, { at: 0, dur: 2.9, ease: EZ.push });
    const back = svg(cam, -31, 77, 2436.5, 817.85,
      '<defs><linearGradient id="s3g" x1="779.454" y1="370.411" x2="827.163" y2="730.165" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#404040"/></linearGradient></defs>' +
      '<path d="M146.5 672.5L33.5 707.5L29.5 709L0 718V0H2384C2432.5 300 2491 882.4 2337 812C2183 741.6 1891.17 720 1764.5 718L1524 586L1384.5 525.5L1305 508V486H1290.5C1285 473.667 1271.1 438.8 1259.5 398C1247.9 357.2 1213.67 342.667 1198 340.5H839.5C825.833 342 795.3 352.3 782.5 381.5C769.7 410.7 756.5 463.333 751.5 486H729.5V513L715 518L494.5 566.5L267 633L146.5 672.5Z" fill="url(#s3g)"/>');
    tl.fromTo(back, { opacity: [0, 1] }, { at: 0, dur: 1.5, ease: EZ.move });

    const car = div(cam, 0, 0, W, H);
    img(car, IMG.taxi_car);
    // the checker: 'off' plates over the lit squares, switched off one by one
    const SQ = [[837.8, 418.2], [878, 457.8], [918.3, 418.2], [959.2, 457.8], [1000.6, 418.2], [1040, 457.8], [1081.2, 418.2]];
    SQ.forEach(function (p, i) {
      const off = div(car, p[0], p[1], 45, 44.4, { background: '#141414', filter: 'blur(0.8px)' });
      const at = 1.55 + i * 0.075;
      tl.fromTo(off, { opacity: [1, 0] }, { at: at, dur: 0.06, ease: EZ.lin });
      const fl = div(car, p[0] + 2, p[1] + 2, 41, 40.4, { background: '#d8d8d8', mixBlendMode: 'screen' });
      tl.fromTo(fl, { opacity: [0, 0.45] }, { at: at, dur: 0.06, ease: EZ.lin });
      tl.fromTo(fl, { opacity: [0.45, 0] }, { at: at + 0.06, dur: 0.32, ease: EZ.quint });
    });
    tl.fromTo(car, { opacity: [0, 1], bri: [0.25, 1] }, {
      at: 0.1, dur: 1.8, ease: EZ.move, set: function (e, st) { e.style.filter = st.bri >= 0.999 ? '' : 'brightness(' + r3(st.bri) + ')'; }
    });
    // a light runs along the roofline once
    const rim = img(cam, IMG.taxi_rim, { mixBlendMode: 'plus-lighter' });
    tl.fromTo(rim, { sw: [0, 1] }, {
      at: 0.85, dur: 1.5, ease: EZ.move, set: function (e, st) {
        if (st.sw <= 0 || st.sw >= 1) { e.style.visibility = 'hidden'; return; }
        e.style.visibility = '';
        const c = lerp(-15, 115, st.sw);
        const g = 'linear-gradient(100deg, transparent ' + r3(c - 14) + '%, #000 ' + r3(c) + '%, transparent ' + r3(c + 9) + '%)';
        e.style.webkitMaskImage = e.style.maskImage = g;
        e.style.opacity = r3(0.85 * Math.sin(Math.PI * c01(st.sw * 1.1)));
      }
    });
    const floor = div(cam, 0, 895, W, 489, { background: 'linear-gradient(179.2326811552532deg, rgba(18,18,18,0.1) 3.1418%, #121212 27.799%)' });
    tl.fromTo(floor, { opacity: [0, 1] }, { at: 0, dur: 0.9, ease: EZ.move });
  }

  // ═════════ 4 · GPU-час → ТОКЕН (3529:406) ═════════
  function buildToken(el, tl) {
    const area = svg(el, -218, 160, 2805, 1201.5,
      '<defs><linearGradient id="s4a" x1="1684.5" y1="762.067" x2="1518.33" y2="-639.883" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#3D3D3D"/></linearGradient></defs>' +
      '<path d="M351.688 286.73L219.006 297.511L144.565 340.65L0 319.129L0.000701107 1201.5L2805 1196.44L2585 49.8882L2449.5 85.8567L2372 69.6709L2257 85.8567L2067.62 22.9364L1984.75 0L1821.12 36.1689L1715.94 22.9364L1537.44 95.2742H1491.75L939.25 201.726H804.312L739.5 210.617L631.125 190.824L351.688 286.73Z" fill="url(#s4a)"/>');
    const steps = svg(el, 5, 165.974, 2347.01, 290.026,
      '<path d="M0 288.026H469.4V192.693H938.8V97.3598H1408.2V8.19405L1877.6 2.02645V98.7988L2347 97.4948" fill="none" stroke="#434343" stroke-width="4"/>');
    const sp = steps.querySelector('path');
    const SL = sp.getTotalLength();
    sp.style.strokeDasharray = r3(SL) + ' ' + r3(SL + 20);
    tl.fromTo(sp, { g: [0, 1] }, {
      at: 0, dur: 1.7, ease: EZ.move, set: function (e, st) {
        const len = SL * st.g;
        e.style.strokeDashoffset = r3(SL - len);
        // the area grows behind the pen through a feathered mask (local x of the pen = slide x + 218)
        if (st.g >= 1) { area.style.webkitMaskImage = area.style.maskImage = ''; return; }
        const ex = e.getPointAtLength(len).x + 5 + 218 + 30;
        area.style.webkitMaskImage = area.style.maskImage = 'linear-gradient(90deg, #000 ' + r3(ex - 220) + 'px, transparent ' + r3(ex) + 'px)';
      }
    });
    tl.fromTo(area, { opacity: [0, 1] }, { at: 0, dur: 0.6, ease: EZ.move });

    const tok = text(el, { x: 97, y: 434, w: 2132, size: 706.8764038085938, lh: 706.8764038085938, ls: -0.05, wt: 500, upper: true,
      clip: 'inset(-12% -3% 60px -3%)', grad: 'linear-gradient(106.2418620233488deg, #fff 24.799%, #999 85.852%)', gw: 2132, gh: 707, fitW: 2132, lines: ['токен'] });
    tl.fromTo(tok[0], { y: [600, 0] }, { at: 1.4, dur: 1.15, ease: EZ.enter });

    // the file sets textCase UPPER here, but Figma renders it as typed (lower-case «час»): follow the render
    const gpu = text(el, { x: 131, y: 85, size: 110, lh: 110, ls: -0.02, wt: 500, color: '#434343', fitW: 442, lines: ['GPU-час'] });
    reveal(tl, gpu, 0.2, { dur: 0.7 });
    tl.fromTo(gpu[0], { dim: [0, 1] }, { at: 0.95, dur: 0.35, ease: EZ.move, set: function (e, st) { e.style.color = mixHex('#d9d9d9', '#434343', st.dim); } });
    // Line 16 is a Figma LINE at y 153: its 9 px stroke covers [y − 9, y] (quirk 190), measured rows 144–152
    const strike = div(el, 104, 144, 478, 9, { background: '#434343', transformOrigin: '0 50%' });
    tl.fromTo(strike, { scaleX: [0, 1] }, { at: 0.95, dur: 0.4, ease: EZ.enter });

    const strip = grid(el, -21, 1112, 2350, 170, 2.373704195022583);
    tl.fromTo(strip, { sw: [0, 112] }, { at: 0, dur: 0.9, ease: EZ.move, set: sweep('r') });
    const src = text(el, { x: 1708, y: 1189, size: 24, lh: 24, wt: 400, color: '#c8c8c8', op: 0.8, mask: false, fitW: 463, lines: ['Источник: Дженсен Хуанг, Yahoo Finance'] });
    fadeUp(tl, src[0], 2.5);
  }

  // ═════════ 5 · Не считать лишнего (3529:507) ═════════
  function buildSection(el, tl) {
    const wash = div(el, 0, 0, 2302, 1282, { background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 100%)' });
    tl.fromTo(wash, { opacity: [0, 1] }, { at: 0, dur: 0.6, ease: EZ.lin });
    const cube = div(el, 0, 0, W, H);
    img(cube, IMG.cube);
    cube.style.transformOrigin = '1148px 620px';
    tl.fromTo(cube, { scale: [1.1, 1], opacity: [0, 1], blur: [6, 0] }, { at: 0, dur: 1.5, ease: EZ.enter });

    const box = grid(el, 522, 260, 1260, 751, 2.373704195022583);
    tl.fromTo(box, { clipR: [100, 0] }, { at: 0.35, dur: 0.65, ease: EZ.wipe });
    const p1 = div(el, 522, 260, 1184, 468, { background: '#fff' });
    tl.fromTo(p1, { clipR: [100, 0] }, { at: 0.55, dur: 0.6, ease: EZ.wipe });
    const h = text(el, { x: 557.2941207885742, y: 270, w: 1113.412, size: 190, lh: 209, ls: -0.04, wt: 600, upper: true, color: '#000', lines: ['Не считать', 'лишнего'] });
    reveal(tl, h, 0.82, { stagger: 0.08, dur: 0.75 });
    const p2 = div(el, 522, 728, 867, 199, { background: '#fff' });
    tl.fromTo(p2, { clipR: [100, 0] }, { at: 0.98, dur: 0.5, ease: EZ.wipe });
    const sub = text(el, { x: 557.2941207885742, y: 745.6470603942871, w: 796.412, size: 64.70588684082031, lh: 64.70588684082031, ls: -0.04, wt: 400, color: '#000', lines: ['Сегодня — как это', 'устроено у нас внутри'] });
    reveal(tl, sub, 1.18, { stagger: 0.07, dur: 0.6 });
  }

  // ═════════ 6 · Исполнение можно делегировать (3529:542) ═════════
  function buildDelegate(el, tl) {
    const g = grid(el, -21, 580, 2350, 702, 2.373704195022583);
    tl.fromTo(g, { sw: [0, 112] }, { at: 0.45, dur: 1.0, ease: EZ.move, set: sweep('u') });
    const dash = div(el, 0, 0, W, H);
    svg(dash, -69, 1157, 637, 212, '<ellipse cx="318.5" cy="106" rx="318.5" ry="106" fill="#020202"/>');
    svg(dash, 1760, 1112, 637, 212, '<ellipse cx="318.5" cy="106" rx="318.5" ry="106" fill="#020202"/>');
    img(dash, IMG.dash);
    tl.fromTo(dash, { y: [170, 0], opacity: [0, 1], bri: [0.3, 1] }, {
      at: 0.7, dur: 1.5, ease: EZ.enter, set: function (e, st) { e.style.filter = st.bri >= 0.999 ? '' : 'brightness(' + r3(st.bri) + ')'; }
    });
    const head = text(el, { x: 100, y: 190, w: 2080, size: 120, lh: 120, ls: 0, wt: 600,
      grad: 'linear-gradient(128.26078370129457deg, #fff 4.8915%, #999 54.018%)', gw: 2080, gh: 240,
      lines: ['Исполнение можно делегировать.', 'Ответственность — нет'] });
    reveal(tl, head, 0.22, { stagger: 0.12, dur: 0.85 });
    const label = text(el, { x: 104, y: 86, size: 44, lh: 60, wt: 600, upper: true, color: '#fff', fitW: 1086, lines: ['Человек задает намерение, агент исполняет'] });
    reveal(tl, label, 0, { dur: 0.6 });
  }

  // ═════════ 7 · Выберите свои 10 бит (3529:567) ═════════
  // Field of 60 x 32 cells (40 px, #222 fill, 1 px #26D07C centre stroke, "0" in SB Sans Text Mono 15 px —
  // glyph outlines exported from Figma). Fills in a diagonal wave, then the two centre cells light up: 1 0.
  const GLYPH0 = 'M16.8971 20.765C16.8971 16.745 18.1121 15.38 20.6621 15.38C23.1071 15.38 24.0971 16.955 24.0971 20.765C24.0971 24.965 22.8221 26.15 20.4971 26.15C18.0071 26.15 16.8971 24.41 16.8971 20.765ZM18.2171 20.765C18.2171 22.325 18.3971 23.375 18.7721 24.035L21.5921 16.715C21.2921 16.58 20.9321 16.52 20.4971 16.52C18.7871 16.52 18.2171 17.465 18.2171 20.765ZM22.7771 20.81C22.7771 19.19 22.6571 18.155 22.3421 17.495L19.5221 24.8C19.8221 24.95 20.1671 25.01 20.5571 25.01C22.1471 25.01 22.7771 24.155 22.7771 20.81Z';
  const GLYPH1 = 'M17.4971 26V24.8H20.5871V16.97L17.4971 18.815V17.51L20.9471 15.395H21.8471V24.8H23.7671V26H17.4971Z';
  function buildBits(el, tl, s) {
    const wash = div(el, 0, 0, 2302, 1282, { background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 100%)' });
    tl.fromTo(wash, { opacity: [0, 1] }, { at: 0, dur: 0.6, ease: EZ.lin });
    const cv = E('canvas', el, 'a', { width: W + 'px', height: H + 'px' });
    const ctx = cv.getContext('2d');
    const G0 = new Path2D(GLYPH0), G1 = new Path2D(GLYPH1);
    const C = 60, R = 32, X0 = -48, CS = 40, DUR = 0.42;
    const HL = [[29, 15, 1.95], [30, 15, 2.12]];             // (col, row, t): 1112,600 and 1152,600
    const rnd = mulberry(402);
    const start = new Float32Array(C * R);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const d = 0.62 * (c / (C - 1)) + 0.38 * (r / (R - 1));
      start[r * C + c] = 0.04 + d * 1.2 + (rnd() - 0.5) * 0.24;
    }
    let maxStart = 0; for (let i = 0; i < start.length; i++) maxStart = Math.max(maxStart, start[i]);
    const END = Math.max(maxStart + DUR + 0.12, HL[1][2] + 0.4);
    let K = 1, last = -1;
    function setSize(k) {
      const dpr = RENDER ? 1 : (window.devicePixelRatio || 1);
      K = k * dpr;
      cv.width = Math.round(W * K); cv.height = Math.round(H * K);
      last = -1; draw(s.tl.time || 0);
    }
    s.resize = setSize;
    function cell(x, y) {          // fill, stroke (centred, 1 px) and the digit — Figma's frame "001"
      ctx.fillStyle = '#222222'; ctx.fillRect(x, y, CS, CS);
      ctx.strokeStyle = '#26D07C'; ctx.lineWidth = 1; ctx.strokeRect(x, y, CS, CS);
    }
    function glyph(path, x, y, color) {
      ctx.save(); ctx.translate(x - 0.5, y - 0.5); ctx.fillStyle = color; ctx.fill(path); ctx.restore();
    }
    function highlight(c, r, q, roll) {   // green rises from the bottom; the digit is dark under the fill
      const x = X0 + c * CS, y = r * CS;
      const h = CS * F.enter(c01(q));
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, CS, CS); ctx.clip();
      ctx.fillStyle = '#26D07C'; ctx.fillRect(x, y + CS - h, CS, h);
      const dy0 = -CS * roll, dy1 = CS * (1 - roll);       // roll: the 0 leaves upwards, the 1 arrives
      for (let pass = 0; pass < 2; pass++) {
        ctx.save(); ctx.beginPath();
        if (pass === 0) ctx.rect(x, y, CS, CS - h); else ctx.rect(x, y + CS - h, CS, h);
        ctx.clip();
        const col = pass === 0 ? '#26D07C' : '#222222';
        if (roll == null) glyph(G0, x, y, col);
        else { glyph(G0, x, y + dy0, col); glyph(G1, x, y + dy1, col); }
        ctx.restore();
      }
      ctx.restore();
    }
    function draw(t) {
      if (t === last) return;
      const settled = t >= END && last >= END;
      last = t;
      if (settled) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(K, 0, 0, K, 0, 0);
      for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) {
        const q = (t - start[r * C + c]) / DUR;
        if (q <= 0) continue;
        const x = X0 + c * CS, y = r * CS;
        if (q >= 1.5) { cell(x, y); glyph(G0, x, y, '#26D07C'); continue; }
        const e = F.enter(c01(q)), sc = 0.55 + 0.45 * e;
        ctx.save();
        ctx.globalAlpha = c01(q * 1.8);
        ctx.translate(x + CS / 2, y + CS / 2); ctx.scale(sc, sc); ctx.translate(-x - CS / 2, -y - CS / 2);
        cell(x, y);
        const qd = c01((q - 0.3) / 0.9);
        if (qd > 0) { ctx.globalAlpha = c01(q * 1.8) * qd; glyph(G0, x, y, '#26D07C'); }
        ctx.restore();
      }
      HL.forEach(function (hl, i) {
        const q = (t - hl[2]) / 0.36;
        if (q <= 0) return;
        const roll = i === 0 ? F.quint(c01((t - hl[2] - 0.05) / 0.38)) : null;
        highlight(hl[0], hl[1], q, roll);
      });
      if (t >= HL[1][2] + 0.2) {          // the divider between the two lit cells (#222 centre stroke)
        ctx.strokeStyle = '#222222'; ctx.lineWidth = 1;
        ctx.globalAlpha = c01((t - HL[1][2] - 0.2) / 0.2);
        ctx.beginPath(); ctx.moveTo(1152, 600); ctx.lineTo(1152, 640); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    tl.fromTo(cv, { gt: [0, END] }, { at: 0, dur: END, ease: EZ.lin, set: function (e, st) { draw(st.gt); } });

    const plate = div(el, 112, 120, 1600, 200, { background: '#fff' });
    tl.fromTo(plate, { clipR: [100, 0] }, { at: 2.55, dur: 0.65, ease: EZ.wipe });
    const head = text(el, { x: 137.938, y: 127.348, w: 1548.132, size: 120, lh: 132, ls: -0.04, wt: 600, upper: true, color: '#000', lines: ['Выберите свои 10 бит'] });
    reveal(tl, head, 2.85, { dur: 0.75 });
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ───────── runtime: fit, navigation, transitions ─────────
  let cur = -1, token = 0;
  const hud = document.getElementById('hud');
  const help = document.getElementById('help');
  const blank = document.getElementById('blank');

  function fit() {
    const k = RENDER ? 1 : Math.min(innerWidth / W, innerHeight / H);
    const x = RENDER ? 0 : (innerWidth - W * k) / 2, y = RENDER ? 0 : (innerHeight - H * k) / 2;
    stage.style.transform = 'translate(' + r3(x) + 'px,' + r3(y) + 'px) scale(' + k + ')';
    stageK = k;
    slides.forEach(function (s) { if (s.resize) s.resize(k); });
  }

  function show(s) { s.el.classList.add('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }
  function hide(s) { s.tl.pause(); s.el.classList.remove('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }

  // the outgoing slide leaves in 0.32 s (opacity + a 2 % push, ease-in); the stage stays #222 underneath
  function leave(s) {
    s.tl.pause();
    const el = s.el, t0 = performance.now(), D = 320;
    el.style.transformOrigin = '50% 50%';
    const my = ++s._leaveId || (s._leaveId = 1);
    function f(now) {
      if (s._leaveId !== my) return;
      const u = Math.min(1, (now - t0) / D), e = F.exit(u);
      el.style.opacity = r3(1 - e);
      el.style.transform = 'scale(' + r3(1 + 0.02 * e) + ')';
      if (u < 1) requestAnimationFrame(f); else hide(s);
    }
    requestAnimationFrame(f);
  }

  function go(i, mode) {
    if (i < 0 || i >= slides.length) return;
    const my = ++token;
    const prev = slides[cur], next = slides[i];
    if (prev && prev !== next) {
      prev._leaveId = (prev._leaveId || 0) + 1;
      if (mode === 'intro') leave(prev); else hide(prev);
    }
    next._leaveId = (next._leaveId || 0) + 1;
    next.tl.pause();
    next.tl.seek(mode === 'intro' ? 0 : next.tl.duration);
    show(next);
    cur = i;
    if (mode === 'intro') {
      const delay = prev && prev !== next ? 200 : 0;
      setTimeout(function () { if (token === my) { next.tl.seek(0); next.tl.play(); } }, delay);
    }
    try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) { /* file:// in some browsers */ }
    hud.textContent = (i + 1) + ' / ' + slides.length;
  }
  const next = function () { if (cur < slides.length - 1) go(cur + 1, 'intro'); };
  const prev = function () { if (cur > 0) go(cur - 1, 'rest'); };

  let idleT = 0;
  function poke() {
    hud.classList.add('show'); document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function () { hud.classList.remove('show'); document.body.classList.add('idle'); }, 1800);
  }
  function toggleFull() {
    if (!document.fullscreenElement) { const r = document.documentElement.requestFullscreen; if (r) r.call(document.documentElement).catch(function () {}); }
    else if (document.exitFullscreen) document.exitFullscreen();
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); next(); }
      else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') { e.preventDefault(); prev(); }
      else if (k === 'Home') go(0, 'intro');
      else if (k === 'End') go(slides.length - 1, 'intro');
      else if (k === 'r' || k === 'R' || k === 'к' || k === 'К') { const s = slides[cur]; s.tl.pause(); s.tl.seek(0); s.tl.play(); }
      else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') toggleFull();
      else if (k === 'h' || k === 'H' || k === 'р' || k === 'Р' || k === '?') help.classList.toggle('show');
      else if (k === 'b' || k === 'B' || k === 'и' || k === 'И' || k === '.') blank.classList.toggle('show');   // clicker «blank screen»
      else if (/^[1-9]$/.test(k) && +k <= slides.length) go(+k - 1, 'intro');
    });
    // the counter shows only when the mouse moves (never on the big screen while clicking through)
    stage.parentNode.addEventListener('click', function (e) { if (e.button === 0) next(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); prev(); });
    let mx = -1, my = -1;
    document.addEventListener('mousemove', function (e) {
      if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < 3) return;
      mx = e.clientX; my = e.clientY; poke();
    });
    let tx = null;
    document.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx; tx = null;
      if (dx < -40) next(); else if (dx > 40) prev(); else next();
    });
    window.addEventListener('resize', fit);
  }

  function ready() {
    const fonts = ['400', '500', '600', '700'].map(function (w) { return document.fonts.load(w + ' 40px Manrope', 'Аа0'); });
    const pics = Object.keys(IMG).map(function (k) {
      return new Promise(function (res) { const im = new Image(); im.onload = im.onerror = function () { (im.decode ? im.decode() : Promise.resolve()).then(res, res); }; im.src = IMG[k]; });
    });
    return Promise.all(fonts.concat(pics)).then(function () { return document.fonts.ready; });
  }

  ready().then(function () {
    slide('x5', buildX5);
    slide('filter', buildFilter);
    slide('taxi', buildTaxi);
    slide('token', buildToken);
    slide('section', buildSection);
    slide('delegate', buildDelegate);
    slide('bits', buildBits);
    fit();
    slides.forEach(function (s) { s.tl.seek(0); });
    window.__deck = { slides: slides, go: go, get cur() { return cur; } };

    const only = Q.has('slide') ? Math.max(0, Math.min(slides.length - 1, +Q.get('slide') - 1)) : null;
    const boot = document.getElementById('boot');
    if (RENDER) {
      const s = slides[only || 0];
      show(s); cur = slides.indexOf(s);
      boot.style.display = 'none'; hud.style.display = 'none';
      M.mount(s.tl, { controls: false, autoplay: false });
      return;
    }
    if (only != null && Q.has('t')) {
      const s = slides[only], tv = Q.get('t');
      show(s); cur = only;
      s.tl.seek(tv === 'end' ? s.tl.duration : +tv);
      boot.style.display = 'none';
      return;
    }
    bindKeys();
    document.body.classList.add('idle');
    const h = parseInt((location.hash || '').slice(1), 10);
    go(only != null ? only : (h >= 1 && h <= slides.length ? h - 1 : 0), 'intro');
    boot.classList.add('gone');
  });
})();
