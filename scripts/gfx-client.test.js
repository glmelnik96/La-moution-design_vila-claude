// Offline execution of the client build payload. Extend the skill's normal AE mock only
// for project-file identity, precomp layers, duplication and footage import.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sandbox, Layer, Property, PropertyValueType } = require('./ae-mock');
const { clientSpec, clientBody, captureBody, payload } = require('./gfx-build');
const { lint } = require('./lint-jsx');

const plan = {
  sequence: { id: 'demo-cut', name: 'Demo', w: 1920, h: 1080, frames: 250, fps: 25 },
  aep: 'C:/example/work.aep', plate: 'C:/example/plate.mov',
  slots: [{ id: 'LABEL', type: 'chapter', layer: 'overlay', in: 15, out: 115 }],
};
const map = { id: 'LABEL', template: 'Approved strap', fields: [{ key: 'title', target: 'name', value: 'New label', required: true }] };
const makeSpec = () => clientSpec(plan, plan.slots, [map]);

function project() {
  const s = sandbox();
  for (const f of ['gfx.jsx', 'gfx-client.jsx']) s.run(readFileSync(path.join(__dirname, 'lib', f), 'utf8'));
  const p = s.app.project, items = [];
  let serial = 0;
  s.File = class { constructor(name) { this.fsName = name; this.exists = true; } };
  s.ImportOptions = class { constructor(file) { this.file = file; } };
  p.file = new s.File(plan.aep);
  p.save = () => {};
  p.rootFolder = new s.FolderItem('Root');
  Object.defineProperty(p, 'numItems', { get: () => items.length });
  p.item = i => items[i - 1];
  function register(item) {
    item.parentFolder = p.rootFolder;
    item.id = ++serial;
    items.push(item);
    item.remove = () => items.splice(items.indexOf(item), 1);
    Object.defineProperty(item, 'usedIn', { get: () => items.filter(c => c._layers?.some(l => l.source === item)) });
    return item;
  }
  p.items.addFolder = name => register(new s.FolderItem(name));
  p.items.addComp = (...args) => {
    const comp = register(new s.CompItem(...args));
    comp.pixelAspect = 1;
    comp.layers.add = source => {
      const layer = new Layer(comp, source.name, 'av');
      const tr = new Property('Time Remap', 'ADBE Time Remapping', 0, PropertyValueType.OneD);
      tr.setValuesAtTimes = (times, values) => times.forEach((t, i) => tr.setValueAtTime(t, values[i]));
      layer._add(tr);
      layer.source = source;
      return comp.layers._push(layer);
    };
    return comp;
  };
  p.importFile = opt => register(Object.assign(new s.FootageItem(), { file: opt.file, replace(f) { this.file = f; } }));
  const templates = p.items.addFolder('TEMPLATES');
  const ornament = p.items.addComp('Shared artwork', 1920, 1080, 1, 4, 25);
  // Fixture for CompItem.duplicate(): independent top-level layers, identical nested source.
  function prepared() {
    const c = p.items.addComp(map.template, 1920, 1080, 1, 4, 25);
    c.parentFolder = templates;
    c.markerProperty.setValueAtTime(0.5, new s.MarkerValue('in'));
    c.markerProperty.setValueAtTime(3.5, new s.MarkerValue('out'));
    c.layers.add(ornament);
    c.layers.addText('Original').name = 'TXT_NAME';
    c.layers.addText('Fixed').name = 'TXT_CREDIT';
    c.layers.addText('Exact-case artwork').name = 'TXT_name';
    const guide = c.layers.addShape();
    guide.name = 'BOX_NAME';
    guide.guideLayer = true;
    c.duplicate = prepared;
    return c;
  }
  const template = prepared();
  const run = (spec = makeSpec()) => JSON.parse(s.run(payload('client', clientBody(plan, spec, false))));
  return { s, p, items, template, ornament, run };
}
const field = (c, layer) => c.layer(layer).property('ADBE Text Properties').property('ADBE Text Document').value.text;

