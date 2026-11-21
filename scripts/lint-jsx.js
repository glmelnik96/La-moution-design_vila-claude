// lint-jsx.js — pre-flight for ExtendScript payloads BEFORE they reach After Effects.
//
//   node scripts/lint-jsx.js file.jsx [more.jsx]     # exit 1 on errors
//   const { lint } = require('./lint-jsx');  lint(src) -> { errors: [], warnings: [] }
//
// Why: a syntax error inside AE does not come back over the bridge — it raises a MODAL
// dialog that blocks the host thread, and every retry queues another one (quirks #11, #25).
// ExtendScript is ES3, so the usual `new Function(src)` parse check is a false negative for
// ES5+ syntax and for reserved-word object keys (quirk #21). This lint catches both classes.
const fs = require('fs');
const vm = require('vm');

const RESERVED_KEYS = 'char|class|int|float|double|final|goto|enum|byte|short|long|native|super|throws|transient|volatile|abstract|boolean|export|import|extends|implements|interface|package|private|protected|public|static|synchronized|debugger|with|function|var|new|delete|typeof|in|instanceof|void|this|null|true|false|if|else|for|while|do|switch|case|default|break|continue|return|try|catch|finally|throw';
// ES5 Array/Object/String extras that ExtendScript does not have
const ES5_MEMBERS = ['forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'indexOf', 'lastIndexOf', 'trim', 'isArray', 'keys', 'create', 'defineProperty', 'freeze', 'bind'];

function stripStringsAndComments(src) {
  // Replace string/comment contents with spaces (keeps line numbers and offsets).
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'") {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += q; i++;
    } else { out += c; i++; }
  }
  return out;
}

function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

function lint(src, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  const clean = stripStringsAndComments(src);

  // 1. Hard parse (catches unbalanced braces etc.)
  try { new vm.Script(src, { filename: 'payload.jsx' }); }
  catch (e) { errors.push('parse: ' + e.message); }

  // 2. ES5+/ES6 syntax that ES3 rejects
  const syntax = [
    [/(^|[^\w$])(let|const)\s+[\w$]/, 'let/const (use var)'],
    [/=>/, 'arrow function (use function)'],
    [/`/, 'template literal (use string concatenation)'],
    [/(^|[^\w$])class\s+[\w$]+\s*\{/, 'class declaration'],
    [/\.\.\.[\w$[]/, 'spread/rest'],
    [/(^|[^\w$])(get|set)\s+[\w$]+\s*\(\s*\)\s*\{/, 'getter/setter'],
    [/,\s*[\]}]/, 'trailing comma before ] or } (ES3 miscounts array length / throws)'],
    [/(^|[^\w$])(async|await|yield)\s/, 'async/await/yield']
  ];
  syntax.forEach(([re, why]) => {
    const m = re.exec(clean);
    if (m) errors.push('ES3: ' + why + ' at line ' + lineOf(clean, m.index));
  });

  // 3. Reserved words as object-literal keys (quirk #21)
  const reKey = new RegExp('[{,]\\s*(' + RESERVED_KEYS + ')\\s*:', 'g');
  let m;
  while ((m = reKey.exec(clean))) {
    // `default:` inside a switch and `case x:` are legal — skip when preceded by newline+case/default patterns
    const before = clean.slice(Math.max(0, m.index - 40), m.index);
    if (/\?\s*$/.test(before)) continue;                       // ternary `a ? b : c` false positive guard
    errors.push('ES3: reserved word "' + m[1] + '" used as object key at line ' + lineOf(clean, m.index) + ' (quirk #21)');
  }

  // 4. ES5 built-ins that ExtendScript lacks (warn — a shim may be present)
  ES5_MEMBERS.forEach((name) => {
    const re = new RegExp('\\.' + name + '\\s*\\(', 'g');
    const mm = re.exec(clean);
    if (mm) {
      // Allow the lib's own M.map/M.each/M.indexOf shims
      const before = clean.slice(Math.max(0, mm.index - 2), mm.index);
      if (/\bM$/.test(before) || /\bJSON$/.test(before)) return;
      warnings.push('ES5 built-in .' + name + '() at line ' + lineOf(clean, mm.index) + ' — ExtendScript has no Array/Object/String ES5 extras; use M.each/M.map/M.indexOf or a loop');
    }
  });
  if (/JSON\.parse\s*\(/.test(clean) && !opts.lib) {
    warnings.push('JSON.parse used — es-json.jsx only polyfills stringify; pass --lib (adds an eval-based parse) or avoid it');
  }

  // 5. Result contract: the LAST statement must produce the JSON string
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l && !/^\/\//.test(l));
  const tail = lines.slice(-3).join(' ');
  if (!opts.lib && !/JSON\.stringify\s*\(/.test(tail)) {
    warnings.push('last statement does not call JSON.stringify(...) — ae.js will report "empty result" (quirk #16). End with JSON.stringify(M.run("label", function(){...}))');
  }

  // 6. Undo discipline
  if (/setValue|addProperty|addText|addShape|addSolid|\.remove\(\)/.test(clean) &&
      !/beginUndoGroup/.test(clean) && !/M\.run\s*\(/.test(clean)) {
    warnings.push('mutations without app.beginUndoGroup / M.run — one Ctrl+Z will not revert the whole action (quirk #10)');
  }

  // 7. Non-ASCII outside strings/comments is almost always a Cyrillic letter in an identifier (quirk #19)
  const nonAscii = /[^\x00-\x7f]/.exec(clean);
  if (nonAscii) errors.push('non-ASCII character in code (outside strings/comments) at line ' + lineOf(clean, nonAscii.index) + ' — Cyrillic in an identifier? (quirk #19)');
  const rawCyr = /[Ѐ-ӿ]/.exec(src);
  if (rawCyr && !nonAscii && !opts.lib) warnings.push('raw Cyrillic inside a string at line ' + lineOf(src, rawCyr.index) + ' — fine over CDP, but write generated files with encoding="ascii" (\\uXXXX) to be safe (quirk #19)');

  return { errors, warnings };
}

module.exports = { lint, stripStringsAndComments };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/lint-jsx.js file.jsx [...]'); process.exit(2); }
  let bad = 0;
  files.forEach((f) => {
    const r = lint(fs.readFileSync(f, 'utf8'), { lib: /cloudru-motion|tokens\.jsx/.test(f) });
    r.warnings.forEach((w) => console.log('WARN  ' + f + ': ' + w));
    r.errors.forEach((e) => console.log('ERROR ' + f + ': ' + e));
    if (r.errors.length) bad += 1;
    else console.log('OK    ' + f + (r.warnings.length ? ' (' + r.warnings.length + ' warning(s))' : ''));
  });
  process.exit(bad ? 1 : 0);
}
