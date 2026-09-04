// html/engine/demo.js — product-demo motion: the UI as an actor.
//
// Choreography primitives for animating a supplied design (a PNG or a Figma frame rebuilt as
// DOM): pointer, typing, checklists, toggles, 3D card fly-ins, whips, skeleton states, kinetic
// type, device mockups. Every timing default is measured off the reference decoded in
// reference/product-demo-motion.md. Free-mode: see that doc §5 before using on Cloud.ru work.
//
// All motion goes through the timeline (tl.fromTo / tl.set / tl.scene) so it stays seekable.
// Engine facts this relies on (motion.js stateAt): per prop, the latest tween that has started
// wins and before any started the first tween's `from` holds; custom setters are deduplicated
// per element and each receives the element's merged state.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brand.js'));
  else root.Demo = factory(root.Brand);
}(typeof self !== 'undefined' ? self : this, function (Brand) {
  'use strict';
  const D = {};
  const el = Brand.el;
  const A = Object.assign;

  // motion-best-practices §1.8: duration scales with the square root of distance.
  D.durByDistance = function (px, base, baseDist) {
    base = base || 0.45; baseDist = baseDist || 400;
    return +(base * Math.sqrt(Math.max(px, 1) / baseDist)).toFixed(3);
  };
  function parentW(elm) { const p = elm.parentElement; return (p && p.clientWidth) || 1920; }
  function parentH(elm) { const p = elm.parentElement; return (p && p.clientHeight) || 1080; }

  // ───────── words with a moving accent ─────────
  // Each word enters on its own beat in the accent colour; when the next word lands, the
  // previous one cools to body colour. opts { at:[...] | at+each, accent, last, body, gap, rise, dur }
  D.wordsAccent = function (tl, parent, words, o) {
    o = A({ at: 0, each: 0.45, accent: '#10b981', last: null, body: '#1f2328', gap: 16, rise: 14, dur: 0.36, blur: 4 }, o || {});
    const times = words.map(function (w, i) {
      if (Array.isArray(o.at)) return o.at[i] != null ? o.at[i] : o.at[o.at.length - 1] + (i - o.at.length + 1) * o.each;
      return o.at + i * o.each;
    });
    return words.map(function (w, i) {
      const s = el('span', 'dm-word', { display: 'inline-block', marginRight: i < words.length - 1 ? o.gap : 0 }, parent);
      s.textContent = w;
      const isLast = i === words.length - 1;
      const col = (isLast && o.last) ? o.last : o.accent;
      s.style.color = col;
      tl.fromTo(s, { opacity: [0, 1], y: [o.rise, 0], blur: [o.blur, 0] }, { at: times[i], dur: o.dur, ease: 'enter' });
      if (!isLast) tl.fromTo(s, { mix: [0, 1] }, { at: times[i + 1], dur: 0.25, ease: 'ui', set: Brand.colorMix(col, o.body, 'color') });
      return s;
    });
  };

  // ───────── letter blur-in ─────────
  D.letters = function (tl, elm, o) {
    o = A({ at: 0, each: 0.06, dur: 0.42, blur: 12, dx: -8 }, o || {});
    const ch = Brand.chars(elm);
    tl.fromTo(ch, { opacity: [0, 1], blur: [o.blur, 0], x: [o.dx, 0] }, { at: o.at, dur: o.dur, ease: 'enter', stagger: o.each });
    return o.at + o.dur + o.each * (ch.length - 1);
  };

  // ───────── sparkles (seeded, so every seek draws the same frame; free mode only) ─────────
  D.sparkles = function (parent, o) {
    o = A({ n: 10, color: '#10b981', seed: 7, spread: { w: 600, h: 220 }, pos: null, size: 10 }, o || {});
    const g = Brand.box(parent, 'dm-sparkles', o.pos);
    g.style.width = o.spread.w + 'px'; g.style.height = o.spread.h + 'px'; g.style.pointerEvents = 'none';
    let s = o.seed;
    const rnd = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const cells = [];
    for (let i = 0; i < o.n; i++) {
      const k = o.size * (0.5 + rnd());
      const c = el('div', 'dm-spark', { position: 'absolute', left: rnd() * o.spread.w, top: rnd() * o.spread.h, width: k, height: k, transformOrigin: '50% 50%' }, g);
      c.innerHTML = '<svg viewBox="0 0 10 10" width="100%" height="100%"><path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" fill="' + o.color + '"/></svg>';
      cells.push(c);
    }
    const api = { el: g, cells: cells };
    // pop in over ~0.55 s, drift up and fade over the next ~0.6 s — the whole life is ≈ 1.1 s,
    // which is what the reference gives its sparkles (2.6–3.3 s)
    api.play = function (tl, at) {
      tl.fromTo(cells, { opacity: [0, 1], scale: [0, 1], rotate: [-40, 0] }, { at: at, dur: 0.26, ease: 'enter', stagger: 0.03 });
      tl.fromTo(cells, { opacity: [1, 0], scale: [1, 0.4], y: [0, -14] }, { at: at + 0.55, dur: 0.4, ease: 'exit', stagger: 0.02 });
      return at + 1.1;
    };
    return api;
  };

  // ───────── typewriter with an idle caret ─────────
  // opts { at, cps, caret, caretFrom, caretTo, hz }. Returns the time typing ends.
  D.type = function (tl, elm, text, o) {
    o = A({ at: 0, cps: 36, caret: true, caretFrom: null, caretTo: null, hz: 1.2 }, o || {});
    const span = el('span', 'dm-typed', null, elm);
    const dur = +(text.length / o.cps).toFixed(3);
    tl.fromTo(elm, { n: [0, text.length] }, { at: o.at, dur: dur, ease: 'linear',
      set: function (e, st) { if ('n' in st) span.textContent = text.slice(0, Math.floor(st.n + 1e-6)); } });
    if (o.caret) {
      const caret = el('span', 'dm-caret', { display: 'inline-block', width: 2, height: '1em', background: 'currentColor', verticalAlign: '-0.12em', marginLeft: 2 }, elm);
      const t0 = o.caretFrom != null ? o.caretFrom : o.at;
      const t1 = o.caretTo != null ? o.caretTo : o.at + dur + 1.0;
      // visibility is driven ONLY by this setter (never by the engine's opacity), so the two cannot fight
      const setter = function (e, st) {
        const on = (st.show || 0) > 0.5 && Math.floor(st.blink || 0) % 2 === 0;
        e.style.visibility = on ? 'visible' : 'hidden';
      };
      tl.fromTo(caret, { show: [0, 0] }, { at: 0, dur: 0, ease: 'linear', set: setter });
      tl.fromTo(caret, { show: [1, 1] }, { at: t0, dur: 0, ease: 'linear', set: setter });
      tl.fromTo(caret, { blink: [0, (t1 - t0) * o.hz * 2] }, { at: t0, dur: t1 - t0, ease: 'linear', set: setter });
      tl.fromTo(caret, { show: [0, 0] }, { at: t1, dur: 0, ease: 'linear', set: setter });
    }
    return o.at + dur;
  };

  // ───────── pointer ─────────
  D.cursor = function (parent, o) {
    o = A({ size: 30, x: 0, y: 0 }, o || {});
    const c = el('div', 'dm-cursor', { position: 'absolute', left: 0, top: 0, width: o.size, height: o.size, pointerEvents: 'none', zIndex: 50, transformOrigin: '3px 2px' }, parent);
    c.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M3 2 L3 20 L8 15.5 L11 22 L14 20.7 L11 14.5 L18 14.5 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const api = { el: c, x: o.x, y: o.y };
    api.show = function (tl, at, x, y) {
      if (x != null) { api.x = x; api.y = y; tl.set(c, { x: x, y: y }, at); }
      tl.fromTo(c, { opacity: [0, 1] }, { at: at, dur: 0.18, ease: 'enter' });
      return at + 0.18;
    };
    api.hide = function (tl, at) { tl.fromTo(c, { opacity: [1, 0] }, { at: at, dur: 0.16, ease: 'exit' }); return at + 0.16; };
    api.moveTo = function (tl, x, y, opts) {
      opts = opts || {};
      const d = Math.hypot(x - api.x, y - api.y);
      const dur = opts.dur != null ? opts.dur : D.durByDistance(d);
      const at = opts.at != null ? opts.at : tl._t;
      tl.fromTo(c, { x: [api.x, x], y: [api.y, y] }, { at: at, dur: dur, ease: opts.ease || 'move' });
      api.x = x; api.y = y;
      return at + dur;
    };
    // click: a 60 ms dip to 86 % and a 120 ms recovery; a ripple on the target if given
    api.click = function (tl, at, target) {
      tl.fromTo(c, { scale: [1, 0.86] }, { at: at, dur: 0.06, ease: 'ui' });
      tl.fromTo(c, { scale: [0.86, 1] }, { at: at + 0.06, dur: 0.12, ease: 'enter' });
      if (target) D.ripple(tl, target, at);
      return at + 0.18;
    };
    return api;
  };
  // hover glow: a soft ring behind the target, in over 220 ms, optionally out at opts.off
  D.glow = function (tl, target, at, o) {
    o = A({ color: 'rgba(16,185,129,.45)', dur: 0.22, off: null }, o || {});
    const g = el('div', 'dm-glow', { position: 'absolute', inset: '-8px', borderRadius: 'inherit', boxShadow: '0 0 0 8px ' + o.color + ', 0 0 28px 10px ' + o.color, pointerEvents: 'none' }, target);
    tl.fromTo(g, { opacity: [0, 1] }, { at: at, dur: o.dur, ease: 'ui' });
    if (o.off != null) tl.fromTo(g, { opacity: [1, 0] }, { at: o.off, dur: 0.2, ease: 'exit' });
    return g;
  };
  // click ripple: a ring scaling 0.85 → 1.6 while fading, 420 ms
  D.ripple = function (tl, target, at, o) {
    o = A({ color: '#10b981', dur: 0.42 }, o || {});
    const r = el('div', 'dm-ripple', { position: 'absolute', inset: '-4px', borderRadius: 'inherit', border: '2px solid ' + o.color, pointerEvents: 'none', transformOrigin: '50% 50%' }, target);
    tl.set(r, { opacity: 0 }, 0);
    tl.fromTo(r, { opacity: [0.9, 0], scale: [0.85, 1.6] }, { at: at, dur: o.dur, ease: 'enter' });
    tl.set(r, { opacity: 0 }, at + o.dur);
    return r;
  };

  // ───────── panels, lists, pills, toggles ─────────
  D.expand = function (tl, elm, o) {
    o = A({ at: 0, dur: 0.45, fromH: null, toH: null, fromW: null, toW: null, dy: 0, ease: 'enter' }, o || {});
    const props = {};
    if (o.toH != null) props.height = [o.fromH, o.toH];
    if (o.toW != null) props.width = [o.fromW, o.toW];
    if (o.dy) props.y = [0, o.dy];
    tl.fromTo(elm, props, { at: o.at, dur: o.dur, ease: o.ease });
    return o.at + o.dur;
  };
  D.scroll = function (tl, elm, o) {
    o = A({ at: 0, dur: 2, dy: -200, ease: 'linear' }, o || {});
    tl.fromTo(elm, { y: [0, o.dy] }, { at: o.at, dur: o.dur, ease: o.ease });
    return o.at + o.dur;
  };
  D.pill = function (parent, text, o) {
    o = A({ bg: '#eef2ff', color: '#4f46e5', pos: null, size: 12 }, o || {});
    const p = Brand.box(parent, 'dm-pill', o.pos);
    A(p.style, { fontSize: o.size + 'px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px', background: o.bg, color: o.color, whiteSpace: 'nowrap', lineHeight: '16px' });
    p.textContent = text;
    return p;
  };
  // swap: out drops and fades in 140 ms; in rises 80 ms later over 220 ms
  D.swap = function (tl, outEl, inEl, at) {
    tl.fromTo(outEl, { opacity: [1, 0], y: [0, -8] }, { at: at, dur: 0.14, ease: 'exit' });
    tl.fromTo(inEl, { opacity: [0, 1], y: [8, 0] }, { at: at + 0.08, dur: 0.22, ease: 'enter' });
    return at + 0.3;
  };
  D.checklist = function (parent, items, o) {
    o = A({ pos: null, rowH: 36, font: 15, width: 420, color: '#1f2328', done: '#10b981', muted: '#9aa3ad' }, o || {});
    const list = Brand.box(parent, 'dm-list', o.pos);
    list.style.width = o.width + 'px';
    const rows = items.map(function (txt, i) {
      const r = el('div', 'dm-row', { position: 'relative', height: o.rowH, display: 'flex', alignItems: 'center', gap: 10, fontSize: o.font, color: o.color }, list);
      const box = el('div', 'dm-box', { width: 16, height: 16, borderRadius: 4, border: '1.5px solid #c9ced6', background: '#fff', position: 'relative', flex: '0 0 auto' }, r);
      const tick = el('div', 'dm-tick', { position: 'absolute', left: 2, top: 1, width: 10, height: 10, transformOrigin: '50% 50%' }, box);
      tick.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M1.5 5.2 L4 7.6 L8.6 2.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const num = el('span', 'dm-num', { color: o.muted, width: 20, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }, r);
      num.textContent = (i + 1) + '.';
      const label = el('span', 'dm-label', { position: 'relative', display: 'inline-block' }, r);
      label.textContent = txt;
      const strike = el('span', 'dm-strike', { position: 'absolute', left: 0, right: 0, top: '54%', height: 1.5, background: o.muted, transformOrigin: 'left center' }, label);
      return { el: r, box: box, tick: tick, label: label, strike: strike, num: num };
    });
    const api = { el: list, rows: rows };
    api.appear = function (tl, at, stagger) {
      stagger = stagger != null ? stagger : 0.07;
      tl.fromTo(rows.map(function (r) { return r.el; }), { opacity: [0, 1], y: [10, 0] }, { at: at, dur: 0.32, ease: 'enter', stagger: stagger });
      return at + 0.32 + stagger * (rows.length - 1);
    };
    // done(i, at): box turns green (160 ms), tick pops (200 ms), strikethrough draws (240 ms), label dims
    api.done = function (tl, i, at) {
      const r = rows[i];
      tl.fromTo(r.box, { mix: [0, 1] }, { at: at, dur: 0.16, ease: 'ui', set: function (e, st) {
        if (!('mix' in st)) return;
        const on = st.mix > 0.5;
        e.style.background = on ? o.done : '#fff';
        e.style.borderColor = on ? o.done : '#c9ced6';
      } });
      tl.fromTo(r.tick, { opacity: [0, 1], scale: [0.5, 1] }, { at: at + 0.04, dur: 0.2, ease: 'enter' });
      tl.fromTo(r.strike, { scaleX: [0, 1] }, { at: at + 0.10, dur: 0.24, ease: 'enter' });
      tl.fromTo(r.label, { opacity: [1, 0.45] }, { at: at + 0.10, dur: 0.24, ease: 'ui' });
      return at + 0.34;
    };
    return api;
  };
  D.toggle = function (parent, o) {
    o = A({ pos: null, w: 44, h: 24, onColor: '#10b981', offColor: '#d1d5db' }, o || {});
    const t = Brand.box(parent, 'dm-toggle', o.pos);
    A(t.style, { width: o.w + 'px', height: o.h + 'px', borderRadius: '999px', background: o.offColor });
    const knob = el('div', 'dm-knob', { position: 'absolute', left: 2, top: 2, width: o.h - 4, height: o.h - 4, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }, t);
    const api = { el: t, knob: knob };
    api.set = function (tl, on, at) {
      const dx = o.w - o.h;
      tl.fromTo(knob, { x: on ? [0, dx] : [dx, 0] }, { at: at, dur: 0.2, ease: 'ui' });
      tl.fromTo(t, { mix: on ? [0, 1] : [1, 0] }, { at: at, dur: 0.2, ease: 'ui', set: Brand.colorMix(o.offColor, o.onColor, 'background') });
      return at + 0.2;
    };
    return api;
  };

  // ───────── 3D card fly-in, whip, skeleton ─────────
  // Measured: 16 frames, tilt flattening on the same ease as the travel, blur gone at rest.
  D.card3d = function (tl, elm, o) {
    o = A({ at: 0, dur: 0.66, from: 'right', ry: -28, rx: 8, z: -520, dx: 0.35, dy: 0.3, blur: 8, ease: 'enter' }, o || {});
    const sx = (o.from === 'right' ? 1 : o.from === 'left' ? -1 : 0) * o.dx * parentW(elm);
    const sy = (o.from === 'bottom' ? 1 : o.from === 'top' ? -1 : 0) * o.dy * parentH(elm);
    const props = { opacity: [0, 1], x: [sx, 0], y: [sy, 0], rotateY: [o.ry, 0], rotateX: [o.rx, 0], z: [o.z, 0] };
    if (o.blur) props.blur = [o.blur, 0];
    tl.fromTo(elm, props, { at: o.at, dur: o.dur, ease: o.ease });
    return o.at + o.dur;
  };
  // Measured: 6 frames, ease-in, velocity blur; the cut belongs INSIDE the whip.
  D.whip = function (tl, elm, o) {
    o = A({ at: 0, dur: 0.25, dir: 'left', blur: 1 }, o || {});
    const tx = (o.dir === 'left' ? -1 : 1) * 1.3 * parentW(elm);
    tl.fromTo(elm, { x: [0, tx] }, { at: o.at, dur: o.dur, ease: 'exit', mblur: o.blur });
    tl.set(elm, { opacity: 0 }, o.at + o.dur);
    return o.at + o.dur;
  };
  D.skeleton = function (tl, elm, o) {
    o = A({ at: 0, dur: 0.5, blur: 6, dim: 0.55 }, o || {});
    tl.fromTo(elm, { blur: [0, o.blur], opacity: [1, o.dim] }, { at: o.at, dur: 0.16, ease: 'ui' });
    tl.fromTo(elm, { blur: [o.blur, 0], opacity: [o.dim, 1] }, { at: o.at + o.dur, dur: 0.24, ease: 'enter' });
    return o.at + o.dur + 0.24;
  };

  // ───────── kinetic type on hard cuts ─────────
  // Unequal durations are the point: pass rhythm:[...] and put the longest on the payoff word.
  D.kinetic = function (tl, parent, words, o) {
    o = A({ at: 0, each: 0.55, rhythm: null, cls: '', style: {} }, o || {});
    let t = o.at;
    const out = words.map(function (w, i) {
      const d = (o.rhythm && o.rhythm[i] != null) ? o.rhythm[i] : o.each;
      const e = el('div', 'dm-kinetic ' + o.cls, A({ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', textAlign: 'center' }, o.style), parent);
      e.textContent = w;
      tl.scene('kinetic:' + i + ':' + w, t, t + d, e);
      t += d;
      return e;
    });
    out.end = t;
    return out;
  };

  // ───────── device mockup + dolly ─────────
  D.device = function (parent, o) {
    o = A({ pos: null, w: 1100, h: 640, bezel: 22, stand: true }, o || {});
    const wrap = Brand.box(parent, 'dm-device', o.pos);
    wrap.style.width = o.w + 'px'; wrap.style.height = (o.h + (o.stand ? 180 : 0)) + 'px'; wrap.style.transformOrigin = '50% 40%';
    const body = el('div', 'dm-monitor', { position: 'absolute', left: 0, top: 0, width: o.w, height: o.h, background: '#0f0f10', borderRadius: 14, boxShadow: '0 30px 80px rgba(0,0,0,.35)' }, wrap);
    const screen = el('div', 'dm-screen', { position: 'absolute', left: o.bezel, top: o.bezel, width: o.w - 2 * o.bezel, height: o.h - 2 * o.bezel, background: '#fff', overflow: 'hidden', borderRadius: 4 }, body);
    if (o.stand) {
      el('div', 'dm-neck', { position: 'absolute', left: o.w / 2 - 60, top: o.h, width: 120, height: 100, background: 'linear-gradient(#d5d8dc,#aeb3b9)' }, wrap);
      el('div', 'dm-foot', { position: 'absolute', left: o.w / 2 - 200, top: o.h + 96, width: 400, height: 24, borderRadius: 8, background: '#b8bcc2' }, wrap);
    }
    return { el: wrap, screen: screen };
  };
  D.dolly = function (tl, elm, o) {
    o = A({ at: 0, dur: 2.0, from: 1.06, to: 1.0, dy: 0 }, o || {});
    tl.fromTo(elm, { scale: [o.from, o.to], y: [o.dy, 0] }, { at: o.at, dur: o.dur, ease: 'linear' });
    return o.at + o.dur;
  };

  return D;
}));
