#!/usr/bin/env node
// film.js — render a seekable page to stills / a contact-sheet strip / a looping video.
//   node tools/film.js v1.html --out out/v1 --beats 0,1.2,3.4      stills at the design frame size (1 CSS px = 1 px)
//   node tools/film.js v1.html --out out/v1 --every 0.2            one PNG every 0.2 s (→ tools/sheet.py)
//   node tools/film.js v1.html --video out/v1.mp4 --hd             H.264 loop at 1080 px wide (--2k = 1440, --outw N)
// Delivery sizes rasterise the design frame at DPR = N / FW (see shoot.js openFrame, quirk #193).
// The loop point is not duplicated: a D-second page at F fps renders round(D*F) frames (0 .. N-1).
'use strict';
const fs = require('fs'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const { launch, openFrame, sleep } = require('./shoot.js');

function args(argv) {
  const o = { page: null, out: null, w: null, h: null, outw: null, beats: null, every: null, video: null, fps: null, crf: 16, from: 0, to: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = () => argv[++i];
    if (a === '--hd') o.outw = 1080; else if (a === '--2k') o.outw = 1440; else if (a === '--outw') o.outw = Number(n());
    else if (a === '--out') o.out = n(); else if (a === '--w') o.w = Number(n()); else if (a === '--h') o.h = Number(n());
    else if (a === '--beats') o.beats = n().split(',').map(Number); else if (a === '--every') o.every = Number(n());
    else if (a === '--video') o.video = n(); else if (a === '--fps') o.fps = Number(n()); else if (a === '--crf') o.crf = Number(n());
    else if (a === '--from') o.from = Number(n()); else if (a === '--to') o.to = Number(n());
    else if (!o.page) o.page = a;
  }
  return o;
}
function ffmpegBin() {
  const c = [process.env.FFMPEG_PATH, 'C:\\ffmpeg\\bin\\ffmpeg.exe'];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
}

(async function main() {
  const o = args(process.argv.slice(2));
  const B = await launch(o.w, o.h, 1);
  try {
    const fr = await openFrame(B, o.page, o);
    const meta = await B.cdp.eval('({ d: __motion.duration, fps: __motion.fps, marks: window.__MARKS || null })');
    const fps = o.fps || meta.fps;
    console.error('frame ' + fr.FW + 'x' + fr.FH + ' dpr ' + fr.dpr.toFixed(6) + ' · ' + meta.d.toFixed(2) + ' s @ ' + fps + ' fps' + (meta.marks ? '  marks ' + JSON.stringify(meta.marks) : ''));
    const shot = async (fmt) => Buffer.from((await B.cdp.send('Page.captureScreenshot', { format: fmt, clip: B.clip })).data, 'base64');
    const seek = async (t) => { await B.cdp.eval('__motion.seek(' + t + ')'); await sleep(8); };
    if (o.out) fs.mkdirSync(o.out, { recursive: true });
    const times = o.beats || [];
    if (o.every) { const to = o.to != null ? o.to : meta.d; for (let t = o.from; t < to - 1e-6; t += o.every) times.push(Math.round(t * 1000) / 1000); }
    for (const t of times) {
      await seek(t);
      fs.writeFileSync(path.join(o.out, 't' + String(Math.round(t * 1000)).padStart(6, '0') + '.png'), await shot('png'));
    }
    if (times.length) console.error(times.length + ' stills → ' + o.out);
    if (o.video) {
      const ff = ffmpegBin(); if (!ff) throw new Error('ffmpeg not found (FFMPEG_PATH)');
      fs.mkdirSync(path.dirname(path.resolve(o.video)), { recursive: true });
      const N = Math.round(meta.d * fps);
      const p = spawn(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.video], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((res) => p.on('close', res));
      const t0 = Date.now();
      for (let f = 0; f < N; f++) {
        await seek(f / fps);
        if (!p.stdin.write(await shot('png'))) await new Promise((r) => p.stdin.once('drain', r));
        if (f % 50 === 0) console.error('  frame ' + f + '/' + N + '  ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
      }
      p.stdin.end();
      const code = await done;
      if (code !== 0) throw new Error('ffmpeg exited ' + code);
      console.error('video ' + o.video + '  (' + N + ' frames, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    }
  } finally { B.close(); }
})().catch((e) => { console.error('ERROR ' + e.message); process.exit(1); });
