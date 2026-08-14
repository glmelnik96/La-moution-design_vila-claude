const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { parseArgs, buildJobBody, classifyJob, tokenCandidates } = require('./gen.js');

test('parseArgs splits command, flags, and positionals', () => {
  const r = parseArgs(['submit', '--node', '94', '--params', '{"prompt":"x"}', 'pos1']);
  assert.strictEqual(r.cmd, 'submit');
  assert.strictEqual(r.opts.node, '94');
  assert.strictEqual(r.opts.params, '{"prompt":"x"}');
  assert.deepStrictEqual(r.positional, ['pos1']);
});

test('buildJobBody coerces node to number and parses params JSON', () => {
  const b = buildJobBody({ node: '100', params: '{"scenario":"t2v","seed":42}' });
  assert.deepStrictEqual(b, { node_id: 100, params: { scenario: 't2v', seed: 42 } });
});

test('buildJobBody parses --init slot=path pairs', () => {
  const b = buildJobBody({ node: '100', init: 'start_img=C:/a.png,end_frame=C:/b.png' });
  assert.deepStrictEqual(b.init_files, { start_img: 'C:/a.png', end_frame: 'C:/b.png' });
});

test('classifyJob: completed with paths is success', () => {
  const r = classifyJob({ status: 'completed', result_paths: ['C:/out.png'] });
  assert.deepStrictEqual(r, { kind: 'success', paths: ['C:/out.png'] });
});

test('classifyJob: error field or failed status is failure', () => {
  assert.strictEqual(classifyJob({ status: 'failed' }).kind, 'failure');
  assert.strictEqual(classifyJob({ status: 'running', error: 'boom' }).kind, 'failure');
});

test('classifyJob: in-progress is pending', () => {
  assert.strictEqual(classifyJob({ status: 'running' }).kind, 'pending');
  assert.strictEqual(classifyJob({ status: 'completed', result_paths: [] }).kind, 'pending');
});

test('tokenCandidates: DATA_ROOT default + real LOCALAPPDATA, both probed', () => {
  const c = tokenCandidates({ USERPROFILE: 'C:\\u', LOCALAPPDATA: 'C:\\u\\AppData\\Local' });
  assert.deepStrictEqual(c, [
    path.join('C:\\u', 'Documents', 'PhygitalStudio-data', 'PhygitalStudio', 'sidecar.token'),
    path.join('C:\\u\\AppData\\Local', 'PhygitalStudio', 'sidecar.token')
  ]);
});

test('tokenCandidates: PHYGITAL_DATA_ROOT override wins for the first candidate', () => {
  const c = tokenCandidates({ USERPROFILE: 'C:\\u', PHYGITAL_DATA_ROOT: 'D:\\root', LOCALAPPDATA: 'C:\\la' });
  assert.strictEqual(c[0], path.join('D:\\root', 'PhygitalStudio', 'sidecar.token'));
  assert.strictEqual(c[1], path.join('C:\\la', 'PhygitalStudio', 'sidecar.token'));
});

test('tokenCandidates: de-dupes when PHYGITAL_DATA_ROOT equals LOCALAPPDATA', () => {
  const c = tokenCandidates({ USERPROFILE: 'C:\\u', PHYGITAL_DATA_ROOT: 'C:\\la', LOCALAPPDATA: 'C:\\la' });
  assert.strictEqual(c.length, 1);
});

test('tokenCandidates: no LOCALAPPDATA yields only the DATA_ROOT candidate', () => {
  const c = tokenCandidates({ USERPROFILE: 'C:\\u' });
  assert.strictEqual(c.length, 1);
});
