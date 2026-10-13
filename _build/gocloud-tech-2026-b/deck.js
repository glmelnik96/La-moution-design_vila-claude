// GoCloud Tech 2026 · part B — animated deck runtime + eight slides (Figma wPZx91jtPPRJ7tCdOSEqI2).
//
// Every slide is rebuilt from its Figma frame in frame units (2304 x 1280) and owns a seekable Motion timeline
// (lib/motion.js) whose last frame is the Figma frame. What the frames share stays on screen instead of being
// rebuilt on every click:
//   chrome  the grid, the event logo and the 3D cube live above/below the slides; the grid and the logo build
//           once when the file opens, the cube enters, glides between its three placements and leaves;
//   carry   slides 2 → 3 → 4 keep the headline card, the section tile and the white card; the next slide
//           only swaps the plate's word and the list (3) or splits the card in two (4).
// Beat sheet: BEATS.md. Three files are built from this one script (tools/build_single.py): 1–3, 4–8, 1–8.
//
//   → Space PgDn Enter click   next slide        ← PgUp Backspace   previous (rest frame)
//   R  replay   F  fullscreen   B / .  black screen   Home End   1–8   H  help
//   ?order=s1,s2,s3           which slides (default: all eight)
//   ?render&slide=N[&fresh]   one slide for html/render/render.js (window.__motion), entered from slide N − 1
//   ?slide=N&t=T|end          one slide frozen at T seconds
(function () {
  'use strict';
  const W = 2304, H = 1280;
  const M = window.Motion;
  const Q = new URLSearchParams(location.search);
  const RENDER = Q.has('render') || !!window.__RENDER__;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const IMG = window.DECK_IMG || { cube: 'img/cube.webp', photo: 'img/photo.webp' };
  const ALL = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const ORDER = window.DECK_ORDER || (Q.get('order') ? Q.get('order').split(',') : ALL);

  // ───────── eases (brand tokens + helpers) ─────────
  const EZ = {
    enter: [0.16, 1, 0.3, 1], exit: [0.7, 0, 0.84, 0], move: [0.65, 0, 0.35, 1], wipe: [0.87, 0, 0.13, 1],
    count: [0.1, 0.9, 0.2, 1], quint: [0.22, 1, 0.36, 1], lin: [0, 0, 1, 1]
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
  // so the card's own clip (its wipe) also clips everything in it — text can never show outside its card
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
  function svg(parent, x, y, w, h, inner, vb) {
    const e = S('svg', { class: 'a', width: r3(w), height: r3(h), viewBox: vb || '0 0 ' + r3(w) + ' ' + r3(h) }, parent);
    place(e, parent, x, y);
    if (inner) e.innerHTML = inner;
    return e;
  }
  function img(parent, src, x, y, w, h) {
    const e = E('img', parent, 'a', { width: px(w), height: px(h) });
    place(e, parent, x, y);
    e.decoding = 'sync'; e.draggable = false; e.alt = '';
    e.src = src;
    return e;
  }

  // Text on its Figma box, one element per Figma line, each in a mask that cuts only below the line box.
  // Line heights are Figma's (rounded to whole px, as Figma lays them out). trim: the node uses CAP_HEIGHT
  // leading trim, so its top is the cap top of the first line (Manrope: ascent 1.066, content 1.366, cap 0.72 em).
  // A line given as an array is split into inline segments that can move on their own.
  // Blink lays a line out with whole-pixel ascent/descent and floors the half-leading, Figma keeps them exact: the box is
  // moved by the difference, so the baseline lands where Figma's is (±1 px otherwise, e.g. 37/47, 80/96, 38/46 trimmed).
  const ASC = 1.066, DSC = 0.3, CAP = 0.72;
  function bfix(size, lh) {
    const A = Math.round(ASC * size), D = Math.round(DSC * size);
    return { fb: lh / 2 + (ASC - DSC) / 2 * size, cb: Math.floor((lh - A - D) / 2) + A };
  }
  function text(parent, o) {
    const n = o.lines.length, lh = o.lh, b = bfix(o.size, lh);
    const top = o.trim ? o.y + CAP * o.size - b.cb : o.y + b.fb - b.cb;
    const root = div(parent, o.x, top, o.w || null, lh * n);
    root.classList.add('t');
    const out = o.lines.map(function (s, i) {
      const wrap = E('div', root, 'ln', { top: px(i * lh), height: px(lh), fontSize: px(o.size), width: o.w ? '100%' : 'auto' });
      if (o.mask !== false) wrap.style.clipPath = 'inset(-60% -4000px -0.32em -0.4em)';
      const t = E('div', wrap, 'lt t', {
        fontSize: px(o.size), lineHeight: px(lh), fontWeight: String(o.wt || 600), letterSpacing: (o.ls || 0) + 'em', color: o.color || '#222'
      });
      if (Array.isArray(s)) t._segs = s.map(function (g) { return E('span', t, 'seg', null, g); });
      else t.textContent = s;
      t._lh = lh; t._size = o.size; t._wrap = wrap;
      return t;
    });
    out.root = root;
    return out;
  }
  const below = (t) => t._lh + 0.34 * t._size + 4;          // a line parked under its own mask
  // line reveal: each line rises from under its line box (brand: a mask per line, never per letter)
  function reveal(tl, lines, at, o) {
    o = o || {};
    const g = o.stagger != null ? o.stagger : 0.08;
    lines.forEach(function (t, i) {
      tl.fromTo(t, { y: [below(t), 0] }, { at: at + nl(i, g, o.k), dur: o.dur || 0.7, ease: o.ease || EZ.enter });
    });
  }
  // lines sink back under their masks (the reverse of a reveal: shorter, ease-in)
  function sink(tl, lines, at, o) {
    o = o || {};
    lines.forEach(function (t, i) {
      tl.fromTo(t, { y: [0, below(t)] }, { at: at + i * (o.stagger || 0.025), dur: o.dur || 0.32, ease: EZ.exit });
    });
  }
  // block wipe: r = left→right, l = right→left, d = top→bottom, u = bottom→top (in place: never crosses a neighbour)
  const CLIP = { r: 'clipR', l: 'clipL', d: 'clipB', u: 'clipT' };
  function wipe(tl, el, at, dir, dur, ease) {
    const p = {};
    p[CLIP[dir || 'r']] = [100, 0];
    tl.fromTo(el, p, { at: at, dur: dur || 0.6, ease: ease || EZ.wipe });
  }
  function shown(tl, els, v) { tl.set(els, { opacity: v }, 0); }

  // a plate with its word: the plate clips the word, so the word can rise into it or leave it
  function chip(parent, x, y, w, h, bg, t) {
    const b = box(parent, x, y, w, h, bg);
    b.classList.add('chip');
    const tt = text(b, Object.assign({ mask: false }, t));
    return { b: b, t: tt, h: h };
  }
  function chipIn(tl, c, at, o) {
    o = o || {};
    wipe(tl, c.b, at, o.dir || 'r', o.dur || 0.5);
    c.t.forEach(function (ln, i) {
      tl.fromTo(ln, { y: [c.h * 0.8 + 6, 0] }, { at: at + (o.lag != null ? o.lag : 0.12) + i * 0.05, dur: o.rise || 0.62, ease: EZ.enter });
    });
  }

  // Figma unordered list (28 px, line 42 px): the bullet hangs at +11, the text starts at +42.25 (measured on the renders)
  const BUL = { lh: 42, size: 28, bx: 11, tx: 42.25 };
  function blist(parent, x, y, items, color) {
    const bf = bfix(BUL.size, BUL.lh);
    return items.map(function (s, i) {
      const wrap = div(parent, x, y + bf.fb - bf.cb + i * BUL.lh, null, BUL.lh, { clipPath: 'inset(-60% -4000px -0.32em -0.4em)', fontSize: px(BUL.size) });
      const inner = E('div', wrap, 'lt t', { fontSize: px(BUL.size), lineHeight: px(BUL.lh), fontWeight: '600', color: color });
      const b = E('span', inner, 'a', { left: px(BUL.bx), transformOrigin: '9.6px 23.5px' }, '•');
      const t = E('span', inner, 'a', { left: px(BUL.tx) }, s);
      return { wrap: wrap, inner: inner, b: b, t: t };
    });
  }
  function blistIn(tl, L, at, gap) {
    L.forEach(function (r, i) {
      const a = at + nl(i, gap || 0.085);
      tl.fromTo(r.b, { scale: [0, 1] }, { at: a, dur: 0.42, ease: EZ.enter });
      tl.fromTo(r.t, { y: [56, 0] }, { at: a + 0.05, dur: 0.66, ease: EZ.enter });
    });
  }
  function blistOut(tl, L, at) {
    L.forEach(function (r, i) { tl.fromTo(r.inner, { y: [0, 56] }, { at: at + i * 0.025, dur: 0.3, ease: EZ.exit }); });
  }

  // Figma PATTERN fill "PATTERN core" (node 1:7): a 12 x 12 tile with 1-unit lines on its right and bottom edges,
  // scaled by s, painted at 40 % LINEAR_DODGE of #505050 → #424242 lines on #222 (white on #e3e3e3). Tiles start
  // at the node's top-left; drawn as exact rectangles.
  function grid(parent, x, y, w, h, s, base, line) {
    const P = 12 * s;
    let d = '';
    for (let k = 1; k * P - s < w; k++) d += 'M' + r3(k * P - s) + ' 0h' + r3(s) + 'v' + r3(h) + 'h' + r3(-s) + 'z';
    for (let k = 1; k * P - s < h; k++) d += 'M0 ' + r3(k * P - s) + 'h' + r3(w) + 'v' + r3(s) + 'h' + r3(-w) + 'z';
    return svg(parent, x, y, w, h, (base ? '<rect width="' + r3(w) + '" height="' + r3(h) + '" fill="' + base + '"/>' : '') +
      '<path d="' + d + '" fill="' + line + '"/>');
  }
  // a soft-edged sweep (CSS mask), left → right; prop sw: 0 → 112
  function sweep(el, st) {
    const p = st.sw;
    if (p >= 112) { el.style.webkitMaskImage = el.style.maskImage = ''; return; }
    const g = 'linear-gradient(90deg, #000 ' + r3(p - 12) + '%, transparent ' + r3(p) + '%)';
    el.style.webkitMaskImage = el.style.maskImage = g;
  }

  // QR code from its module matrix (lib/qr.js): one evenodd path, rebuilt from the build progress q (0 → 1):
  // the three finder eyes grow first, then the data modules in a diagonal wave from the top-left corner.
  // At q = 1 the path is the exact code (eyes with the file's 1.05-module ring).
  function qrcode(parent, key, ox, oy, mx, my) {
    const D = window.DECK_QR[key], n = D.n, q0 = D.quiet, Z = D.size, ring = D.eye;
    const el = S('svg', { class: 'a', width: r3(Z * mx), height: r3(Z * my), viewBox: '0 0 ' + Z + ' ' + Z, preserveAspectRatio: 'none' }, parent);
    place(el, parent, ox, oy);
    const path = S('path', { fill: '#000', 'fill-rule': 'evenodd' }, el);
    const EYES = [[0, 0], [n - 7, 0], [0, n - 7]];
    const inEye = (c, r) => EYES.some((e) => c >= e[0] && c < e[0] + 7 && r >= e[1] && r < e[1] + 7);
    const rnd = mulberry(n * 131 + key.charCodeAt(0));
    const mods = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (D.rows[r][c] !== '1' || inEye(c, r)) continue;
      mods.push([c + q0, r + q0, 0.16 + 0.5 * (c + r) / (2 * (n - 1)) + (rnd() - 0.5) * 0.06]);
    }
    const sq = (cx, cy, h) => 'M' + r3(cx - h) + ' ' + r3(cy - h) + 'h' + r3(2 * h) + 'v' + r3(2 * h) + 'h' + r3(-2 * h) + 'z';
    let last = -1;
    function draw(q) {
      if (q === last) return;
      last = q;
      let d = '';
      EYES.forEach(function (e, i) {
        const s = F.enter(c01((q - i * 0.05) / 0.32));
        if (s <= 0) return;
        const cx = e[0] + q0 + 3.5, cy = e[1] + q0 + 3.5;
        d += sq(cx, cy, 3.5 * s) + sq(cx, cy, (3.5 - ring) * s) + sq(cx, cy, 1.5 * s);
      });
      for (let i = 0; i < mods.length; i++) {
        const m = mods[i], s = F.enter(c01((q - m[2]) / 0.3));
        if (s > 0.002) d += sq(m[0] + 0.5, m[1] + 0.5, s / 2);
      }
      path.setAttribute('d', d);
    }
    draw(1);
    return { el: el, path: path, draw: draw };
  }
  function qrIn(tl, qr, at, dur) {
    tl.fromTo(qr.path, { qq: [0, 1] }, { at: at, dur: dur || 1, ease: EZ.lin, set: function (e, st) { qr.draw(st.qq); } });
  }

  // odometer: digit columns roll and land, left to right (the non-digits stand still)
  function odo(parent, x, y, str, o) {
    const bf = bfix(o.size, o.lh);
    const root = div(parent, x, y + bf.fb - bf.cb, null, o.lh);
    root.classList.add('t');
    Object.assign(root.style, { fontSize: px(o.size), lineHeight: px(o.lh), fontWeight: '600', color: o.color });
    root._cols = [];
    let j = 0;
    for (const ch of str) {
      if (!/[0-9]/.test(ch)) { root.appendChild(document.createTextNode(ch)); continue; }
      const od = E('span', root, 'od');
      E('span', od, 'of', null, ch);
      const n = 3 + (j * 3) % 5, fin = +ch, seq = [];
      for (let k = 0; k < n; k++) seq.push(((fin - (n - 1 - k)) % 10 + 10) % 10);
      const oc = E('span', od, 'oc', { lineHeight: px(o.lh) }, seq.join('\n'));
      oc._n = n; oc._lh = o.lh;
      root._cols.push(oc);
      j++;
    }
    return root;
  }
  function odoIn(tl, root, at) {
    root._cols.forEach(function (oc, j) {
      tl.fromTo(oc, { k: [0, oc._n - 1] }, {
        at: at + j * 0.04, dur: 0.7 + 0.05 * j, ease: EZ.count,
        set: function (e, st) { e.style.transform = 'translate(0px,' + r3(-st.k * e._lh) + 'px)'; }
      });
    });
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ═════════ chrome: grid · cube · (slides) · logo ═════════
  const stage = document.getElementById('stage');
  const gridL = E('div', stage, 'layer'), cubeL = E('div', stage, 'layer');
  const slidesL = E('div', stage, 'layer'), logoL = E('div', stage, 'layer');
  const gridEl = grid(gridL, 0, 0, W, H, 6, null, '#424242');

  // The cube: one raw render (2294 x 2253) placed three times in the file. img/cube.webp is that render with
  // Figma's filters baked in (tools/prep_assets.py), rows 81..1907 only. Placements from the image fills:
  const CUBE = { w: 2294, h: 2253, y0: 81, rows: 1826 };
  function fillPlace(nx, ny, nw, nh) {
    const k = Math.max(nw / CUBE.w, nh / CUBE.h);
    return { X: nx + (nw - CUBE.w * k) / 2, Y: ny + (nh - CUBE.h * k) / 2 + CUBE.y0 * k, KX: k, KY: k };
  }
  function cropPlace(nx, ny, nw, nh, a, tx, d, ty) {     // CROP: node (u, v) shows image (a u + tx, d v + ty)
    const KX = nw / (a * CUBE.w), KY = nh / (d * CUBE.h);
    return { X: nx - tx / a * nw, Y: ny - ty / d * nh + CUBE.y0 * KY, KX: KX, KY: KY };
  }
  const PLACE = {
    P1: fillPlace(807, -113, 2453, 2409),                                     // slides 2–4 (3513:463)
    P2: cropPlace(-151, -632, 2607, 2561, 1.361, -0.1803, 1.3608, -0.1803),  // slides 5–6 (3472:543)
    P3: cropPlace(360, -289, 2675, 2540, 1.0344, -0.0172, 1, 0)               // slide 8 (3480:21442)
  };
  const cubeImg = img(cubeL, IMG.cube, 0, 0, CUBE.w, CUBE.rows);
  cubeImg.style.transformOrigin = '0 0';
  const HIDDEN = Object.assign({ s: 1, o: 0, b: 0 }, PLACE.P1);
  let cubeS = HIDDEN;
  function cubeApply(c) {
    const cx = 1350, cy = 640;                      // the entrance scales about this frame point
    const X = cx + (c.X - cx) * c.s, Y = cy + (c.Y - cy) * c.s;
    cubeImg.style.transform = 'translate(' + r3(X) + 'px,' + r3(Y) + 'px) scale(' + (c.KX * c.s).toFixed(6) + ',' + (c.KY * c.s).toFixed(6) + ')';
    cubeImg.style.opacity = r3(c01(c.o));
    cubeImg.style.filter = c.b > 0.05 ? 'blur(' + r3(c.b) + 'px)' : '';
    cubeImg.style.visibility = c.o <= 0.002 ? 'hidden' : '';
    cubeS = c;
  }
  cubeApply(HIDDEN);
  function cubeTw(tl, A, B, at, dur, ease, fade) {
    tl.fromTo(cubeImg, { cu: [0, 1] }, {
      at: at, dur: dur, ease: ease, set: function (e, st) {
        const u = st.cu, o = {};
        for (const k in B) o[k] = lerp(A[k], B[k], u);
        if (fade) o.o = lerp(A.o, B.o, fade(u));
        cubeApply(o);
      }
    });
  }
  const cubeRest = (d) => (d && d.cube ? Object.assign({ s: 1, o: 1, b: 0 }, PLACE[d.cube]) : null);
  const same = (a, b) => ['X', 'Y', 'KX', 'KY', 's', 'o', 'b'].every((k) => Math.abs(a[k] - b[k]) < 1e-3);

  // the event logo, built letter by letter (Figma "Logo FINAL" at 102, 103)
  const LOGO = (function () {
    const L = window.DECK_LOGO;
    const root = div(logoL, 102, 103, 438.675, 359.938);
    const BB = {   // group boxes in logo units (measured with getBBox), + 1 px for antialiasing
      plate: [0, 0, 438.675, 359.938], G: [11.25, 11.33, 207.05, 206.76], O: [231.59, 11.25, 427.43, 206.8],
      C: [11.25, 218.05, 92.8, 287.05], L: [100.18, 221.51, 165.49, 284.46], O2: [166.77, 218.05, 248.65, 287.05],
      U: [254.75, 221.38, 336.64, 287.3], D: [345.17, 221.43, 427.43, 284.34], mark: [13.29, 319.12, 38.65, 346.12],
      word: [46.71, 317.54, 165.49, 341.49], t: [221.03, 298.82, 261.18, 347.15], e: [265.52, 309.29, 317.51, 347.15],
      c: [322.87, 309.29, 369.84, 347.15], h: [377.37, 293.08, 426.42, 346.15]
    };
    let tech = null;   // «tech» rises from under a cut at y 348.15 (created after the plate, so it sits above it)
    const P = {};
    for (const g in L.groups) {
      const b = BB[g], p = g === 'plate' ? 0 : 1;
      const x = b[0] - p, y = b[1] - p, w = b[2] - b[0] + 2 * p, h = b[3] - b[1] + 2 * p;
      const isTech = g.length === 1 && 'tech'.indexOf(g) >= 0;
      if (isTech && !tech) tech = div(root, 102, 103, 438.675, 359.938, { clipPath: 'inset(-30px -30px 11.8px -30px)' });
      const host = isTech ? tech : root;
      const s = svg(host, 102 + x, 103 + y, w, h, '', r3(x) + ' ' + r3(y) + ' ' + r3(w) + ' ' + r3(h));
      L.groups[g].forEach(function (i) { const q = L.paths[i]; S('path', { d: q.d, fill: q.fill, 'fill-rule': q.rule }, s); });
      P[g] = s;
    }
    P.mark.style.transformOrigin = '50% 50%';
    return P;
  })();
  function logoIn(tl, at) {
    tl.fromTo(LOGO.plate, { opacity: [0, 1] }, { at: at, dur: 0.4, ease: EZ.enter });
    wipe(tl, LOGO.G, at + 0.1, 'u', 0.6);
    wipe(tl, LOGO.O, at + 0.2, 'u', 0.6);
    ['C', 'L', 'O2', 'U', 'D'].forEach(function (g, i) { wipe(tl, LOGO[g], at + 0.42 + nl(i, 0.07), 'u', 0.5); });
    ['t', 'e', 'c', 'h'].forEach(function (g, i) { tl.fromTo(LOGO[g], { y: [64, 0] }, { at: at + 0.66 + nl(i, 0.06), dur: 0.62, ease: EZ.enter }); });
    tl.fromTo(LOGO.mark, { scale: [0, 1] }, { at: at + 0.72, dur: 0.5, ease: EZ.enter });
    tl.fromTo(LOGO.word, { opacity: [0, 1], x: [-14, 0] }, { at: at + 0.8, dur: 0.55, ease: EZ.enter });
  }

  // the chrome's part of a slide change, added to tl: opening = the file starts here (grid + logo build);
  // A = where the cube is now (null → the rest state of fromDef)
  function chromeTo(tl, fromDef, toDef, A, opening) {
    if (opening) {
      tl.fromTo(gridEl, { sw: [0, 112] }, { at: 0, dur: 1.15, ease: EZ.move, set: sweep });
      logoIn(tl, 0.05);
    }
    const B = cubeRest(toDef);
    let A0 = A || cubeRest(fromDef);
    if (A0 && A0.o < 0.01) A0 = null;
    // enters once the outgoing slide is gone (0.32 s), fading in slower than it sharpens
    if (B && !A0) cubeTw(tl, Object.assign({}, B, { s: 1.08, o: 0, b: 12 }), B, opening ? 0 : 0.3, 1.6, EZ.enter, (u) => u * u);
    else if (B && A0) cubeTw(tl, A0, B, 0, same(A0, B) ? 0.001 : 1.4, EZ.move);
    else if (A0) cubeTw(tl, A0, Object.assign({}, A0, { o: 0, s: A0.s * 1.03 }), 0, 0.5, EZ.exit);
    else cubeTw(tl, HIDDEN, HIDDEN, 0, 0.001, EZ.lin);
  }

  // ═════════ slides ═════════
  // Every text, plate, list and code is created inside its card (frame coordinates, placed relative to the card):
  // the card's wipe clips its content, so nothing ever shows over the background or a neighbour while it builds.
  const DEFS = {};
  function def(key, o) { DEFS[key] = Object.assign({ key: key }, o); }

  // ───── 1 · Самое важное на сегодня (3472:350): the headline, the day's three notes, then the two floors ─────
  // (the build ends on the 1st floor's technozones — slides 2–4 open them one by one)
  def('s1', {
    title: 'Самое важное на сегодня', cube: null, build: function (el, tl) {
      const tc = box(el, 105, 637, 955, 475, '#fff');
      wipe(tl, tc, 0.1, 'r', 0.65);
      reveal(tl, text(tc, { x: 125, y: 742, w: 915, size: 120, lh: 120, ls: -0.02, lines: ['САМОЕ', 'ВАЖНОЕ', 'НА СЕГОДНЯ'] }), 0.32, { stagger: 0.09, dur: 0.8 });
      [[101, 144, ['Небольшие перерывы', 'после каждого доклада']],
        [265, 144, ['Время обеда указано', 'на бейджах']],
        [429, 191, ['После 18:30: afterparty,', 'нетворкинг, фуршет,', 'лаунж-зона']]].forEach(function (n, i) {
        const at = 0.5 + nl(i, 0.13), b = box(el, 560, n[0], 500, n[1], '#434343');
        wipe(tl, b, at, 'd', 0.5);
        reveal(tl, text(b, { x: 590, y: n[0] + 25, w: 440, size: 37, lh: 47, color: '#fff', lines: n[2] }), at + 0.16, { stagger: 0.06, dur: 0.6 });
      });
      floor(el, tl, 0.92, {
        y: 100, h: 521, label: '2 этаж', tracks: [[294, 587, 'ДАННЫЕ И ML']], side: 'Активности', sx: 1727,
        chips: [[294, 175, ['Воркшопы']], [350, 322, ['Лаборатория карьеры']], [406, 327, ['Лаборатория решений']],
          [462, 286, ['Зона выдачи мерча']], [518, 429, ['Инсталляция', '«Дверь инженерных решений»'], 67]]
      });
      floor(el, tl, 1.42, {
        y: 637, h: 475, label: '1 этаж', tracks: [[831, 774, 'ИНФРАСТРУКТУРА'], [927, 556, 'РАЗРАБОТКА']], side: 'Технозоны', sx: 1914,
        chips: [[831, 254, ['Инфраструктура']], [887, 191, ['Разработка']], [943, 199, ['ИИ-сервисы']], [999, 145, ['Данные']]]
      });
    }
  });
  function floor(el, tl, at, f) {
    const c = box(el, 1080, f.y, 1140, f.h, '#fff');
    wipe(tl, c, at, 'r', 0.65);
    reveal(tl, text(c, { x: 1120, y: f.y + 36, size: 70, lh: 70, lines: [f.label] }), at + 0.18, { dur: 0.7 });
    reveal(tl, text(c, { x: 1120, y: f.y + 146, size: 28, lh: 28, lines: ['Треки'] }), at + 0.3, { dur: 0.55 });
    f.tracks.forEach(function (k, i) {
      chipIn(tl, chip(c, 1120, k[0], k[1], 82, '#26d07c', { x: 1144, y: k[0] + 12, size: 80, lh: 80, trim: true, lines: [k[2]] }), at + 0.36 + nl(i, 0.11), { dur: 0.52 });
    });
    reveal(tl, text(c, { x: f.sx, y: f.y + 146, size: 28, lh: 28, lines: [f.side] }), at + 0.44, { dur: 0.55 });
    f.chips.forEach(function (k, i) {
      chipIn(tl, chip(c, f.sx, k[0], k[1], k[3] || 42, '#e3e3e3', { x: f.sx + 24, y: k[0] + 12, size: 25, lh: 25, trim: true, lines: k[2] }),
        at + 0.52 + nl(i, 0.08), { dur: 0.4, lag: 0.08, rise: 0.5 });
    });
  }

  // ───── 2–4 · Технозоны и лаборатория решений: one headline, the zones one after another ─────
  const ZH = ['ОБЩАЙТЕСЬ С ИНЖЕНЕРАМИ,', 'ИЗУЧАЙТЕ ТЕХНОЛОГИИ И ПОЛУЧАЙТЕ', 'БИЛЕТ В ЛАБОРАТОРИЮ РЕШЕНИЙ'];
  const LIST = {
    infraL: ['Хранение данных', 'Выделенные физические серверы', 'Виртуальные рабочие места', 'Безопасность в облаке'],
    infraR: ['Вычисления и миграция', 'Инфраструктура как код', 'Облачные сети', 'Кубер'],
    devL: ['Управление базами данных', 'Хранение и безопасность артефактов', 'Создание и управление API-шлюзами'],
    // the file has «ранение кода…» (the Х is lost) — fixed
    devR: ['ИИ-развертывание приложений', 'Хранение кода, моделей и датасетов', 'Запуск контейнерных приложений в облаке'],
    // the file's last item lost its bullet — given back
    dataL: ['Потоковая обработка данных', 'Обработка и анализ больших данных', 'Хранилище для аналитики (DWH)', 'Оркестрация и визуализация данных'],
    aiL: ['Эксперименты с машинным обучением', 'Дообучение LLM-моделей', 'Управляемые RAG-системы', 'Создание ИИ-агентов',
      'ИИ-модели, доступные по API', 'Запуск и развертывание моделей']
  };
  function zoneFrame(el, tl) {
    const tile = box(el, 105, 623, 550, 488, '#c3eed8');
    const head = box(el, 586, 103, 1613, 500, '#fff');
    wipe(tl, head, 0.1, 'r', 0.7);
    reveal(tl, text(head, { x: 616, y: 285, w: 1553, size: 80, lh: 96, lines: ZH }), 0.34, { stagger: 0.09, dur: 0.8 });
    wipe(tl, tile, 0.55, 'u', 0.6);
    reveal(tl, text(tile, { x: 135, y: 901, w: 490, size: 60, lh: 60, lines: ['ТЕХНОЗОНЫ', 'И ЛАБОРАТОРИЯ', 'РЕШЕНИЙ'] }), 0.8, { stagger: 0.07, dur: 0.7 });
  }
  const zchip = (card, x, w, word) => chip(card, x, 653, w, 110, '#26d07c', { x: x + 20, y: 663, size: 90, lh: 90, lines: [word] });
  const ghostWord = (c, word) => text(c.b, { x: c.b._x + 20, y: 663, size: 90, lh: 90, mask: false, lines: [word] });
  const wraps = (L) => L.map((r) => r.wrap);

  def('s2', {
    title: 'Инфраструктура', cube: 'P1', build: function (el, tl) {
      zoneFrame(el, tl);
      const cd = box(el, 675, 623, 1525, 488, '#fff');
      wipe(tl, cd, 0.75, 'r', 0.7);
      chipIn(tl, zchip(cd, 705, 857, 'ИНФРАСТРУКТУРА'), 1.0);
      blistIn(tl, blist(cd, 705, 913, LIST.infraL, '#000'), 1.28);
      blistIn(tl, blist(cd, 1739, 913, LIST.infraR, '#000'), 1.46);
    }
  });

  def('s3', {
    title: 'Разработка', cube: 'P1', carryFrom: 's2', build: function (el, tl, ct) {
      zoneFrame(el, tl);
      const cd = box(el, 675, 623, 1525, 488, '#fff');
      wipe(tl, cd, 0.75, 'r', 0.7);
      const ch = zchip(cd, 705, 611, 'РАЗРАБОТКА');
      const gw = ghostWord(ch, 'ИНФРАСТРУКТУРА');
      const gL = blist(cd, 705, 913, LIST.infraL, '#000'), gR = blist(cd, 1739, 913, LIST.infraR, '#000');
      const L = blist(cd, 705, 955, LIST.devL, '#222'), R = blist(cd, 1526, 955, LIST.devR, '#222');
      const ghosts = [gw.root].concat(wraps(gL), wraps(gR));
      // fresh: the whole slide builds
      shown(tl, ghosts, 0);
      tl.set(ch.b, { width: 611 }, 0);
      chipIn(tl, ch, 1.0);
      blistIn(tl, L, 1.28); blistIn(tl, R, 1.46);
      // from slide 2: the headline, the tile and the card stay; the plate drops its word, narrows, takes the next one
      shown(ct, ghosts, 1);
      blistOut(ct, gL.concat(gR), 0);
      ct.fromTo(gw[0], { y: [0, -100] }, { at: 0.04, dur: 0.34, ease: EZ.exit });
      ct.set(ghosts, { opacity: 0 }, 0.5);
      ct.fromTo(ch.b, { width: [857, 611] }, { at: 0.2, dur: 0.6, ease: EZ.move });
      ct.fromTo(ch.t[0], { y: [100, 0] }, { at: 0.36, dur: 0.66, ease: EZ.enter });
      blistIn(ct, L, 0.6); blistIn(ct, R, 0.78);
    }
  });

  def('s4', {
    title: 'Данные · ИИ-сервисы', cube: 'P1', carryFrom: 's3', build: function (el, tl, ct) {
      zoneFrame(el, tl);
      const c1 = box(el, 675, 623, 752.5, 488, '#fff'), bridge = box(el, 1426.5, 623, 22, 488, '#fff'), c2 = box(el, 1447.5, 623, 752.5, 488, '#fff');
      const ch1 = zchip(c1, 705, 423, 'ДАННЫЕ'), ch2 = zchip(c2, 1477.5, 641, 'ИИ-СЕРВИСЫ');
      const gw = ghostWord(ch1, 'РАЗРАБОТКА');
      const gL = blist(c1, 705, 955, LIST.devL, '#222'), gR = blist(c2, 1526, 955, LIST.devR, '#222');
      const L = blist(c1, 705, 913, LIST.dataL, '#222'), R = blist(c2, 1477.5, 829, LIST.aiL, '#222');
      const ghosts = [gw.root].concat(wraps(gL), wraps(gR));
      // fresh
      shown(tl, ghosts, 0);
      tl.set(bridge, { clipT: 100 }, 0);
      tl.set(ch1.b, { width: 423 }, 0);
      wipe(tl, c1, 0.75, 'r', 0.65);
      wipe(tl, c2, 0.92, 'r', 0.65);
      chipIn(tl, ch1, 0.98); chipIn(tl, ch2, 1.14);
      blistIn(tl, L, 1.3); blistIn(tl, R, 1.48, 0.07);
      // from slide 3: the card splits in two — a cut runs down its middle (the bridge overlaps both halves by 1 px:
      // two boxes meeting on a half pixel would show an antialiasing seam); the plate narrows to «Данные»,
      // the second plate wipes in on the new half
      shown(ct, ghosts, 1);
      blistOut(ct, gL.concat(gR), 0);
      ct.fromTo(gw[0], { y: [0, -100] }, { at: 0.04, dur: 0.34, ease: EZ.exit });
      ct.set(ghosts, { opacity: 0 }, 0.5);
      ct.fromTo(bridge, { clipT: [0, 100] }, { at: 0.22, dur: 0.6, ease: EZ.wipe });
      ct.fromTo(ch1.b, { width: [611, 423] }, { at: 0.22, dur: 0.6, ease: EZ.move });
      ct.fromTo(ch1.t[0], { y: [100, 0] }, { at: 0.38, dur: 0.66, ease: EZ.enter });
      chipIn(ct, ch2, 0.58);
      blistIn(ct, L, 0.78); blistIn(ct, R, 0.96, 0.07);
    }
  });

  // ───── 5 · Как задать вопрос спикеру (3472:541): headline → offline (the path through the app) → online + QR → the rule ─────
  def('s5', {
    title: 'Как задать вопрос спикеру', cube: 'P2', build: function (el, tl) {
      const hd = box(el, 560, 103, 1625, 360, '#fff');
      wipe(tl, hd, 0.1, 'r', 0.7);
      reveal(tl, text(hd, { x: 590, y: 133, w: 1565, size: 120, lh: 120, ls: -0.02, color: '#000', lines: ['КАК ЗАДАТЬ ВОПРОС', 'СПИКЕРУ'] }), 0.34, { stagger: 0.1, dur: 0.8 });
      // offline
      const c1 = box(el, 120, 483, 1020, 477, '#fff');
      wipe(tl, c1, 0.55, 'r', 0.62);
      chipIn(tl, chip(c1, 160, 523, 430, 114, '#434343', { x: 184, y: 535, size: 90, lh: 90, color: '#fff', lines: ['ОФЛАЙН'] }), 0.78);
      const t1 = text(c1, {
        x: 160, y: 776, w: 880, size: 40, lh: 48, ls: -0.02, color: '#000',
        lines: ['Через SuperApp:', ['раздел «Программа» ', '→ ', 'выбрать доклад ', '→'], 'кнопка «Задать вопрос»']
      });
      reveal(tl, [t1[0]], 0.98, { dur: 0.65 });
      const sg = t1[1]._segs;                 // the path: one step after another, the arrows point the way
      [[sg[0], 1.1], [sg[2], 1.31]].forEach(function (p) { tl.fromTo(p[0], { y: [below(t1[1]), 0] }, { at: p[1], dur: 0.62, ease: EZ.enter }); });
      [[sg[1], 1.24], [sg[3], 1.45]].forEach(function (p) { tl.fromTo(p[0], { x: [-18, 0], opacity: [0, 1] }, { at: p[1], dur: 0.45, ease: EZ.enter }); });
      reveal(tl, [t1[2]], 1.52, { dur: 0.65 });
      // online
      const c2 = box(el, 1164, 483, 1020, 477, '#fff');
      wipe(tl, c2, 0.8, 'r', 0.62);
      chipIn(tl, chip(c2, 1204, 523, 430, 114, '#26d07c', { x: 1228, y: 535, size: 90, lh: 90, color: '#222', lines: ['ОНЛАЙН'] }), 1.02);
      reveal(tl, text(c2, { x: 1204, y: 779, w: 740, size: 40, lh: 48, ls: -0.02, color: '#000', lines: ['Напишите вопрос в чат трансляции —', 'самые интересные вопросы', 'модератор озвучит спикеру'] }), 1.22, { stagger: 0.08, dur: 0.7 });
      const D = window.DECK_QR.app;
      qrIn(tl, qrcode(c2, 'app', 1935, 513, 220 / D.size, 220 / D.size), 1.32, 1.0);
      // the rule, last
      const bar = box(el, 120, 980, 1020, 111, '#fff');
      wipe(tl, bar, 1.74, 'r', 0.55);
      reveal(tl, text(bar, { x: 156, y: 1013.5, size: 44, lh: 44, ls: -0.01, lines: ['ОТВЕЧАЕМ НА ВОПРОСЫ ПОСЛЕ ДОКЛАДА'] }), 1.94, { dur: 0.7 });
    }
  });

  // ───── 6 · Оставайтесь на связи (3480:21806): the card, the call, then the four codes in reading order ─────
  def('s6', {
    title: 'Оставайтесь на связи', cube: 'P2', build: function (el, tl) {
      const cd = box(el, 560, 100, 1639, 1011, '#fff');
      wipe(tl, cd, 0.1, 'r', 0.8);
      reveal(tl, text(cd, { x: 600, y: 961, w: 1559, size: 120, lh: 120, ls: -0.02, color: '#000', lines: ['ОСТАВАЙТЕСЬ НА СВЯЗИ'] }), 0.5, { dur: 0.85 });
      [['future', 600, 130, 980.5, 153, ['БУДУЩИЕ', 'МЕРОПРИЯТИЯ']],
        ['learn', 1504.5, 130, 1885, 153, ['ОБУЧЕНИЕ', 'И СЕРТИФИКАЦИЯ']],
        ['career', 600, 530.5, 980.5, 553.5, ['КАРЬЕРА', 'В CLOUD.RU']],
        ['tg', 1504.5, 530.5, 1885, 553.5, ['TELEGRAM-', 'КАНАЛ']]].forEach(function (q, i) {
        const m = 370.5 / window.DECK_QR[q[0]].size, at = 0.66 + nl(i, 0.21, 0.85);
        qrIn(tl, qrcode(cd, q[0], q[1], q[2], m, m), at, 0.95);
        reveal(tl, text(cd, { x: q[3], y: q[4], size: 30, lh: 30, wt: 700, color: '#000', lines: q[5] }), at + 0.3, { stagger: 0.07, dur: 0.6 });
      });
    }
  });

  // ───── 7 · Онлайн-программа (3472:478): the podcast, its host, the three guests in programme order ─────
  const SPK = [
    { x: 588.75, cw: 232, name: ['Анатолий', 'Карпов'], co: 'Karpov Courses', time: '12:40 – 13:00',
      topic: ['Какие навыки остаются', 'востребованными', 'всегда, что выделяет', 'сильного инженера', 'и чему учиться прямо', 'сейчас'] },
    { x: 1132.5, cw: 233, name: ['Дмитрий', 'Зубцов'], co: 'СберУниверситет', time: '13:40 – 14:00',
      topic: ['Что работодатели ищут', 'в кандидатах, зачем', 'развивать мягкие', 'навыки и куда расти', 'при горизонтальной', 'карьере'] },
    { x: 1676.25, cw: 232, name: ['Софья', 'Черногорцева'], co: 'НИУ ВШЭ', time: '15:00 – 15:20',
      topic: ['Как трансформируется', 'рынок труда и какие', 'навыки становятся', 'востребованными', 'под влиянием', 'генеративного ИИ'] }
  ];
  def('s7', {
    title: 'Онлайн-программа', cube: null, build: function (el, tl) {
      const hd = box(el, 589, 103, 1611, 357, '#fff');
      wipe(tl, hd, 0.1, 'r', 0.7);
      reveal(tl, text(hd, { x: 609, y: 113, size: 44, lh: 44, ls: -0.02, color: '#000', lines: ['ОНЛАЙН-ПРОГРАММА'] }), 0.3, { dur: 0.6 });
      reveal(tl, text(hd, { x: 609, y: 302, w: 1571, size: 74, lh: 74, color: '#000', lines: ['ПОДКАСТ CLOUD.RU: КАРЬЕРА И РАЗВИТИЕ', 'ИТ-СПЕЦИАЛИСТОВ В ЭПОХУ ИИ'] }), 0.42, { stagger: 0.1, dur: 0.8 });
      // the host: photo tile (pattern sf 3.6, cut-out photo) + card
      const media = div(el, 105, 480, 463.75, 332, { overflow: 'hidden', background: '#e3e3e3' });
      grid(media, 105, 480, 463.75, 332, 3.6, '#e3e3e3', '#ffffff');
      const ph = img(media, IMG.photo, 84, 467, 509, 509);
      ph.style.transformOrigin = '254px 420px';
      wipe(tl, media, 0.62, 'u', 0.6);
      tl.fromTo(ph, { y: [72, 0], scale: [1.05, 1] }, { at: 0.74, dur: 1.2, ease: EZ.enter });
      const hc = box(el, 105, 812, 463.75, 300, '#fff');
      wipe(tl, hc, 0.92, 'd', 0.55);
      reveal(tl, text(hc, { x: 135, y: 842, w: 403.75, size: 30, lh: 36, trim: true, lines: ['Ведущая подкаста,', 'директор по персоналу', 'Cloud.ru'] }), 1.08, { stagger: 0.06, dur: 0.6 });
      reveal(tl, text(hc, { x: 135, y: 966, w: 403.75, size: 52, lh: 52, trim: true, lines: ['Виктория', 'Трифонова'] }), 1.2, { stagger: 0.08, dur: 0.7 });
      SPK.forEach(function (p, i) { speaker(el, tl, 1.12 + nl(i, 0.3, 0.85), p); });
    }
  });
  function speaker(el, tl, at, p) {
    const x = p.x + 30, c = box(el, p.x, 480, 523.75, 632, '#fff');
    wipe(tl, c, at, 'd', 0.6);
    reveal(tl, text(c, { x: x, y: 510, w: 463.75, size: 52, lh: 52, trim: true, lines: p.name }), at + 0.16, { stagger: 0.07, dur: 0.7 });
    reveal(tl, text(c, { x: x, y: 629, w: 463.75, size: 30, lh: 36, trim: true, lines: [p.co] }), at + 0.28, { dur: 0.6 });
    const ch = box(c, x, 681, p.cw, 54, '#26d07c');
    ch.classList.add('chip');
    wipe(tl, ch, at + 0.34, 'r', 0.42);
    odoIn(tl, odo(ch, x + 24, 693, p.time, { size: 30, lh: 30, color: '#222' }), at + 0.4);
    reveal(tl, text(c, { x: x, y: 765, w: 463.75, size: 38, lh: 46, trim: true, lines: p.topic }), at + 0.46, { stagger: 0.055, dur: 0.65 });
  }

  // ───── 8 · SuperApp Cloud.ru (3480:21440): the app and its code, then what to do in it ─────
  def('s8', {
    title: 'SuperApp Cloud.ru', cube: 'P3', build: function (el, tl) {
      const hd = box(el, 560, 103, 1640, 357, '#fff');
      wipe(tl, hd, 0.1, 'r', 0.7);
      reveal(tl, text(hd, { x: 580, y: 123, w: 1175, size: 120, lh: 120, ls: -0.02, color: '#000', lines: ['SUPERAPP', 'CLOUD.RU'] }), 0.34, { stagger: 0.1, dur: 0.8 });
      const Z = window.DECK_QR.app.size;      // CROP [[0.9498,0,0.0251],[0,0.9665,0.0167]] on 321 x 316 at (1854, 124)
      qrIn(tl, qrcode(hd, 'app', 1854 - 0.0251 / 0.9498 * 321, 124 - 0.0167 / 0.9665 * 316, 321 / (0.9498 * Z), 316 / (0.9665 * Z)), 0.62, 1.0);
      [[480, 530.5, ['Посмотреть программу и задать', 'вопросы спикерам']], [697, 775.5, ['Записаться на воркшопы']],
        [914, 992.5, ['Посмотреть карту конференции']]].forEach(function (a, i) {
        const at = 0.72 + nl(i, 0.15), c = box(el, 105, a[0], 1037.5, 197, '#fff');
        wipe(tl, c, at, 'r', 0.55);
        reveal(tl, text(c, { x: 133.77, y: a[1], w: 979.96, size: 56, lh: 56, trim: true, lines: a[2] }), at + 0.22, { stagger: 0.07, dur: 0.7 });
      });
      const m = box(el, 1162.5, 480, 617, 631, '#fff');
      wipe(tl, m, 1.12, 'd', 0.6);
      reveal(tl, text(m, { x: 1191.27, y: 508.77, w: 559.46, size: 56, lh: 56, trim: true, lines: ['Записаться', 'на fast track', 'в Лабораторию', 'Карьеры', 'по направлениям'] }), 1.3, { stagger: 0.07, dur: 0.7 });
      const r = box(el, 1799.5, 480, 400.5, 631, '#fff');
      wipe(tl, r, 1.3, 'd', 0.6);
      reveal(tl, text(r, { x: 1828.27, y: 508.77, w: 342.96, size: 56, lh: 56, trim: true, lines: ['Пройти', 'активности', 'и получить', 'мерч'] }), 1.48, { stagger: 0.07, dur: 0.7 });
    }
  });

  // ───────── runtime: fit, navigation, transitions ─────────
  const slides = [];
  let cur = -1, token = 0, stageK = 1, chromeTl = null;
  const hud = document.getElementById('hud');
  const help = document.getElementById('help');
  const blank = document.getElementById('blank');

  function makeSlides() {
    ORDER.forEach(function (key, i) {
      const d = DEFS[key];
      const el = E('section', slidesL, 'slide');
      el.dataset.key = key;
      const fresh = M.timeline({ fps: 60 });
      const carry = d.carryFrom ? M.timeline({ fps: 60 }) : null;
      d.build(el, fresh, carry || M.timeline({ fps: 60 }));
      slides.push({ key: key, def: d, el: el, fresh: fresh, carry: carry, tl: fresh, prev: ORDER[i - 1] || null });
    });
  }
  // a slide plays either its full build (fresh) or the carry-over from its predecessor; the other timeline is
  // parked at its end first, so every element it alone drives sits in its rest state
  function activate(s, useCarry, t) {
    if (useCarry) { s.fresh.seek(s.fresh.duration); s.tl = s.carry; }
    else { if (s.carry) s.carry.seek(s.carry.duration); s.tl = s.fresh; }
    s.tl.seek(t === 'end' ? s.tl.duration : t);
  }
  const atRest = (s) => !s.tl._playing && s.tl.time >= s.tl.duration - 1e-6;

  function fit() {
    const k = RENDER ? 1 : Math.min(innerWidth / W, innerHeight / H);
    const x = RENDER ? 0 : (innerWidth - W * k) / 2, y = RENDER ? 0 : (innerHeight - H * k) / 2;
    stage.style.transform = 'translate(' + r3(x) + 'px,' + r3(y) + 'px) scale(' + k + ')';
    stageK = k;
  }

  function show(s) { s.el.classList.add('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }
  function hide(s) { s.tl.pause(); s.el.classList.remove('on'); s.el.style.opacity = ''; s.el.style.transform = ''; }

  // the outgoing slide leaves in 0.32 s (opacity + a 2 % push, ease-in); the chrome stays
  function leave(s) {
    s.tl.pause();
    const el = s.el, t0 = performance.now(), D = 320;
    el.style.transformOrigin = '50% 50%';
    const my = s._leaveId;
    function f(now) {
      if (s._leaveId !== my) return;
      const u = Math.min(1, (now - t0) / D), e = F.exit(u);
      el.style.opacity = r3(1 - e);
      el.style.transform = 'scale(' + r3(1 + 0.02 * e) + ')';
      if (u < 1) requestAnimationFrame(f); else hide(s);
    }
    requestAnimationFrame(f);
  }

  // chrome to the next slide: from wherever the cube is now; an unfinished chrome move is completed first
  function chromeGo(fromDef, toDef, animate, opening) {
    const A = Object.assign({}, cubeS);
    if (chromeTl) { chromeTl.pause(); chromeTl.seek(chromeTl.duration); }
    const tl = M.timeline({ fps: 60 });
    chromeTo(tl, fromDef, toDef, A, opening);
    chromeTl = tl;
    if (animate) { tl.seek(0); tl.play(); } else tl.seek(tl.duration);
  }

  function go(i, mode) {
    if (i < 0 || i >= slides.length) return;
    const my = ++token;
    const prev = slides[cur], next = slides[i], intro = mode === 'intro';
    const carry = !!(intro && prev && prev !== next && next.carry && next.def.carryFrom === prev.key && atRest(prev));
    chromeGo(prev ? prev.def : null, next.def, intro, !prev);
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
      // the file's first slide waits for the logo to stand (0.45 s); others start as the outgoing one fades
      const delay = carry || prev === next ? 0 : !prev ? 450 : 200;
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

  // one slide as one seekable clip, entered exactly as in the room: from the slide before it in this file (its rest
  // frame leaves in 0.32 s and the build starts 0.2 s after the click, or the carry-over plays at once), with the
  // chrome's part (the opening build for the first slide, the cube's move otherwise)
  function clip(i, forceFresh) {
    const s = slides[i], p = slides[i - 1] || null;
    const useCarry = !!(p && s.carry && s.def.carryFrom === p.key && !forceFresh);
    const out = p && !useCarry ? p : null, lead = out ? 0.2 : !p ? 0.45 : 0;
    const ctl = M.timeline({ fps: 60 });
    chromeTo(ctl, p ? p.def : null, s.def, null, !p);
    if (out) { activate(out, false, 'end'); out.el.style.transformOrigin = '50% 50%'; }
    activate(s, useCarry, 0);
    show(s); cur = i;
    const tl = s.tl, dur = Math.max(tl.duration + lead, ctl.duration);
    const seek = function (t) {
      t = Math.max(0, Math.min(dur, t));
      ctl.seek(Math.min(t, ctl.duration));
      tl.seek(Math.max(0, Math.min(t - lead, tl.duration)));
      if (out) {
        const on = t < 0.32, e = F.exit(c01(t / 0.32));
        out.el.classList.toggle('on', on);
        out.el.style.opacity = on ? r3(1 - e) : '';
        out.el.style.transform = on ? 'scale(' + r3(1 + 0.02 * e) + ')' : '';
      }
      return t;
    };
    const all = {};
    tl.beatList('all').map(function (b) { return b + lead; }).concat(ctl.beatList('all')).forEach(function (b) { all[Math.round(b * 1000)] = b; });
    const beats = [];
    for (let k = 0; k <= 8; k++) beats.push(Math.round(dur * k / 8 * 1000) / 1000);
    return {
      ready: true, fps: 60, duration: dur, frames: Math.round(dur * 60), beats: beats,
      beatsAll: Object.keys(all).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return all[k]; }),
      seek: seek, seekFrame: function (f) { return seek(f / 60); }, play: function () {}, pause: function () {}
    };
  }

  function ready() {
    const fonts = ['600', '700'].map(function (w) { return document.fonts.load(w + ' 40px Manrope', 'Аа0→«'); });
    const used = {};
    ORDER.forEach(function (k) { if (DEFS[k].cube) used.cube = 1; if (k === 's7') used.photo = 1; });
    const pics = Object.keys(used).map(function (k) {
      return new Promise(function (res) { const im = new Image(); im.onload = im.onerror = function () { (im.decode ? im.decode() : Promise.resolve()).then(res, res); }; im.src = IMG[k]; });
    });
    return Promise.all(fonts.concat(pics)).then(function () { return document.fonts.ready; });
  }

  ready().then(function () {
    makeSlides();
    fit();
    slides.forEach(function (s) { if (s.carry) s.carry.seek(s.carry.duration); s.fresh.seek(0); });
    window.__deck = { slides: slides, go: go, get cur() { return cur; }, get chrome() { return chromeTl; }, cube: function () { return cubeS; } };

    const only = Q.has('slide') ? Math.max(0, Math.min(slides.length - 1, +Q.get('slide') - 1)) : null;
    const boot = document.getElementById('boot');
    if (RENDER || (only != null && Q.has('t'))) {
      const c = clip(only || 0, Q.has('fresh'));
      boot.style.display = 'none'; hud.style.display = 'none';
      if (RENDER) { window.__motion = c; c.seek(0); }
      else { const tv = Q.get('t'); c.seek(tv === 'end' ? c.duration : +tv); }
      return;
    }
    bindKeys();
    document.body.classList.add('idle');
    const h = parseInt((location.hash || '').slice(1), 10);
    go(only != null ? only : (h >= 1 && h <= slides.length ? h - 1 : 0), 'intro');
    boot.classList.add('gone');
  });
})();
