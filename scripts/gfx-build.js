// gfx-build.js — the After Effects half of graphics over a Premiere edit (reference/gfx-for-edit.md;
// the plan format lives in premiere-autopilot references/gfx-plan.md).
//
//   node scripts/gfx-build.js --plan <gfx-plan.json> [--only LT_01,Q_02] [--refresh-plate] [--rebuild-kit] [--no-capture]
//   node scripts/gfx-build.js check-kit --aep <scratch.aep> --out <dir> [--rebuild-kit]
//
// One AE call per step:
//   open     AE up (launched when no AE window exists), the plan's .aep open or created. A DIFFERENT
//            project with unsaved changes is the user's work: refuse, never discard it.
//   kit      TEMPLATES/TPL_* (Cloud.ru, lib/gfx-kit-cloudru.jsx) + the contract check
//   plate    imported once into PLATE; --refresh-plate reloads it after a re-export; a plan naming
//            another file (plate.b.mov while AE held plate.mov) switches the item to it
//   slot     one comp per slot, rebuilt IN PLACE: Premiere links to the comp object
//   preview  PREVIEW_<sequence> (plate as a normal layer + every slot), then save — Dynamic Link reads
//            the saved file whenever AE has another project open (quirk 185)
//   capture  QA frames into <plan dir>/qa + sheet.png: after each entrance, the middle, and past the
//            template's own length when the slot is longer (quirk 183)
// Exit 1 when a text sticks out of its box or a field has no layer: fix the plan, run again.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { run } = require('./ae.js');
const { parseSvg } = require('./lib/svgpath.js');

// sent as ASCII: the kit's Cyrillic placeholders go as \uXXXX, like every payload (quirk 19)
const LIBS = ['gfx.jsx', 'gfx-kit-cloudru.jsx'].map((f) => fs.readFileSync(path.join(__dirname, 'lib', f), 'utf8')).join('\n')
  .replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const LOGO_SVG = path.join(__dirname, '..', 'html', 'templates', 'cn-assets', 'logo_color.svg');
const AE_EXE = process.env.AE_EXE || 'C:/Program Files/Adobe/Adobe After Effects 2026/Support Files/AfterFX.exe';
const PORT = process.env.AE_CDP_PORT || '8092';
const TYPES = ['lower_third', 'quote', 'callout', 'logo', 'chapter', 'intro', 'outro'];
const LAYER_ORDER = { overlay: 0, logo: 1, insert: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => String(p).replace(/\\/g, '/');
// JSON with every non-ASCII character as \uXXXX: payloads stay ASCII (quirk 19), Cyrillic survives.
const J = (v) => JSON.stringify(v).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function colorOf(fill) {
  const named = { white: [1, 1, 1], black: [0, 0, 0] };
  if (named[fill]) return named[fill];
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) throw new Error('logo fill not supported: ' + fill);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function logoData() {
  const svg = parseSvg(fs.readFileSync(LOGO_SVG, 'utf8'));
  return { w: svg.viewBox[2], h: svg.viewBox[3], paths: svg.paths.map((p) => ({ color: colorOf(p.fill), subpaths: p.subpaths })) };
}

// What the AE side needs before touching AE (the full validation: premiere-autopilot gfxplan.mjs).
function checkPlan(plan) {
  const e = [];
  if (!plan || plan.version !== 1) e.push('version must be 1');
  const s = plan && plan.sequence;
  if (!s || !(s.fps > 0) || !Number.isInteger(s.frames) || !Number.isInteger(s.w) || !Number.isInteger(s.h)) e.push('sequence needs fps, whole frames, w, h');
  else if (Math.abs(s.w / s.h - 16 / 9) > 0.01) e.push(`only 16:9 in v1 (got ${s.w}x${s.h})`);
  if (!plan || !/\.aep$/i.test(plan.aep || '')) e.push('aep must be an .aep path');
  if (!plan || !plan.plate) e.push('plate is required');
  if (plan && plan.style && plan.style !== 'cloudru') e.push(`style ${plan.style}: only the cloudru kit exists yet`);
  for (const sl of (plan && plan.slots) || []) {
    if (!TYPES.includes(sl.type)) e.push(`${sl.id}: unknown type ${sl.type}`);
    if (!Number.isInteger(sl.in) || !Number.isInteger(sl.out) || sl.out <= sl.in) e.push(`${sl.id}: in/out must be whole frames, in < out`);
  }
  return e;
}
function slotsInOrder(plan, only) {
  return plan.slots.filter((s) => !s.lost && (!only || only.includes(s.id)))
    .sort((a, b) => (LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]) || (a.in - b.in));
}

