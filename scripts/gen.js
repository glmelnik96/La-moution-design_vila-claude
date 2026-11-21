// gen.js — Phygital sidecar client: lifecycle + /jobs API.
// Commands: start | health | cost | submit | wait | enhance
// Pure helpers are exported for unit tests; HTTP/spawn live below.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SIDECAR_URL = process.env.PHYGITAL_URL || 'http://127.0.0.1:8765';
const DATA_ROOT = process.env.PHYGITAL_DATA_ROOT ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'PhygitalStudio-data');
// The sidecar's token can live in two places depending on who launched it:
//  1. DATA_ROOT/PhygitalStudio — where a gen.js-launched sidecar writes it,
//     because startSidecar() overrides LOCALAPPDATA=DATA_ROOT (see below).
//  2. The *real* %LOCALAPPDATA%/PhygitalStudio — where the standalone Phygital
//     Studio app writes it (the common case).
// LIVE-VERIFIED: both files can exist with DIFFERENT 43-byte tokens, so we can't
// tell from disk which one the running sidecar validates — we probe each token
// against the sidecar (see api()) and keep whichever authenticates.
function tokenCandidates(env = process.env) {
  const home = env.USERPROFILE || env.HOME;
  const dataRoot = env.PHYGITAL_DATA_ROOT ||
    path.join(home, 'Documents', 'PhygitalStudio-data');
  const cands = [path.join(dataRoot, 'PhygitalStudio', 'sidecar.token')];
  if (env.LOCALAPPDATA) {
    const real = path.join(env.LOCALAPPDATA, 'PhygitalStudio', 'sidecar.token');
    if (cands.indexOf(real) === -1) { cands.push(real); }
  }
  return cands;
}

// Read every distinct non-empty token from the candidate paths (order preserved).
function readTokens() {
  const out = [];
  const seen = {};
  tokenCandidates().forEach((p) => {
    try {
      const t = fs.readFileSync(p, 'utf8').trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    } catch (e) { /* missing candidate — skip */ }
  });
  return out;
}
const SIDECAR_DIR = process.env.PHYGITAL_SIDECAR_DIR ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'Phygital-Adobe-Studio', 'sidecar');

const ACTIVE = ['queued', 'pending', 'waiting_for_launch', 'running', 'downloading', 'processing'];
const FAILED = ['failed', 'error', 'canceled', 'cancelled'];

function parseArgs(argv) {
  const cmd = argv[0];
  const opts = {};
  const positional = [];
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.indexOf('--') === 0) { opts[a.slice(2)] = argv[i + 1]; i += 1; }
    else { positional.push(a); }
  }
  return { cmd, opts, positional };
}

function buildJobBody(opts) {
  const body = { node_id: Number(opts.node), params: {} };
  if (opts.params) { body.params = JSON.parse(opts.params); }
  if (opts.init) {
    body.init_files = {};
    opts.init.split(',').forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > 0) { body.init_files[pair.slice(0, idx)] = pair.slice(idx + 1); }
    });
  }
  return body;
}

function classifyJob(state) {
  if (!state || typeof state !== 'object') { return { kind: 'pending' }; }
  if (state.status === 'completed' && Array.isArray(state.result_paths) && state.result_paths.length) {
    return { kind: 'success', paths: state.result_paths };
  }
  if (state.error || FAILED.indexOf(state.status) !== -1) {
    return { kind: 'failure', error: state.error || state.status };
  }
  return { kind: 'pending', status: state.status, progress: state.progress };
}

module.exports = { parseArgs, buildJobBody, classifyJob, tokenCandidates, ACTIVE, FAILED };

// ── I/O shell ────────────────────────────────────────────────────────────
// Once a token authenticates we cache it so we don't re-probe every call.
let cachedToken = null;

async function fetchJson(method, route, body, tok) {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) { headers['X-Phygital-Sidecar-Token'] = tok; }
  const res = await fetch(SIDECAR_URL + route, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
  return { res, text, json };
}

async function api(method, route, body, needsToken = true) {
  if (!needsToken) {
    const r = await fetchJson(method, route, body, null);
    if (!r.res.ok) throw new Error('sidecar ' + method + ' ' + route + ' → ' + r.res.status + ': ' + r.text);
    return r.json;
  }

  // Probe candidate tokens; the sidecar tells us which one it validates.
  const tokens = readTokens();
  if (cachedToken) {
    const i = tokens.indexOf(cachedToken);
    if (i > 0) { tokens.splice(i, 1); }
    if (i !== 0) { tokens.unshift(cachedToken); }
  }
  if (!tokens.length) {
    throw new Error('sidecar token not found (looked in: ' +
      tokenCandidates().join(', ') + ') — is the sidecar started?');
  }
  let last;
  for (let i = 0; i < tokens.length; i += 1) {
    const r = await fetchJson(method, route, body, tokens[i]);
    last = r;
    if (r.res.status === 401 || r.res.status === 403) {
      if (cachedToken === tokens[i]) { cachedToken = null; }
      continue;                       // this token rejected — try the next
    }
    if (!r.res.ok) throw new Error('sidecar ' + method + ' ' + route + ' → ' + r.res.status + ': ' + r.text);
    cachedToken = tokens[i];          // this token works — remember it
    return r.json;
  }
  throw new Error('sidecar ' + method + ' ' + route + ' → ' + last.res.status + ': ' + last.text +
    ' (all candidate tokens rejected; looked in: ' + tokenCandidates().join(', ') + ')');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function health() { return api('GET', '/health', null, false); }

async function startSidecar() {
  const py = path.join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe');
  const child = spawn(py, ['-m', 'app.main'], {
    cwd: SIDECAR_DIR,
    env: Object.assign({}, process.env, { LOCALAPPDATA: DATA_ROOT }),
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  // Poll /health for up to 30s.
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    try { const h = await health(); if (h && h.ok !== false) return h; } catch (e) { /* not up yet */ }
  }
  throw new Error('sidecar did not become healthy within 30s');
}

async function waitJob(jobId) {
  for (;;) {
    const state = await api('GET', '/jobs/' + jobId);
    const c = classifyJob(state);
    if (c.kind === 'success') return c.paths;
    if (c.kind === 'failure') throw new Error('job ' + jobId + ' failed: ' + c.error);
    await sleep(1500);
  }
}

async function main() {
  const { cmd, opts, positional } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'start':   return startSidecar();
    case 'health':  return health();
    case 'cost':    return api('POST', '/jobs/preview-cost', buildJobBody(opts));
    case 'enhance': return api('POST', '/enhance', { prompt: opts.prompt });
    case 'submit':  return api('POST', '/jobs', buildJobBody(opts));
    case 'wait':    return { result_paths: await waitJob(positional[0] || opts.job) };
    case 'generate': {
      const { job_id } = await api('POST', '/jobs', buildJobBody(opts));
      return { job_id, result_paths: await waitJob(job_id) };
    }
    default:
      throw new Error('unknown command: ' + cmd + ' (start|health|cost|submit|wait|generate|enhance)');
  }
}

if (require.main === module) {
  main()
    .then(v => { console.log(JSON.stringify(v, null, 2)); })
    .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
