// fig.js — Figma-exact components for seekable HTML motion (skill: reference/html-figma-1to1.md).
//
// Design space = the Figma frame in its own units: set window.FIG_FRAME = { w, h } before this file
// (e.g. a 1080x1920 frame scaled down in Figma is 791.0024 x 1406.2266). The stage is scaled to the
// viewport; renders use a device scale factor so the output lands on the delivery size.
//
// Every component is one absolutely positioned root translated to its Figma (x, y); geometry is SVG
// (anti-aliased fractional edges, like Figma), text is HTML placed on Figma's baseline (measured, see
// text()). Props go through comp.apply(st) — the motion.js custom setter — so any prop (w, h, clip,
// colour alpha…) can be keyframed.
(function (root) {
  'use strict';
  const FRAME = root.FIG_FRAME || { w: 1080, h: 1920 };
  const FW = FRAME.w, FH = FRAME.h;
  // Vertical metrics straight from the OTF tables (upm 1000): the ascent/descent Figma and Chrome use
  // (hhea; = OS/2 win for these files) and the cap height. Add fonts with Fig.METRICS.key = {...}.
  const METRICS = {
    display: { fam: "'SB Sans Display'", asc: 0.96, desc: 0.22, cap: 0.70 },
    text: { fam: "'SB Sans Text'", asc: 0.982, desc: 0.272, cap: 0.70 },
  };
  const Q = new URLSearchParams(root.location ? root.location.search : '');
  const RENDER = !!(root.__RENDER__ || Q.has('render'));
  const SVGNS = 'http://www.w3.org/2000/svg';
  const r3 = (v) => Math.round(v * 1000) / 1000;
  // Clip edges: motion.js interpolates numbers only (null → 0), so "no clip" is a far-away sentinel:
  // cT/cL below -9e4 and cB/cR above 9e4 are off. Fig.NOCLIP = { cT: -1e5, cB: 1e5, cL: -1e5, cR: 1e5 }.
  const NOCLIP = { cT: -1e5, cB: 1e5, cL: -1e5, cR: 1e5 };
  const clipOn = (p) => (p.cT != null && p.cT > -9e4) || (p.cB != null && p.cB < 9e4) || (p.cL != null && p.cL > -9e4) || (p.cR != null && p.cR < 9e4);
  const edge = (v, lo) => (v == null || (lo ? v < -9e4 : v > 9e4)) ? null : v;

  function h(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
  function s(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function svgRoot(parent) { return s('svg', { class: 'fig-svg', width: 1, height: 1 }, parent); }

  // ───────── stage ─────────
  let stageK = 1;                                // current stage scale (for measuring in design units)
  function stage() {
    const st = h('div', 'fig-stage', document.body);
    st.style.width = FW + 'px'; st.style.height = FH + 'px';
    const preview = !RENDER && !Q.has('k');
    if (preview) document.body.classList.add('fig-preview');
    function fit() {
      let k, x = 0, y = 0;
      if (Q.has('k')) k = Number(Q.get('k'));
      else if (!preview) k = innerWidth / FW;                    // render: fill the width (1080 → x1.3654)
      else { k = Math.min(innerWidth / FW, innerHeight / FH); x = (innerWidth - FW * k) / 2; y = (innerHeight - FH * k) / 2; }
      st.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
      stageK = k;
    }
    fit();
    root.addEventListener('resize', fit);
    return st;
  }

  // ───────── component core ─────────
  // base: default props; extra(p): component-specific DOM update. x, y → translate; op → opacity.
  function comp(el, base, extra) {
    const c = { el: el, base: Object.assign({ x: 0, y: 0, op: 1 }, base), cur: null };
    c.apply = function (st) {
      const p = Object.assign({}, c.base, st || {});
      el.style.transform = 'translate(' + r3(p.x) + 'px,' + r3(p.y) + 'px)';
      el.style.opacity = r3(Math.max(0, Math.min(1, p.op)));
      el.style.visibility = p.op <= 0.0005 ? 'hidden' : '';
      if (extra) extra(p);
      c.cur = p;
      return c;
    };
    // static state for verification frames: merge into base
    c.state = function (st) { Object.assign(c.base, st); return c.apply(); };
    el.__comp = c;
    return c;
  }
  function group(parent) { return h('div', 'fig-abs', parent); }

  // ───────── text ─────────
  // o: { s, font:'display'|'text', w8, size, lh(px), ls(em), color:[r,g,b], a (alpha), align:'L'|'C'|'R',
  //      bw (box width for C/R), trim:'CAP', vbox (box height, vertical centre), n (lines), dy, x, y, op }
  // Clip props (stage coordinates, null = off): cT cB cL cR. Reveal offset: ry (px, moves the glyphs
  // inside the clip, not the clip).
  function text(parent, o) {
    if (o.outline) return outlineText(parent, o);
    const m = METRICS[o.font || 'display'];
    const S = o.size, L = o.lh != null ? o.lh : S * 1.1;
    // Figma's first baseline below the box top: exact metrics, half-leading not rounded.
    const bo = (L - (m.asc + m.desc) * S) / 2 + m.asc * S;
    let base;
    if (o.trim === 'CAP') base = m.cap * S;                                  // box top = cap top of line 1
    else if (o.vbox != null) base = (o.vbox - (o.n || 1) * L) / 2 + bo;     // vertical centre in the box
    else base = bo;
    base += o.dy || 0;
    const rootEl = group(parent);
    const t = h('div', 'fig-text', rootEl);
    t.textContent = o.s;
    const ts = t.style;
    ts.fontFamily = m.fam; ts.fontWeight = String(o.w8 || 400); ts.fontSize = S + 'px'; ts.lineHeight = L + 'px';
    if (o.ls) ts.letterSpacing = o.ls + 'em';
    // Chrome does NOT put the baseline where the formula says: it rounds ascent/descent to whole px and
    // floors the half-leading (LayoutNG), up to ~1px higher than Figma. Measure its real first baseline
    // with a zero-height inline-block and place the glyph box so that baseline lands on Figma's.
    const mk = document.createElement('span');
    mk.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    t.insertBefore(mk, t.firstChild);                               // first line's baseline
    ts.top = '0px';
    const chromeBase = (mk.getBoundingClientRect().top - t.getBoundingClientRect().top) / (stageK || 1);
    mk.remove();
    const top = base - chromeBase;
    // Chrome appends letter-spacing after the last glyph too; Figma does not → shift C/R aligned text back.
    let ox = 0;
    if (o.align === 'C' || o.align === 'R') {
      ts.width = o.bw + 'px'; ts.textAlign = o.align === 'C' ? 'center' : 'right';
      ox = (o.align === 'C' ? 0.5 : 1) * (o.ls || 0) * S;
    }
    // Layout stays on whole pixels (left/top 0); every fractional offset lives in transforms. Chrome
    // rounds layout offsets and glyph baselines separately — split across both, identical Figma
    // baselines came out 0.2 or 0.8 px off depending on the element.
    ts.left = '0px'; ts.top = '0px';
    const rgb = o.color || [34, 34, 34];
    const n = o.n || (String(o.s).split('\n').length);
    let wCache = null;
    const c = comp(rootEl, { x: o.x || 0, y: o.y || 0, op: o.op != null ? o.op : 1, a: o.a != null ? o.a : 1, ry: 0,
      cT: null, cB: null, cL: null, cR: null }, function (p) {
      ts.color = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + r3(p.a) + ')';
      ts.transform = 'translate(' + r3(ox) + 'px,' + r3(top + p.ry) + 'px)';
      if (clipOn(p)) {
        // clip in stage coords → inset() on the glyph box, compensating the reveal offset
        const elTop = p.y + top + p.ry, elLeft = p.x + ox, H = n * L;
        if (wCache == null) wCache = t.offsetWidth || 2000;
        const cT = edge(p.cT, 1), cB = edge(p.cB, 0), cL = edge(p.cL, 1), cR = edge(p.cR, 0);
        const it = cT != null ? cT - elTop : -4000;
        const ib = cB != null ? (elTop + H) - cB : -4000;
        const il = cL != null ? cL - elLeft : -4000;
        const ir = cR != null ? (elLeft + wCache) - cR : -4000;
        ts.clipPath = 'inset(' + r3(it) + 'px ' + r3(ir) + 'px ' + r3(ib) + 'px ' + r3(il) + 'px)';
      } else ts.clipPath = '';
    });
    c.textEl = t; c.metrics = { S: S, L: L, top: top, bo: bo, n: n };
    return c.apply();
  }

  // Same component contract as text(), but the glyphs are Figma's own outlines (SVG export of the TEXT
  // node): light-on-dark browser text comes out ~10% heavier than Figma's, paths rasterise the same.
  // o.outline = { d, ox, oy } (path origin relative to the node box); colour/alpha as in text().
  function outlineText(parent, o) {
    const ol = o.outline;
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const path = s('path', { d: ol.d }, svg);
    const rgb = o.color || [34, 34, 34];
    const c = comp(rootEl, { x: o.x || 0, y: o.y || 0, op: o.op != null ? o.op : 1, a: o.a != null ? o.a : 1, ry: 0,
      cT: null, cB: null, cL: null, cR: null }, function (p) {
      path.setAttribute('fill', 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + r3(p.a) + ')');
      svg.style.transform = 'translate(' + r3(ol.ox) + 'px,' + r3(ol.oy + p.ry) + 'px)';
      if (clipOn(p)) {
        const elTop = p.y + ol.oy + p.ry, elLeft = p.x + ol.ox;      // svg box is 1x1 at the path origin
        const cT = edge(p.cT, 1), cB = edge(p.cB, 0), cL = edge(p.cL, 1), cR = edge(p.cR, 0);
        const it = cT != null ? cT - elTop : -4000, ib = cB != null ? elTop + 1 - cB : -4000;
        const il = cL != null ? cL - elLeft : -4000, ir = cR != null ? elLeft + 1 - cR : -4000;
        svg.style.clipPath = 'inset(' + r3(it) + 'px ' + r3(ir) + 'px ' + r3(ib) + 'px ' + r3(il) + 'px)';
      } else svg.style.clipPath = '';
    });
    c.textEl = svg;
    return c.apply();
  }

  // ───────── SVG geometry ─────────
  // Rectangle with an INSIDE stroke (Figma default for frames/rects) and optional selection handles.
  // o: { x, y, w, h, fill, stroke, sw, handles: { size, dl, dr, dt, db, fill } }
  function rect(parent, o) {
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const fill = s('rect', { x: 0, y: 0, fill: o.fill || 'none' }, svg);
    const str = o.stroke ? s('rect', { x: 0, y: 0, fill: 'none', stroke: o.stroke, 'stroke-width': o.sw || 1 }, svg) : null;
    const hs = [];
    if (o.handles) for (let i = 0; i < 4; i++) hs.push(s('rect', { width: o.handles.size, height: o.handles.size, fill: o.handles.fill }, svg));
    // ht / hb: scale of the top / bottom handle pair (0..1) — selection handles popping in
    const c = comp(rootEl, { x: o.x, y: o.y, w: o.w, h: o.h, op: o.op != null ? o.op : 1, ht: 1, hb: 1 }, function (p) {
      const w = Math.max(0, p.w), hh = Math.max(0, p.h);
      fill.setAttribute('width', r3(w)); fill.setAttribute('height', r3(hh));
      if (str) {
        const sw = o.sw || 1;
        const vis = w > 0.01 && hh > 0.01;
        str.setAttribute('visibility', vis ? 'visible' : 'hidden');
        str.setAttribute('x', r3(Math.min(sw / 2, w / 2))); str.setAttribute('y', r3(Math.min(sw / 2, hh / 2)));
        str.setAttribute('width', r3(Math.max(0, w - sw))); str.setAttribute('height', r3(Math.max(0, hh - sw)));
      }
      if (hs.length) {
        const H = o.handles, S = H.size, vis = w > 0.01 && hh > 0.01;
        const xs = [H.dl, w + H.dr, H.dl, w + H.dr], ys = [H.dt, H.dt, hh + H.db, hh + H.db];
        hs.forEach(function (e, i) {
          const k = Math.max(0, Math.min(1, i < 2 ? p.ht : p.hb)), sz = S * k, off = (S - sz) / 2;
          e.setAttribute('x', r3(xs[i] + off)); e.setAttribute('y', r3(ys[i] + off));
          e.setAttribute('width', r3(sz)); e.setAttribute('height', r3(sz));
          e.setAttribute('visibility', vis && k > 0.001 ? 'visible' : 'hidden');
        });
      }
    });
    return c.apply();
  }

  // Figma LINE node, butt caps: from (x, y) to (x + len, y). Measured off the renders: a LINE with a
  // CENTER stroke of weight sw is painted over [y - sw, y] (entirely above its y), not [y - sw/2, y + sw/2].
  // Prop `len` draws it on (strike-through), prop `x` slides it.
  function hline(parent, o) {
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const r = s('rect', { x: 0, y: -o.sw, height: o.sw, fill: o.color }, svg);
    const c = comp(rootEl, { x: o.x, y: o.y, len: o.len, op: o.op != null ? o.op : 1 }, function (p) {
      r.setAttribute('width', r3(Math.max(0, p.len)));
    });
    return c.apply();
  }

  // The "⊠" close/check icon of the pattern panels: 31x31 box, 2px inside stroke, two 27px diagonals.
  function crossBox(parent, o) {
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const box = s('rect', { x: 1, y: 1, width: 29, height: 29, fill: 'none', stroke: '#000', 'stroke-width': 2 }, svg);
    // Two LINE nodes (27px, rotated -135° / +135°). A LINE paints its stroke on its local -y side
    // (see hline), so each diagonal sits 1px off its axis along the rotated normal.
    const d = 27 * Math.SQRT1_2, n = Math.SQRT1_2;
    const l1 = s('line', { x1: r3(25.09 + n), y1: r3(5 + n), x2: r3(25.09 - d + n), y2: r3(5 + d + n), stroke: '#000', 'stroke-width': 2 }, svg);
    const l2 = s('line', { x1: r3(26.18 - n), y1: r3(24.38 + n), x2: r3(26.18 - d - n), y2: r3(24.38 - d + n), stroke: '#000', 'stroke-width': 2 }, svg);
    // prop d (0..1): draw-on — the square first, then one diagonal, then the other. d = 1 is the
    // plain Figma icon (no dash arrays left on it).
    const dash = function (el, len, k) {
      if (k >= 1) { el.removeAttribute('stroke-dasharray'); el.removeAttribute('stroke-dashoffset'); el.removeAttribute('visibility'); return; }
      el.setAttribute('visibility', k <= 0 ? 'hidden' : 'visible');
      el.setAttribute('stroke-dasharray', len + ' ' + len); el.setAttribute('stroke-dashoffset', r3(len * (1 - k)));
    };
    const cl = (v) => Math.max(0, Math.min(1, v));
    return comp(rootEl, { x: o.x, y: o.y, op: o.op != null ? o.op : 1, d: 1 }, function (p) {
      dash(box, 116, cl(p.d / 0.58)); dash(l1, 27, cl((p.d - 0.5) / 0.26)); dash(l2, 27, cl((p.d - 0.72) / 0.28));
    }).apply();
  }

  // ───────── logo ─────────
  const LOGO = {
    mark: 'M23.6316 24.6071H44.0349V37.6063L23.6278 46.2006V24.6034L23.6316 24.6071ZM44.0349 21.5972V8.59797L23.6316 0V21.5861L44.0349 21.5972ZM0 8.59797V37.6101L20.407 46.2043V0L0 8.59797Z',
    markW: 44.0349, markH: 46.2043,
    word: 'M14.8952 10.6517C5.21427 10.6517 0 16.1393 0 25.82C0 35.5006 5.21427 40.9882 14.6275 40.9882C20.8124 40.9882 25.811 37.8668 27.8007 31.5197H21.348C20.1095 33.6701 18.3355 35.0169 14.6275 35.0169C9.08963 35.0169 6.88417 32.0592 6.88417 25.872V25.7121C6.88417 19.5249 9.08963 16.623 14.8952 16.623C18.3355 16.623 20.1095 17.8061 21.348 19.8523H27.8007C25.811 13.721 21.0802 10.6554 14.8952 10.6554V10.6517ZM82.651 28.5656C82.651 32.8702 84.8006 35.0206 89.1037 35.0206C93.4068 35.0206 95.5564 32.8702 95.5564 28.5656V11.2953H102.333V40.3446H95.9879V36.04C94.2138 39.1057 91.3092 40.9882 86.4705 40.9882C79.5864 40.9882 75.8784 37.2231 75.8784 29.6929V11.2953H82.6547V28.5619L82.651 28.5656ZM186.594 28.5656C186.594 32.8702 188.744 35.0206 193.047 35.0206C197.35 35.0206 199.5 32.8702 199.5 28.5656V11.2953H206.276V40.3446H199.931V36.04C198.157 39.1057 195.252 40.9882 190.414 40.9882C183.53 40.9882 179.822 37.2231 179.822 29.6929V11.2953H186.598V28.5619L186.594 28.5656ZM121.691 35.0206C127.5 35.0206 129.758 32.0629 129.758 25.8758V25.7158C129.758 19.5287 127.5 16.6788 121.691 16.6788C115.882 16.6788 113.624 19.5287 113.624 25.7158V25.8758C113.624 32.0629 115.882 35.0206 121.691 35.0206ZM136.315 0V40.3446H129.862V36.04C128.032 38.9457 125.239 40.9882 120.453 40.9882C111.311 40.9882 106.74 34.6412 106.74 26.2478C106.74 17.0508 111.311 10.7037 120.453 10.7037C124.432 10.7037 128.248 12.6421 129.538 15.2241V0H136.315ZM30.4339 40.3446H37.2102V0H30.4339V40.3446ZM56.5685 40.992C47.3189 40.992 41.5133 35.2364 41.5133 25.8237C41.5133 16.4109 47.3226 10.6554 56.5685 10.6554C65.8143 10.6554 71.6236 16.4109 71.6236 25.8237C71.6236 35.2364 65.8143 40.992 56.5685 40.992ZM48.3937 25.8758C48.3937 32.0629 50.6513 35.0206 56.5685 35.0206C62.4857 35.0206 64.7432 32.0629 64.7432 25.8758V25.7158C64.7432 19.5287 62.4857 16.6267 56.5685 16.6267C50.6513 16.6267 48.3937 19.5324 48.3937 25.7158V25.8758ZM173.201 11.299H176.43V17.754H171.591C167.288 17.754 165.837 19.7445 165.837 22.9701V40.3446H159.061V11.2432H165.514V16.623C166.804 12.91 169.386 11.299 173.205 11.299H173.201ZM147.658 40.992C150.615 40.992 152.497 39.2173 152.497 36.2037C152.497 33.1902 150.615 31.4155 147.658 31.4155C144.701 31.4155 142.82 33.1902 142.82 36.2037C142.82 39.2173 144.701 40.992 147.658 40.992Z',
    wordW: 206.276, wordH: 40.992,
  };
  // Lockup: the instance is the header logo scaled x1.64698 (435.33 / 264.32); mark and word coloured apart.
  function logo(parent, o) {
    const k = o.scale || 1;
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const markY = (48.91 - LOGO.markH) * k;            // instance 264.32 x 48.91: mark bottom-aligned
    s('path', { d: LOGO.mark, fill: o.markColor || '#222222', transform: 'translate(0 ' + r3(markY) + ') scale(' + k + ')' }, svg);
    s('path', { d: LOGO.word, fill: o.wordColor || '#222222', transform: 'translate(' + r3(58.05 * k) + ' 0) scale(' + k + ')' }, svg);
    return comp(rootEl, { x: o.x, y: o.y, op: o.op != null ? o.op : 1 }).apply();
  }

  // ───────── dot grid (Figma pattern fill: 4px white dot on a 20px tile, x0.8584, spacing 0.8 tile) ─────────
  // o: { x, y, w, h, ox (tile origin x), masks: [[x,y,w,h]…] (union clip, frame coords) }
  let uid = 0;
  function dots(parent, o) {
    const TILE = 20 * 0.8584216833114624, PITCH = TILE * 1.8, DOT = 4 * 0.8584216833114624;
    const id = 'fd' + (++uid);
    const rootEl = group(parent);
    const svg = svgRoot(rootEl);
    const defs = s('defs', {}, svg);
    const pat = s('pattern', { id: id + 'p', patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: r3(PITCH), height: r3(PITCH) }, defs);
    s('rect', { x: 0, y: 0, width: r3(DOT), height: r3(DOT), fill: '#ffffff' }, pat);
    const cp = s('clipPath', { id: id + 'c' }, defs);
    (o.masks || []).forEach(function (m) { s('rect', { x: m[0], y: m[1], width: m[2], height: m[3] }, cp); });
    const area = s('rect', { fill: 'url(#' + id + 'p)' }, svg);
    const c = comp(rootEl, { x: 0, y: 0, ax: o.x, ay: o.y, aw: o.w, ah: o.h, ox: o.ox != null ? o.ox : o.x, mask: 0 }, function (p) {
      pat.setAttribute('x', r3(p.ox)); pat.setAttribute('y', 0);
      area.setAttribute('x', r3(p.ax)); area.setAttribute('y', r3(p.ay));
      area.setAttribute('width', r3(p.aw)); area.setAttribute('height', r3(p.ah));
      if (p.mask >= 0.5) area.setAttribute('clip-path', 'url(#' + id + 'c)'); else area.removeAttribute('clip-path');
    });
    return c.apply();
  }

  // ───────── motion.js bridge ─────────
  // A(tl) → { tw(c, props, t, dur, ease), set(c, props, t), path(c, prop, keys) }. Props are [from, to].
  function A(tl) {
    const setter = function (el, st) { el.__comp.apply(st); };
    const api = {
      tw: function (c, props, t, dur, ease) { tl.fromTo(c.el, props, { at: t, dur: dur, ease: ease || 'linear', set: setter }); return api; },
      set: function (c, props, t) { const p = {}; for (const k in props) p[k] = [props[k], props[k]]; tl.fromTo(c.el, p, { at: t, dur: 0, ease: 'linear', set: setter }); return api; },
      // keys: [[t, v], [t, v, ease], …] — ease belongs to the segment that ends at that key
      path: function (c, prop, keys) {
        const first = {}; first[prop] = keys[0][1];
        api.set(c, first, keys[0][0]);
        for (let i = 1; i < keys.length; i++) {
          const p = {}; p[prop] = [keys[i - 1][1], keys[i][1]];
          const dur = keys[i][0] - keys[i - 1][0];
          if (dur <= 0) api.set(c, (function () { const q = {}; q[prop] = keys[i][1]; return q; })(), keys[i][0]);
          else api.tw(c, p, keys[i - 1][0], dur, keys[i][2] || 'linear');
        }
        return api;
      },
    };
    return api;
  }

  // Wait for every @font-face in use, then build. Verification mode (?frame=) applies one state and
  // mounts a still timeline so the renderer can capture it like any other page.
  function ready(fn) {
    const fams = ['400 20px "SB Sans Display"', '500 20px "SB Sans Display"', '600 20px "SB Sans Display"', '400 20px "SB Sans Text"', '500 20px "SB Sans Text"'];
    Promise.all(fams.map(function (f) { return document.fonts.load(f, 'ВЫБЕРИ Выбери'); })).then(function () { return document.fonts.ready; }).then(fn);
  }

  root.Fig = { FW: FW, FH: FH, METRICS: METRICS, Q: Q, RENDER: RENDER, NOCLIP: NOCLIP, stage: stage, comp: comp, group: group, text: text,
    rect: rect, hline: hline, crossBox: crossBox, logo: logo, dots: dots, A: A, ready: ready, el: h, svg: s };
})(typeof self !== 'undefined' ? self : this);
