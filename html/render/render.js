// render.js — render an HTML motion page to review stills, a beat sheet, and video with headless Chrome over CDP.
//
//   node html/render/render.js html/templates/showreel.html --out out/showreel \
//        [--fps 25] [--w 1920 --h 1080] [--scale 0.5] [--from 0 --to 6] \
//        [--beats auto|all|0.5,1.2,3|none] [--sheet out/beats.png] \
//        [--video out/showreel.mp4|.webm] [--frames]
//
// No npm dependencies: raw DevTools protocol (fetch + WebSocket, Node ≥ 22). Finds a
// Chrome/Chromium binary (CHROME_PATH env, Playwright cache, common install paths) and ffmpeg
// (FFMPEG_PATH env, PATH, Playwright cache). The page must call Motion.mount(tl) so that
// window.__motion.seek(t) exists; every frame is a deterministic seek + screenshot.
//
// Outputs in <out>/: beat_<ms>.png review stills · sheet (composed IN the browser, so it needs
// no ffmpeg) · f00001.png… only with --frames · video streamed to ffmpeg as JPEG frames over
// a pipe (works with the minimal Playwright ffmpeg too: .webm/VP8 always, .mp4/H.264 when the
// build has libx264 — otherwise it falls back to .webm and says so).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = { fps: 0, w: 1920, h: 1080, scale: 1, from: 0, to: null, out: 'out/render', video: null, beats: 'auto', sheet: null, frames: false, page: null, port: 0, quiet: false, jpegQuality: 92 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--w') o.w = Number(next());
    else if (a === '--h') o.h = Number(next());
    else if (a === '--scale') o.scale = Number(next());
    else if (a === '--from') o.from = Number(next());
    else if (a === '--to') o.to = Number(next());
    else if (a === '--video' || a === '--mp4' || a === '--webm') o.video = next();
    else if (a === '--beats') o.beats = next();
    else if (a === '--sheet') o.sheet = next();
    else if (a === '--frames') o.frames = true;
    else if (a === '--port') o.port = Number(next());
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--quality') o.jpegQuality = Number(next());
    else if (!o.page) o.page = a;
  }
  return o;
}

function firstExisting(cands) { return cands.find((p) => { try { return p && fs.existsSync(p); } catch (e) { return false; } }) || null; }
function globDirs(base, prefix) {
  try { return fs.readdirSync(base).filter((d) => d.indexOf(prefix) === 0).map((d) => path.join(base, d)); } catch (e) { return []; }
}
function pwCache() {
  const env = process.env;
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}
function findChrome() {
  const env = process.env;
  const pw = pwCache();
  const cands = [env.CHROME_PATH, env.CHROMIUM_PATH];
  globDirs(pw, 'chromium-').forEach((d) => {
    cands.push(path.join(d, 'chrome-linux', 'chrome'), path.join(d, 'chrome-win', 'chrome.exe'),
      path.join(d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      path.join(d, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  });
  cands.push(path.join(pw, 'chromium'), '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  if (env.PROGRAMFILES) cands.push(path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (env['PROGRAMFILES(X86)']) cands.push(path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  if (env.LOCALAPPDATA) cands.push(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return firstExisting(cands);
}
function findFfmpeg() {
  const env = process.env;
  const pw = pwCache();
  const cands = [env.FFMPEG_PATH];
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) cands.push(probe.stdout.trim().split(/\r?\n/)[0]);
  globDirs(pw, 'ffmpeg-').concat(globDirs('/opt/pw-browsers', 'ffmpeg-')).forEach((d) => { cands.push(path.join(d, 'ffmpeg-linux'), path.join(d, 'ffmpeg-win64.exe'), path.join(d, 'ffmpeg-mac'), path.join(d, 'ffmpeg-mac-arm64')); });
  return firstExisting(cands);
}
function ffmpegEncoders(bin) {
  const r = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.stdout || '';
}

// ───────── minimal CDP client ─────────
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = (e) => rej(new Error('ws error ' + (e.message || ''))); });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    };
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(o) {
  const bin = findChrome();
  if (!bin) throw new Error('no Chrome/Chromium found — set CHROME_PATH');
  const port = o.port || (9300 + Math.floor(Math.random() * 500));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-render-'));
  const args = ['--headless=new', '--remote-debugging-port=' + port, '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', '--window-size=' + o.w + ',' + o.h, '--allow-file-access-from-files', '--font-render-hinting=none', 'about:blank'];
  const child = spawn(bin, args, { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (targets.length) break; } catch (e) { /* not up yet */ }
  }
  if (!targets) { child.kill(); throw new Error('Chrome did not expose CDP on port ' + port); }
  const page = targets.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  return { child, cdp, profile, bin, port };
}

