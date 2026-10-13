// navtest.js — drive the deck in real time like a speaker would (headless Chrome over CDP):
// open it, press → through all slides, ← back, R, a digit; screenshot along the way; report console errors.
//   node _build/gocloud-tech-2026/tools/navtest.js <page.html> <outdir> [w h]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { findChrome, fileUrl } = require('../../../html/render/render.js');

const [page, out, W = 1920, H = 1080] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); this.events = []; }
  async open() {
    this.ws = new WebSocket(this.u);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result); }
      else if (m.method) this.events.push(m);
    };
  }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.p.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
}

(async () => {
  const port = 9900 + Math.floor(Math.random() * 90);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'navtest-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + prof,
    '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { await sleep(100); try { t = (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).find((x) => x.type === 'page'); } catch (e) { /* not yet */ } }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: fileUrl(page) });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await cdp.eval('!!window.__deck')) break; }
  let n = 0;
  async function shot(tag) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    const f = path.join(out, String(++n).padStart(2, '0') + '_' + tag + '.jpg');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    const cur = await cdp.eval('__deck.cur');
    console.log(f, 'cur=' + cur);
  }
  async function key(k, code, kc) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code, windowsVirtualKeyCode: kc });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code, windowsVirtualKeyCode: kc });
  }
  await sleep(4200); await shot('s1_rest');
  for (let s = 2; s <= 7; s++) {
    await key('ArrowRight', 'ArrowRight', 39);
    await sleep(120); await shot('s' + s + '_t0.12');
    await sleep(1100); await shot('s' + s + '_t1.2');
    await sleep(3000); await shot('s' + s + '_rest');
  }
  await key('ArrowRight', 'ArrowRight', 39); await sleep(300); await shot('past_end');
  await key('ArrowLeft', 'ArrowLeft', 37); await sleep(300); await shot('back_s6');
  await key('3', 'Digit3', 51); await sleep(1000); await shot('jump_s3_t1');
  await key('ArrowRight', 'ArrowRight', 39); await sleep(80); await key('ArrowRight', 'ArrowRight', 39); await sleep(4000); await shot('double_s5_rest');
  const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && /error|warn/.test(e.params.type)) || (e.method === 'Log.entryAdded' && /error|warning/.test(e.params.entry.level)));
  console.log('console problems:', errs.length);
  errs.slice(0, 10).forEach((e) => console.log(JSON.stringify(e.params).slice(0, 400)));
  cdp.ws.close(); chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
