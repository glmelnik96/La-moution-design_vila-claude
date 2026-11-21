const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { outputs, hexToRgb01 } = require('./build-tokens.js');

const ROOT = path.join(__dirname, '..');
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand', 'cloudru-motion-tokens.json'), 'utf8'));

test('hexToRgb01 converts brand green exactly', () => {
  assert.deepStrictEqual(hexToRgb01('#26D07C'), [0.14902, 0.81569, 0.48627]);
  assert.deepStrictEqual(hexToRgb01('#FFFFFF'), [1, 1, 1]);
});

test('generated token files are in sync with brand/cloudru-motion-tokens.json', () => {
  const outs = outputs(tokens);
  Object.keys(outs).forEach((p) => {
    const cur = fs.readFileSync(p, 'utf8');
    assert.strictEqual(cur, outs[p], path.relative(ROOT, p) + ' is stale — run `node scripts/build-tokens.js`');
  });
});

test('every ease is a 4-number bezier inside the unit x-range, and the brand has no overshoot', () => {
  Object.keys(tokens.ease).forEach((k) => {
    if (k[0] === '_') return;
    const b = tokens.ease[k].bezier;
    assert.strictEqual(b.length, 4, k);
    assert.ok(b[0] >= 0 && b[0] <= 1 && b[2] >= 0 && b[2] <= 1, k + ': x handles must be in [0,1]');
    assert.ok(b[1] <= 1 && b[3] <= 1 && b[1] >= 0 && b[3] >= 0, k + ': Cloud.ru forbids overshoot (y outside [0,1])');
    const inf = tokens.ease[k].ae_influence;
    assert.ok(Math.abs(inf[0] - Math.max(0.1, b[0] * 100)) < 0.01, k + ': ae_influence[0] must equal x1·100');
    assert.ok(Math.abs(inf[1] - Math.max(0.1, (1 - b[2]) * 100)) < 0.01, k + ': ae_influence[1] must equal (1−x2)·100');
  });
});

test('geometry obeys the brand micro-module and straight-corner rules', () => {
  const g = tokens.geometry;
  assert.strictEqual(g.corner_radius, 0);
  assert.strictEqual(g.stroke_linecap, 'square');
  g.line_weights.concat(g.dot_sizes, g.dot_gaps).forEach((v) => assert.strictEqual(v % g.micro_module, 0));
  Object.keys(tokens.format).forEach((k) => {
    if (k[0] === '_') return;
    assert.strictEqual(tokens.format[k].margin % 10, 0, k + ' margin must be a multiple of 10');
  });
});

test('the HTML token module exposes the same eases as the jsx', () => {
  const js = require(path.join(ROOT, 'html', 'engine', 'tokens.js'));
  const jsx = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'tokens.jsx'), 'utf8');
  Object.keys(js.ease).forEach((k) => {
    const line = 'CR.EASE.' + k.toUpperCase() + ' = [' + js.ease[k].bezier.join(', ') + '];';
    assert.ok(jsx.indexOf(line) !== -1, 'jsx missing ' + line);
  });
});