const openBody = (aep) => `
  var want = new File(${J(fwd(aep))}), cur = app.project.file;
  if (cur && cur.fsName.toLowerCase() === want.fsName.toLowerCase()) { return { opened: "already", file: cur.fsName }; }
  if (app.project.dirty) { throw new Error("AE has unsaved changes in " + (cur ? cur.fsName : "an untitled project") + ": save or close it, then run again"); }
  if (want.exists) { app.open(want); return { opened: "open", file: app.project.file.fsName }; }
  app.newProject();
  app.project.save(want);
  return { opened: "new", file: app.project.file.fsName };`;
const kitBody = (types, rebuild) => `
  var TPL = G.folder("TEMPLATES"), built = K.ensure(TPL, ${J(logoData())}, ${rebuild ? 'true' : 'false'}), probs = [], need = ${J(types)}, i;
  for (i = 0; i < need.length; i++) {
    var c = G.find("TPL_" + need[i], CompItem);
    if (!c) { probs.push("TPL_" + need[i] + " missing"); continue; }
    probs = probs.concat(G.tplProblems(G.tplInfo(c), K.FIELDS[need[i]]));
  }
  if (probs.length) { throw new Error("kit contract: " + probs.join("; ")); }
  return { built: built };`;
// AE holds the plate file open, so a re-export under a live build goes to the other name of the pair
// (plate.b.mov; premiere-autopilot prexport.freePath). The PLATE item then switches to the plan's file,
// which also lets go of the old one.
const plateBody = (plate, refresh) => `
  var f = new File(${J(fwd(plate))});
  if (!f.exists) { throw new Error("plate not found: " + f.fsName); }
  var P = G.folder("PLATE"), it = G.footageByPath(f.fsName), was = null, i;
  if (it && ${refresh ? 'true' : 'false'}) { it.replace(f); }
  if (!it) {
    for (i = 1; i <= app.project.numItems; i++) { if (app.project.item(i) instanceof FootageItem && app.project.item(i).parentFolder === P) { it = app.project.item(i); } }
    if (it) { was = it.file ? it.file.fsName : null; it.replace(f); }
  }
  if (!it) { it = app.project.importFile(new ImportOptions(f)); it.parentFolder = P; }
  return { plate: it.name, duration: it.duration, switchedFrom: was };`;
