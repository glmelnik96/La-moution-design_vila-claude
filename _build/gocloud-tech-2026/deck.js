// GoCloud Tech 2026 — animated deck runtime + eight slides (Figma wPZx91jtPPRJ7tCdOSEqI2, section «Лобоцкий OUT2»).
//
// Every slide is rebuilt from its Figma frame in frame units (2304 x 1280) and owns a seekable Motion timeline
// (lib/motion.js): the build plays when the slide opens, the timeline's last frame is the Figma frame. A slide can
// also carry a second timeline that continues from the slide before it (ВМЕСТЕ → ×5 share the grid: only the words
// leave). The filter slide keeps its output bits moving once the build is done (an idle loop). Beat sheet: BEATS.md.
//
//   → Space PgDn Enter click   next slide        ← PgUp Backspace   previous (rest frame)
//   R  replay   F  fullscreen   B / .  black screen   Home End   1–8   H  help
//   ?order=vmeste,x5,…          which slides (default: all eight, Figma order)
//   ?render&slide=N[&fresh][&idle=S][&outidle=S]   one slide for html/render/render.js (window.__motion), entered
//                               from slide N − 1 (idle: seconds of idle loop after the build; outidle: of the slide left)
//   ?slide=N&t=T|end            one slide frozen at T seconds
(function () {
  'use strict';
  const W = 2304, H = 1280;
  const M = window.Motion;
  const Q = new URLSearchParams(location.search);
  const RENDER = Q.has('render') || !!window.__RENDER__;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const IMG = window.DECK_IMG || {
    taxi_car: 'img/taxi_car.webp', taxi_rim: 'img/taxi_rim.webp', cube: 'img/cube.webp', dash: 'img/dash.webp',
    servers: 'img/servers.webp', bull: 'img/bull.webp'
  };
  const ALL = ['vmeste', 'x5', 'filter', 'taxi', 'token', 'section', 'delegate', 'bits'];
  const ORDER = window.DECK_ORDER || (Q.get('order') ? Q.get('order').split(',') : ALL);

  // ───────── eases (brand tokens + helpers) ─────────
  const EZ = {
    enter: [0.16, 1, 0.3, 1], exit: [0.7, 0, 0.84, 0], move: [0.65, 0, 0.35, 1], wipe: [0.87, 0, 0.13, 1],
    count: [0.1, 0.9, 0.2, 1], quint: [0.22, 1, 0.36, 1], push: [0.25, 1, 0.5, 1], ein: [0.5, 0, 0.9, 0.5],
    calm: [0.37, 0, 0.63, 1], lin: [0, 0, 1, 1]
  };
  const F = {};
  for (const k in EZ) F[k] = M.cubicBezier(EZ[k][0], EZ[k][1], EZ[k][2], EZ[k][3]);
  const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const lerp = (a, b, u) => a + (b - a) * u;
  // non-linear stagger: every next gap is k times the previous one — a list accelerates into place
  function nl(i, gap, k) { k = k == null ? 0.82 : k; return k === 1 ? i * gap : gap * (1 - Math.pow(k, i)) / (1 - k); }

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
  // all coordinates are frame coordinates; an element inside a placed one (a card) is positioned relative to it,
  // so the card's clip (its wipe) also clips what is in it
  function place(e, parent, x, y) {
    e._x = x; e._y = y;
    e.style.left = px(x - ((parent && parent._x) || 0)); e.style.top = px(y - ((parent && parent._y) || 0));
  }
  function div(parent, x, y, w, h, css) {
    const e = E('div', parent, 'a', css);
    place(e, parent, x, y);
    if (w != null) e.style.width = px(w);
    if (h != null) e.style.height = px(h);
    return e;
  }
  function box(parent, x, y, w, h, bg) { return div(parent, x, y, w, h, { background: bg }); }
  function svg(parent, x, y, w, h, inner) {
    const e = S('svg', { class: 'a', width: r3(w), height: r3(h), viewBox: '0 0 ' + r3(w) + ' ' + r3(h) }, parent);
    place(e, parent, x, y);
    if (inner) e.innerHTML = inner;
    return e;
  }
  function img(parent, src, x, y, w, h, css) {
    const e = E('img', parent, 'a', Object.assign({ width: px(w), height: px(h) }, css || {}));
    place(e, parent, x, y);
    e.decoding = 'sync'; e.draggable = false; e.alt = '';
    e.src = src;
    return e;
  }

  // Text on its Figma box, one element per Figma line, each in a mask that cuts only below the line box.
  // Blink lays a line out with whole-pixel ascent/descent and floors the half-leading, Figma keeps them exact: the
  // box moves by the difference so the baseline lands on Figma's (Manrope: ascent 1.066, descent 0.3, cap 0.72 em).
  // Gradient fills span the whole node (background sized to the node box). With the current Manrope (the one Figma
  // renders) the file's own letter-spacing lands every glyph; fitW (spread advances to a measured width) is kept for
  // fonts that differ.
  const ASC = 1.066, DSC = 0.3, CAP = 0.72;
  function bfix(size, lh) {
    const A = Math.round(ASC * size), D = Math.round(DSC * size);
    return { fb: lh / 2 + (ASC - DSC) / 2 * size, cb: Math.floor((lh - A - D) / 2) + A };
  }
  function text(parent, o) {
    const n = o.lines.length, lh = o.lh, b = bfix(o.size, lh);
    const shift = o.trim ? CAP * o.size - b.cb : b.fb - b.cb;
    const root = div(parent, o.x, o.y + shift, o.w || null, lh * n);
    root.classList.add('t');
    if (o.op != null) root.style.opacity = o.op;
    const out = o.lines.map(function (s, i) {
      const wrap = E('div', root, 'ln', { top: px(i * lh), height: px(lh), fontSize: px(o.size), width: o.w ? '100%' : 'auto' });
      if (o.mask !== false) wrap.style.clipPath = o.clip || 'inset(-60% -4000px -0.32em -0.4em)';
      const t = E('div', wrap, 'lt t', {
        fontSize: px(o.size), lineHeight: px(lh), fontWeight: String(o.wt || 400),
        letterSpacing: o.fitW ? fitSpacing(s, o) : (o.ls || 0) + 'em', textTransform: o.upper ? 'uppercase' : 'none'
      }, s);
      if (o.grad) {
        t.classList.add('grad');
        t.style.backgroundImage = o.grad;
        t.style.backgroundSize = px(o.gw) + ' ' + px(o.gh);
        t.style.backgroundPosition = '0px ' + px(-shift - i * lh);
        t.style.width = px(o.gw);
      } else t.style.color = o.color || '#fff';
      t._lh = lh; t._size = o.size;
      return t;
    });
    out.root = root;
    return out;
  }
  const below = (t) => t._lh + 0.34 * t._size + 4;          // a line parked under its own mask
  // line reveal: each line rises from under its line box (brand: mask per line, never per letter)
  function reveal(tl, lines, at, o) {
    o = o || {};
    const g = o.stagger != null ? o.stagger : 0.08;
    lines.forEach(function (t, i) {
      tl.fromTo(t, { y: [below(t), 0] }, { at: at + nl(i, g, o.k == null ? 1 : o.k), dur: o.dur || 0.7, ease: o.ease || EZ.enter });
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
  const CLIP = { r: 'clipR', l: 'clipL', d: 'clipB', u: 'clipT' };
  function wipe(tl, el, at, dir, dur, ease) {
    const p = {};
    p[CLIP[dir || 'r']] = [100, 0];
    tl.fromTo(el, p, { at: at, dur: dur || 0.6, ease: ease || EZ.wipe });
  }

  // Figma PATTERN fill "PATTERN core" (node 1:7): a 12 x 12 tile with 1-unit lines on its right and bottom edges,
  // scaled by s, painted at 40 % LINEAR_DODGE of #505050 over the #222 fill → #424242 lines on #222.
  // Tiles start at the node's top-left. Drawn as exact rectangles (an SVG <pattern> drifts at fractional pitch).
  const SF35 = 3.4956507682800293, SF24 = 2.373704195022583;
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
  // (Figma's box excludes the trailing tracking)
  function fitSpacing(s, o) {
    const str = o.upper ? s.toUpperCase() : s;
    const A = advance(str, (o.wt || 400) + ' ' + o.size + 'px Manrope', 0);
    const n = Array.from(str).length;
    return r3((o.fitW - A) / Math.max(1, n - 1)) + 'px';
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ═════════ slides ═════════
  const DEFS = {};
  function def(key, o) { DEFS[key] = Object.assign({ key: key }, o); }

  // ───── 1 · Облачный рынок вместе (3631:558) — the calmest possible entrance: a fade, nothing moves ─────
  const VM = {
    top: { x: 578, y: 271, size: 130, lh: 130, ls: -0.03, wt: 500, upper: true, mask: false, gw: 1147, gh: 130,
      grad: 'linear-gradient(130.4428493885116deg, #fff 24.799%, #999 85.852%)', lines: ['облачный рынок'] },
    big: { x: 116, y: 421, size: 576.88, lh: 576.88, ls: -0.05, wt: 500, upper: true, mask: false, gw: 2110, gh: 577,
      grad: 'linear-gradient(109.45684405422563deg, #fff 24.799%, #999 85.852%)', lines: ['вместе'] }
  };
  def('vmeste', {
    title: 'Облачный рынок вместе', build: function (el, tl) {
      const g = grid(el, 0, -1, W, H, SF35);          // the file's grid sits 1 px higher here than on ×5
      tl.fromTo(g, { opacity: [0, 1] }, { at: 0, dur: 1.4, ease: EZ.calm });
      tl.fromTo(text(el, VM.top).root, { opacity: [0, 1] }, { at: 0.5, dur: 1.6, ease: EZ.calm });
      tl.fromTo(text(el, VM.big).root, { opacity: [0, 1] }, { at: 1.0, dur: 2.2, ease: EZ.calm });
    }
  });

  // ───── 2 · ×5 в год / 35 тысяч лет (3620:4707): compute grows, the brain stays — racks light up with the curve,
  //           the cave-painting bull surfaces on the green card ─────
  def('x5', {
    title: '×5 в год / 35 тысяч лет', carryFrom: 'vmeste', build: function (el, tl, ct) {
      const bg = grid(el, 0, 0, W, H, SF35);

      // dark card: Union fill, the server racks (cut-out), the growth chart masked into the card
      const UNION = 'M1012.08 971H0V460H0.414062V0H1012.5V460H1012.08V971Z';
      const AREA = 'M-0.909729 837.142L-163 956.624V1716H1195V-37L1154.15 120.556L1073.43 263.983L927.156 379.022L835.239 548.65L656.346 656.989L316.352 731.279L261.334 800.616L-0.909729 837.142Z';
      const LINE = 'M-163 956.624L-0.909729 837.142L261.334 800.616L316.352 731.279L656.346 656.989L835.239 548.65L927.156 379.022L1073.43 263.983L1154.15 120.556L1195 -37';
      const card = div(el, 119, 120, 1012.5, 971);
      card.style.transformOrigin = '506px 971px';
      svg(card, 119, 120, 1012.5, 971,
        '<defs><linearGradient id="s1u" x1="555" y1="34" x2="1266.32" y2="1393.24" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#494949"/></linearGradient></defs>' +
        '<path d="' + UNION + '" fill="url(#s1u)"/>');
      const srvDark = img(card, IMG.servers, 119, 437, 976, 654, { filter: 'brightness(0.24)' });
      const srvLit = img(card, IMG.servers, 119, 437, 976, 654);
      const chart = svg(card, 119, 120, 1012.5, 971,
        '<defs>' +
        '<linearGradient id="s1a" x1="271.434" y1="756.949" x2="589.013" y2="1379.65" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#404040"/></linearGradient>' +
        '<linearGradient id="s1s" x1="-163" y1="592.295" x2="1192.03" y2="592.295" gradientUnits="userSpaceOnUse"><stop stop-color="#26D07C"/><stop offset="1" stop-color="#E8FFF4"/></linearGradient>' +
        '<clipPath id="s1c"><path d="' + UNION + '"/></clipPath>' +
        '<linearGradient id="s1mg" x1="-400" y1="0" x2="-300" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' +
        '<mask id="s1m" maskUnits="userSpaceOnUse" x="-400" y="-200" width="2000" height="2400"><rect x="-400" y="-200" width="2000" height="2400" fill="url(#s1mg)"/></mask>' +
        '</defs>' +
        '<g clip-path="url(#s1c)"><g mask="url(#s1m)"><path d="' + AREA + '" fill="url(#s1a)"/></g>' +
        '<path id="s1line" d="' + LINE + '" fill="none" stroke="url(#s1s)" stroke-width="4" stroke-miterlimit="10"/></g>');
      const line = chart.querySelector('#s1line'), feather = chart.querySelector('#s1mg');
      const LEN = line.getTotalLength();
      function lenAtX(x) { let lo = 0, hi = LEN; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (line.getPointAtLength(m).x < x) lo = m; else hi = m; } return lo; }
      const A0 = lenAtX(-2), A1 = lenAtX(1014);
      line.style.strokeDasharray = r3(LEN) + ' ' + r3(LEN + 20);

      // green card (two rects, as in the file), its flat line, the bull screened over it (all clipped by the card)
      const green = div(el, 1151, 120, 1012.5, 971);
      svg(green, 1151, 120, 1012.5, 971, '<rect x="0" y="480" width="1012.08" height="491" fill="#26D07C"/><rect x="0.4140625" y="0" width="1012.08" height="506" fill="#26D07C"/>');
      const flat = svg(green, 1137, 978, 1046, 4,
        '<defs><linearGradient id="s1f" x1="0" y1="0" x2="1043.72" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>' +
        '<line x1="1046" y1="2" x2="0" y2="2" stroke="url(#s1f)" stroke-width="4"/>');
      flat.style.clipPath = 'inset(0 19.92px 0 14px)';
      const fl = flat.querySelector('line');
      // «image 208»: saturation −1, exposure .39 baked (tools/prep_v2.py), screen at 90 %, clipped to the card
      const bull = img(green, IMG.bull, 1196, 276, 967.5, 815, { mixBlendMode: 'screen', opacity: '0.9', transformOrigin: '60% 70%' });

      const t1 = text(el, { x: 203, y: 180, w: 757, size: 44.77366638183594, lh: 53.728397369384766, ls: -0.01, wt: 500, color: '#fff', lines: ['Вычисления для обучения', 'передовых моделей'] });
      const t4 = text(el, { x: 1240, y: 180, w: 757, size: 44.77366638183594, lh: 53.728397369384766, ls: -0.01, wt: 500, color: '#000', lines: ['Мозг человека в нынешней форме'] });

      // ×5: "x" lands, the digit rolls 1 → 5 in step with the curve (detents: hold, then roll)
      const G5 = 'linear-gradient(101.0952887486837deg, #fff 4.8915%, #999 54.018%)';
      const b5 = bfix(420, 462), sh5 = b5.fb - b5.cb;
      const x5 = div(el, 200, 276 + sh5, 995.651, 462); x5.classList.add('t');
      const f5 = { fontSize: '420px', lineHeight: '462px', fontWeight: '400', letterSpacing: '-0.03em' };
      E('div', x5, 'lt t grad', Object.assign({ backgroundImage: G5, backgroundSize: '995.651px 462px', backgroundPosition: '0px ' + px(-sh5), width: '995.651px' }, f5), 'x');
      const xw = advance('x', '400 420px Manrope', -12.6);
      // the roll window hugs the digit (ink y 364–673 on the slide): digits slot in and out below the caption
      const win = div(x5, 200 + xw, 276 + sh5, 560, 462, { clipPath: 'inset(64px -10% 38px -10%)' });
      const col = div(win, 200 + xw, 276 + sh5, 560, 462 * 5);
      const digits = [1, 2, 3, 4, 5].map(function (d, i) {
        return E('div', col, 'a t grad', Object.assign({ top: px(i * 462), width: '560px', backgroundImage: G5, backgroundSize: '995.651px 462px' }, f5), String(d));
      });
      x5.style.transformOrigin = '200px 380px';
      const vgod = text(el, { x: 692.5078125, y: 343.46484375, w: 313.277, size: 54, lh: 59.4, ls: -0.02, wt: 600, grad: 'linear-gradient(115.7886423338069deg, #fff 4.8915%, #999 54.018%)', gw: 313.277, gh: 59, lines: ['в год'] });
      const n35 = text(el, { x: 1216, y: 276, w: 552.307, size: 420, lh: 462, ls: -0.05, wt: 400, mask: false, grad: 'linear-gradient(76.44932869913853deg, #222 13.215%, #494949 84.796%)', gw: 552.307, gh: 462, lines: ['35'] });
      n35.root.style.transformOrigin = '200px 380px';
      const tys = text(el, { x: 1708.5078125, y: 343.46484375, w: 313.277, size: 54, lh: 59.4, ls: -0.02, wt: 600, grad: 'linear-gradient(61.842424155793594deg, #222 13.215%, #494949 84.796%)', gw: 313.277, gh: 118, lines: ['тысяч', 'лет'] });
      // (the reworked file dropped the source line inside the green card — the bull is there now)
      const src2 = text(el, { x: 1709, y: 1189, size: 24, lh: 24, wt: 400, color: '#c8c8c8', op: 0.8, mask: false, lines: ['Источник: Epoch AI · Max Planck Institute'] });
      // the words of slide 1, for the carry-over (they fade where they stood; the grid stays)
      const ghost = [text(el, VM.top).root, text(el, VM.big).root];

      function anim(T, t0, opening) {
        if (opening) T.fromTo(bg, { sw: [0, 112] }, { at: 0, dur: 1.0, ease: EZ.move, set: sweep('r') });
        premium(T, card, t0 + 0.12, { dur: 0.85 });
        // racks: dim first, then the lamps come on behind the pen
        T.fromTo(srvDark, { opacity: [0, 1] }, { at: t0 + 0.35, dur: 0.9, ease: EZ.enter });
        T.fromTo(line, { draw: [0, 1] }, {
          at: t0 + 0.85, dur: 1.6, ease: EZ.move, set: function (e, st) {
            const len = st.draw >= 1 ? LEN : A0 + (A1 - A0) * st.draw;
            e.style.strokeDashoffset = r3(LEN - len);
            const x = st.draw >= 1 ? 4000 : e.getPointAtLength(Math.min(len, LEN)).x;
            feather.setAttribute('x1', r3(x - 170)); feather.setAttribute('x2', r3(x + 2));
            const m = st.draw >= 1 ? '' : 'linear-gradient(90deg, #000 ' + r3(x - 260) + 'px, transparent ' + r3(x) + 'px)';
            srvLit.style.webkitMaskImage = srvLit.style.maskImage = m;
          }
        });
        wipe(T, green, t0 + 0.3, 'r', 0.75);
        reveal(T, t1, t0 + 0.55, { stagger: 0.08 });
        reveal(T, t4, t0 + 0.75);
        premium(T, x5, t0 + 0.75, { rise: 60, blur: 6, dur: 0.9 });
        T.fromTo(col, { roll: [0, 1] }, {
          at: t0 + 0.85, dur: 1.6, ease: EZ.move, set: function (e, st) {
            const u = st.roll * 4, k = Math.min(3, Math.floor(u)), f = u - k;
            const r = st.roll >= 1 ? 4 : k + F.quint(c01((f - 0.35) / 0.65));
            const ty = -r * 462;
            e.style.transform = 'translate(0px, ' + r3(ty) + 'px)';
            digits.forEach(function (dg, i) { dg.style.backgroundPosition = px(-xw) + ' ' + px(-(i * 462 + ty) - sh5); });
          }
        });
        reveal(T, vgod, t0 + 2.45, { dur: 0.6 });
        T.fromTo(fl, { fd: [0, 1] }, {
          at: t0 + 0.95, dur: 1.6, ease: EZ.move, set: function (e, st) {
            // the path runs right → left in the file; reveal it left → right
            e.style.strokeDasharray = '1046 1100';
            e.style.strokeDashoffset = r3(-1046 * (1 - st.fd));
          }
        });
        // 35 — heavy, still: it does not count; the bull surfaces behind it like a cave painting
        premium(T, n35.root, t0 + 1.0, { rise: 60, blur: 6, dur: 0.9 });
        reveal(T, tys, t0 + 1.25, { dur: 0.6, stagger: 0.07 });
        T.fromTo(bull, { opacity: [0, 0.9], scale: [1.03, 1], blur: [4, 0] }, { at: t0 + 1.15, dur: 1.9, ease: EZ.move });
        fadeUp(T, src2[0], t0 + 2.6);
      }
      tl.set(ghost, { opacity: 0 }, 0);
      anim(tl, 0, true);
      // from slide 1: the grid is the same, so only its words leave, calmly
      ct.set(ghost, { opacity: 1 }, 0);
      ct.fromTo(ghost, { opacity: [1, 0] }, { at: 0, dur: 0.45, ease: EZ.calm });
      anim(ct, 0.3, false);
    }
  });

  // ───── 3 · Интеллект — фильтр (3620:591), rebuilt as vectors; the output bits keep flowing ─────
  def('filter', {
    title: 'Интеллект — фильтр', build: function (el, tl, ct, s) {
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

      reveal(tl, text(el, { x: 104, y: 86, size: 44, lh: 60, wt: 600, upper: true, color: '#fff', lines: ['Интеллект — фильтр'] }), 0);
      reveal(tl, text(el, { x: 124.39, y: 220, size: 36, lh: 36, wt: 400, color: '#fff', lines: ['входит в мозг'] }), 0.2, { dur: 0.6 });

      // 1 000 000 000 бит/с — odometer: every column spins and lands, the leading one on 1
      const LH = 100.11715698242188;
      const bn = bfix(LH, LH);
      const num = div(el, 116.905, 287.07 + bn.fb - bn.cb, null, LH);
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
      num.appendChild(document.createTextNode(' бит/с'));
      num.style.transformOrigin = '0 50%';
      tl.fromTo(num, { opacity: [0, 1], y: [24, 0] }, { at: 0.3, dur: 0.5, ease: EZ.enter });

      reveal(tl, text(el, { x: 1744, y: 220, size: 38, lh: 38, wt: 400, color: '#fff', lines: ['выходит наружу'] }), 2.75, { dur: 0.6 });
      const ten = text(el, { x: 1730, y: 287, size: 100, lh: 100, ls: -0.01, wt: 700, color: '#fff', mask: false, lines: ['~10 бит/с'] });
      ten.root.style.transformOrigin = '0 70%';
      premium(tl, ten.root, 2.85, { blur: 6, dur: 0.8 });
      fadeUp(tl, text(el, { x: 1708, y: 1189, size: 24, lh: 24, wt: 400, color: 'rgba(200,200,200,0.5)', op: 0.8, mask: false, lines: ['Источник: Zheng & Meister, Neuron, 2024'] })[0], 3.2);

      // After the build the bits keep flowing (review: «может продолжать движение?»): the landed bit sets off again,
      // a new one leaves the funnel every 2.2 s. Each bit opens up at P, speeds up for 0.8 s, then glides off-screen.
      const V = 240, ACC = 0.8, PERIOD = 2.2, FIRST = 1.4, X0 = P[0] - 14;
      const pool = [0, 1, 2, 3].map(function () { return div(el, 0, 749, 28, 28, { background: '#fff', visibility: 'hidden' }); });
      const travel = (age) => (age < ACC ? 0.5 * (V / ACC) * age * age : 0.5 * V * ACC + V * (age - ACC));
      s.idle = function (t) {
        if (t < 0) { pool.forEach(function (b) { b.style.visibility = 'hidden'; }); return; }
        const t0 = t - 0.6;                                      // the landed bit rests 0.6 s, then sets off
        bit.style.transform = t0 > 0 ? 'translate(' + r3(travel(t0)) + 'px, 0px)' : '';
        const n = Math.floor((t - FIRST) / PERIOD);
        pool.forEach(function (b, i) {
          let m = n - ((n - i) % 4 + 4) % 4;                      // the newest spawn this slot owns
          const age = t - FIRST - m * PERIOD;
          const x = X0 + travel(age);
          if (m < 0 || age < 0 || x > W + 20) { b.style.visibility = 'hidden'; return; }
          b.style.visibility = '';
          b.style.transform = 'translate(' + r3(x) + 'px, 0px) scale(' + r3(F.enter(c01(age / 0.3))) + ')';
        });
      };
    }
  });

  // ───── 4 · Такси (3620:549) ─────
  def('taxi', {
    title: 'Такси', build: function (el, tl) {
      const cam = div(el, 0, 0, W, H);
      cam.style.transformOrigin = '1000px 520px';
      tl.fromTo(cam, { scale: [1.06, 1] }, { at: 0, dur: 2.9, ease: EZ.push });
      const back = svg(cam, -31, 77, 2436.5, 817.85,
        '<defs><linearGradient id="s3g" x1="779.454" y1="370.411" x2="827.163" y2="730.165" gradientUnits="userSpaceOnUse"><stop stop-color="#222222"/><stop offset="1" stop-color="#404040"/></linearGradient></defs>' +
        '<path d="M146.5 672.5L33.5 707.5L29.5 709L0 718V0H2384C2432.5 300 2491 882.4 2337 812C2183 741.6 1891.17 720 1764.5 718L1524 586L1384.5 525.5L1305 508V486H1290.5C1285 473.667 1271.1 438.8 1259.5 398C1247.9 357.2 1213.67 342.667 1198 340.5H839.5C825.833 342 795.3 352.3 782.5 381.5C769.7 410.7 756.5 463.333 751.5 486H729.5V513L715 518L494.5 566.5L267 633L146.5 672.5Z" fill="url(#s3g)"/>');
      tl.fromTo(back, { opacity: [0, 1] }, { at: 0, dur: 1.5, ease: EZ.move });

      const car = div(cam, 0, 0, W, H);
      img(car, IMG.taxi_car, 0, 0, W, H);
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
      const rim = img(cam, IMG.taxi_rim, 0, 0, W, H, { mixBlendMode: 'plus-lighter' });
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
  });

  // ───── 5 · GPU-ЧАС → ТОКЕН (3620:553) ─────
  def('token', {
    title: 'GPU-час → токен', build: function (el, tl) {
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
        clip: 'inset(-12% -3% 60px -3%)', grad: 'linear-gradient(106.2418620233488deg, #fff 24.799%, #999 85.852%)', gw: 2132, gh: 707, lines: ['токен'] });
      tl.fromTo(tok[0], { y: [600, 0] }, { at: 1.4, dur: 1.15, ease: EZ.enter });

      // the reworked file shows the unit in capitals and greys it to #888 (was lower case, #434343)
      const gpu = text(el, { x: 113, y: 85, size: 110, lh: 110, ls: -0.02, wt: 500, upper: true, color: '#888888', lines: ['GPU-час'] });
      reveal(tl, gpu, 0.2, { dur: 0.7 });
      tl.fromTo(gpu[0], { dim: [0, 1] }, { at: 0.95, dur: 0.35, ease: EZ.move, set: function (e, st) { e.style.color = mixHex('#e6e6e6', '#888888', st.dim); } });
      // Line 16 is a Figma LINE at y 152: its 9 px stroke covers [y − 9, y] (quirk 190), measured rows 143–151
      const strike = div(el, 102, 143, 500, 9, { background: '#888888', transformOrigin: '0 50%' });
      tl.fromTo(strike, { scaleX: [0, 1] }, { at: 0.95, dur: 0.4, ease: EZ.enter });

      const strip = grid(el, -21, 1112, 2350, 170, SF24);
      tl.fromTo(strip, { sw: [0, 112] }, { at: 0, dur: 0.9, ease: EZ.move, set: sweep('r') });
      fadeUp(tl, text(el, { x: 1708, y: 1189, size: 24, lh: 24, wt: 400, color: '#c8c8c8', op: 0.8, mask: false, lines: ['Источник: Дженсен Хуанг, Yahoo Finance'] })[0], 2.5);
    }
  });

  // ───── 6 · Не считать лишнего (3621:6224): the headline, then what is inside — five techniques, one by one ─────
  def('section', {
    title: 'Не считать лишнего', build: function (el, tl) {
      const cube = div(el, 0, 0, W, H);
      img(cube, IMG.cube, 0, 0, W, H);
      cube.style.transformOrigin = '1148px 620px';
      tl.fromTo(cube, { scale: [1.1, 1], opacity: [0, 1], blur: [6, 0] }, { at: 0, dur: 1.5, ease: EZ.enter });

      const blk = grid(el, 155, 100, 1260, 751, SF24);
      wipe(tl, blk, 0.35, 'r', 0.65);
      const p1 = box(el, 155, 100, 1184, 468, '#fff');
      wipe(tl, p1, 0.55, 'r', 0.6);
      reveal(tl, text(p1, { x: 190.2941207885742, y: 110, w: 1113.412, size: 190, lh: 209, ls: -0.04, wt: 600, upper: true, color: '#000', lines: ['Не считать', 'лишнего'] }), 0.82, { stagger: 0.08, dur: 0.75 });
      const p2 = box(el, 155, 593, 867, 199, '#fff');
      wipe(tl, p2, 0.98, 'r', 0.5);
      reveal(tl, text(p2, { x: 190.2941207885742, y: 610.6470603942871, w: 796.412, size: 64.70588684082031, lh: 64.70588684082031, ls: -0.04, wt: 400, color: '#000', lines: ['Сегодня — как это', 'устроено у нас внутри'] }), 1.18, { stagger: 0.07, dur: 0.6 });

      // the list (Frame 2136141722): white plates, the word rises inside its plate
      const LH = 49.925;
      [[568, 810, 1379.78, 593.99, 47.974, 'Disaggregated serving'],
        [690.99, 648.051, 1371.63, 716.97, 47.974, 'Speculative decoding'],
        [813.97, 717.985, 1375, 840, 48, 'Mixture of experts (MoE)'],
        [936.96, 584.645, 1368.44, 962.74, 48.178, 'Prefix caching'],
        [1059.94, 411.209, 1359.71, 1085.72, 48.178, 'KV-кэш']].forEach(function (r, i) {
        const at = 1.42 + nl(i, 0.14);
        const pl = box(el, 1339, r[0], r[1], 97.985, '#fff');
        wipe(tl, pl, at, 'r', 0.5);
        const t = text(pl, { x: r[2], y: r[3] + (r[4] - LH) / 2, size: LH, lh: LH, wt: 600, color: '#222', lines: [r[5]] });
        tl.fromTo(t[0], { y: [72, 0] }, { at: at + 0.12, dur: 0.6, ease: EZ.enter });
      });
    }
  });

  // ───── 7 · Исполнение можно делегировать (3620:620) ─────
  def('delegate', {
    title: 'Исполнение можно делегировать', build: function (el, tl) {
      const g = grid(el, -21, 580, 2350, 702, SF24);
      tl.fromTo(g, { sw: [0, 112] }, { at: 0.45, dur: 1.0, ease: EZ.move, set: sweep('u') });
      const dash = div(el, 0, 0, W, H);
      svg(dash, -69, 1157, 637, 212, '<ellipse cx="318.5" cy="106" rx="318.5" ry="106" fill="#020202"/>');
      svg(dash, 1760, 1112, 637, 212, '<ellipse cx="318.5" cy="106" rx="318.5" ry="106" fill="#020202"/>');
      img(dash, IMG.dash, 0, 0, W, H);
      tl.fromTo(dash, { y: [170, 0], opacity: [0, 1], bri: [0.3, 1] }, {
        at: 0.7, dur: 1.5, ease: EZ.enter, set: function (e, st) { e.style.filter = st.bri >= 0.999 ? '' : 'brightness(' + r3(st.bri) + ')'; }
      });
      reveal(tl, text(el, { x: 100, y: 190, w: 2080, size: 120, lh: 120, ls: 0, wt: 600,
        grad: 'linear-gradient(128.26078370129457deg, #fff 4.8915%, #999 54.018%)', gw: 2080, gh: 240,
        lines: ['Исполнение можно делегировать.', 'Ответственность — нет'] }), 0.22, { stagger: 0.12, dur: 0.85 });
      reveal(tl, text(el, { x: 104, y: 86, size: 44, lh: 60, wt: 600, upper: true, color: '#fff', lines: ['Человек задает намерение, агент исполняет'] }), 0, { dur: 0.6 });
    }
  });

  // ───── 8 · Выберите свои 10 бит (3620:628) ─────
  // Field of 60 x 32 cells (40 px, #222 fill, 1 px #26D07C centre stroke, "0" in SB Sans Text Mono 15 px —
  // glyph outlines exported from Figma). Fills in a diagonal wave, then the two centre cells light up: 1 0.
  const GLYPH0 = 'M16.8971 20.765C16.8971 16.745 18.1121 15.38 20.6621 15.38C23.1071 15.38 24.0971 16.955 24.0971 20.765C24.0971 24.965 22.8221 26.15 20.4971 26.15C18.0071 26.15 16.8971 24.41 16.8971 20.765ZM18.2171 20.765C18.2171 22.325 18.3971 23.375 18.7721 24.035L21.5921 16.715C21.2921 16.58 20.9321 16.52 20.4971 16.52C18.7871 16.52 18.2171 17.465 18.2171 20.765ZM22.7771 20.81C22.7771 19.19 22.6571 18.155 22.3421 17.495L19.5221 24.8C19.8221 24.95 20.1671 25.01 20.5571 25.01C22.1471 25.01 22.7771 24.155 22.7771 20.81Z';
  const GLYPH1 = 'M17.4971 26V24.8H20.5871V16.97L17.4971 18.815V17.51L20.9471 15.395H21.8471V24.8H23.7671V26H17.4971Z';
  def('bits', {
    title: 'Выберите свои 10 бит', build: function (el, tl, ct, s) {
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

      const plate = box(el, 112, 120, 1600, 200, '#fff');
      wipe(tl, plate, 2.55, 'r', 0.65);
      reveal(tl, text(plate, { x: 137.938, y: 127.348, w: 1548.132, size: 120, lh: 132, ls: -0.04, wt: 600, upper: true, color: '#000', lines: ['Выберите свои 10 бит'] }), 2.85, { dur: 0.75 });
    }
  });

  // ───────── runtime: fit, navigation, transitions ─────────
  const stage = document.getElementById('stage');
  const slides = [];
  let cur = -1, token = 0;
  const hud = document.getElementById('hud');
  const help = document.getElementById('help');
  const blank = document.getElementById('blank');

  function makeSlides() {
    ORDER.forEach(function (key, i) {
      const d = DEFS[key];
      const el = E('section', stage, 'slide');
      el.dataset.key = key;
      const s = { key: key, def: d, el: el, fresh: M.timeline({ fps: 60 }), carry: d.carryFrom ? M.timeline({ fps: 60 }) : null, resize: null, idle: null };
      s.tl = s.fresh;
      d.build(el, s.fresh, s.carry || M.timeline({ fps: 60 }), s);
      slides.push(s);
    });
  }
  // a slide plays its full build (fresh) or the carry-over from its predecessor; the other timeline is parked at
  // its end first, so every element only it drives sits at rest
  function activate(s, useCarry, t) {
    if (useCarry) { s.fresh.seek(s.fresh.duration); s.tl = s.carry; }
    else { if (s.carry) s.carry.seek(s.carry.duration); s.tl = s.fresh; }
    s.tl.seek(t === 'end' ? s.tl.duration : t);
    if (s.idle) s.idle(-1);
    s._idle0 = null;
  }
  const atRest = (s) => !s.tl._playing && s.tl.time >= s.tl.duration - 1e-6;

  function fit() {
    const k = RENDER ? 1 : Math.min(innerWidth / W, innerHeight / H);
    const x = RENDER ? 0 : (innerWidth - W * k) / 2, y = RENDER ? 0 : (innerHeight - H * k) / 2;
    stage.style.transform = 'translate(' + r3(x) + 'px,' + r3(y) + 'px) scale(' + k + ')';
    slides.forEach(function (s) { if (s.resize) s.resize(k); });
  }

  function show(s) { s.el.classList.add('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }
  function hide(s) { s.tl.pause(); s.el.classList.remove('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }

  // the outgoing slide leaves in 0.32 s (opacity + a 2 % push, ease-in); the stage stays #222 underneath.
  // An idle loop that is running (the filter's bits) keeps running until the slide is gone — nothing freezes mid-air
  function leave(s) {
    s.tl.pause();
    const el = s.el, t0 = performance.now(), D = 320;
    const i0 = s.idle && s._idle0 != null ? s._idle0 : null;
    el.style.transformOrigin = '50% 50%';
    const my = s._leaveId;
    function f(now) {
      if (s._leaveId !== my) return;
      if (i0 != null) s.idle((now - i0) / 1000);
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
    const prev = slides[cur], next = slides[i], intro = mode === 'intro';
    const carry = !!(intro && prev && prev !== next && next.carry && next.def.carryFrom === prev.key && atRest(prev));
    if (prev && prev !== next) {
      prev._leaveId = (prev._leaveId || 0) + 1;
      if (intro && !carry) leave(prev); else hide(prev);
    }
    next._leaveId = (next._leaveId || 0) + 1;
    next.tl.pause();
    activate(next, carry, intro ? 0 : 'end');
    show(next);
    cur = i;
    if (intro) {
      const delay = carry || !prev || prev === next ? 0 : 200;
      setTimeout(function () { if (token === my) { next.tl.seek(0); next.tl.play(); } }, delay);
    }
    try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) { /* file:// in some browsers */ }
    hud.textContent = (i + 1) + ' / ' + slides.length;
  }
  const next = function () { if (cur < slides.length - 1) go(cur + 1, 'intro'); };
  const prev = function () { if (cur > 0) go(cur - 1, 'rest'); };

  // idle loops (the filter slide's bits) run while their slide rests
  function idleTick(now) {
    const s = slides[cur];
    if (s && s.idle) {
      if (atRest(s)) { if (s._idle0 == null) s._idle0 = now; s.idle((now - s._idle0) / 1000); }
      else if (s._idle0 != null) { s._idle0 = null; s.idle(-1); }
    }
    requestAnimationFrame(idleTick);
  }

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
      else if (k === 'r' || k === 'R' || k === 'к' || k === 'К') { const s = slides[cur]; s.tl.pause(); s.tl.seek(0); if (s.idle) s.idle(-1); s._idle0 = null; s.tl.play(); }
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

  // one slide as one seekable clip, entered as in the room: from the slide before it in this file (its rest frame
  // leaves in 0.32 s and the build starts 0.2 s after the click, or the carry-over plays at once); idle = seconds of
  // the idle loop appended after the build; outIdle = how long the outgoing slide's idle loop had run when it was
  // left (so clips rendered back to back join without a jump)
  function clip(i, forceFresh, idle, outIdle) {
    const s = slides[i], p = slides[i - 1] || null;
    const useCarry = !!(p && s.carry && s.def.carryFrom === p.key && !forceFresh);
    const out = p && !useCarry ? p : null, lead = out ? 0.2 : 0;
    if (out) { activate(out, false, 'end'); out.el.style.transformOrigin = '50% 50%'; }
    activate(s, useCarry, 0);
    show(s); cur = i;
    const tl = s.tl, build = tl.duration + lead, dur = build + (s.idle ? idle || 0 : 0);
    const seek = function (t) {
      t = Math.max(0, Math.min(dur, t));
      tl.seek(Math.max(0, Math.min(t - lead, tl.duration)));
      if (s.idle) s.idle(t > build ? t - build : -1);
      if (out) {
        const on = t < 0.32, e = F.exit(c01(t / 0.32));
        out.el.classList.toggle('on', on);
        out.el.style.opacity = on ? r3(1 - e) : '';
        out.el.style.transform = on ? 'scale(' + r3(1 + 0.02 * e) + ')' : '';
        if (out.idle && outIdle > 0) out.idle(outIdle + t);
      }
      return t;
    };
    const all = {};
    tl.beatList('all').forEach(function (b) { all[Math.round((b + lead) * 1000)] = b + lead; });
    const beats = [];
    for (let k = 0; k <= 8; k++) beats.push(Math.round(dur * k / 8 * 1000) / 1000);
    return {
      ready: true, fps: 60, duration: dur, frames: Math.round(dur * 60), beats: beats,
      beatsAll: Object.keys(all).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return all[k]; }),
      seek: seek, seekFrame: function (f) { return seek(f / 60); }, play: function () {}, pause: function () {}
    };
  }

  function ready() {
    const fonts = ['400', '500', '600', '700'].map(function (w) { return document.fonts.load(w + ' 40px Manrope', 'Аа0'); });
    const pics = Object.keys(IMG).map(function (k) {
      return new Promise(function (res) { const im = new Image(); im.onload = im.onerror = function () { (im.decode ? im.decode() : Promise.resolve()).then(res, res); }; im.src = IMG[k]; });
    });
    return Promise.all(fonts.concat(pics)).then(function () { return document.fonts.ready; });
  }

  ready().then(function () {
    makeSlides();
    fit();
    slides.forEach(function (s) { if (s.carry) s.carry.seek(s.carry.duration); s.fresh.seek(0); });
    window.__deck = { slides: slides, go: go, get cur() { return cur; } };

    const only = Q.has('slide') ? Math.max(0, Math.min(slides.length - 1, +Q.get('slide') - 1)) : null;
    const boot = document.getElementById('boot');
    if (RENDER || (only != null && Q.has('t'))) {
      const c = clip(only || 0, Q.has('fresh'), +(Q.get('idle') || 0), +(Q.get('outidle') || 0));
      boot.style.display = 'none'; hud.style.display = 'none';
      if (RENDER) { window.__motion = c; c.seek(0); }
      else { const tv = Q.get('t'); c.seek(tv === 'end' ? c.duration : +tv); }
      return;
    }
    bindKeys();
    document.body.classList.add('idle');
    requestAnimationFrame(idleTick);
    const h = parseInt((location.hash || '').slice(1), 10);
    go(only != null ? only : (h >= 1 && h <= slides.length ? h - 1 : 0), 'intro');
    boot.classList.add('gone');
  });
})();
