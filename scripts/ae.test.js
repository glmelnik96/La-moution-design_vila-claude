const { test } = require('node:test');
const assert = require('node:assert');
const { buildPayload, parseResponse } = require('./ae.js');

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
