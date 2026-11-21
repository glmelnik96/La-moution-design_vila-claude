const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lint, stripStringsAndComments } = require('./lint-jsx.js');

test('stripStringsAndComments blanks strings and comments but keeps line count', () => {
  const src = 'var a = "x => y"; // let z\n/* const q */ var b = 1;';
  const out = stripStringsAndComments(src);
  assert.strictEqual(out.split('\n').length, 2);
  assert.ok(!/=>/.test(out));
  assert.ok(!/let z/.test(out));
  assert.ok(!/const q/.test(out));
  assert.ok(/var b = 1;/.test(out));
});

test('lint rejects ES5+/ES6 syntax that ES3 cannot parse', () => {
  assert.ok(lint('let a = 1; JSON.stringify({a:a})').errors.some(e => /let\/const/.test(e)));
  assert.ok(lint('var f = (x) => x; JSON.stringify(1)').errors.some(e => /arrow/.test(e)));
  assert.ok(lint('var s = `t`; JSON.stringify(1)').errors.some(e => /template/.test(e)));
  assert.ok(lint('var a = [1, 2,]; JSON.stringify(a)').errors.some(e => /trailing comma/.test(e)));
});

test('lint rejects reserved words as object keys (quirk #21) but not ternaries', () => {
  assert.ok(lint('JSON.stringify({ char: 1 })').errors.some(e => /reserved word "char"/.test(e)));
  assert.ok(lint('JSON.stringify({ cell: 1 })').errors.length === 0);
  assert.ok(lint('var v = x ? {a:1} : 2; JSON.stringify(v)').errors.length === 0);
});

test('lint flags non-ASCII identifiers (quirk #19) as errors, Cyrillic in strings as a warning', () => {
  assert.ok(lint('var nо = 1; JSON.stringify(nо)').errors.some(e => /non-ASCII/.test(e)));   // Cyrillic о
  const r = lint('var s = "Привет"; JSON.stringify(s)');
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.warnings.some(w => /raw Cyrillic/.test(w)));
});

test('lint warns when the payload does not end in JSON.stringify and when mutating without an undo group', () => {
  const r = lint('var L = comp.layers.addText("x"); L.name = "y";');
  assert.ok(r.warnings.some(w => /JSON\.stringify/.test(w)));
  assert.ok(r.warnings.some(w => /beginUndoGroup/.test(w)));
  const ok = lint('JSON.stringify(M.run("x", function(){ var L = comp.layers.addText("x"); return {n:1}; }))');
  assert.strictEqual(ok.warnings.length, 0);
});

test('lint warns on ES5 array extras except through the M.* shims', () => {
  assert.ok(lint('[1].forEach(function(){}); JSON.stringify(1)').warnings.some(w => /forEach/.test(w)));
  assert.strictEqual(lint('M.each([1], function(){}); JSON.stringify(1)').warnings.filter(w => /each/.test(w)).length, 0);
});

test('the shipped ES3 library and generated tokens pass the lint with no errors', () => {
  ['lib/cloudru-motion.jsx', 'lib/tokens.jsx', 'es-json.jsx'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const r = lint(src, { lib: true });
    assert.deepStrictEqual(r.errors, [], f + ': ' + r.errors.join('; '));
    assert.deepStrictEqual(r.warnings, [], f + ': ' + r.warnings.join('; '));
  });
});
