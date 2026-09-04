// cloudru-motion.jsx — ES3 motion library for live After Effects work in the Cloud.ru brand.
//
// Prepended by `node scripts/ae.js --lib '@file.jsx'` AFTER es-json.jsx and tokens.jsx, so
// `JSON`, `CR` (tokens) and `M` (this) are available to the payload. Everything here is
// ES3: no let/const/arrows/template strings, no Array.prototype.map/forEach/indexOf,
// no trailing commas, no reserved words as object keys (quirk #21).
//
// Design rules baked in (see reference/ae-quirks.md for the numbers):
//   - every layer this lib creates gets `comment = M.TAG` so M.clean() can rebuild idempotently
//   - inPoint is always set before outPoint (#14)
//   - Position keys are spatially flattened (#30); temporal ease uses the EXACT bezier
//     mapping (motion-design-principles.md §2b) with adaptive arity (#12, #18)
//   - patterns are ONE seed cell + Repeaters, never N×M shapes (#17)
//   - capture restores resolutionFactor (#34) and warns that PNG writes are async (#27, #40)
//   - M.run() carries a STEP marker so an uncaught throw still reports where it died (#16)
//
// Anything marked VERIFY has not yet been exercised against a live AE from this repo —
// run reference/live-verify-checklist.md on the local machine and update this comment.

var M = {};
M.VERSION = "1.0.0";
M.TAG = "CR_FX";
M.comp = null;
M.FPS = 25;
M.FD = 1 / 25;
M.SCALE = 1;          // format scale relative to 1080p (CR.FORMAT[key].scale)
M.W = 1920;
M.H = 1080;
M.warnings = [];
M.STEP = "init";

// ───────────────────────────── ES3 shims ─────────────────────────────
if (typeof JSON !== "undefined" && typeof JSON.parse !== "function") {
  JSON.parse = function (s) { return eval("(" + s + ")"); };
}
M.indexOf = function (arr, v) { for (var i = 0; i < arr.length; i++) { if (arr[i] === v) return i; } return -1; };
M.each = function (arr, fn) { for (var i = 0; i < arr.length; i++) { fn(arr[i], i); } };
M.map = function (arr, fn) { var o = []; for (var i = 0; i < arr.length; i++) { o.push(fn(arr[i], i)); } return o; };
M.isArray = function (v) { return v instanceof Array || Object.prototype.toString.call(v) === "[object Array]"; };
M.merge = function (a, b) { var o = {}, k; for (k in a) { if (a.hasOwnProperty(k)) o[k] = a[k]; } if (b) { for (k in b) { if (b.hasOwnProperty(k)) o[k] = b[k]; } } return o; };
M.warn = function (msg) { M.warnings.push(msg); };
M.step = function (s) { M.STEP = s; return s; };

// ───────────────────────────── time ─────────────────────────────
// All choreography APIs take MILLISECONDS (brand tokens are ms) and snap to whole frames.
M.frames = function (ms) { return Math.round(ms / 1000 * M.FPS); };
M.f = function (ms) { return M.frames(ms) * M.FD; };          // ms  -> seconds on a frame
M.fr = function (frames) { return frames * M.FD; };            // frames -> seconds
M.px = function (v) { return Math.round(v * M.SCALE / 2) * 2; }; // 1080p px -> this format, kept on the 2px module

// ───────────────────────────── comp ─────────────────────────────
M.use = function (comp) {
  if (!(comp instanceof CompItem)) throw new Error("M.use: not a CompItem");
  M.comp = comp;
  M.FPS = comp.frameRate;
  M.FD = 1 / comp.frameRate;
  M.W = comp.width;
  M.H = comp.height;
  M.SCALE = comp.height / 1080;
  return comp;
};
M.active = function () {
  var c = app.project.activeItem;
  if (!(c instanceof CompItem)) throw new Error("no active comp — ask the user to select one");
  return M.use(c);
};
// Find a comp by name or create it from a CR.FORMAT key / {w,h,fps,dur} object.
M.ensureComp = function (name, fmt, durSec) {
  var i, it;
  for (i = 1; i <= app.project.numItems; i++) {
    it = app.project.item(i);
    if (it instanceof CompItem && it.name === name) return M.use(it);
  }
  var F = (typeof fmt === "string") ? CR.FORMAT[fmt] : (fmt || CR.FORMAT["1080p"]);
  var c = app.project.items.addComp(name, F.w, F.h, 1, durSec || 10, F.fps);
  return M.use(c);
};
M.clean = function (tag) {
  tag = tag || M.TAG;
  var n = 0;
  for (var i = M.comp.numLayers; i >= 1; i--) {
    if (M.comp.layer(i).comment === tag) { M.comp.layer(i).remove(); n++; }
  }
  return n;
};
M.keep = function (L) { L.comment = M.TAG; return L; };
M.layerByName = function (name) {
  for (var i = 1; i <= M.comp.numLayers; i++) { if (M.comp.layer(i).name === name) return M.comp.layer(i); }
  return null;
};

// ───────────────────────────── property access ─────────────────────────────
M.P = function (L) { return L.property("ADBE Transform Group"); };
M.pos = function (L) { return M.P(L).property("ADBE Position"); };
M.scale = function (L) { return M.P(L).property("ADBE Scale"); };
M.opacity = function (L) { return M.P(L).property("ADBE Opacity"); };
M.anchor = function (L) { return M.P(L).property("ADBE Anchor Point"); };
M.rot = function (L) { return M.P(L).property("ADBE Rotate Z"); };
M.fx = function (L) { return L.property("ADBE Effect Parade"); };
M.contents = function (L) { return L.property("ADBE Root Vectors Group"); };
M.masks = function (L) { return L.property("ADBE Mask Parade"); };
M.srcText = function (L) { return L.property("ADBE Text Properties").property("ADBE Text Document"); };
// property by matchName with a display-name fallback (localized AE)
M.prop = function (group, matchName, displayName) {
  var p = null;
  try { p = group.property(matchName); } catch (e0) { p = null; }
  if (!p && displayName) { try { p = group.property(displayName); } catch (e1) { p = null; } }
  return p;
};