test('client build and repeat preserve the source, private-copy artwork and linked slot identity', () => {
  const { run, template, items, ornament } = project();
  const spec = makeSpec();
  assert.equal(run(spec).ok, true);
  const linked = items.find(c => c.name === 'LABEL');
  const originalCopy = linked.layer('TEMPLATE').source;
  const guide = linked.layer('GUIDE_PLATE');
  assert.deepEqual([guide.guideLayer, guide.audioEnabled, guide.startTime], [true, false, -0.6]);
  assert.equal(field(originalCopy, 'TXT_NAME'), 'New label');
  spec.rows[0].fields = [{ ...map.fields[0], value: 'Updated' }];
  const second = run(spec);
  assert.equal(second.ok, true, second.error);
  assert.equal(items.find(c => c.name === 'LABEL'), linked);
  const copy = linked.layer('TEMPLATE').source;
  assert.equal(linked.numLayers, 2);
  assert.equal(copy.layer('Shared artwork').source, ornament);
  assert.deepEqual([field(template, 'TXT_NAME'), field(copy, 'TXT_NAME'), field(copy, 'TXT_CREDIT')], ['Original', 'Updated', 'Fixed']);
  assert.equal(field(copy, 'TXT_name'), 'Exact-case artwork');
  assert.equal(items.includes(originalCopy), false);
  assert.equal(items.filter(c => c.name === 'LABEL__tpl').length, 1);
});
test('client build rejects a template/slot name collision, missing layer and animated text before creating outputs', () => {
  for (const conflict of ['name', 'missing', 'animated']) {
    const { template, items, run } = project();
    const spec = makeSpec();
    if (conflict === 'name') { spec.rows[0].template = template.name = 'LABEL'; }
    if (conflict === 'missing') { template.layer('BOX_NAME').name = 'Other'; }
    if (conflict === 'animated') { template.layer('TXT_NAME').property('ADBE Text Properties').property('ADBE Text Document').expressionEnabled = true; }
    const before = items.slice();
    const r = run(spec);
    assert.equal(r.ok, false, conflict);
    assert.match(r.error, /ambiguous or occupied|one TXT_|static Source Text/);
    assert.deepEqual(items, before);
    assert.equal(field(template, 'TXT_NAME'), 'Original');
  }
});
test('an author layer in the preview or another consumer of a private copy blocks a rebuild before edits', () => {
  for (const conflict of ['layer', 'consumer']) {
    const { p, run, items } = project();
    assert.equal(run().ok, true);
    const copy = items.find(c => c.name === 'LABEL__tpl');
    if (conflict === 'consumer') p.items.addComp('Designer composite', 1920, 1080, 1, 4, 25).layers.add(copy);
    else items.find(c => c.name === 'PREVIEW_Demo').layers.addText('Designer note');
    const before = items.slice();
    const r = run();
    assert.equal(r.ok, false);
    assert.match(r.error, /author composition|manually added/);
    assert.deepEqual(items, before);
    assert.equal(field(copy, 'TXT_NAME'), 'New label');
  }
});
test('external build and capture produce ES3 payloads with no lint findings', () => {
  for (const body of [clientBody(plan, makeSpec(), false), captureBody(plan, plan.slots, 'C:/example/qa', true)]) {
    const r = lint(payload('client', body), { lib: false });
    assert.deepEqual(r, { errors: [], warnings: [] });
  }
});


test('offline option errors exit before resolving files or connecting to Adobe', () => {
  for (const args of [['--plan'], ['--plan', '--preview'], ['--plan', 'missing.json', '--only'], ['check-kit', '--preview']]) {
    const cli = spawnSync(process.execPath, [path.join(__dirname, 'gfx-build.js'), ...args], { encoding: 'utf8', timeout: 2000 });
    assert.equal(cli.status, 1, cli.stderr);
    assert.match(cli.stderr, /--plan needs|--only needs|preview mappings/);
  }
});
