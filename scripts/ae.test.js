const { test } = require('node:test');
const assert = require('node:assert');
const { buildPayload, parseResponse, parseCli, preludeFor, LIB_FILES } = require('./ae.js');

test('buildPayload embeds jsx as an escaped string literal', () => {
  const out = buildPayload('alert("hi");', 'PRELUDE;');
  assert.match(out, /new CSInterface\(\)/);
  assert.match(out, /cs\.evalScript/);
  // The prelude and jsx are JSON-escaped into one literal:
  assert.ok(out.includes(JSON.stringify('PRELUDE;\nalert("hi");')));
});

test('parseResponse parses JSON tool output', () => {
  assert.deepStrictEqual(parseResponse('{"ok":true,"n":3}'), { ok: true, n: 3 });
});

test('parseResponse wraps non-JSON as {raw}', () => {
  assert.deepStrictEqual(parseResponse('42'), 42);              // valid JSON number
  assert.deepStrictEqual(parseResponse('just text'), { raw: 'just text' });
});

test('parseResponse throws on empty / bridge / evalScript errors', () => {
  assert.throws(() => parseResponse(''), /empty/);
  assert.throws(() => parseResponse('undefined'), /empty/);
  assert.throws(() => parseResponse('AE_BRIDGE_ERROR: boom'), /AE_BRIDGE_ERROR/);
  assert.throws(() => parseResponse('EvalScript error.'), /EvalScript error/);
});

test('parseCli understands --lib, --no-lint, --timeout and the payload argument', () => {
  const c = parseCli(['--lib', '--timeout', '300000', '@x.jsx']);
  assert.strictEqual(c.lib, true);
  assert.strictEqual(c.lint, true);
  assert.strictEqual(c.timeout, 300000);
  assert.strictEqual(c.arg, '@x.jsx');
  const d = parseCli(['app.project.name', '--no-lint']);
  assert.strictEqual(d.lint, false);
  assert.strictEqual(d.arg, 'app.project.name');
});

test('preludeFor(true) prepends es-json + tokens + the motion lib, in that order', () => {
  const p = preludeFor(true);
  const iJson = p.indexOf('JSON.stringify = function');
  const iTok = p.indexOf('var CR = {};');
  const iLib = p.indexOf('var M = {};');
  assert.ok(iJson !== -1 && iTok > iJson && iLib > iTok, 'order must be es-json, tokens, lib');
  assert.deepStrictEqual(LIB_FILES, ['lib/tokens.jsx', 'lib/cloudru-motion.jsx']);
  assert.ok(preludeFor(false).indexOf('var M = {};') === -1);
});
