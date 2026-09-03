// lib.test.js — exercises scripts/lib/cloudru-motion.jsx against the strict AE mock.
// This proves API usage, arity handling and the exact bezier math; it does NOT prove AE
// accepts every matchName (see reference/live-verify-checklist.md for the live pass).
const { test } = require('node:test');
const assert = require('node:assert');
const { sandbox, KeyframeInterpolationType } = require('./ae-mock.js');

function fresh() {
  const s = sandbox();
  s.run('M.ensureComp("T", "1080p", 10);');
  return s;
}

test('time helpers snap to frames and px keeps the 2px module', () => {
  const s = fresh();
  assert.strictEqual(s.run('M.frames(400)'), 10);                // 25 fps
  assert.strictEqual(s.run('M.f(400)'), 10 / 25);
  assert.strictEqual(s.run('M.frames(70)'), 2);
  assert.strictEqual(s.run('M.px(41)'), 42);
  s.run('M.ensureComp("K", "4k", 10);');
  assert.strictEqual(s.run('M.px(40)'), 80);
});

test('bezierEase applies the exact §2b mapping on a 1-D property', () => {
  const s = fresh();
  const r = s.run(`
    var L = M.solid("s", CR.COLOR.WHITE);
    var op = M.opacity(L);
    M.tween(op, 0, 400, 0, 100, "enter");
    var o = op.keyOutTemporalEase(1)[0], i = op.keyInTemporalEase(2)[0];
    JSON.stringify({ oi: o.influence, os: o.speed, ii: i.influence, is: i.speed,
                     t1: op.keyOutInterpolationType(1), t2: op.keyInInterpolationType(2) })`);
  const v = JSON.parse(r);
  // Δv/Δt = 100 / 0.4 = 250; out speed = y1/x1 · 250 = 1/0.16 · 250 = 1562.5
  assert.strictEqual(v.oi, 16);
  assert.ok(Math.abs(v.os - 1562.5) < 1e-6);
  assert.ok(Math.abs(v.ii - 70) < 1e-9);
  assert.strictEqual(v.is, 0);
  assert.strictEqual(v.t1, KeyframeInterpolationType.BEZIER);
  assert.strictEqual(v.t2, KeyframeInterpolationType.BEZIER);
});

test('bezierEase signs the speed for a decreasing 1-D value (exit)', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var L = M.solid("s", CR.COLOR.WHITE); var op = M.opacity(L);
    M.tween(op, 0, 280, 100, 0, "exit");
    var o = op.keyOutTemporalEase(1)[0], i = op.keyInTemporalEase(2)[0];
    JSON.stringify({ os: o.speed, oi: o.influence, is: i.speed, ii: i.influence })`));
  // exit = 0.7,0,0.84,0 ; Δv = -100 over 0.28 s → vel = -357.14 ; out speed = 0 ; in speed = (1-0)/(1-0.84)·vel
  assert.strictEqual(v.os, 0);
  assert.strictEqual(v.oi, 70);
  assert.ok(v.is < 0, 'in-speed must be negative for a decreasing value');
  assert.ok(Math.abs(v.ii - 16) < 1e-9);
});

test('tween on Position uses ONE ease (spatial), flattens tangents and lands exactly', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var L = M.solid("s", CR.COLOR.WHITE); var p = M.pos(L);
    M.tween(p, 0, 400, [100, 500], [100, 460], "enter");
    JSON.stringify({ n: p.keyOutTemporalEase(1).length, tan: p.keyOutSpatialTangent(1), land: p.keyValue(2), sp: p.keyOutTemporalEase(1)[0].speed })`));
  assert.strictEqual(v.n, 1);
  assert.deepStrictEqual(v.tan, [0, 0, 0]);
  assert.deepStrictEqual(v.land, [100, 460]);
  assert.ok(v.sp > 0, 'spatial speed is a magnitude');
});

test('tween on a TEXT layer Scale (3-D, quirk #18) and a shape Scale (2-D) both succeed', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var T = M.text("t", "Hello", { size: 100 });
    var S = M.rect("r", 0, 0, 100, 10, CR.COLOR.GREEN);
    M.tween(M.scale(T), 0, 400, [0, 0, 100], [100, 100, 100], "enter");
    M.tween(M.scale(S), 0, 400, [0, 100], [100, 100], "enter");
    JSON.stringify({ t: M.scale(T).keyOutTemporalEase(1).length, s: M.scale(S).keyOutTemporalEase(1).length,
                     sx: M.scale(S).keyOutTemporalEase(1)[0].speed, sy: M.scale(S).keyOutTemporalEase(1)[1].speed })`));
  assert.strictEqual(v.t, 3);
  assert.strictEqual(v.s, 2);
  assert.ok(v.sx > 0 && v.sy === 0, 'per-dimension speeds: X moves, Y does not');
});

test('text() follows the quirk #9 font sequence and reports fallback as a warning', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    JSON.stringify(M.run("t", function () {
      var a = M.text("a", "Cloud", { size: 132, font: CR.FONT.SEMIBOLD, x: 80, y: 400 });
      var b = M.text("b", "Cloud", { size: 132, font: "NoSuchFont-Bold" });
      return { fa: a.__font, fb: b.__font, pos: M.pos(a).value };
    }))`));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.fa, 'SBSansDisplay-SemiBold');
  assert.strictEqual(v.fb, 'ArialMT');
  assert.deepStrictEqual(v.pos, [80, 400]);
  assert.strictEqual(v.warnings.length, 1);
  assert.match(v.warnings[0], /font fallback on 'b'/);
});