function fileUrl(p) {
  if (/^https?:\/\//.test(p)) return p;
  const abs = path.resolve(p);
  return 'file://' + (process.platform === 'win32' ? '/' + abs.replace(/\\/g, '/') : abs);
}

async function waitReady(cdp) {
  for (let i = 0; i < 150; i++) {
    let ready = false;
    try { ready = await cdp.eval('!!(window.__motion && window.__motion.ready)'); } catch (e) { ready = false; }
    if (ready) return true;
    await sleep(100);
  }
  return false;
}

// Compose the beat sheet in the browser: an HTML grid of the captured stills, screenshotted once.
async function composeSheet(cdp, o, beats, times, sheetPath) {
  const cols = Math.min(4, beats.length), rows = Math.ceil(beats.length / cols);
  const tw = Math.round(o.w * o.scale / 2), th = Math.round(o.h * o.scale / 2), pad = 10, labelH = 22;
  const W = cols * (tw + pad) + pad, H = rows * (th + pad + labelH) + pad;
  const cells = beats.map((b, i) => '<figure style="margin:0;width:' + tw + 'px"><img src="' + fileUrl(b) + '" style="width:' + tw + 'px;height:' + th + 'px;display:block">' +
    '<figcaption style="color:#9aa;font:12px/22px monospace;height:' + labelH + 'px">' + times[i].toFixed(2) + ' s · f' + Math.round(times[i] * o.fps) + '</figcaption></figure>').join('');
  const html = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;width:' + W + 'px;height:' + H + 'px"><div style="display:grid;grid-template-columns:repeat(' + cols + ',' + tw + 'px);gap:' + pad + 'px;padding:' + pad + 'px">' + cells + '</div>';
  const tmp = path.join(o.out, 'sheet.html');
  fs.writeFileSync(tmp, html);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: fileUrl(tmp) });
  await sleep(400);
  for (let i = 0; i < 50; i++) { if (await cdp.eval('Array.from(document.images).every(function(i){return i.complete})')) break; await sleep(100); }
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(sheetPath, Buffer.from(r.data, 'base64'));
  fs.unlinkSync(tmp);
}

