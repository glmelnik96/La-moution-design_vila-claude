// brand.js — Cloud.ru brand primitives for the HTML motion engine (DOM builders + custom setters).
//
// Every builder returns plain DOM you can hand to Motion.timeline().fromTo(). Geometry follows
// the brand: straight corners, square caps, 2px module, weights 2/4/6. Colours come from
// tokens.css custom properties (--cr-green etc.), so a page can retheme by overriding them.
//
//   const T = Brand.canvas(document.body, '1080p');          // sized .cr-canvas
//   const scene = Brand.scene(T, 'cr-tone-light');
//   const h = Brand.text(scene, 'Cloud.ru снижает цену прогресса', 'cr-title', { left: 80, top: 400, width: 1200 });
//   const lines = Brand.lines(h);                            // → [.cr-line] wrapped in .cr-line-mask
//   tl.fromTo(lines, { y: [140, 0] }, { at: 0.5, dur: 0.7, ease: 'enter', stagger: 0.07 });
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.MotionTokens || require('./tokens.js'));
  else root.Brand = factory(root.MotionTokens);
})(typeof self !== 'undefined' ? self : this, function (TOKENS) {
  'use strict';
  const NBSP_THIN = ' ';

  function el(tag, cls, style, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.keys(style).forEach(function (k) {
      const v = style[k];
      e.style[k] = (typeof v === 'number' && !/opacity|zIndex|fontWeight|lineHeight/.test(k)) ? v + 'px' : v;
    });
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(tag, attrs, parent) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(key) { return TOKENS.format[key] || TOKENS.format['1080p']; }

  // ───────── canvas / scenes ─────────
  function canvas(parent, formatKey, opts) {
    const F = fmt(formatKey);
    opts = opts || {};
    const c = el('div', 'cr-canvas', { width: opts.w || F.w, height: opts.h || F.h }, parent);
    c.dataset.format = formatKey || '1080p';
    c.dataset.scale = String(F.scale);
    c.style.setProperty('--cr-scale', String(F.scale));
    c.style.setProperty('--cr-margin', F.margin + 'px');
    return c;
  }
  function scene(canvasEl, tone) {
    return el('div', 'cr-scene ' + (tone || 'cr-tone-light'), null, canvasEl);
  }
  // Absolutely positioned box: {left, top, right, bottom, width, height}
  function box(parent, cls, pos) {
    const b = el('div', cls || '', null, parent);
    b.style.position = 'absolute';
    if (pos) Object.keys(pos).forEach(function (k) { b.style[k] = typeof pos[k] === 'number' ? pos[k] + 'px' : pos[k]; });
    return b;
  }
  function text(parent, str, cls, pos) {
    const t = box(parent, 'cr-text ' + (cls || 'cr-body'), pos);
    t.textContent = str;
    return t;
  }

  // ───────── line splitting for line-mask reveals ─────────
  // Splits an element's text into measured lines (by offsetTop of word spans), then rebuilds it
  // as .cr-line-mask > .cr-line blocks. Call AFTER fonts are ready and the element is laid out.
  function lines(elm, opts) {
    opts = opts || {};
    const raw = elm.textContent;
    const words = raw.split(/\s+/).filter(Boolean);
    elm.textContent = '';
    const spans = words.map(function (w) { const s = document.createElement('span'); s.textContent = w; elm.appendChild(s); elm.appendChild(document.createTextNode(' ')); return s; });
    const rows = [];
    let lastTop = null;
    spans.forEach(function (s) {
      const top = s.offsetTop;
      if (lastTop === null || Math.abs(top - lastTop) > 1) { rows.push([]); lastTop = top; }
      rows[rows.length - 1].push(s.textContent);
    });
    elm.textContent = '';
    const out = rows.map(function (r) {
      const mask = el('div', 'cr-line-mask', null, elm);
      const line = el('div', 'cr-line', null, mask);
      line.textContent = r.join(' ');
      if (opts.pad != null) mask.style.paddingBottom = opts.pad + 'px';
      return line;
    });
    elm.classList.add('cr-lines');
    return out;
  }
  // Height of a line box in px (for reveal travel distances): reads the first .cr-line.
  function lineHeight(lineEl) { return lineEl.getBoundingClientRect().height; }

  // ───────── logo ─────────
  // PLACEHOLDER lockup (hexagon mark + wordmark). In deliverables replace with the real
  // cloud-ru-logo-RGB.svg via opts.svg (a string) — brand rule: never a typed lockup, never distorted.
  function logo(parent, opts) {
    opts = opts || {};
    const size = opts.size || 42;
    const ink = opts.ink || 'var(--cr-black)';
    const l = box(parent, 'cr-logo', opts.pos || { left: 'var(--cr-margin)', top: 60 });
    l.style.height = size + 'px';
    if (opts.svg) { l.innerHTML = opts.svg; return l; }
    const s = svg('svg', { viewBox: '0 0 32 32', width: size, height: size }, l);
    svg('polygon', { points: '4,12 16,4 28,12 28,24 16,32 4,24', fill: opts.mark || 'var(--cr-green)' }, s);
    svg('rect', { x: 14, y: 9, width: 4, height: 18, fill: opts.inner || 'var(--cr-white)' }, s);
    const w = el('span', 'cr-logo-word', { fontSize: size * 0.68, color: ink }, l);
    w.textContent = 'cloud.ru';
    return l;
  }

  // ───────── patterns ─────────
  // Dots grid → { el, cells, rows } — animate cells with a stagger (row order = reading order).
  function dots(parent, o) {
    o = Object.assign({ cols: 30, rows: 4, size: 4, gap: 12, color: 'var(--cr-green)' }, o || {});
    const g = box(parent, 'cr-dots', o.pos);
    g.style.display = 'grid';
    g.style.gridTemplateColumns = 'repeat(' + o.cols + ', ' + o.size + 'px)';
    g.style.gap = o.gap + 'px';
    const cells = [], rows = [];
    for (let r = 0; r < o.rows; r++) {
      rows.push([]);
      for (let c = 0; c < o.cols; c++) {
        const d = el('i', 'cr-dot', { width: o.size, height: o.size, background: o.color }, g);
        cells.push(d); rows[r].push(d);
      }
    }
    return { el: g, cells: cells, rows: rows, cols: o.cols };
  }
  // Square grid of hairlines (one element; reveal it with clip props).
  function grid(parent, o) {
    o = Object.assign({ cols: 12, rows: 6, cell: 80, weight: 2, color: 'var(--cr-gray)' }, o || {});
    const g = box(parent, 'cr-grid', Object.assign({ width: o.cols * o.cell + o.weight, height: o.rows * o.cell + o.weight }, o.pos || {}));
    g.style.backgroundImage =
      'linear-gradient(to right, ' + o.color + ' ' + o.weight + 'px, transparent ' + o.weight + 'px), ' +
      'linear-gradient(to bottom, ' + o.color + ' ' + o.weight + 'px, transparent ' + o.weight + 'px)';
    g.style.backgroundSize = o.cell + 'px ' + o.cell + 'px';
    return g;
  }
  // ЛЛЛЛ arrow pattern → { el, cells } (each cell an SVG with two square-capped strokes).
  function llll(parent, o) {
    o = Object.assign({ cells: 4, cell: 120, gap: 12, weight: 2, color: 'var(--cr-green)' }, o || {});
    const g = box(parent, 'cr-llll', o.pos);
    g.style.display = 'flex';
    g.style.gap = o.gap + 'px';
    const cells = [];
    for (let i = 0; i < o.cells; i++) {
      const s = svg('svg', { viewBox: '0 0 100 100', width: o.cell, height: o.cell, class: 'cr-llll-cell' }, g);
      const w = (o.weight / o.cell) * 100;
      svg('polyline', { points: '40,' + (w / 2) + ' ' + (100 - w / 2) + ',' + (w / 2) + ' ' + (100 - w / 2) + ',70',
        fill: 'none', stroke: o.color, 'stroke-width': w, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }, s);
      cells.push(s);
    }
    return { el: g, cells: cells };
  }
  // Portal: N stepped rectangles → { el, steps } — animate steps with x/y or clip.
  function portal(parent, o) {
    o = Object.assign({ w: 480, h: 320, steps: TOKENS.geometry.portal_steps_default, dx: 40, dy: 40, color: 'var(--cr-green)' }, o || {});
    const g = box(parent, 'cr-portal', Object.assign({ width: o.w + (o.steps - 1) * Math.abs(o.dx), height: o.h + (o.steps - 1) * Math.abs(o.dy) }, o.pos || {}));
    const steps = [];
    for (let i = 0; i < o.steps; i++) {
      const s = box(g, 'cr-portal-step', {
        left: o.dx >= 0 ? i * o.dx : (o.steps - 1 - i) * -o.dx,
        top: o.dy >= 0 ? i * o.dy : (o.steps - 1 - i) * -o.dy,
        width: o.w, height: o.h
      });
      s.style.background = o.color;
      steps.push(s);
    }
    return { el: g, steps: steps };
  }
  // Bracket frame → { el, sides: {top1, top2, right, bottom, left} } — draw-on via scaleX/scaleY.
  function bracket(parent, o) {
    o = Object.assign({ inset: 80, weight: 2, color: 'var(--cr-black)', cut: [0.3, 0.42] }, o || {});
    const g = box(parent, 'cr-bracket', { left: o.inset, top: o.inset, right: o.inset, bottom: o.inset });
    const mk = function (pos, origin) { const s = box(g, 'cr-bracket-side', pos); s.style.background = o.color; s.style.transformOrigin = origin; return s; };
    const sides = {
      top1: mk({ left: 0, top: 0, width: (o.cut ? o.cut[0] * 100 : 100) + '%', height: o.weight }, 'left center'),
      top2: o.cut ? mk({ left: (o.cut[1] * 100) + '%', right: 0, top: 0, height: o.weight }, 'left center') : null,
      right: mk({ right: 0, top: 0, bottom: 0, width: o.weight }, 'center top'),
      bottom: mk({ left: 0, right: 0, bottom: 0, height: o.weight }, 'right center'),
      left: mk({ left: 0, top: 0, bottom: 0, width: o.weight }, 'center bottom')
    };
    return { el: g, sides: sides, list: [sides.top1, sides.top2, sides.right, sides.bottom, sides.left].filter(Boolean) };
  }
  // Rule / bar at final size; grows from its origin ('left' | 'right' | 'top' | 'bottom').
  function rule(parent, o) {
    o = Object.assign({ w: 600, h: 4, color: 'var(--cr-green)', origin: 'left' }, o || {});
    const r = box(parent, 'cr-rule', Object.assign({ width: o.w, height: o.h }, o.pos || {}));
    r.style.background = o.color;
    r.style.transformOrigin = { left: 'left center', right: 'right center', top: 'center top', bottom: 'center bottom' }[o.origin];
    return r;
  }
  // Colour plate (for block wipes and subtitle plates).
  function plate(parent, o) {
    o = Object.assign({ color: 'var(--cr-green)' }, o || {});
    const p = box(parent, 'cr-plate', o.pos || { left: 0, top: 0, right: 0, bottom: 0 });
    p.style.background = o.color;
    return p;
  }

  // ───────── linear illustrations (square caps, 2 colours max) ─────────
  function arrow(parent, o) {
    o = Object.assign({ len: 400, weight: 2, head: 14, color: 'var(--cr-arrow)' }, o || {});
    const s = svg('svg', { width: o.len, height: o.head * 2 + o.weight, viewBox: '0 0 ' + o.len + ' ' + (o.head * 2 + o.weight), class: 'cr-arrow' });
    s.style.position = 'absolute';
    if (o.pos) Object.keys(o.pos).forEach(function (k) { s.style[k] = o.pos[k] + 'px'; });
    const y = o.head + o.weight / 2;
    const p = svg('path', { d: 'M0 ' + y + ' H' + (o.len - o.weight) + ' M' + (o.len - o.head - o.weight) + ' ' + (y - o.head) + ' L' + (o.len - o.weight) + ' ' + y + ' L' + (o.len - o.head - o.weight) + ' ' + (y + o.head),
      fill: 'none', stroke: o.color, 'stroke-width': o.weight, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' }, s);
    if (parent) parent.appendChild(s);
    return { el: s, path: p };
  }
  // AI star ✦ (four-pointed, straight strokes) and cloud (rectilinear brand cloud).
  function star(parent, o) {
    o = Object.assign({ size: 48, weight: 2, color: 'var(--cr-green)' }, o || {});
    const s = svg('svg', { width: o.size, height: o.size, viewBox: '0 0 48 48', class: 'cr-star' });
    s.style.position = 'absolute';
    if (o.pos) Object.keys(o.pos).forEach(function (k) { s.style[k] = o.pos[k] + 'px'; });
    const p = svg('path', { d: 'M24 2 V46 M2 24 H46 M10 10 L38 38 M38 10 L10 38', fill: 'none', stroke: o.color, 'stroke-width': o.weight, 'stroke-linecap': 'square' }, s);
    if (parent) parent.appendChild(s);
    return { el: s, path: p };
  }
  function cloud(parent, o) {
    o = Object.assign({ w: 160, weight: 2, color: 'var(--cr-black)' }, o || {});
    const h = o.w * 0.6;
    const s = svg('svg', { width: o.w, height: h, viewBox: '0 0 160 96', class: 'cr-cloud' });
    s.style.position = 'absolute';
    if (o.pos) Object.keys(o.pos).forEach(function (k) { s.style[k] = o.pos[k] + 'px'; });
    // rectilinear cloud silhouette: stepped rectangles, straight corners only
    const p = svg('path', { d: 'M20 94 H140 V62 H156 V30 H124 V10 H68 V26 H36 V50 H4 V94 Z', fill: 'none', stroke: o.color, 'stroke-width': o.weight, 'stroke-linejoin': 'miter' }, s);
    if (parent) parent.appendChild(s);
    return { el: s, path: p };
  }
  // Draw-on setter for an SVG path: use with prop 'draw' in [0,1].
  //   tl.fromTo(arrowEl, { draw: [0, 1] }, { set: Brand.drawOn(pathEl), at, dur, ease: 'enter' })
  function drawOn(pathEl) {
    const len = (typeof pathEl.getTotalLength === 'function') ? pathEl.getTotalLength() : 1000;
    pathEl.style.strokeDasharray = len + ' ' + len;
    pathEl.style.strokeDashoffset = String(len);
    return function (elm, st) { if ('draw' in st) pathEl.style.strokeDashoffset = String(len * (1 - st.draw)); };
  }

  // ───────── numbers ─────────
  function formatNumber(v, o) {
    o = o || {};
    const d = o.decimals || 0;
    let s = Math.abs(v).toFixed(d);
    let parts = s.split('.');
    let ip = parts[0], out = '';
    while (ip.length > 3) { out = NBSP_THIN + ip.slice(-3) + out; ip = ip.slice(0, -3); }
    ip += out;
    return (v < 0 ? '−' : '') + (o.prefix || '') + ip + (d > 0 ? ',' + parts[1] : '') + (o.suffix || '');
  }
  // Counter setter for prop 'n': tl.fromTo(el, { n: [0, 12500] }, { set: Brand.counter({ suffix: ' %' }), ease: 'count', dur: 1.4 })
  function counter(o) {
    return function (elm, st) { if ('n' in st) elm.textContent = formatNumber(st.n, o); };
  }

  // ───────── colour setter (for the accent colour cut) ─────────
  function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colorMix(fromHex, toHex, prop) {
    const a = hexToRgb(fromHex), b = hexToRgb(toHex);
    return function (elm, st) {
      if (!('mix' in st)) return;
      const u = Math.max(0, Math.min(1, st.mix));
      const c = a.map(function (x, i) { return Math.round(x + (b[i] - x) * u); });
      elm.style[prop || 'color'] = 'rgb(' + c.join(',') + ')';
    };
  }

  return { el: el, svg: svg, canvas: canvas, scene: scene, box: box, text: text, lines: lines, lineHeight: lineHeight,
           logo: logo, dots: dots, grid: grid, llll: llll, portal: portal, bracket: bracket, rule: rule, plate: plate,
           arrow: arrow, star: star, cloud: cloud, drawOn: drawOn, formatNumber: formatNumber, counter: counter,
           colorMix: colorMix, hexToRgb: hexToRgb, tokens: TOKENS, THIN: NBSP_THIN };
});