test('window() sets inPoint before outPoint so the shift trap (#14) does not bite', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var L = M.rect("r", 0, 0, 10, 10, CR.COLOR.GREEN);
    M.window(L, 720, 840);
    JSON.stringify({ i: L.inPoint, o: L.outPoint })`));
  assert.ok(Math.abs(v.i - 0.72) < 1e-9);
  assert.ok(Math.abs(v.o - 0.84) < 1e-9);
});

test('clean() removes only tagged layers; run() wraps one undo group and reports the STEP on failure', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var keepMe = M.comp.layers.addSolid([0,0,0], "user", 10, 10);
    M.rect("a", 0, 0, 10, 10, CR.COLOR.GREEN); M.rect("b", 0, 0, 10, 10, CR.COLOR.GREEN);
    var removed = M.clean();
    var r = M.run("boom", function () { M.step("phase-2"); throw new Error("nope"); });
    JSON.stringify({ removed: removed, left: M.comp.numLayers, ok: r.ok, failedAfter: r.failedAfter, err: r.error, undo: app.undo })`));
  assert.strictEqual(v.removed, 2);
  assert.strictEqual(v.left, 1);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.failedAfter, 'phase-2');
  assert.match(v.err, /nope/);
  assert.deepStrictEqual(v.undo, [['begin', 'boom'], ['end']]);
});

test('patterns are built from one seed cell plus repeaters (quirk #17), never N×M shapes', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var D = M.dots("dots", { cols: 40, rows: 12, size: 4, gap: 12 });
    var c = M.inner(M.groupByName(D, "dots"));
    var reps = 0, rects = 0;
    for (var i = 1; i <= c.numProperties; i++) { var m = c.property(i).matchName;
      if (m === "ADBE Vector Filter - Repeater") reps++; if (m === "ADBE Vector Shape - Rect") rects++; }
    var G = M.grid("grid", { cols: 12, rows: 6, cell: 80 });
    var LL = M.llll("llll", { cells: 4 });
    var Po = M.portal("portal", { steps: 4 });
    JSON.stringify({ reps: reps, rects: rects, box: D.__box, gridBox: G.__box, steps: Po.__steps, llBox: LL.__box })`));
  assert.strictEqual(v.reps, 2);
  assert.strictEqual(v.rects, 1);
  assert.deepStrictEqual(v.box, [0, 0, 40 * 16 - 12, 12 * 16 - 12]);
  assert.deepStrictEqual(v.gridBox, [0, 0, 960, 480]);
  assert.strictEqual(v.steps, 4);
});

test('a full Cloud.ru title scene builds without errors or warnings and passes exprErrors()', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    JSON.stringify(M.run("title", function () {
      M.step("ground");
      var bg = M.solid("ground", CR.COLOR.WHITE);
      M.step("portal");
      var Po = M.portal("portal", { x: 1200, y: 240, w: 480, h: 320, steps: 4, color: CR.COLOR.GREEN });
      M.portalWipe(Po, 0, { dir: "right" });
      M.step("title");
      var T = M.text("title", "Cloud.ru", { size: CR.TYPE.TITLE, font: CR.FONT.SEMIBOLD, x: 80, y: 500 });
      M.lineReveal(T, 500);
      M.step("rule");
      var R = M.rule("rule", 80, 540, 600, 4, CR.COLOR.GREEN);
      M.growRule(R, 900);
      M.step("dots");
      var D = M.dots("dots", { x: 80, y: 900, cols: 30, rows: 4 });
      M.patternBuild(D, 1100);
      M.step("kpi");
      var K = M.text("kpi", "0", { size: CR.TYPE.KPI_HERO, x: 80, y: 900, tracking: CR.TRACKING.KPI });
      M.counter(K, 1200, 2600, 0, 12500, { suffix: " %" });
      M.colorCut(K, 2800, CR.COLOR.GREEN);
      M.step("exit");
      M.stagger([T, R, D], 3000, CR.STAGGER_MS.BASE, function (L, t) { M.slideOut(L, t); });
      M.window(D, 0, 4000);
      return { errs: M.exprErrors(), summary: M.summary(), keys: M.pos(T).numKeys, animators: T.property("ADBE Text Properties").property("ADBE Text Animators").numProperties };
    }))`));
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.deepStrictEqual(v.warnings, []);
  assert.deepStrictEqual(v.errs, []);
  assert.strictEqual(v.summary.numLayers, 6);
  assert.strictEqual(v.animators, 1);
  assert.strictEqual(v.step, 'exit');
});

test('counter() writes a formatting expression with the U+202F thousands separator escape', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    var K = M.text("kpi", "0", { size: 300 });
    M.counter(K, 0, 1400, 0, 12500, { decimals: 1, suffix: " %" });
    var st = M.srcText(K); var sl = M.fx(K).property("Progress").property("ADBE Slider Control-0001");
    JSON.stringify({ ex: st.expression, k: sl.numKeys, i1: sl.keyOutTemporalEase(1)[0].influence })`));
  assert.match(v.ex, /\\u202F/);
  assert.match(v.ex, /toFixed\(d\)/);
  assert.strictEqual(v.k, 2);
  assert.strictEqual(v.i1, 10);   // count ease x1 = 0.10
});

test('capture() restores the resolution factor and returns one path per frame', () => {
  const s = fresh();
  const v = JSON.parse(s.run(`
    M.comp.resolutionFactor = [4, 4];
    var paths = M.capture([0, 12, 25], "beat");
    JSON.stringify({ paths: paths, res: M.comp.resolutionFactor, saved: M.comp.saved })`));
  assert.strictEqual(v.paths.length, 3);
  assert.deepStrictEqual(v.res, [4, 4]);
  v.saved.forEach(x => assert.deepStrictEqual(x.res, [1, 1]));
});
