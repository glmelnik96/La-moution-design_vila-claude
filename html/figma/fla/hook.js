// hook.js — FLA export: records the component model and every tween of a page (loaded after fig.js and rk.js).
// window.__FLA = { prims: [{ kind, o, comp }], tweens: [{ t, dur, ease }] }; tools/fla_extract.js reads it.
(function () {
  'use strict';
  const REC = window.__FLA = { prims: [], tweens: [] };
  const clone = (o) => JSON.parse(JSON.stringify(o, function (k, v) {
    if (k === 'outline') return v ? { ox: v.ox, oy: v.oy } : null;       // the glyph outline itself is not needed
    return v;
  }));
  ['rect', 'text', 'logo', 'dots'].forEach(function (kind) {
    const f = Fig[kind];
    Fig[kind] = function (parent, o) {
      const c = f.apply(this, arguments);
      REC.prims.push({ kind: kind, o: clone(o || {}), comp: c });
      c.__kind = kind;
      return c;
    };
  });
  const A0 = Fig.A;
  Fig.A = function (tl) {
    const api = A0(tl), tw0 = api.tw;
    api.tw = function (c, props, t, dur, ease) {
      let e = ease || 'linear';
      if (typeof e === 'function') {
        const fn = e, n = 24;
        e = { samples: Array.from({ length: n + 1 }, function (_, i) { return fn(i / n); }) };
      }
      REC.tweens.push({ t: t, dur: dur, ease: e });
      return tw0.apply(this, arguments);
    };
    return api;
  };
})();
