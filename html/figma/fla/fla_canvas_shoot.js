// fla_canvas_shoot.js — stills of Animate's HTML5 Canvas publish at chosen frames, at any pixel ratio.
//   node tools/fla_canvas_shoot.js published.html STAGE_W STAGE_H DPR OUT_PREFIX frame,frame,...
// The published page sizes its canvas to stage × devicePixelRatio (AdobeAn.makeResponsive); each still is
// exportRoot.gotoAndStop(frame) + stage.update(). A fresh Chrome every 8 stills: one headless session hung after
// ~20 screenshots of a 728x90 canvas.
'use strict';
const fs = require('fs');
const path = require('path');
const T = require('./shoot.js');
const BATCH = 8;

async function shoot(page, sw, sh, dpr, prefix, frames) {
  const B = await T.launch(sw, sh, dpr);
  try {
    await B.cdp.send('Page.navigate', { url: 'file:///' + path.resolve(page).replace(/\\/g, '/') });
    for (let i = 0; i < 200; i++) {
      await T.sleep(100);
      try { if (await B.cdp.eval('!!(window.exportRoot && window.stage && exportRoot.totalFrames > 1)')) break; } catch (e) { /* loading */ }
    }
    await B.cdp.eval('createjs.Ticker.removeAllEventListeners(); exportRoot.stop(); true');
    for (const f of frames) {
      await B.cdp.eval('exportRoot.gotoAndStop(' + f + '); stage.update(); true');
      await T.sleep(20);
      const r = await B.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: sw, height: sh, scale: 1 } });
      fs.writeFileSync(prefix + f + '.png', Buffer.from(r.data, 'base64'));
    }
  } finally { B.close(); }
}

async function main() {
  const [page, sw, sh, dpr, prefix, list] = process.argv.slice(2);
  const frames = list.split(',').map(Number);
  for (let i = 0; i < frames.length; i += BATCH) await shoot(page, Number(sw), Number(sh), Number(dpr), prefix, frames.slice(i, i + BATCH));
  console.log(frames.length + ' stills → ' + prefix + '*.png');
}
main().catch(function (e) { console.error(e); process.exit(1); });
