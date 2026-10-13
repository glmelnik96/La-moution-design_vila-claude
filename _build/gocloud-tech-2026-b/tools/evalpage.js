// evalpage.js — open a page in headless Chrome, wait for an expression to be truthy, evaluate another, print JSON.
//   node _build/gocloud-tech-2026-b/tools/evalpage.js <page.html?query> "<ready expr>" "<expr>" [w h]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { findChrome, fileUrl } = require('../../../html/render/render.js');

const [page, readyX, expr, W = 2304, H = 1280] = process.argv.slice(2);
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
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value; }
}
(async () => {
  const port = 9800 + Math.floor(Math.random() * 90);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'evalpage-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + prof,
    '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { await sleep(100); try { t = (await (await fetch('http://127.0.0.1:' + port + '/json')).json()).find((x) => x.type === 'page'); } catch (e) { /* not yet */ } }
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
  const q = page.indexOf('?');
  const url = q < 0 ? fileUrl(page) : fileUrl(page.slice(0, q)) + page.slice(q);
  await cdp.send('Page.navigate', { url });
  let ok = false;
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await cdp.eval(readyX)) { ok = true; break; } } catch (e) { /* not yet */ } }
  if (!ok) console.error('ready expression never became truthy');
  try { console.log(JSON.stringify(await cdp.eval(expr), null, 1)); } catch (e) { console.error(e.message); }
  const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && /error|warn/.test(e.params.type)));
  errs.slice(0, 5).forEach((e) => console.error('console:', JSON.stringify(e.params).slice(0, 400)));
  cdp.ws.close(); chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* ignore */ }
})().catch((e) => { console.error(e); process.exit(1); });