async function render(o) {
  if (!o.page) throw new Error('usage: node html/render/render.js page.html --out dir [--video x.mp4|x.webm] [--beats auto|all|t1,t2] [--sheet sheet.png] [--frames]');
  fs.mkdirSync(o.out, { recursive: true });
  const log = (m) => { if (!o.quiet) console.error(m); };
  const { child, cdp, profile } = await launchChrome(o);
  const t0 = Date.now();
  let ffmpegProc = null;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.w, height: o.h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__RENDER__ = true;' });
    await cdp.send('Page.navigate', { url: fileUrl(o.page) });
    if (!(await waitReady(cdp))) throw new Error('page never called Motion.mount(tl) (window.__motion.ready) — open it in a browser and check the console');
    const meta = JSON.parse(await cdp.eval('JSON.stringify({ fps: __motion.fps, duration: __motion.duration, frames: __motion.frames, beats: __motion.beats, beatsAll: __motion.beatsAll || [] })'));
    const fps = o.fps || meta.fps; o.fps = fps;
    const to = o.to != null ? o.to : meta.duration;
    log('page ready: ' + meta.duration.toFixed(2) + 's @' + meta.fps + 'fps, ' + meta.frames + ' frames; window ' + o.from + '→' + to + 's, ' + fps + 'fps, scale ' + o.scale);

    async function shot(file, format, quality) {
      const p = { format: format || 'png', clip: { x: 0, y: 0, width: o.w, height: o.h, scale: o.scale }, captureBeyondViewport: false };
      if (format === 'jpeg') p.quality = quality || o.jpegQuality;
      const r = await cdp.send('Page.captureScreenshot', p);
      const buf = Buffer.from(r.data, 'base64');
      if (file) fs.writeFileSync(file, buf);
      return buf;
    }
    const result = { frames: [], beats: [], beatTimes: [], video: null, sheet: null, meta };

    // ── beats (review stills)
    let beatTimes = [];
    if (o.beats === 'auto') beatTimes = meta.beats;
    else if (o.beats === 'all') beatTimes = meta.beatsAll;
    else if (o.beats && o.beats !== 'none') beatTimes = o.beats.split(',').map(Number).filter((n) => !isNaN(n));
    beatTimes = beatTimes.filter((b) => b >= o.from && b <= to);
    for (const b of beatTimes) {
      await cdp.eval('__motion.seek(' + b + ')');
      await sleep(10);
      const f = path.join(o.out, 'beat_' + String(Math.round(b * 1000)).padStart(6, '0') + '.png');
      await shot(f, 'png');
      result.beats.push(f); result.beatTimes.push(b);
    }
    if (beatTimes.length) log('beats: ' + beatTimes.length + ' stills → ' + o.out);

    // ── frames / video
    if (o.frames || o.video) {
      let enc = null, outVideo = o.video;
      if (o.video) {
        const ffmpeg = findFfmpeg();
        if (!ffmpeg) throw new Error('ffmpeg not found — set FFMPEG_PATH (or drop --video and use --frames)');
        const encs = ffmpegEncoders(ffmpeg);
        const wantMp4 = /\.mp4$/i.test(outVideo);
        if (wantMp4 && /libx264/.test(encs)) enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart'];
        else if (/libvpx-vp9/.test(encs)) { enc = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-pix_fmt', 'yuv420p']; if (wantMp4) { outVideo = outVideo.replace(/\.mp4$/i, '.webm'); log('this ffmpeg has no libx264 — writing VP9 ' + outVideo + ' instead'); } }
        else if (/libvpx/.test(encs)) { enc = ['-c:v', 'libvpx', '-b:v', '6M', '-pix_fmt', 'yuv420p']; if (wantMp4) { outVideo = outVideo.replace(/\.mp4$/i, '.webm'); log('this ffmpeg has no libx264 — writing VP8 ' + outVideo + ' instead'); } }
        else throw new Error('ffmpeg has neither libx264 nor libvpx');
        fs.mkdirSync(path.dirname(path.resolve(outVideo)), { recursive: true });
        // 'pipe:0' — the bare '-' is not understood by minimal builds (Playwright's ffmpeg)
        ffmpegProc = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0'].concat(enc, [outVideo]), { stdio: ['pipe', 'inherit', 'inherit'] });
        ffmpegProc.exited = null;
        ffmpegProc.done = new Promise((res) => { ffmpegProc.on('close', (code) => { ffmpegProc.exited = code; res(code); }); ffmpegProc.on('error', (e) => { ffmpegProc.exited = -1; res(-1); }); });
        ffmpegProc.stdin.on('error', () => { /* EPIPE after an early exit — reported via exited */ });
      }
      const f0 = Math.round(o.from * fps), f1 = Math.round(to * fps);
      for (let f = f0; f <= f1; f++) {
        await cdp.eval('__motion.seek(' + (f / fps) + ')');
        if (o.frames) {
          const file = path.join(o.out, 'f' + String(f - f0 + 1).padStart(5, '0') + '.png');
          await shot(file, 'png');
          result.frames.push(file);
        }
        if (ffmpegProc) {
          if (ffmpegProc.exited !== null) throw new Error('ffmpeg exited early with code ' + ffmpegProc.exited + ' (see its stderr above)');
          const jpg = await shot(null, 'jpeg');
          if (!ffmpegProc.stdin.write(jpg)) {
            await Promise.race([new Promise((r) => ffmpegProc.stdin.once('drain', r)), ffmpegProc.done]);
          }
        }
        if ((f - f0) % 50 === 0) log('  frame ' + (f - f0 + 1) + '/' + (f1 - f0 + 1));
      }
      if (ffmpegProc) {
        ffmpegProc.stdin.end();
        const code = await ffmpegProc.done;
        if (code !== 0) throw new Error('ffmpeg exited with ' + code);
        result.video = outVideo;
        log('video: ' + outVideo);
        ffmpegProc = null;
      }
    }

    // ── beat sheet (composed in the browser)
    if (o.sheet && result.beats.length) {
      await composeSheet(cdp, o, result.beats, result.beatTimes, o.sheet);
      result.sheet = o.sheet;
      log('beat sheet: ' + o.sheet);
    }
    log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return result;
  } finally {
    if (ffmpegProc) { try { ffmpegProc.kill(); } catch (e) { /* ignore */ } }
    cdp.close(); child.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = { parseArgs, findChrome, findFfmpeg, render, fileUrl };

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  render(o)
    .then((r) => { console.log(JSON.stringify({ beats: r.beats.length, frames: r.frames.length, video: r.video, sheet: r.sheet, duration: r.meta.duration, fps: r.meta.fps, out: o.out })); })
    .catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
}