const slotBody = (slot, plan) => {
  const fps = plan.sequence.fps;
  return `
  var F = G.folder("GFX"), TF = G.folder("_tpl", F), tpl = G.find("TPL_" + ${J(slot.type)}, CompItem);
  if (!tpl) { throw new Error("no template TPL_" + ${J(slot.type)}); }
  return G.buildSlot({ id: ${J(slot.id)}, D: ${(slot.out - slot.in) / fps}, fps: ${fps}, w: ${plan.sequence.w}, h: ${plan.sequence.h},
    tpl: tpl, plate: G.footageByPath(new File(${J(fwd(plan.plate))}).fsName), inS: ${slot.in / fps},
    text: ${J(slot.text || {})}, folder: F, tplFolder: TF });`;
};
const previewBody = (plan, slots) => {
  const fps = plan.sequence.fps;
  return `
  var c = G.preview(${J('PREVIEW_' + plan.sequence.name)}, ${plan.sequence.frames / fps}, ${fps}, ${plan.sequence.w}, ${plan.sequence.h},
    G.footageByPath(new File(${J(fwd(plan.plate))}).fsName), ${J(slots.map((s) => ({ id: s.id, inS: s.in / fps })))}, G.folder("GFX"));
  app.project.save();
  return { preview: c.name, saved: app.project.file.fsName };`;
};
const captureBody = (plan, slots, dir) => `
  M.use(G.find(${J('PREVIEW_' + plan.sequence.name)}, CompItem));
  var S = ${J(slots.map((s) => ({ id: s.id, type: s.type, inF: s.in, outF: s.out })))}, out = [], i;
  for (i = 0; i < S.length; i++) {
    var info = G.tplInfo(G.find("TPL_" + S[i].type, CompItem)), fr = [];
    var a = S[i].inF + Math.round(info.tin * M.FPS) + 2, b = Math.round((S[i].inF + S[i].outF) / 2);
    fr.push(a < S[i].outF ? a : b);
    if (b !== fr[0]) { fr.push(b); }
    var past = S[i].inF + Math.round(info.T * M.FPS) + 5, exitAt = S[i].outF - Math.round((info.T - info.tout) * M.FPS);
    if (past < exitAt - 1) { fr.push(past); }
    out.push({ id: S[i].id, frames: fr, files: M.capture(fr, "qa_" + S[i].id, ${J(fwd(dir))}) });
  }
  return { shots: out };`;