// ───────────────────────────── colour ─────────────────────────────
M.rgb = function (hex) {
  var h = String(hex).replace("#", "");
  var n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
M.col = function (c) { return (typeof c === "string") ? M.rgb(c) : c; };

// ───────────────────────────── layers: solids / text / shapes ─────────────────────────────
M.solid = function (name, color, w, h) {
  var L = M.comp.layers.addSolid(M.col(color), name, w || M.W, h || M.H, 1, M.comp.duration);
  return M.keep(L);
};

// Text layer with the font sequence from quirk #9. opts:
//   size (px, already scaled), font (PostScript), color, tracking (AE units), leading (px|null),
//   x, y (baseline origin in comp px), justify 'left'|'center'|'right', box [w,h] for paragraph text
M.text = function (name, str, opts) {
  var o = M.merge({ size: CR.TYPE.BODY, font: CR.FONT.REGULAR, color: CR.COLOR.BLACK, tracking: 0,
                    leading: null, x: 0, y: 0, justify: "left", box: null }, opts);
  var L = o.box ? M.comp.layers.addBoxText([o.box[0], o.box[1]], str) : M.comp.layers.addText(str);
  L.name = name;
  var st = M.srcText(L);
  var doc = st.value;
  doc.text = str;
  st.setValue(doc);
  var live = st.value;                    // quirk #9: mutate the LIVE doc, then save again
  live.fontSize = o.size;
  live.font = o.font;
  live.fillColor = M.col(o.color);
  live.applyFill = true;
  live.applyStroke = false;
  live.tracking = o.tracking;
  try {
    live.justification = (o.justify === "center") ? ParagraphJustification.CENTER_JUSTIFY :
                         (o.justify === "right") ? ParagraphJustification.RIGHT_JUSTIFY :
                         ParagraphJustification.LEFT_JUSTIFY;
  } catch (e0) { M.warn("justification not settable: " + e0); }
  if (o.leading !== null) {
    try { live.autoLeading = false; live.leading = o.leading; } catch (e1) { M.warn("leading not settable: " + e1); }
  }
  st.setValue(live);
  var got = st.value.font;
  if (got !== o.font) M.warn("font fallback on '" + name + "': wanted " + o.font + ", got " + got);
  L.__font = got;
  M.pos(L).setValue([o.x, o.y]);
  return M.keep(L);
};

// Shape layer with anchor == position == [0,0]: layer coordinates ARE comp coordinates.
M.shape = function (name) {
  var S = M.comp.layers.addShape();
  S.name = name;
  M.anchor(S).setValue([0, 0]);
  M.pos(S).setValue([0, 0]);
  return M.keep(S);
};
M.group = function (S, name) {
  var g = M.contents(S).addProperty("ADBE Vector Group");
  g.name = name;
  return g;                                   // NOTE: returns the GROUP; use M.inner(g) for its contents
};
M.inner = function (g) { return g.property("ADBE Vectors Group"); };
M.gTransform = function (g) { return g.property("ADBE Vector Transform Group"); };
// Re-resolve a group by name after addProperty() calls (quirk #3).
M.groupByName = function (S, name) {
  var root = M.contents(S);
  for (var i = 1; i <= root.numProperties; i++) { if (root.property(i).name === name) return root.property(i); }
  return null;
};
M.fill = function (inner, color) {
  var f = inner.addProperty("ADBE Vector Graphic - Fill");
  f.property("ADBE Vector Fill Color").setValue(M.col(color));
  return f;
};
// Stroke with SQUARE caps and MITER joins (brand look & feel). Line Cap enum: 1 butt, 2 round,
// 3 projecting/square; Line Join: 1 miter, 2 round, 3 bevel.  <!-- VERIFY enum values live -->
M.stroke = function (inner, color, width, cap) {
  var s = inner.addProperty("ADBE Vector Graphic - Stroke");
  s.property("ADBE Vector Stroke Color").setValue(M.col(color));
  s.property("ADBE Vector Stroke Width").setValue(width);
  try { s.property("ADBE Vector Stroke Line Cap").setValue(cap === "butt" ? 1 : 3); } catch (e0) { M.warn("line cap: " + e0); }
  try { s.property("ADBE Vector Stroke Line Join").setValue(1); } catch (e1) { M.warn("line join: " + e1); }
  return s;
};
// Rectangle inside a group's contents. (x,y) = TOP-LEFT in comp px. Roundness forced to 0.
M.rectIn = function (inner, x, y, w, h) {
  var r = inner.addProperty("ADBE Vector Shape - Rect");
  r.property("ADBE Vector Rect Size").setValue([w, h]);
  r.property("ADBE Vector Rect Position").setValue([x + w / 2, y + h / 2]);
  try { r.property("ADBE Vector Rect Roundness").setValue(0); } catch (e0) {}
  return r;
};
M.pathIn = function (inner, pts, closed) {
  var p = inner.addProperty("ADBE Vector Shape - Group");
  var sh = new Shape();
  sh.vertices = pts;
  sh.closed = !!closed;
  p.property("ADBE Vector Shape").setValue(sh);
  return p;
};
// Standalone filled rectangle layer. Returns the layer; its single group is named "rect".
M.rect = function (name, x, y, w, h, color) {
  var S = M.shape(name);
  var g = M.group(S, "rect");
  M.rectIn(M.inner(g), x, y, w, h);
  M.fill(M.inner(M.groupByName(S, "rect")), color);
  S.__box = [x, y, w, h];
  return S;
};
// A rule/bar built at FINAL size (quirk #28), anchored on its LEFT-centre so Scale X grows it
// from the left. Same trick with anchor='right'|'top'|'bottom'.
M.rule = function (name, x, y, w, h, color, anchor) {
  var S = M.rect(name, x, y, w, h, color);
  var ax = x, ay = y + h / 2;
  if (anchor === "right") { ax = x + w; }
  else if (anchor === "top") { ax = x + w / 2; ay = y; }
  else if (anchor === "bottom") { ax = x + w / 2; ay = y + h; }
  else if (anchor === "center") { ax = x + w / 2; }
  M.anchor(S).setValue([ax, ay]);
  M.pos(S).setValue([ax, ay]);           // anchor == position keeps layer space == comp space
  S.__anchorMode = anchor || "left";
  return S;
};
// Straight line (square caps) as its own layer.
M.line = function (name, a, b, weight, color) {
  var S = M.shape(name);
  var g = M.group(S, "line");
  M.pathIn(M.inner(g), [a, b], false);
  M.stroke(M.inner(M.groupByName(S, "line")), color, weight);
  return S;
};

// ───────────────────────────── brand patterns (repeater-based, quirk #17) ─────────────────────────────
// Dots: seed square + 2 repeaters. opts {x,y,cols,rows,size,gap,color}
M.dots = function (name, opts) {
  var o = M.merge({ x: 0, y: 0, cols: 20, rows: 6, size: 4, gap: 16, color: CR.COLOR.GREEN }, opts);
  var S = M.shape(name);
  var g = M.group(S, "dots");
  var c = M.inner(g);
  M.rectIn(c, o.x, o.y, o.size, o.size);
  M.fill(c, o.color);
  var step = o.size + o.gap;
  var r1 = c.addProperty("ADBE Vector Filter - Repeater");
  r1.property("ADBE Vector Repeater Copies").setValue(o.cols);
  r1.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([step, 0]);
  var r2 = c.addProperty("ADBE Vector Filter - Repeater");
  r2.property("ADBE Vector Repeater Copies").setValue(o.rows);
  r2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, step]);
  S.__box = [o.x, o.y, o.cols * step - o.gap, o.rows * step - o.gap];
  S.__rows = o.rows; S.__cols = o.cols;
  return S;
};
// Square grid of hairlines. opts {x,y,cols,rows,cell,weight,color}
M.grid = function (name, opts) {
  var o = M.merge({ x: 0, y: 0, cols: 12, rows: 6, cell: 80, weight: 2, color: CR.COLOR.GRAY }, opts);
  var S = M.shape(name);
  var w = o.cols * o.cell, h = o.rows * o.cell;
  var gv = M.group(S, "vertical");
  var cv = M.inner(gv);
  M.rectIn(cv, o.x, o.y, o.weight, h);
  M.fill(cv, o.color);
  var rv = cv.addProperty("ADBE Vector Filter - Repeater");
  rv.property("ADBE Vector Repeater Copies").setValue(o.cols + 1);
  rv.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([o.cell, 0]);
  var gh = M.group(S, "horizontal");
  var ch = M.inner(gh);
  M.rectIn(ch, o.x, o.y, w + o.weight, o.weight);
  M.fill(ch, o.color);
  var rh = ch.addProperty("ADBE Vector Filter - Repeater");
  rh.property("ADBE Vector Repeater Copies").setValue(o.rows + 1);
  rh.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, o.cell]);
  S.__box = [o.x, o.y, w, h];
  return S;
};
// LLLL (\u041b\u041b\u041b\u041b) arrow pattern: per cell a horizontal stroke along the top-right and a vertical stroke
// down the right edge (the brand's L-arrow), repeated `cells` times. opts {x,y,cells,cell,weight,color,rows}
M.llll = function (name, opts) {
  var o = M.merge({ x: 0, y: 0, cells: 4, rows: 1, cell: 120, gap: 12, weight: 2, color: CR.COLOR.GREEN }, opts);
  var S = M.shape(name);
  var g = M.group(S, "llll");
  var c = M.inner(g);
  var x0 = o.x, y0 = o.y, s = o.cell;
  M.pathIn(c, [[x0 + s * 0.4, y0], [x0 + s, y0]], false);            // top arm
  M.pathIn(c, [[x0 + s, y0], [x0 + s, y0 + s * 0.7]], false);        // right arm
  M.stroke(c, o.color, o.weight);
  var r1 = c.addProperty("ADBE Vector Filter - Repeater");
  r1.property("ADBE Vector Repeater Copies").setValue(o.cells);
  r1.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([s + o.gap, 0]);
  if (o.rows > 1) {
    var r2 = c.addProperty("ADBE Vector Filter - Repeater");
    r2.property("ADBE Vector Repeater Copies").setValue(o.rows);
    r2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, s + o.gap]);
  }
  S.__box = [o.x, o.y, o.cells * (s + o.gap) - o.gap, o.rows * (s + o.gap) - o.gap];
  return S;
};
// Portal: N rectangles, each shifted by (dx,dy) — the brand's "repetition with an offset".
// Each step is its own group ("step0".."stepN-1") so it can be animated independently.
// opts {x,y,w,h,steps,dx,dy,color}
M.portal = function (name, opts) {
  var o = M.merge({ x: 0, y: 0, w: 480, h: 320, steps: CR.GEO.PORTAL_STEPS_DEFAULT, dx: 40, dy: 40, color: CR.COLOR.GREEN }, opts);
  var S = M.shape(name);
  for (var i = 0; i < o.steps; i++) {
    var g = M.group(S, "step" + i);
    var c = M.inner(g);
    M.rectIn(c, o.x + i * o.dx, o.y + i * o.dy, o.w, o.h);
    M.fill(c, o.color);
  }
  S.__box = [o.x, o.y, o.w + (o.steps - 1) * o.dx, o.h + (o.steps - 1) * o.dy];
  S.__steps = o.steps;
  return S;
};
// Bracket frame: four strokes (top may be "cut" — a gap in the middle like the template's frame).
// opts {x,y,w,h,weight,color,cut:[fromFrac,toFrac]|null}
M.bracket = function (name, opts) {
  var o = M.merge({ x: 80, y: 80, w: 1760, h: 920, weight: 2, color: CR.COLOR.BLACK, cut: [0.3, 0.4] }, opts);
  var S = M.shape(name);
  var g = M.group(S, "frame");
  var c = M.inner(g);
  var x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (o.cut) {
    M.pathIn(c, [[x0, y0], [x0 + o.w * o.cut[0], y0]], false);
    M.pathIn(c, [[x0 + o.w * o.cut[1], y0], [x1, y0]], false);
  } else {
    M.pathIn(c, [[x0, y0], [x1, y0]], false);
  }
  M.pathIn(c, [[x1, y0], [x1, y1]], false);
  M.pathIn(c, [[x1, y1], [x0, y1]], false);
  M.pathIn(c, [[x0, y1], [x0, y0]], false);
  M.stroke(c, o.color, o.weight);
  S.__box = [o.x, o.y, o.w, o.h];
  return S;
};

