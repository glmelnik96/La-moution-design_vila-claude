const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { parseArgs, fileUrl } = require('./render.js');

test('parseArgs reads the page, output, window and video options', () => {
  const o = parseArgs(['page.html', '--out', 'out/x', '--scale', '0.5', '--from', '1', '--to', '2.5', '--video', 'out/x.mp4', '--beats', '0.5,1', '--sheet', 's.png', '--frames']);
  assert.strictEqual(o.page, 'page.html');
  assert.strictEqual(o.out, 'out/x');
  assert.strictEqual(o.scale, 0.5);
  assert.strictEqual(o.from, 1);
  assert.strictEqual(o.to, 2.5);
  assert.strictEqual(o.video, 'out/x.mp4');
  assert.strictEqual(o.beats, '0.5,1');
  assert.strictEqual(o.sheet, 's.png');
  assert.strictEqual(o.frames, true);
});

test('parseArgs defaults: auto beats, no video, 1080p, fps from the page', () => {
  const o = parseArgs(['p.html']);
  assert.strictEqual(o.beats, 'auto');
  assert.strictEqual(o.video, null);
  assert.strictEqual(o.w, 1920);
  assert.strictEqual(o.h, 1080);
  assert.strictEqual(o.fps, 0);
});

test('fileUrl leaves http(s) alone and makes absolute file:// URLs', () => {
  assert.strictEqual(fileUrl('https://x/y.html'), 'https://x/y.html');
  const u = fileUrl('html/templates/showreel.html?scene=kpi');
  assert.ok(u.startsWith('file://'));
  assert.ok(u.endsWith(path.join('html', 'templates', 'showreel.html?scene=kpi').replace(/\\/g, '/')));
});