// What one step sends: the libraries, then the body, with JSON.stringify on the LAST line (ae.js's
// lint looks there, quirk 16). `raw` is for the open step: no undo group around opening a project,
// and no G/K libraries, which it does not use.
function payload(label, body, raw) {
  const fn = `var __gfx = function () {${body}\n};\n`;
  if (raw) return fn + 'JSON.stringify((function () { try { var __r = __gfx(); __r.ok = true; return __r; } catch (e) { return { ok: false, error: String(e), line: e.line }; } })());';
  return `${LIBS}\n${fn}JSON.stringify(M.run(${J(label)}, __gfx));`;
}
async function aeStep(label, body, { raw = false, timeout = 180000 } = {}) {
  const r = await run(payload(label, body, raw), { lib: true, timeout });
  if (!r || r.ok !== true) throw new Error(`${label}: ${(r && (r.error || r.raw)) || 'no answer'}${r && r.failedAfter ? ' (after step ' + r.failedAfter + ')' : ''}`);
  return r;
}
async function aeUp() {
  try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); return t.some((x) => x.type === 'page'); } catch { return false; }
}
function aeWindow() {   // a Dynamic Link server is an AfterFX.exe with no window: it does not count
  const n = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '@(Get-Process AfterFX -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count'], { encoding: 'utf8' }).trim();
  return Number(n) > 0;
}
async function ensureAE() {
  if (await aeUp()) return 'up';
  const launched = !aeWindow();
  if (launched) spawn(AE_EXE, [], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 90; i++) { await sleep(2000); if (await aeUp()) return launched ? 'launched' : 'waited'; }
  throw new Error(`the AE panel does not answer on ${PORT}: open Window > Extensions > Extensions LLM Chat in After Effects`);
}
async function waitFiles(files, maxMs = 60000) {   // PNG writes are asynchronous (quirks 27/40)
  const t0 = Date.now(), sizes = new Map();
  while (Date.now() - t0 < maxMs) {
    let ready = true;
    for (const f of files) {
      const s = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (!s || sizes.get(f) !== s) ready = false;
      sizes.set(f, s);
    }
    if (ready) return;
    await sleep(500);
  }
  throw new Error('QA frames were not written: ' + files.filter((f) => !fs.existsSync(f)).join(', '));
}
function sheet(files, out) {
  const list = out + '.txt';
  fs.writeFileSync(list, files.map((f) => `file '${fwd(f)}'`).join('\n'));
  const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=480:-2,tile=${cols}x${rows}`, '-frames:v', '1', out]);
  return out;
}

async function build(argv) {
  const val = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const planPath = path.resolve(val('plan'));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const errs = checkPlan(plan);
  if (errs.length) throw new Error('plan: ' + errs.join('; '));
  const slots = slotsInOrder(plan, val('only') ? val('only').split(',') : null);
  const report = { ae: await ensureAE() };
  report.open = await aeStep('gfx: open', openBody(plan.aep), { raw: true });
  report.kit = await aeStep('gfx: kit', kitBody([...new Set(slots.map((s) => s.type))], argv.includes('--rebuild-kit')));
  report.plate = await aeStep('gfx: plate', plateBody(plan.plate, argv.includes('--refresh-plate')));
  const problems = [];
  report.slots = [];
  for (const s of slots) {
    const r = await aeStep('gfx: slot ' + s.id, slotBody(s, plan));
    report.slots.push({ id: s.id, D: r.D, min: r.min, overflow: r.overflow, missing: r.missing });
    for (const [f, px] of Object.entries(r.overflow || {})) problems.push(`${s.id}: text.${f} sticks out of BOX_${f.toUpperCase()} by ${px} px, shorten it`);
    for (const f of r.missing || []) problems.push(`${s.id}: the template has no TXT_${f.toUpperCase()}`);
  }
  report.preview = await aeStep('gfx: preview', previewBody(plan, slotsInOrder(plan, null)));
  if (!argv.includes('--no-capture')) {
    const dir = path.join(path.dirname(planPath), 'qa');
    fs.mkdirSync(dir, { recursive: true });
    const cap = await aeStep('gfx: capture', captureBody(plan, slots, dir));
    const files = cap.shots.flatMap((x) => x.files);
    await waitFiles(files);
    report.qa = { shots: cap.shots, sheet: sheet(files, path.join(dir, 'sheet.png')) };
  }
  report.problems = problems;
  report.ok = problems.length === 0;
  return report;
}

async function checkKit(argv) {
  const val = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  if (!val('aep') || !val('out')) throw new Error('check-kit needs --aep <scratch.aep> --out <dir>');
  const out = path.resolve(val('out'));
  fs.mkdirSync(out, { recursive: true });
  const report = { ae: await ensureAE() };
  report.open = await aeStep('gfx: open', openBody(val('aep')), { raw: true });
  report.kit = await aeStep('gfx: kit', kitBody(TYPES, argv.includes('--rebuild-kit')));
  // every template on a grey card at its in marker, its middle and just before its end
  const cap = await aeStep('gfx: kit capture', `
    var T = ${J(TYPES)}, out = [], i;
    for (i = 0; i < T.length; i++) {
      var c = G.find("TPL_" + T[i], CompItem), info = G.tplInfo(c), R = G.find("REVIEW_" + T[i], CompItem);
      if (!R) { R = app.project.items.addComp("REVIEW_" + T[i], 1920, 1080, 1, c.duration, c.frameRate); }
      R.duration = c.duration;
      while (R.numLayers > 0) { R.layer(1).remove(); }
      R.layers.add(c);
      R.layers.addSolid([0.45, 0.47, 0.5], "grey", 1920, 1080, 1, c.duration).moveToEnd();
      M.use(R);
      var fr = [Math.round(info.tin * M.FPS), Math.round(info.T * M.FPS / 2), Math.round(info.T * M.FPS) - 3];
      out.push({ type: T[i], files: M.capture(fr, "kit_" + T[i], ${J(fwd(out))}) });
    }
    app.project.save();
    return { shots: out };`);
  const files = cap.shots.flatMap((x) => x.files);
  await waitFiles(files);
  report.sheet = sheet(files, path.join(out, 'kit_sheet.png'));
  report.ok = true;
  return report;
}

module.exports = { checkPlan, slotsInOrder, logoData, colorOf, J, payload, openBody, kitBody, plateBody, slotBody, previewBody, captureBody };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const job = argv[0] === 'check-kit' ? checkKit(argv) : (argv.includes('--plan') ? build(argv) : null);
  if (!job) {
    console.error('usage: gfx-build.js --plan <gfx-plan.json> [--only A,B] [--refresh-plate] [--rebuild-kit] [--no-capture]\n       gfx-build.js check-kit --aep <scratch.aep> --out <dir> [--rebuild-kit]');
    process.exit(2);
  }
  job.then((r) => { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1; })
    .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; });
}
