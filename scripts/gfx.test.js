// gfx.test.js — graphics over a Premiere edit (reference/gfx-for-edit.md): the logo's SVG as shapes,
// the template contract and the remap fit (G.*), the Cloud.ru kit (K.*), gfx-build's pure parts.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parsePath, parseSvg } = require('./lib/svgpath.js');

const LOGO_SVG = path.join(__dirname, '..', 'html', 'templates', 'cn-assets', 'logo_color.svg');

test('svgpath: a square of lines', () => {
  const [sq] = parsePath('M0 0H10V10H0Z');
  assert.deepStrictEqual(sq.vertices, [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.strictEqual(sq.closed, true);
  assert.ok(sq.inTangents.concat(sq.outTangents).every((t) => t[0] === 0 && t[1] === 0));
});

test('svgpath: a cubic gives tangents relative to its vertices', () => {
  const [p] = parsePath('M0 0C0 5 5 10 10 10L10 0Z');
  assert.deepStrictEqual(p.vertices, [[0, 0], [10, 10], [10, 0]]);
  assert.deepStrictEqual(p.outTangents[0], [0, 5]);
  assert.deepStrictEqual(p.inTangents[1], [-5, 0]);
});

test('svgpath: a closing vertex that repeats the first is folded into it', () => {
  const [p] = parsePath('M0 0L10 0C10 5 5 10 0 0Z');
  assert.deepStrictEqual(p.vertices, [[0, 0], [10, 0]]);
  assert.deepStrictEqual(p.outTangents[1], [0, 5]);
  assert.deepStrictEqual(p.inTangents[0], [5, 10]);
});

test('svgpath: relative commands and transforms are refused, not drawn wrong', () => {
  assert.throws(() => parsePath('m0 0l10 0z'), /relative command/);
  assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><path transform="x" d="M0 0Z"/></svg>'), /transform/);
});

test('svgpath: the Cloud.ru logo is two filled paths of closed shapes', () => {
  const svg = parseSvg(fs.readFileSync(LOGO_SVG, 'utf8'));
  assert.deepStrictEqual(svg.viewBox, [0, 0, 340.5, 63]);
  assert.deepStrictEqual(svg.paths.map((p) => p.fill), ['#26D07C', 'white']);
  assert.deepStrictEqual(svg.paths.map((p) => p.subpaths.length), [3, 10]);
  assert.ok(svg.paths.every((p) => p.subpaths.every((sp) => sp.closed && sp.vertices.length >= 3)));
});

const { sandbox } = require('./ae-mock.js');
const { lint } = require('./lint-jsx.js');
const LIB = (f) => fs.readFileSync(path.join(__dirname, 'lib', f), 'utf8');
function gfxSandbox() {
  const s = sandbox();
  s.run(LIB('gfx.jsx'));
  return s;
}
const near = (a, b) => a.length === b.length && a.every((k, i) => Math.abs(k[0] - b[i][0]) < 1e-9 && Math.abs(k[1] - b[i][1]) < 1e-9);

test('G.remapKeys keeps entrance and exit at their own speed for any slot length', () => {
  const s = gfxSandbox();
  const keys = (D) => JSON.parse(s.run(`JSON.stringify(G.remapKeys(${D}, 4, 0.8, 3.4))`));
  assert.ok(near(keys(10), [[0, 0], [0.8, 0.8], [9.4, 3.4], [10, 4]]), JSON.stringify(keys(10)));
  assert.ok(near(keys(4), [[0, 0], [0.8, 0.8], [3.4, 3.4], [4, 4]]));
  assert.ok(near(keys(3), [[0, 0], [0.8, 0.8], [2.4, 3.4], [3, 4]]));
  assert.ok(Math.abs(s.run('G.minSec(4, 0.8, 3.4)') - 2.9) < 1e-9);
});

test('G.tplProblems names every broken rule of the contract', () => {
  const s = gfxSandbox();
  assert.strictEqual(s.run('JSON.stringify(G.tplProblems({ name: "TPL_x", T: 4, tin: 0.8, tout: 3.4, txt: ["name", "role"], box: ["name", "role"], audio: false }, ["name", "role"]))'), '[]');
  const bad = JSON.parse(s.run('JSON.stringify(G.tplProblems({ name: "TPL_x", T: 4, tin: 3.5, tout: 3.4, txt: ["name"], box: [], audio: true }, ["name", "role"]))'));
  assert.strictEqual(bad.length, 5, bad.join(' | '));   // markers, BOX_NAME, TXT_ROLE, BOX_ROLE, audio
});

test('gfx.jsx passes the ES3 lint', () => {
  const r = lint(LIB('gfx.jsx'), { lib: false });
  assert.deepStrictEqual(r.errors, [], r.errors.join('; '));
});

test('G.tplInfo reads markers, TXT_ and BOX_; G.setTexts and G.overflow work on them', () => {
  const s = gfxSandbox();
  const v = JSON.parse(s.run(`
    var c = M.ensureComp("TPL_test", "1080p", 4);
    c.markerProperty.setValueAtTime(0.8, new MarkerValue("in"));
    c.markerProperty.setValueAtTime(3.4, new MarkerValue("out"));
    M.text("TXT_NAME", "Имя", { size: 50, x: 100, y: 500 });
    M.text("TXT_ROLE", "Роль", { size: 30, x: 100, y: 560 });
    M.rect("BOX_NAME", 90, 450, 600, 70, [1, 0, 1]).guideLayer = true;
    M.rect("BOX_ROLE", 90, 530, 600, 40, [1, 0, 1]).guideLayer = true;
    var info = G.tplInfo(c);
    var miss = G.setTexts(c, { name: "Иван Петров", extra: "x" });
    var roleNow = G.layer(c, "TXT_ROLE").property("ADBE Text Properties").property("ADBE Text Document").value.text;
    var fit = G.overflow(c, "name", 1.0), fitRole = G.overflow(c, "role", 1.0);
    G.setTexts(c, { name: "Очень длинное имя человека, которое не помещается", role: "CTO" });
    var over = G.overflow(c, "name", 1.0);
    JSON.stringify({ info: info, miss: miss, roleNow: roleNow, fit: fit, fitRole: fitRole, over: over,
      role: G.layer(c, "TXT_ROLE").property("ADBE Text Properties").property("ADBE Text Document").value.text })`));
  assert.deepStrictEqual([v.info.T, v.info.tin, v.info.tout], [4, 0.8, 3.4]);
  assert.deepStrictEqual(v.info.txt.sort(), ['name', 'role']);
  assert.deepStrictEqual(v.info.box.sort(), ['name', 'role']);
  assert.deepStrictEqual(v.miss, ['extra']);
  assert.strictEqual(v.roleNow, ' ');                  // a field the slot leaves out becomes a space
  assert.strictEqual(v.fit, 0);
  assert.strictEqual(v.fitRole, 0);                    // a space has no ink to measure
  assert.ok(v.over > 100, 'a long name sticks out of its box: ' + v.over);
  assert.strictEqual(v.role, 'CTO');
});

test('the Cloud.ru kit builds all seven templates and each honours the contract', () => {
  const s = gfxSandbox();
  s.run(LIB('gfx-kit-cloudru.jsx'));
  const svg = parseSvg(fs.readFileSync(LOGO_SVG, 'utf8'));
  const logo = { w: svg.viewBox[2], h: svg.viewBox[3], paths: svg.paths.map((p) => ({ color: p.fill === 'white' ? [1, 1, 1] : [0.149, 0.816, 0.486], subpaths: p.subpaths })) };
  const v = JSON.parse(s.run(`
    var built = K.ensure(null, ${JSON.stringify(logo)}), again = K.ensure(null, ${JSON.stringify(logo)}), probs = {}, counts = {};
    for (var i = 0; i < K.TYPES.length; i++) {
      var c = G.find("TPL_" + K.TYPES[i], CompItem);
      probs[K.TYPES[i]] = G.tplProblems(G.tplInfo(c), K.FIELDS[K.TYPES[i]]);
      counts[K.TYPES[i]] = c.numLayers;
    }
    var rebuilt = K.ensure(null, ${JSON.stringify(logo)}, true), same = true;
    for (i = 0; i < K.TYPES.length; i++) { if (G.find("TPL_" + K.TYPES[i], CompItem).numLayers !== counts[K.TYPES[i]]) { same = false; } }
    JSON.stringify({ built: built, again: again, rebuilt: rebuilt.length, same: same, probs: probs })`));
  assert.deepStrictEqual(v.built, ['lower_third', 'quote', 'callout', 'logo', 'chapter', 'intro', 'outro']);
  assert.deepStrictEqual(v.again, [], 'existing templates are not rebuilt');
  assert.strictEqual(v.rebuilt, 7);
  assert.strictEqual(v.same, true, 'a forced rebuild leaves no duplicate layers');
  for (const [t, p] of Object.entries(v.probs)) assert.deepStrictEqual(p, [], t);
});

test('the kit passes the ES3 lint', () => {
  const r = lint(LIB('gfx-kit-cloudru.jsx'), { lib: false });
  assert.deepStrictEqual(r.errors, [], r.errors.join('; '));
});

const B = require('./gfx-build.js');
const PLAN = { version: 1, sequence: { id: 's', name: 'Фильм', fps: 25, w: 1920, h: 1080, frames: 450 }, style: 'cloudru',
  plate: 'C:/f/plate.mov', aep: 'C:/Проект/f_gfx.aep',
  slots: [{ id: 'CH', type: 'chapter', layer: 'insert', in: 300, out: 375, text: { title: 'Глава' } },
          { id: 'LG', type: 'logo', layer: 'logo', in: 0, out: 450, text: {} },
          { id: 'LT', type: 'lower_third', layer: 'overlay', in: 25, out: 125, text: { name: 'Иван', role: 'CTO' } },
          { id: 'X', type: 'quote', layer: 'overlay', in: 10, out: 20, text: { quote: 'x' }, lost: true }] };

test('gfx-build: plan checks and build order (overlays, logo, inserts; lost slots skipped)', () => {
  assert.deepStrictEqual(B.checkPlan(PLAN), []);
  assert.deepStrictEqual(B.slotsInOrder(PLAN).map((s) => s.id), ['LT', 'LG', 'CH']);
  assert.match(B.checkPlan({ ...PLAN, sequence: { ...PLAN.sequence, w: 1080, h: 1920 } }).join(' '), /16:9/);
  assert.match(B.checkPlan({ ...PLAN, style: 'client' }).join(' '), /only the cloudru kit/);
});

test('gfx-build: payloads are ASCII (Cyrillic as \\u escapes) and lint-clean', () => {
  assert.strictEqual(B.J({ a: 'Ж' }), '{"a":"\\u0416"}');
  const bodies = [B.openBody(PLAN.aep), B.kitBody(['lower_third'], false), B.plateBody(PLAN.plate, true),
    B.slotBody(PLAN.slots[2], PLAN), B.previewBody(PLAN, B.slotsInOrder(PLAN)), B.captureBody(PLAN, B.slotsInOrder(PLAN), 'C:/f/qa')];
  for (const b of bodies) {
    assert.ok(!/[^\x00-\x7f]/.test(b), 'non-ASCII in a payload');
    const r = lint('function __t() {' + b + '\n}', { lib: false });
    assert.deepStrictEqual(r.errors, [], r.errors.join('; '));
  }
});

test('gfx-build: a step as sent is ASCII and draws no lint warning (a fresh agent reads warnings as trouble)', () => {
  const steps = [['gfx: open', B.openBody(PLAN.aep), true], ['gfx: kit', B.kitBody(['lower_third'], false), false],
    ['gfx: plate', B.plateBody(PLAN.plate, true), false], ['gfx: slot', B.slotBody(PLAN.slots[0], PLAN), false],
    ['gfx: preview', B.previewBody(PLAN, B.slotsInOrder(PLAN)), false], ['gfx: capture', B.captureBody(PLAN, B.slotsInOrder(PLAN), 'C:/f/qa'), false]];
  for (const [label, body, raw] of steps) {
    const src = B.payload(label, body, raw);
    assert.ok(!/[^\x00-\x7f]/.test(src), `${label}: non-ASCII in the payload`);
    const r = lint(src, { lib: false });
    assert.deepStrictEqual([r.errors, r.warnings], [[], []], `${label}: ${r.errors.concat(r.warnings).join('; ')}`);
  }
});

test('gfx-build: the plate step switches the PLATE item to the plan\'s file, or reloads it on --refresh-plate', () => {
  const s = gfxSandbox();
  const P = s.app.project.items.addFolder('PLATE');
  const item = Object.assign(new s.FootageItem(), { name: 'plate.mov', parentFolder: P, duration: 18, file: new s.File('C:/f/plate.mov'),
    replaced: [], replace(f) { this.replaced.push(f.fsName); this.file = f; this.name = f.fsName.split('/').pop(); } });
  const list = [P, item];
  Object.defineProperty(s.app.project, 'numItems', { get: () => list.length });
  s.app.project.item = (i) => list[i - 1];
  s.File = class { constructor(p) { this.fsName = p; this.exists = true; } };
  const step = (plate, refresh) => JSON.parse(s.run(`JSON.stringify((function () {${B.plateBody(plate, refresh)}\n})())`));
  // a re-export went to plate.b.mov because AE held plate.mov: the item follows it, and lets go of the old file
  assert.deepStrictEqual(step('C:/f/plate.b.mov', false), { plate: 'plate.b.mov', duration: 18, switchedFrom: 'C:/f/plate.mov' });
  assert.deepStrictEqual(step('C:/f/plate.b.mov', false).switchedFrom, null);     // already on it: nothing to do
  assert.deepStrictEqual(item.replaced, ['C:/f/plate.b.mov']);
  step('C:/f/plate.b.mov', true);                                                  // same file re-rendered: reload
  assert.deepStrictEqual(item.replaced, ['C:/f/plate.b.mov', 'C:/f/plate.b.mov']);
});

test('gfx-build: logo data carries the SVG fills as rgb', () => {
  const d = B.logoData();
  assert.deepStrictEqual(d.paths.map((p) => p.color.map((c) => Math.round(c * 255))), [[38, 208, 124], [255, 255, 255]]);
});
