// motion.test.js — the HTML engine's pure core (easing, timeline resolution, stagger, scenes)
// exercised in Node with fake elements. Visual verification is html/render/render.js.
const { test } = require('node:test');
const assert = require('node:assert');
const Motion = require('./engine/motion.js');
const Brand = (() => { try { return require('./engine/brand.js'); } catch (e) { return null; } })();

function fake() { return { style: {}, textContent: '' }; }

test('cubicBezier reproduces the identity for linear and is monotonic for the brand eases', () => {
  const lin = Motion.cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(lin(0.3) - 0.3) < 1e-9);
  const enter = Motion.ease('enter');
  let prev = 0;
  for (let i = 1; i <= 100; i++) { const v = enter(i / 100); assert.ok(v >= prev - 1e-9, 'monotonic'); prev = v; }
  assert.ok(enter(0.25) > 0.7, 'enter is a strong ease-out: 25% of the time covers >70% of the distance (' + enter(0.25).toFixed(3) + ')');
  assert.ok(Math.abs(enter(1) - 1) < 1e-9 && enter(0) === 0);
  const exit = Motion.ease('exit');
  assert.ok(exit(0.5) < 0.2, 'exit accelerates: half the time covers <20% of the distance');
});

test('ease() accepts token names, bezier arrays, steps(n) and functions', () => {
  assert.strictEqual(typeof Motion.ease([0.16, 1, 0.3, 1]), 'function');
  const st = Motion.ease('steps(4)');
  assert.strictEqual(st(0.1), 0);
  assert.strictEqual(st(0.26), 0.25);
  assert.strictEqual(st(1), 1);
  const fn = (t) => t * t;
  assert.strictEqual(Motion.ease(fn), fn);
  assert.throws(() => Motion.ease('bounce'), /unknown ease/);
});

test('fromTo resolves from/during/after and applies transform + opacity strings', () => {
  const el = fake();
  const tl = Motion.timeline({ fps: 25 });
  tl.fromTo(el, { y: [40, 0], opacity: [0, 1] }, { at: 1, dur: 0.4, ease: 'linear' });
  tl.seek(0);
  assert.strictEqual(el.style.transform, 'translate(0px, 40px)');
  assert.strictEqual(el.style.opacity, '0');
  tl.seek(1.2);
  assert.strictEqual(el.style.transform, 'translate(0px, 20px)');
  assert.strictEqual(el.style.opacity, '0.5');
  tl.seek(3);
  assert.strictEqual(el.style.transform, 'translate(0px, 0px)');
  assert.strictEqual(el.style.opacity, '1');
  assert.strictEqual(tl.duration, 1.4);
});

test('sequential tweens on the same prop: the latest started one wins; earlier ones keep their end', () => {
  const el = fake();
  const tl = Motion.timeline();
  tl.fromTo(el, { x: [0, 100] }, { at: 0, dur: 1, ease: 'linear' });
  tl.fromTo(el, { x: [100, 300] }, { at: 2, dur: 1, ease: 'linear' });
  tl.seek(1.5); assert.strictEqual(el.style.transform, 'translate(100px, 0px)');
  tl.seek(2.5); assert.strictEqual(el.style.transform, 'translate(200px, 0px)');
});

test('stagger offsets each target; from:"end" reverses; duration grows accordingly', () => {
  const els = [fake(), fake(), fake()];
  const tl = Motion.timeline();
  tl.fromTo(els, { opacity: [0, 1] }, { at: 0, dur: 0.2, ease: 'linear', stagger: 0.1 });
  tl.seek(0.1);
  assert.strictEqual(els[0].style.opacity, '0.5');
  assert.strictEqual(els[1].style.opacity, '0');
  assert.strictEqual(els[2].style.opacity, '0');
  assert.strictEqual(tl.duration, 0.4);
  const tl2 = Motion.timeline();
  const e2 = [fake(), fake(), fake()];
  tl2.fromTo(e2, { opacity: [0, 1] }, { at: 0, dur: 0.2, ease: 'linear', stagger: 0.1, from: 'end' });
  tl2.seek(0.1);
  assert.strictEqual(e2[2].style.opacity, '0.5');
  assert.strictEqual(e2[0].style.opacity, '0');
});

test('clip props produce a clip-path inset and set() makes a HOLD state', () => {
  const el = fake();
  const tl = Motion.timeline();
  tl.fromTo(el, { clipR: [100, 0] }, { at: 0, dur: 1, ease: 'linear' });
  tl.seek(0.5);
  assert.strictEqual(el.style.clipPath, 'inset(0% 50% 0% 0%)');
  const el2 = fake();
  tl.set(el2, { opacity: 0 }, 0).set(el2, { opacity: 1 }, 2);
  tl.seek(1.9); assert.strictEqual(el2.style.opacity, '0');
  tl.seek(2.0); assert.strictEqual(el2.style.opacity, '1');
});

test('scenes toggle display and register labels; beatList is sorted and unique', () => {
  const a = fake(), b = fake();
  const tl = Motion.timeline();
  tl.scene('one', 0, 2, a).scene('two', 2, 4, b);
  tl.fromTo(fake(), { x: [0, 1] }, { at: 'two', dur: 0.5 });
  tl.seek(1); assert.strictEqual(a.style.display, ''); assert.strictEqual(b.style.display, 'none');
  tl.seek(2); assert.strictEqual(a.style.display, 'none'); assert.strictEqual(b.style.display, '');
  assert.deepStrictEqual(tl.beatList('all'), [0, 2, 2.5]);
  const stills = tl.beatList();                       // per scene: first frame, +0.6, +1.4, mid, last frame
  assert.deepStrictEqual(stills, [0.04, 0.6, 1, 1.4, 1.96, 2.04, 2.6, 3, 3.4, 3.96]);
  assert.strictEqual(tl.frames(), 100);
});

test('custom setters (counter) receive the interpolated value', () => {
  if (!Brand) return;
  const el = fake();
  const tl = Motion.timeline();
  tl.fromTo(el, { n: [0, 12500] }, { at: 0, dur: 1, ease: 'linear', set: Brand.counter({ suffix: ' %' }) });
  tl.seek(0.5);
  assert.strictEqual(el.textContent, '6' + Brand.THIN + '250 %');
  tl.seek(1);
  assert.strictEqual(el.textContent, '12' + Brand.THIN + '500 %');
  assert.strictEqual(Brand.formatNumber(99.9, { decimals: 1, suffix: ' %' }), '99,9 %');
  assert.strictEqual(Brand.formatNumber(-30, { suffix: ' %' }), '−30 %');
});

test('mount exposes a seek API without a DOM (render contract)', () => {
  const tl = Motion.timeline({ fps: 30 });
  tl.fromTo(fake(), { x: [0, 1] }, { at: 0, dur: 2 });
  global.__RENDER__ = true;
  Motion.mount(tl, { controls: false, autoplay: false });
  const m = global.__motion;
  assert.strictEqual(m.ready, true);
  assert.strictEqual(m.fps, 30);
  assert.strictEqual(m.frames, 60);
  assert.strictEqual(m.seek(1), 1);
  assert.strictEqual(m.seekFrame(45), 1.5);
});
