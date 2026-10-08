// fla_extract.js — dump a page's component model, its tweens and every frame's props for the FLA converter.
//   node tools/fla_extract.js fla/extract-9x16.html fla/model-9x16.json
// The page loads fla/hook.js after fig.js / rk.js (records primitives and tweens); this script seeks every frame
// and reads each component's applied props (comp.cur) — exactly what the HTML version renders.
'use strict';
const fs = require('fs');
const T = require('./shoot.js');

async function main() {
  const [page, out] = process.argv.slice(2);
  const B = await T.launch(1000, 1000, 1);
  try {
    await T.open(B.cdp, page);
    const json = await B.cdp.eval(`(function () {
      const R = window.__FLA, C = window.__C, fps = window.__motion.fps, dur = window.__motion.duration;
      const N = Math.round(dur * fps);
      const r5 = (v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v);
      const pathOf = (root, el) => { const p = []; while (el && el !== root) { p.unshift(Array.prototype.indexOf.call(el.parentNode.children, el)); el = el.parentNode; } return el === root ? p : null; };
      const comps = Object.keys(C).map(function (id) {
        const c = C[id];
        const kind = c.__kind || (c.base && 'open' in c.base ? 'brandBox' : 'group');
        const prims = R.prims.filter(function (p) { return p.comp === c || c.el.contains(p.comp.el); }).map(function (p) {
          const d = { kind: p.kind, o: p.o, path: pathOf(c.el, p.comp.el) };
          if (p.kind === 'logo') d.paths = Array.prototype.map.call(p.comp.el.querySelectorAll('path'), function (e) {
            return { d: e.getAttribute('d'), fill: e.getAttribute('fill'), transform: e.getAttribute('transform') }; });
          if (p.kind === 'text' && p.comp.metrics) d.metrics = p.comp.metrics;
          return d;
        });
        return { id: id, kind: kind, base: c.base, prims: prims };
      });
      const frames = [];
      for (let n = 0; n < N; n++) {
        window.__motion.seek(n / fps);
        const f = {};
        for (const id in C) { const cur = C[id].cur || {}; const o = {}; for (const k in cur) o[k] = r5(cur[k]); f[id] = o; }
        frames.push(f);
      }
      return JSON.stringify({ frame: { w: window.Fig.FW, h: window.Fig.FH }, fps: fps, duration: dur, N: N, marks: window.__MARKS || null,
        layout: window.LAYOUT || null, comps: comps, tweens: R.tweens, frames: frames });
    })()`);
    fs.writeFileSync(out, json);
    const m = JSON.parse(json);
    console.log(out, (json.length / 1e6).toFixed(2) + ' MB', m.comps.length + ' comps', m.tweens.length + ' tweens', m.N + ' frames', 'marks', JSON.stringify(m.marks));
  } finally { B.close(); }
}
main().catch(function (e) { console.error(e); process.exit(1); });
