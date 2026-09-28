#!/usr/bin/env node
// shoot.js — capture many (page, time) stills with ONE headless Chrome (Figma verification).
//   node tools/shoot.js --jobs jobs.json [--outw 1080]
//   jobs.json: [{ "page": "v1.html?frame=F8", "t": 0, "out": "out/verify/A_F8.png" }, …]
// Size: the page's own design frame (window.Fig.FW x FH, from window.FIG_FRAME) at 1 CSS px = 1 px;
// --outw N rasterises that frame at DPR N / FW (the delivery size); --w/--h force a viewport.
// Pages must call Motion.mount(tl) (window.__motion). Chrome: CHROME_PATH, else the system Chrome.
// EXTRA_FLAGS="--a --b" adds Chrome switches (experiments).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

function args(argv) {
  const o = { w: null, h: null, jobs: null, outw: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = () => argv[++i];
    if (a === '--w') o.w = Number(n()); else if (a === '--h') o.h = Number(n());
    else if (a === '--jobs') o.jobs = n(); else if (a === '--outw') o.outw = Number(n());
  }
  return o;
}
function chromePath() {
  const c = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'];
  return c.find((p) => p && fs.existsSync(p));
}
// Figma anti-aliases text in greyscale; Chrome on Windows would use ClearType (colour fringes, heavier glyphs).
const CHROME_FLAGS = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu',
  '--force-device-scale-factor=1', '--allow-file-access-from-files', '--font-render-hinting=none', '--disable-lcd-text'];

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); }
  async open() {
    this.ws = new WebSocket(this.u);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result); } };
  }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.p.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fileUrl(p) {
  const i = p.indexOf('?'); const file = i >= 0 ? p.slice(0, i) : p, qs = i >= 0 ? p.slice(i) : '';
  const abs = path.resolve(file).replace(/\\/g, '/');
  return 'file:///' + abs.replace(/^\//, '') + qs + (qs ? '&' : '?') + 'render';
}

async function launch(w, h, dpr) {
  const bin = chromePath(); if (!bin) throw new Error('no Chrome — set CHROME_PATH');
  const port = 9400 + Math.floor(Math.random() * 400);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-shoot-'));
  const extra = (process.env.EXTRA_FLAGS || '').split(' ').filter(Boolean);
  const child = spawn(bin, CHROME_FLAGS.concat(['--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + prof,
    '--window-size=' + (w || 1080) + ',' + (h || 1920)], extra, ['about:blank']), { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 100 && !targets; i++) { await sleep(100); try { const t = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (t.length) targets = t; } catch (e) { /* not yet */ } }
  if (!targets) { child.kill(); throw new Error('Chrome did not start'); }
  const cdp = new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const B = { cdp, child, prof, clip: null, close() { try { cdp.ws.close(); } catch (e) { /* ignore */ } child.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ } } };
  await metrics(B, w || 1080, h || 1920, dpr || 1);
  return B;
}
async function metrics(B, w, h, dpr) {
  await B.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  B.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
}
async function open(cdp, page) {
  await cdp.send('Page.navigate', { url: fileUrl(page) });
  for (let i = 0; i < 150; i++) { await sleep(60); try { if (await cdp.eval('!!(window.__motion && window.__motion.ready)')) return; } catch (e) { /* loading */ } }
  throw new Error('page not ready: ' + page);
}
// Open a page at its own design frame: read Fig.FW/FH, size the viewport to floor(FW) CSS px (stage
// scale ≈ 1) and, for a delivery render, rasterise at DPR = outw / FW — Chrome then places glyphs in
// device pixels; a CSS scale() would magnify its per-element baseline rounding (quirk #193).
async function openFrame(B, page, o) {
  await open(B.cdp, page);
  if (o.w && o.h && !o.outw) { await metrics(B, o.w, o.h, 1); await open(B.cdp, page); return { FW: o.w, FH: o.h, dpr: 1 }; }
  const fr = await B.cdp.eval('window.Fig ? { w: Fig.FW, h: Fig.FH } : { w: innerWidth, h: innerHeight }');
  const dpr = o.outw ? o.outw / fr.w : 1;
  await metrics(B, Math.floor(fr.w + 1e-6), Math.floor(fr.h + 1e-6) + (Number.isInteger(fr.h) ? 0 : 1), dpr);
  await open(B.cdp, page);
  B.clip = { x: 0, y: 0, width: fr.w, height: fr.h, scale: 1 };
  return { FW: fr.w, FH: fr.h, dpr: dpr };
}

async function main() {
  const o = args(process.argv.slice(2));
  const jobs = JSON.parse(fs.readFileSync(o.jobs, 'utf8'));
  const B = await launch(o.w, o.h, 1);
  try {
    let cur = null;
    for (const j of jobs) {
      if (j.page !== cur) { await openFrame(B, j.page, o); cur = j.page; }
      await B.cdp.eval('__motion.seek(' + (j.t || 0) + ')');
      await sleep(30);
      const r = await B.cdp.send('Page.captureScreenshot', { format: 'png', clip: B.clip });
      fs.mkdirSync(path.dirname(path.resolve(j.out)), { recursive: true });
      fs.writeFileSync(j.out, Buffer.from(r.data, 'base64'));
      process.stdout.write(j.out + '\n');
    }
  } finally { B.close(); }
}

module.exports = { launch, open, openFrame, metrics, fileUrl, CHROME_FLAGS, sleep };
if (require.main === module) main().catch((e) => { console.error('ERROR ' + e.message); process.exit(1); });