// ───────────────────────────── keys & easing ─────────────────────────────
M.key = function (prop, tSec, v) {
  prop.setValueAtTime(tSec, v);
  return prop.nearestKeyIndex(tSec);
};
M.holdAll = function (prop) {
  for (var k = 1; k <= prop.numKeys; k++) {
    prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
  }
};
M.isSpatial = function (prop) {
  try {
    return prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
           prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL;
  } catch (e0) { return false; }
};
// Zero the spatial tangents so the path is straight and the arrival exact (quirk #30).
M.flatten = function (prop) {
  if (!M.isSpatial(prop)) return;
  for (var k = 1; k <= prop.numKeys; k++) {
    try { prop.setSpatialAutoBezierAtKey(k, false); } catch (e0) {}
    try { prop.setSpatialTangentsAtKey(k, [0, 0, 0], [0, 0, 0]); } catch (e1) {}
  }
};
M.easeOf = function (nameOrBez) {
  if (M.isArray(nameOrBez)) return nameOrBez;
  var key = String(nameOrBez).toUpperCase();
  if (!CR.EASE[key]) throw new Error("unknown ease token: " + nameOrBez);
  return CR.EASE[key];
};
M._len = function (v) { var s = 0; for (var i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); };
M._sub = function (a, b) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] - b[i]); return o; };
M._clampInf = function (x) { return Math.max(0.1, Math.min(100, x)); };
// Exact cubic-bezier -> KeyframeEase for the pair (k, k+1). See motion-design-principles.md §2b.
M.bezierEase = function (prop, k, bez) {
  bez = M.easeOf(bez);
  var x1 = bez[0], y1 = bez[1], x2 = bez[2], y2 = bez[3];
  var t0 = prop.keyTime(k), t1 = prop.keyTime(k + 1);
  var dt = t1 - t0;
  if (dt <= 0) throw new Error("bezierEase: keys " + k + "/" + (k + 1) + " not in order");
  var v0 = prop.keyValue(k), v1 = prop.keyValue(k + 1);
  var spatial = M.isSpatial(prop);
  var dims = [];                                             // signed Δv per ease slot
  if (M.isArray(v0)) {
    if (spatial) { dims = [M._len(M._sub(v1, v0))]; }
    else { dims = M._sub(v1, v0); }
  } else { dims = [v1 - v0]; }
  var infOut = M._clampInf(x1 * 100), infIn = M._clampInf((1 - x2) * 100);
  var outE = [], inE = [];
  for (var d = 0; d < dims.length; d++) {
    var vel = dims[d] / dt;
    var so = (x1 <= 0.001) ? 0 : (y1 / x1) * vel;
    var si = (x2 >= 0.999) ? 0 : ((1 - y2) / (1 - x2)) * vel;
    outE.push(new KeyframeEase(so, infOut));
    inE.push(new KeyframeEase(si, infIn));
  }
  prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
  prop.setInterpolationTypeAtKey(k + 1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
  M._setEase(prop, k, prop.keyInTemporalEase(k), outE);
  M._setEase(prop, k + 1, inE, prop.keyOutTemporalEase(k + 1));
};
// setTemporalEaseAtKey with adaptive arity (quirk #12 / #18): try the given arrays, then 1, 2, 3.
M._setEase = function (prop, k, inArr, outArr) {
  var tries = [inArr.length, 1, 2, 3];
  var lastErr = null;
  for (var a = 0; a < tries.length; a++) {
    var n = tries[a], ia = [], oa = [];
    for (var i = 0; i < n; i++) { ia.push(inArr[Math.min(i, inArr.length - 1)]); oa.push(outArr[Math.min(i, outArr.length - 1)]); }
    try { prop.setTemporalEaseAtKey(k, ia, oa); return; } catch (e0) { lastErr = e0; }
  }
  throw lastErr;
};
// Two keys + exact ease + flattened path. Times in ms (snapped). Returns the first key index.
M.tween = function (prop, ms0, ms1, v0, v1, ease) {
  var t0 = M.f(ms0), t1 = M.f(ms1);
  if (t1 <= t0) t1 = t0 + M.FD;
  prop.setValueAtTime(t0, v0);
  prop.setValueAtTime(t1, v1);
  var k = prop.nearestKeyIndex(t0);
  M.bezierEase(prop, k, ease || "enter");
  M.flatten(prop);
  return k;
};
// A HOLD key (state change without interpolation).
M.at = function (prop, ms, v) {
  var t = M.f(ms);
  prop.setValueAtTime(t, v);
  var k = prop.nearestKeyIndex(t);
  prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
  return k;
};

// ───────────────────────────── choreography ─────────────────────────────
// Every helper: (layer, startMs, opts). Durations default to brand tokens.
M.fadeIn = function (L, ms0, opts) {
  var o = M.merge({ dur: CR.MS.BASE, ease: "enter", from: 0, to: 100 }, opts);
  M.tween(M.opacity(L), ms0, ms0 + o.dur, o.from, o.to, o.ease);
  return L;
};
M.fadeOut = function (L, ms0, opts) {
  var o = M.merge({ dur: Math.round(CR.MS.BASE * CR.MS.EXIT_RATIO), ease: "exit" }, opts);
  M.tween(M.opacity(L), ms0, ms0 + o.dur, 100, 0, o.ease);
  return L;
};
// Arrive along one axis: the layer's CURRENT position is the landing spot.
M.slideIn = function (L, ms0, opts) {
  var o = M.merge({ dx: 0, dy: M.px(CR.TRAVEL.SLIDE), dur: CR.MS.BASE, ease: "enter", fade: true }, opts);
  var p = M.pos(L);
  var land = p.value;
  var from = [land[0] - o.dx, land[1] - o.dy];
  if (land.length === 3) from.push(land[2]);
  M.tween(p, ms0, ms0 + o.dur, from, land, o.ease);
  if (o.fade) M.fadeIn(L, ms0, { dur: Math.round(o.dur * 0.7), ease: o.ease });
  return L;
};
// Leave along one axis (exit ease, 70% of the enter duration by default).
M.slideOut = function (L, ms0, opts) {
  var o = M.merge({ dx: 0, dy: M.px(CR.TRAVEL.SLIDE), dur: Math.round(CR.MS.BASE * CR.MS.EXIT_RATIO), ease: "exit", fade: true }, opts);
  var p = M.pos(L);
  var here = p.valueAtTime(M.f(ms0), false);
  var to = [here[0] + o.dx, here[1] + o.dy];
  if (here.length === 3) to.push(here[2]);
  M.tween(p, ms0, ms0 + o.dur, here, to, o.ease);
  if (o.fade) M.fadeOut(L, ms0 + Math.round(o.dur * 0.3), { dur: Math.round(o.dur * 0.7), ease: o.ease });
  return L;
};
// Layer visible only inside [ms0, ms1] (quirk #14: inPoint FIRST).
M.window = function (L, ms0, ms1) {
  L.inPoint = M.f(ms0);
  L.outPoint = M.f(ms1);
  return L;
};
M.fadeInOut = function (L, ms0, ms1, fadeMs) {
  fadeMs = fadeMs || CR.MS.FAST;
  var op = M.opacity(L);
  M.tween(op, ms0, ms0 + fadeMs, 0, 100, "enter");
  M.tween(op, ms1 - fadeMs, ms1, 100, 0, "exit");
  return L;
};
// Stagger: fn(layer, startMs, i) for each layer, offset by eachMs. from: 'start'|'end'|'center'.
M.stagger = function (layers, ms0, eachMs, fn, from) {
  var n = layers.length;
  for (var i = 0; i < n; i++) {
    var order = i;
    if (from === "end") order = n - 1 - i;
    else if (from === "center") order = Math.abs(i - (n - 1) / 2);
    fn(layers[i], ms0 + Math.round(order * eachMs), i);
  }
  return layers;
};

// Rectangular mask in LAYER space. Returns the mask property group.
M.maskRect = function (L, x, y, w, h) {
  var m = M.masks(L).addProperty("ADBE Mask Atom");
  m.maskMode = MaskMode.ADD;
  var sh = new Shape();
  sh.vertices = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  sh.closed = true;
  m.property("ADBE Mask Shape").setValue(sh);
  return m;
};
// Line-mask reveal for a TEXT layer: glyphs rise from below the line box behind a static mask.
// mode 'animator' (default): a Text Animator Position moves the glyphs inside the layer, so the
// layer's own mask stays put. <!-- VERIFY: animator + selector creation via addProperty -->
// mode 'matte': a solid alpha-matte sized to the box (setTrackMatte, AE 23+; falls back to
// trackMatteType on older builds). Use for non-text layers or if the animator path misbehaves.
M.lineReveal = function (L, ms0, opts) {
  var o = M.merge({ dur: CR.MS.SLOW, ease: "enter", pad: 8, mode: "animator", dir: "up" }, opts);
  var t = M.f(ms0);
  var r = L.sourceRectAtTime(Math.max(t, L.inPoint) + M.FD * 0.5, false);
  var travel = r.height + o.pad;
  var from = (o.dir === "down") ? [0, -travel] : [0, travel];
  if (o.mode === "matte") {
    var box = M.solid(L.name + " matte", CR.COLOR.WHITE, 10, 10);
    box.enabled = true;
    M.anchor(box).setValue([0, 0]);
    box.parent = L;
    M.pos(box).setValue([r.left - o.pad, r.top - o.pad]);
    M.scale(box).setValue([(r.width + o.pad * 2) * 10, (r.height + o.pad * 2) * 10]);   // 10px solid × N ×10%
    box.moveBefore(L);
    try { L.setTrackMatte(box, TrackMatteType.ALPHA); }
    catch (e0) { try { L.trackMatteType = TrackMatteType.ALPHA; } catch (e1) { M.warn("track matte: " + e1); } }
    var p = M.pos(L);
    var land = p.value;
    // the matte is parented to the text, so move the matte inversely: simpler — animate the text's
    // ANCHOR would move the matte too. Instead un-parent and pin the matte in comp space:
    box.parent = null;
    var lp = [land[0] + r.left - o.pad, land[1] + r.top - o.pad];
    M.pos(box).setValue(lp);
    var start = [land[0] + from[0], land[1] + from[1]];
    if (land.length === 3) start.push(land[2]);
    M.tween(p, ms0, ms0 + o.dur, start, land, o.ease);
    return L;
  }
  M.maskRect(L, r.left - o.pad * 4, r.top - o.pad, r.width + o.pad * 8, r.height + o.pad * 2);
  var anims = L.property("ADBE Text Properties").property("ADBE Text Animators");
  var anim = anims.addProperty("ADBE Text Animator");
  anim.name = "line reveal";
  var sels = anim.property("ADBE Text Selectors");
  if (sels.numProperties === 0) { try { sels.addProperty("ADBE Text Selector"); } catch (e2) { M.warn("range selector: " + e2); } }
  var props = anim.property("ADBE Text Animator Properties");
  var ap = props.addProperty("ADBE Text Position 3D");
  M.tween(ap, ms0, ms0 + o.dur, [from[0], from[1], 0], [0, 0, 0], o.ease);
  return L;
};
// Reveal any layer through an animated rectangular mask (layer stays put). dir: right|left|down|up
M.wipe = function (L, ms0, opts) {
  var o = M.merge({ dur: CR.MS.WIPE, ease: "wipe", dir: "right", pad: 4, out: false }, opts);
  var t = M.f(ms0);
  var r = L.sourceRectAtTime(Math.max(t, L.inPoint) + M.FD * 0.5, false);
  var x = r.left - o.pad, y = r.top - o.pad, w = r.width + o.pad * 2, h = r.height + o.pad * 2;
  var m = M.maskRect(L, x, y, w, h);
  var sp = m.property("ADBE Mask Shape");
  function rectShape(x0, y0, x1, y1) {
    var s = new Shape(); s.vertices = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; s.closed = true; return s;
  }
  var full = rectShape(x, y, x + w, y + h), empty;
  if (o.dir === "right") empty = rectShape(x, y, x, y + h);
  else if (o.dir === "left") empty = rectShape(x + w, y, x + w, y + h);
  else if (o.dir === "down") empty = rectShape(x, y, x + w, y);
  else empty = rectShape(x, y + h, x + w, y + h);
  var t0 = M.f(ms0), t1 = M.f(ms0 + o.dur);
  sp.setValueAtTime(t0, o.out ? full : empty);
  sp.setValueAtTime(t1, o.out ? empty : full);
  var k = sp.nearestKeyIndex(t0);
  // mask shapes are not numeric: ease by influence only (no speed term)
  var bez = M.easeOf(o.ease);
  try {
    sp.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    sp.setInterpolationTypeAtKey(k + 1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    sp.setTemporalEaseAtKey(k, [new KeyframeEase(0, 0.1)], [new KeyframeEase(0, M._clampInf(bez[0] * 100))]);
    sp.setTemporalEaseAtKey(k + 1, [new KeyframeEase(0, M._clampInf((1 - bez[2]) * 100))], [new KeyframeEase(0, 0.1)]);
  } catch (e0) { M.warn("mask ease: " + e0); }
  return L;
};
// Full-frame colour plate sweeping across the frame. opts {color, dir, dur, hold, out, name}
// Returns the plate layer. Motion blur ON for this one (shutter is a comp setting — set ≤ 90°).
M.blockWipe = function (ms0, opts) {
  var o = M.merge({ color: CR.COLOR.GREEN, dir: "right", dur: CR.MS.WIPE, hold: 0, out: true, name: "wipe", ease: "wipe" }, opts);
  var S = M.rect(o.name, 0, 0, M.W, M.H, o.color);
  var p = M.pos(S);
  var offA, offB;
  if (o.dir === "right") { offA = [-M.W, 0]; offB = [M.W, 0]; }
  else if (o.dir === "left") { offA = [M.W, 0]; offB = [-M.W, 0]; }
  else if (o.dir === "down") { offA = [0, -M.H]; offB = [0, M.H]; }
  else { offA = [0, M.H]; offB = [0, -M.H]; }
  M.tween(p, ms0, ms0 + o.dur, offA, [0, 0], o.ease);
  if (o.out) M.tween(p, ms0 + o.dur + o.hold, ms0 + o.dur * 2 + o.hold, [0, 0], offB, o.ease);
  S.motionBlur = true;
  M.window(S, ms0, o.out ? ms0 + o.dur * 2 + o.hold : M.comp.duration * 1000);
  return S;
};
// Portal wipe: each step group slides in from `dir` with a tight stagger.
M.portalWipe = function (S, ms0, opts) {
  var o = M.merge({ dir: "right", dur: CR.MS.WIPE, each: CR.STAGGER_MS.TIGHT, ease: "wipe", out: false }, opts);
  var n = S.__steps || 4;
  var dist = (o.dir === "right" || o.dir === "left") ? M.W : M.H;
  var sign = (o.dir === "right" || o.dir === "down") ? -1 : 1;
  for (var i = 0; i < n; i++) {
    var g = M.groupByName(S, "step" + i);
    var gp = M.gTransform(g).property("ADBE Vector Position");
    var off = (o.dir === "right" || o.dir === "left") ? [sign * dist, 0] : [0, sign * dist];
    var t = ms0 + i * o.each;
    if (o.out) M.tween(gp, t, t + o.dur, [0, 0], [-off[0], -off[1]], o.ease);
    else M.tween(gp, t, t + o.dur, off, [0, 0], o.ease);
  }
  return S;
};
// Portal BUILD: steps pop in one by one with HOLD keys (the "repetition" reading of the portal).
M.portalBuild = function (S, ms0, opts) {
  var o = M.merge({ each: CR.STAGGER_MS.TIGHT * 2 }, opts);
  var n = S.__steps || 4;
  for (var i = 0; i < n; i++) {
    var g = M.groupByName(S, "step" + i);
    var op = M.gTransform(g).property("ADBE Vector Group Opacity");
    M.at(op, 0, 0);
    M.at(op, ms0 + i * o.each, 100);
  }
  return S;
};
// Grow a rule/bar from its anchor (built with M.rule).
M.growRule = function (S, ms0, opts) {
  var o = M.merge({ dur: CR.MS.FAST, ease: "enter" }, opts);
  var sc = M.scale(S);
  var axisY = (S.__anchorMode === "top" || S.__anchorMode === "bottom");
  M.tween(sc, ms0, ms0 + o.dur, axisY ? [100, 0] : [0, 100], [100, 100], o.ease);
  return S;
};
// Pattern build: rows (or columns) of a repeater pattern appear one by one via the repeater's
// Copies count on HOLD keys. Reads as a "row-by-row" build. opts {each, axis:'rows'|'cols'}
M.patternBuild = function (S, ms0, opts) {
  var o = M.merge({ each: CR.STAGGER_MS.PATTERN_ROW, axis: "rows" }, opts);
  var g = M.contents(S).property(1);
  var c = M.inner(g);
  var reps = [];
  for (var i = 1; i <= c.numProperties; i++) { if (c.property(i).matchName === "ADBE Vector Filter - Repeater") reps.push(c.property(i)); }
  var rep = (o.axis === "cols") ? reps[0] : reps[reps.length - 1];
  if (!rep) { M.warn("patternBuild: no repeater on " + S.name); return S; }
  var copies = rep.property("ADBE Vector Repeater Copies");
  var total = copies.value;
  for (var n = 0; n <= total; n++) M.at(copies, ms0 + n * o.each, n);
  return S;
};
// Draw-on for stroked paths: Trim Paths End 0 -> 100 on the given group (or the first group).
M.drawOn = function (S, ms0, opts) {
  var o = M.merge({ dur: CR.MS.BASE, ease: "enter", group: null, out: false }, opts);
  var g = o.group ? M.groupByName(S, o.group) : M.contents(S).property(1);
  var trim = M.inner(g).addProperty("ADBE Vector Filter - Trim");
  var end = trim.property("ADBE Vector Trim End");
  if (o.out) M.tween(end, ms0, ms0 + o.dur, 100, 0, "exit");
  else M.tween(end, ms0, ms0 + o.dur, 0, 100, o.ease);
  return S;
};
// Count-up on a TEXT layer. Adds a Slider "Progress" (0..100) eased with `count`, and a
// Source Text expression that formats the value: prefix, decimals, suffix, RU thousands (U+202F).
M.counter = function (L, ms0, ms1, from, to, opts) {
  var o = M.merge({ decimals: 0, prefix: "", suffix: "", ease: "count", sep: "\\u202F" }, opts);
  var sl = M.fx(L).addProperty("ADBE Slider Control");
  sl.name = "Progress";
  var slider = M.prop(sl, "ADBE Slider Control-0001", "Slider");
  M.tween(slider, ms0, ms1, 0, 100, o.ease);
  var ex =
    'var p = effect("Progress")(1).value / 100;\n' +
    'var v = ' + from + ' + (' + to + ' - ' + from + ') * p;\n' +
    'var d = ' + o.decimals + ';\n' +
    'var s = v.toFixed(d);\n' +
    'var parts = s.split(".");\n' +
    'var ip = parts[0], out = "";\n' +
    'while (ip.length > 3) { out = "' + o.sep + '" + ip.substr(-3) + out; ip = ip.substr(0, ip.length - 3); }\n' +
    'ip = ip + out;\n' +
    '"' + o.prefix + '" + ip + (d > 0 ? "," + parts[1] : "") + "' + o.suffix + '"';
  var st = M.srcText(L);
  st.expression = ex;
  if (st.expressionError && st.expressionError.length > 0) M.warn("counter expression: " + st.expressionError);
  return L;
};
// Colour cut: a Fill effect on the layer changes colour at `ms` (HOLD) or ramps over `dur` ms.
M.colorCut = function (L, ms, toColor, opts) {
  var o = M.merge({ fromColor: null, dur: 0 }, opts);
  var f = M.fx(L).addProperty("ADBE Fill");
  var cp = M.prop(f, "ADBE Fill-0002", "Color");
  var from = o.fromColor ? M.col(o.fromColor) : cp.value;
  if (o.dur > 0) {
    cp.setValueAtTime(M.f(ms), from);
    cp.setValueAtTime(M.f(ms + o.dur), M.col(toColor));
  } else {
    M.at(cp, 0, from);
    M.at(cp, ms, M.col(toColor));
  }
  return L;
};

// ───────────────────────────── verification ─────────────────────────────
M.exprErrors = function () {
  var errs = [];
  function walk(pg, L, path) {
    for (var i = 1; i <= pg.numProperties; i++) {
      var p = pg.property(i);
      if (!p) continue;
      if (p.propertyType === PropertyType.PROPERTY) {
        try {
          if (p.expressionEnabled && p.expressionError && p.expressionError.length > 0) {
            errs.push({ layer: L.name, prop: path + "/" + p.name, error: p.expressionError });
          }
        } catch (e0) {}
      } else {
        try { walk(p, L, path + "/" + p.name); } catch (e1) {}
      }
    }
  }
  for (var i = 1; i <= M.comp.numLayers; i++) { var L = M.comp.layer(i); walk(L, L, ""); }
  return errs;
};
// Capture frames to PNG at FULL resolution (quirk #34). Returns the paths. ASYNC on disk (#27/#40):
// poll the files until their sizes stop changing before reading them.
M.capture = function (frames, prefix, dir) {
  var out = [];
  var keep = M.comp.resolutionFactor;
  var folder = dir ? new Folder(dir) : Folder.temp;
  M.comp.resolutionFactor = [1, 1];
  try {
    for (var i = 0; i < frames.length; i++) {
      var f = new File(folder.fsName + "/" + (prefix || "beat") + "_" + frames[i] + ".png");
      M.comp.saveFrameToPng(frames[i] * M.FD, f);
      out.push(f.fsName);
    }
  } finally { M.comp.resolutionFactor = keep; }
  return out;
};
// 2D comp-space ink box of a layer at time t (anchor/scale aware; no rotation, no 3D).
M.bounds = function (L, tSec) {
  var r = L.sourceRectAtTime(tSec, false);
  var p = M.pos(L).valueAtTime(tSec, false);
  var a = M.anchor(L).valueAtTime(tSec, false);
  var s = M.scale(L).valueAtTime(tSec, false);
  var sx = s[0] / 100, sy = s[1] / 100;
  return { left: p[0] + (r.left - a[0]) * sx, top: p[1] + (r.top - a[1]) * sy,
           width: r.width * sx, height: r.height * sy };
};
// First/last frame where the layer is actually visible (opacity>0 and scale != 0), sampled
// twice per frame (quirk #26). Returns {first, last} in frames or null.
M.visibleWindow = function (L) {
  var op = M.opacity(L), sc = M.scale(L);
  var end = Math.round(M.comp.duration * M.FPS), first = -1, last = -1;
  for (var fr = 0; fr <= end; fr++) {
    for (var s = 0; s < 2; s++) {
      var t = (fr + 0.25 + s * 0.5) * M.FD;
      if (t < L.inPoint || t > L.outPoint) continue;
      var o = op.valueAtTime(t, false);
      var v = sc.valueAtTime(t, false);
      var mx = 0;
      for (var d = 0; d < v.length; d++) mx = Math.max(mx, Math.abs(v[d]));
      if (o > 0 && mx > 0) { if (first < 0) first = fr; last = fr; }
    }
  }
  return first < 0 ? null : { first: first, last: last };
};
M.summary = function () {
  var layers = [];
  for (var i = 1; i <= M.comp.numLayers; i++) {
    var L = M.comp.layer(i);
    layers.push({ index: L.index, name: L.name, inF: Math.round(L.inPoint * M.FPS), outF: Math.round(L.outPoint * M.FPS), tag: L.comment });
  }
  return { name: M.comp.name, w: M.W, h: M.H, fps: M.FPS, durationF: Math.round(M.comp.duration * M.FPS), numLayers: M.comp.numLayers, layers: layers };
};

// ───────────────────────────── runner ─────────────────────────────
// M.run("label", function(){ ...; return {anything}; })  -> {ok, step, warnings, ...}
// One undo group per run; an uncaught throw reports the last M.step() marker and the line.
M.run = function (label, fn) {
  M.warnings = [];
  M.STEP = "start";
  var out = {};
  app.beginUndoGroup(label || "cloudru-motion");
  try {
    var ret = fn();
    if (ret && typeof ret === "object") { for (var k in ret) { if (ret.hasOwnProperty(k)) out[k] = ret[k]; } }
    out.ok = true;
  } catch (err) {
    out.ok = false;
    out.error = String(err);
    out.line = err.line;
    out.failedAfter = M.STEP;
  } finally {
    app.endUndoGroup();
  }
  out.step = M.STEP;
  out.warnings = M.warnings;
  return out;
};

// ───────────────────────────── v1.1: market-practice additions ─────────────────────────────
// Springs (closed-form damped oscillator, mass 1, 0→1, v0 = 0) — SAME math as html/engine/motion.js
// (Motion.springSolver), verified equal in scripts/lib.test.js. Baked to per-frame keys because
// AE has no spring interpolation; the keys are linear between frames (invisible at 25+ fps).
M.springSolver = function (stiffness, zeta) {
  var w0 = Math.sqrt(stiffness);
  if (zeta < 1) {
    var wd = w0 * Math.sqrt(1 - zeta * zeta);
    return function (t) { return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)); };
  }
  if (zeta === 1) return function (t) { return 1 - Math.exp(-w0 * t) * (1 + w0 * t); };
  var s = Math.sqrt(zeta * zeta - 1);
  var r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
  return function (t) { return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1); };
};
M.springOf = function (nameOrCfg) {
  if (typeof nameOrCfg === "string") {
    var key = nameOrCfg.toUpperCase().replace(/^SPRING:/, "");
    if (!CR.SPRING[key]) throw new Error("unknown spring: " + nameOrCfg);
    return CR.SPRING[key];
  }
  return nameOrCfg;
};
// Settle time in seconds (|1−x| < 0.001 and nearly still), 1 ms search like the HTML engine.
M.springDuration = function (cfg) {
  var c = M.springOf(cfg), f = M.springSolver(c.stiffness, c.damping), settle = 0;
  for (var t = 0; t <= 10; t += 0.001) {
    if (Math.abs(1 - f(t)) < 0.001 && Math.abs(f(t + 0.016) - f(t)) < 0.0005) { settle = t; break; }
    settle = t;
  }
  return Math.ceil(settle * 1000) / 1000;
};
// Bake a spring from v0 to v1 starting at ms0: one LINEAR key per frame until settled. Returns the key count.
// Position keys are flattened (straight path). v0/v1 numbers or arrays.
M.springBake = function (prop, ms0, v0, v1, cfg) {
  var c = M.springOf(cfg || "M3_EXPRESSIVE");
  var f = M.springSolver(c.stiffness, c.damping);
  var dur = M.springDuration(c);
  var frames = Math.ceil(dur * M.FPS);
  var t0 = M.f(ms0), n = 0;
  var arr = M.isArray(v0);
  for (var i = 0; i <= frames; i++) {
    var u = (i >= frames) ? 1 : f(i * M.FD);
    var v;
    if (arr) { v = []; for (var d = 0; d < v0.length; d++) v.push(v0[d] + (v1[d] - v0[d]) * u); }
    else v = v0 + (v1 - v0) * u;
    prop.setValueAtTime(t0 + i * M.FD, v);
    n++;
  }
  var k0 = prop.nearestKeyIndex(t0);
  for (var k = k0; k < k0 + n; k++) {
    try { prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); } catch (e0) {}
  }
  M.flatten(prop);
  return n;
};
// Gaussian blur in → 0 (transition aid only; brand: ≤ 6 px at 1080p, 0 at rest). <!-- VERIFY matchName -->
M.blurIn = function (L, ms0, opts) {
  var o = M.merge({ from: M.px(CR.ENTRANCE.BLUR_PX), dur: CR.MS.BASE, ease: "enter", out: false }, opts);
  var fx = M.fx(L).addProperty("ADBE Gaussian Blur 2");
  var b = M.prop(fx, "ADBE Gaussian Blur 2-0001", "Blurriness");
  try { M.prop(fx, "ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels").setValue(true); } catch (e0) {}
  if (o.out) M.tween(b, ms0, ms0 + o.dur, 0, o.from, "exit");
  else M.tween(b, ms0, ms0 + o.dur, o.from, 0, o.ease);
  return L;
};
// The premium entrance: opacity + rise + scale (+ blur) together. opts { rise, dx, scale, blur, dur, ease|spring }
M.premiumIn = function (L, ms0, opts) {
  var o = M.merge({ rise: M.px(CR.ENTRANCE.RISE_PX), dx: 0, scale: CR.ENTRANCE.SCALE_FROM, blur: 0, dur: CR.MS.BASE, ease: "enter", spring: null }, opts);
  var p = M.pos(L), land = p.value;
  var from = [land[0] - o.dx, land[1] - o.rise];
  if (land.length === 3) from.push(land[2]);
  var sc = M.scale(L), s1 = sc.value, s0 = [];
  for (var i = 0; i < s1.length; i++) s0.push(i < 2 ? s1[i] * o.scale : s1[i]);
  if (o.spring) {
    M.springBake(p, ms0, from, land, o.spring);
    M.springBake(sc, ms0, s0, s1, o.spring);
    o.dur = Math.round(M.springDuration(o.spring) * 1000);
  } else {
    M.tween(p, ms0, ms0 + o.dur, from, land, o.ease);
    M.tween(sc, ms0, ms0 + o.dur, s0, s1, o.ease);
  }
  M.tween(M.opacity(L), ms0, ms0 + Math.round(o.dur * 0.6), 0, 100, "enter");
  if (o.blur) M.blurIn(L, ms0, { from: o.blur, dur: Math.round(o.dur * 0.8) });
  return L;
};
// Exit: ≤ 10 frames, ease-in, opacity + short drop. opts { drop, dx, dur }
M.exitOut = function (L, ms0, opts) {
  var o = M.merge({ drop: -M.px(32), dx: 0, dur: Math.round(CR.ENTRANCE.EXIT_FRAMES_MAX / M.FPS * 1000) }, opts);
  var p = M.pos(L), here = p.valueAtTime(M.f(ms0), false);
  var to = [here[0] + o.dx, here[1] + o.drop];
  if (here.length === 3) to.push(here[2]);
  M.tween(p, ms0, ms0 + o.dur, here, to, "exit");
  M.tween(M.opacity(L), ms0, ms0 + o.dur, 100, 0, "exit");
  return L;
};
// Word cascade on ONE text layer via a Text Animator (Based On = words): each word rises + fades in,
// offset sweeping across the string. opts { rise, each (ms per word), words (count, for the sweep length) }
// <!-- VERIFY: ADBE Text Range Advanced / Type2 = 3 (words), Percent Offset sweep -->
M.wordCascade = function (L, ms0, opts) {
  var o = M.merge({ rise: M.px(30), each: Math.round(CR.ENTRANCE.WORD_STAGGER_FRAMES / M.FPS * 1000), words: 4, dur: CR.MS.BASE, ease: "enter" }, opts);
  var anims = L.property("ADBE Text Properties").property("ADBE Text Animators");
  var anim = anims.addProperty("ADBE Text Animator");
  anim.name = "word cascade";
  var sels = anim.property("ADBE Text Selectors");
  if (sels.numProperties === 0) { try { sels.addProperty("ADBE Text Selector"); } catch (e0) { M.warn("range selector: " + e0); } }
  var sel = sels.property(1);
  try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").setValue(3); } catch (e1) { M.warn("based on words: " + e1); }
  try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Shape").setValue(2); } catch (e2) { M.warn("ramp up shape: " + e2); }
  var props = anim.property("ADBE Text Animator Properties");
  var ap = props.addProperty("ADBE Text Position 3D");
  ap.setValue([0, o.rise, 0]);
  var op = props.addProperty("ADBE Text Opacity");
  op.setValue(0);
  // sweep the selector offset from -100% (nothing selected → all words "animated" = hidden) to +100%
  var off = sel.property("ADBE Text Percent Offset");
  var total = o.dur + o.each * Math.max(1, o.words - 1);
  M.tween(off, ms0, ms0 + total, -100, 100, "linear");
  return L;
};
// Camera push: parent the given layers to a null at comp centre and scale it 100 → 100·push over [ms0, ms1].
M.cameraPush = function (layers, ms0, ms1, push) {
  push = push || CR.CAMERA.PUSH_SCALE;
  var nul = M.keep(M.comp.layers.addNull(M.comp.duration));
  nul.name = "CAMERA";
  M.anchor(nul).setValue([M.W / 2, M.H / 2]);
  M.pos(nul).setValue([M.W / 2, M.H / 2]);
  for (var i = 0; i < layers.length; i++) layers[i].parent = nul;   // parent BEFORE any keys (quirk #29)
  var sc = M.scale(nul);
  M.tween(sc, ms0, ms1, [100, 100], [100 * push, 100 * push], "linear");
  nul.enabled = false;
  return nul;
};
// Follow-through helper: run fn for each layer with an accumulating offset (default 60 ms) — the
// hero first, then support elements landing one after another.
M.followThrough = function (layers, ms0, fn, offsetMs) {
  offsetMs = offsetMs || CR.ENTRANCE.FOLLOW_THROUGH_DELAY_MS;
  for (var i = 0; i < layers.length; i++) fn(layers[i], ms0 + i * offsetMs, i);
  return layers;
};
