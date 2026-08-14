// ae.js — run arbitrary ExtendScript in the live AE panel via CDP (port 8092).
// Usage:
//   node ae.js "@payload.jsx"      # read jsx from a file
//   node ae.js "app.project.name"  # inline jsx (must END in a JSON.stringify(...) expression)
// The jsx's LAST expression must evaluate to a JSON string, e.g.:
//   ... build result object ...; JSON.stringify(result)
const fs = require('fs');
const path = require('path');

const CDP_PORT = process.env.AE_CDP_PORT || '8092';

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

async function run(jsx) {
  const prelude = fs.readFileSync(path.join(__dirname, 'es-json.jsx'), 'utf8');
  const expression = buildPayload(jsx, prelude);

  const targets = await (await fetch('http://localhost:' + CDP_PORT + '/json')).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('AE panel CDP target not found on port ' + CDP_PORT + ' — is the panel open?');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const reply = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('CDP timeout (120s)')), 120000);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id === 1) { clearTimeout(timer); res(msg); }
    };
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, timeout: 110000 }
    }));
  });
  ws.close();

  const r = reply.result;
  if (r.exceptionDetails) throw new Error('CDP EXCEPTION: ' + JSON.stringify(r.exceptionDetails));
  const value = r.result && r.result.value !== undefined ? r.result.value : '';
  return parseResponse(value);
}

module.exports = { buildPayload, parseResponse, run };

if (require.main === module) {
  let arg = process.argv[2];
  if (!arg) { console.error('usage: node ae.js "@file.jsx" | "<inline jsx>"'); process.exit(1); }
  if (arg.startsWith('@')) arg = fs.readFileSync(arg.slice(1), 'utf8');
  run(arg)
    .then(v => { console.log(JSON.stringify(v, null, 2)); })
    .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
