// ae.js — run arbitrary ExtendScript in the live AE panel via CDP (port 8092).
// Usage:
//   node ae.js "@payload.jsx"             # read jsx from a file
//   node ae.js --lib "@payload.jsx"       # prepend the Cloud.ru motion lib (tokens.jsx + cloudru-motion.jsx) → `CR`, `M`
//   node ae.js "app.project.name"         # inline jsx (must END in a JSON.stringify(...) expression)
//   node ae.js --no-lint "@x.jsx"         # skip the ES3 pre-flight (not recommended)
//   node ae.js --timeout 300000 "@x.jsx"  # CDP timeout in ms (default 120000)
// The jsx's LAST expression must evaluate to a JSON string, e.g.:
//   ... build result object ...; JSON.stringify(result)
// With --lib the recommended shape is:
//   JSON.stringify(M.run("label", function () { ...; return { anything: 1 }; }))
//
// Every payload is linted first (scripts/lint-jsx.js). A syntax error that reaches AE raises a
// modal that blocks the bridge (quirks #11/#25), so refusing to send a bad payload is cheaper
// than any retry.
const fs = require('fs');
const path = require('path');
const { lint } = require('./lint-jsx');

const CDP_PORT = process.env.AE_CDP_PORT || '8092';
const LIB_FILES = ['lib/tokens.jsx', 'lib/cloudru-motion.jsx'];

function buildPayload(jsx, prelude) {
  const full = (prelude || '') + '\n' + jsx;
  const literal = JSON.stringify(full);
  return '(function(){var __jsx=' + literal + ';' +
    'return new Promise(function(res){try{var cs=new CSInterface();' +
    'cs.evalScript(__jsx,function(r){res(r);});}' +
    'catch(e){res("AE_BRIDGE_ERROR: "+String(e));}});})()';
}

function parseResponse(str) {
  if (typeof str !== 'string' || str === '' || str === 'undefined' || str === 'null') {
    throw new Error('AE returned empty result');
  }
  if (str.indexOf('AE_BRIDGE_ERROR') === 0) { throw new Error(str); }
  if (str.indexOf('EvalScript error') === 0) { throw new Error(str); }
  try { return JSON.parse(str); }
  catch (e) { return { raw: str }; }
}

function parseCli(argv) {
  const opts = { lib: false, lint: true, timeout: 120000, arg: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--lib') opts.lib = true;
    else if (a === '--no-lint') opts.lint = false;
    else if (a === '--timeout') { opts.timeout = Number(argv[i + 1]); i += 1; }
    else if (opts.arg === null) opts.arg = a;
  }
  return opts;
}

function preludeFor(lib) {
  let p = fs.readFileSync(path.join(__dirname, 'es-json.jsx'), 'utf8');
  if (lib) {
    LIB_FILES.forEach((f) => { p += '\n' + fs.readFileSync(path.join(__dirname, f), 'utf8'); });
  }
  return p;
}

async function run(jsx, options) {
  const o = Object.assign({ lib: false, lint: true, timeout: 120000 }, options || {});
  if (o.lint) {
    const r = lint(jsx, { lib: false });
    r.warnings.forEach((w) => console.error('LINT WARN: ' + w));
    if (r.errors.length) {
      throw new Error('payload rejected by lint (would raise a blocking modal in AE):\n  ' + r.errors.join('\n  '));
    }
  }
  const prelude = preludeFor(o.lib);
  const expression = buildPayload(jsx, prelude);

  const targets = await (await fetch('http://localhost:' + CDP_PORT + '/json')).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('AE panel CDP target not found on port ' + CDP_PORT + ' — is the panel open?');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const reply = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('CDP timeout (' + Math.round(o.timeout / 1000) + 's) — a modal dialog is probably blocking AE; STOP calling AE and ask the user to dismiss it (quirk #25)')), o.timeout);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id === 1) { clearTimeout(timer); res(msg); }
    };
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, timeout: Math.max(1000, o.timeout - 10000) }
    }));
  });
  ws.close();

  const r = reply.result;
  if (r.exceptionDetails) throw new Error('CDP EXCEPTION: ' + JSON.stringify(r.exceptionDetails));
  const value = r.result && r.result.value !== undefined ? r.result.value : '';
  return parseResponse(value);
}

module.exports = { buildPayload, parseResponse, parseCli, preludeFor, run, LIB_FILES };

if (require.main === module) {
  const cli = parseCli(process.argv.slice(2));
  let arg = cli.arg;
  if (!arg) { console.error('usage: node ae.js [--lib] [--no-lint] [--timeout ms] "@file.jsx" | "<inline jsx>"'); process.exit(1); }
  if (arg.startsWith('@')) arg = fs.readFileSync(arg.slice(1), 'utf8');
  run(arg, cli)
    .then(v => { console.log(JSON.stringify(v, null, 2)); })
    .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
