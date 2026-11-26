'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('./series-adapt.js');
function fixture() {
  return [{ series: 'Show', fps: '25/1', slots: [{id: 'card', in: {cue:'start'}, out:{cue:'word',offset:-2},
    maxLines:2, maxCharsPerSecond:10, enterFrames:2, exitFrames:3}]},
    {id:'02',fps:25,frames:130,cues:{start:{frame:10},word:{frame:115}},values:{card:{lines:['Первый вопрос']}}}];
}
test('episode anchors, exclusive holds, review frames and an editable replacement', () => {
  const result = resolve(...fixture());
  assert.equal(result.status, 'ready-for-render');
  assert.deepEqual(result.slots[0].range, [10,113]);
  assert.deepEqual(result.slots[0].hold, [12,110]);
  assert.deepEqual(result.slots[0].checkFrames,[9,10,12,60,109,112,113]);
});
test('a fixed duration and excess lines require an editorial decision', () => {
  const [r,e] = fixture(); e.values.card.lines=['первая','вторая','третья']; e.cues.word.frame = 28;
  assert.deepEqual(resolve(r,e).slots[0].issues,['line_limit','reading_time']);
});
test('rejects mismatched clocks, missing cues and intervals without a hold', () => {
  const [r,e] = fixture(); e.fps='24000/1001'; assert.throws(()=>resolve(r,e),/frame rate/);
  e.fps=25; delete e.cues.word; assert.throws(()=>resolve(r,e),/Missing cue/);
  e.cues.word={frame:16}; assert.throws(()=>resolve(r,e),/consume/);
});

test('a later spoken word follows the edited picture, and a substituted early cue is flagged', () => {
  const [r,e] = fixture(); r.slots[0].checkCues=[{edge:'out',cue:'answer',window:[0,6]}];
  e.cues.answer={frame:118}; assert.equal(resolve(r,e).slots[0].cueChecks[0].delta,5);
  e.cues.answer={frame:100}; assert.deepEqual(resolve(r,e).slots[0].issues,['cue_alignment:answer']);
});

test('a single long name can exceed a pixel boundary below the line limit', () => {
  const [r,e] = fixture(); r.slots[0].maxWidthPx=680;
  assert.throws(()=>resolve(r,e),/width in rendered pixels/);
  e.values.card.widthsPx=[702.2]; assert.deepEqual(resolve(r,e).slots[0].issues,['text_width']);
});

test('out may use the end boundary, but a negative offset cannot rescue an outside source cue', () => {
  const [r,e] = fixture(); e.cues.word.frame=e.frames; r.slots[0].out.offset=0;
  assert.equal(resolve(r,e).slots[0].range[1],e.frames);
  e.cues.word.frame=e.frames+4; r.slots[0].out.offset=-9;
  assert.throws(()=>resolve(r,e),/Source cue outside episode/);
});
test('visual-only slot passes without a text payload and checks the meaningful hold', () => {
  const [r,e] = fixture();
  r.slots[0]={id:'product',kind:'visual',in:{cue:'start'},out:{cue:'word'},minHoldFrames:50};
  e.values={product:{asset:'Product B / demonstrated state'}};
  assert.equal(resolve(r,e).slots[0].asset,e.values.product.asset);
  e.cues.word.frame=55; assert.deepEqual(resolve(r,e).slots[0].issues,['visual_hold']);
});

function measuredFixture() {
  const [recipe, episode] = fixture();
  recipe.template = 'Donor question card.mogrt';
  recipe.slots[0].textLayout = {
    space: 'normalized-sequence', templatePosition: [0.5, 0.52731481194496],
    variants: {
      top: {lines: 1, position: [0.5, 0.419], frameSize: [3840, 2160], evidence: 'Master A, card 1, frame 51'},
      middle: {lines: 2, position: [0.49, 0.4731], frameSize: [3840, 2160], evidence: 'Master B, card 3, frame 72'}
    }
  };
  episode.frameSize = [1280, 720];
  episode.values.card.layout = 'top';
  return [recipe, episode];
}

test('resolves the explicitly chosen master instance while retaining the template default and evidence', () => {
  const [recipe, episode] = measuredFixture();
  let slot = resolve(recipe, episode).slots[0];
  assert.deepEqual(slot.textPosition, [0.5, 0.419]);
  assert.equal(slot.cardId, 'card');
  episode.values.card = {layout: 'middle', lines: ['First', 'Second'], cardId: 'Q07'};
  slot = resolve(recipe, episode).slots[0];
  assert.deepEqual(slot.textPosition, [0.49, 0.4731]);
  assert.deepEqual(slot.textLayout, {variant:'middle', space:'normalized-sequence',
    template:recipe.template, templatePosition:[0.5, 0.52731481194496], frameSize:[3840,2160],
    episodeFrameSize:[1280,720], lines:2, timelinePosition:[0.49,0.4731], evidence:'Master B, card 3, frame 72'});
  assert.equal(slot.cardId, 'Q07');
});

test('unknown, unmeasured, reflowed and reframed layouts stay in review without a placement', () => {
  const cases = [
    ['text_layout_unknown', (r,e) => { delete e.values.card.layout; }],
    ['text_layout_unknown', (r,e) => { e.values.card.layout = 'untested'; }],
    ['text_layout_unmeasured', r => { r.slots[0].textLayout.variants.top.evidence = ''; }],
    ['text_layout_unmeasured', r => { delete r.slots[0].textLayout.variants.top.position; }],
    ['text_layout_unmeasured', r => { r.slots[0].textLayout.variants.top.position = [600, 200]; }],
    ['text_layout_unmeasured', (r,e) => { delete e.frameSize; }],
    ['text_layout_lines', (r,e) => { e.values.card.lines = ['a', 'b']; }],
    ['text_layout_aspect', (r,e) => { e.frameSize = [1080,1920]; }]
  ];
  for (const [expected, mutate] of cases) {
    const [r,e] = measuredFixture();
    mutate(r,e);
    const result = resolve(r,e);
    assert.equal(result.status, 'review');
    assert.deepEqual(result.slots[0].issues, [expected]);
    assert.equal(result.slots[0].textPosition, undefined);
  }
});

test('CLI writes builder input only for a ready plan; review still writes its report', t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const {spawnSync} = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'series-layout-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const [r,e] = measuredFixture();
  r.slots.push({id:'product',kind:'visual',in:{cue:'start'},out:{cue:'word'}});
  e.values.product = {asset:'screen'};
  e.values.card = {layout:'middle', cardId:'Title 02', lines:['First', 'Second']};
  const write = (name, data) => fs.writeFileSync(path.join(dir,name), JSON.stringify(data));
  const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'series-adapt.js'), 'r.json', 'e.json', ...args], {cwd:dir, encoding:'utf8'});
  write('r.json',r); write('e.json',e);
  assert.equal(run('--out','shared.json','--cards-out','./shared.json').status,2);
  assert.equal(fs.existsSync(path.join(dir,'shared.json')),false);
  const built = run('--cards-out','cards.json','--out','plan.json');
  assert.equal(built.status,0,built.stderr);
  assert.deepEqual(read('cards.json'),[{id:'Title 02',text:'First\nSecond',textPosition:[0.49,0.4731]}]);
  assert.equal(run('--cards-out','cards.json').status,2);
  e.values.card.lines.pop();
  write('e.json',e);
  assert.equal(run('--out','review.json','--cards-out','unmeasured.json').status,1);
  assert.equal(read('review.json').status,'review');
  assert.equal(fs.existsSync(path.join(dir,'unmeasured.json')),false);
});
