// gfx.jsx — graphics over a Premiere edit (reference/gfx-for-edit.md). Loaded after the lib (CR, M)
// by scripts/gfx-build.js. ES3 only (lint-checked). What a slot needs:
//   - the template contract: TXT_<FIELD> text layers, BOX_<FIELD> guide boxes, comp markers "in"
//     (entrance done) and "out" (exit starts), no audio
//   - fitting a template to any slot length by time remap: entrance and exit at their own speed,
//     the middle stretched or squeezed (G.remapKeys); keys in SECONDS, so a 25 fps template works
//     in a 29.97 edit
//   - the edit as a guide plate WITHOUT audio: guide audio leaks through Dynamic Link (quirk 185)
var G = {};

// Linear remap keys [[slotTime, templateTime], ...] for a slot of D s over a template of T s with
// its markers at tin/tout.
G.remapKeys = function (D, T, tin, tout) {
  return [[0, 0], [tin, tin], [D - (T - tout), tout], [D, T]];
};
// The shortest slot a template allows: its entrance, its exit and 1.5 s to read in between.
G.minSec = function (T, tin, tout) {
  return tin + (T - tout) + 1.5;
};
// Contract problems of one template for the fields a type may receive ([] = fine).
G.tplProblems = function (info, fields) {
  var p = [], i;
  if (!(info.tin > 0 && info.tin < info.tout && info.tout <= info.T + 1e-6)) {
    p.push(info.name + ": comp markers need 0 < in < out <= duration (in " + info.tin + ", out " + info.tout + ", duration " + info.T + ")");
  }
  for (i = 0; i < fields.length; i++) {
    if (M.indexOf(info.txt, fields[i]) < 0) { p.push(info.name + ": no TXT_" + fields[i].toUpperCase()); }
    if (M.indexOf(info.box, fields[i]) < 0) { p.push(info.name + ": no BOX_" + fields[i].toUpperCase()); }
  }
  if (info.audio) { p.push(info.name + ": has audio, a linked comp must be silent"); }
  return p;
};

G.find = function (name, kind) {
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it.name === name && (!kind || it instanceof kind)) { return it; }
  }
  return null;
};
G.folder = function (name, parent) {
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof FolderItem && it.name === name && (!parent || it.parentFolder === parent)) { return it; }
  }
  var f = app.project.items.addFolder(name);
  if (parent) { f.parentFolder = parent; }
  return f;
};
G.footageByPath = function (fsName) {
  var want = String(fsName).toLowerCase();
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof FootageItem && it.file && String(it.file.fsName).toLowerCase() === want) { return it; }
  }
  return null;
};
G.layer = function (comp, name) {
  for (var i = 1; i <= comp.numLayers; i++) { if (comp.layer(i).name === name) { return comp.layer(i); } }
  return null;
};
// A template's contract, read off the comp: duration and markers in seconds, its fields, audio.
G.tplInfo = function (comp) {
  var info = { name: comp.name, T: comp.duration, tin: -1, tout: -1, txt: [], box: [], audio: false }, k, i;
  var mp = comp.markerProperty;
  for (k = 1; k <= mp.numKeys; k++) {
    var c = String(mp.keyValue(k).comment);
    if (c === "in") { info.tin = mp.keyTime(k); }
    if (c === "out") { info.tout = mp.keyTime(k); }
  }
  for (i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i), n = String(L.name);
    if (n.substring(0, 4) === "TXT_") { info.txt.push(n.substring(4).toLowerCase()); }
    if (n.substring(0, 4) === "BOX_") { info.box.push(n.substring(4).toLowerCase()); }
    if (L.hasAudio && L.audioEnabled) { info.audio = true; }
  }
  return info;
};
// Write a slot's texts into a template copy. A field the slot leaves out becomes a single space:
// the layer keeps an ink box of ~0, so the plate expressions shrink instead of breaking.
// Returns the text keys that have no TXT_ layer.
G.setTexts = function (comp, text) {
  var missing = [], i, k;
  for (i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i), n = String(L.name);
    if (n.substring(0, 4) !== "TXT_") { continue; }
    var f = n.substring(4).toLowerCase(), v = text.hasOwnProperty(f) ? String(text[f]) : "";
    var st = L.property("ADBE Text Properties").property("ADBE Text Document");
    var d = st.value;
    d.text = v === "" ? " " : v.split("\n").join("\r");
    st.setValue(d);
  }
  for (k in text) { if (text.hasOwnProperty(k) && !G.layer(comp, "TXT_" + k.toUpperCase())) { missing.push(k); } }
  return missing;
};
// How far (px) a field's ink sticks out of its BOX at template time tSec; 0 = it fits.
G.overflow = function (comp, field, tSec) {
  var tx = G.layer(comp, "TXT_" + field.toUpperCase()), bx = G.layer(comp, "BOX_" + field.toUpperCase());
  if (!tx || !bx) { return 0; }
  var txt = tx.property("ADBE Text Properties").property("ADBE Text Document").value.text;
  if (txt === " " || txt === "") { return 0; }
  var a = M.bounds(tx, tSec), b = M.bounds(bx, tSec);
  return Math.max(0, b.left - a.left, (a.left + a.width) - (b.left + b.width), b.top - a.top, (a.top + a.height) - (b.top + b.height));
};
// AE 26 hands back a phantom for a PostScript name it does not have: its location is times.ttf (quirk 187).
G.fontOk = function (ps) {
  if (typeof app.fonts === "undefined" || !app.fonts.getFontsByPostScriptName) { return true; }
  var f = app.fonts.getFontsByPostScriptName(ps);
  if (!f || !f.length) { return false; }
  var loc = String(f[0].location).toLowerCase();
  return !(loc.slice(-9) === "times.ttf" && String(ps).toLowerCase().substring(0, 5) !== "times");
};
// Build (or rebuild IN PLACE) one slot comp. The comp object is kept across rebuilds: Premiere
// links to it, and a comp deleted and re-created under the same name is a different item.
// o: { id, D (s), fps, w, h, tpl (CompItem), plate (FootageItem|null), inS (s), text, folder, tplFolder }
G.buildSlot = function (o) {
  var info = G.tplInfo(o.tpl), min = G.minSec(info.T, info.tin, info.tout), i, k, j;
  if (o.D < min - 0.5 / o.fps) { throw new Error(o.id + ": " + o.D + " s is shorter than " + min + " s, the minimum of " + o.tpl.name); }
  var comp = G.find(o.id, CompItem);
  if (!comp) { comp = app.project.items.addComp(o.id, o.w, o.h, 1, o.D, o.fps); }
  comp.duration = o.D;
  comp.parentFolder = o.folder;
  while (comp.numLayers > 0) { comp.layer(1).remove(); }
  var old = G.find(o.id + "__tpl", CompItem);
  if (old) { old.remove(); }
  var copy = o.tpl.duplicate();
  copy.name = o.id + "__tpl";
  copy.parentFolder = o.tplFolder;
  var missing = G.setTexts(copy, o.text), over = {};
  for (i = 1; i <= copy.numLayers; i++) {
    var n = String(copy.layer(i).name);
    if (n.substring(0, 4) === "TXT_") {
      var f = n.substring(4).toLowerCase(), px = G.overflow(copy, f, info.tin);
      if (px > 1) { over[f] = Math.round(px); }
    }
  }
  var L = comp.layers.add(copy);
  L.name = "TEMPLATE";
  // quirk 183: remap FIRST, then the out point, then our keys, then drop the default keys
  L.timeRemapEnabled = true;
  L.outPoint = o.D;
  var tr = L.property("ADBE Time Remapping"), ks = G.remapKeys(o.D, info.T, info.tin, info.tout), times = [], vals = [];
  for (k = 0; k < ks.length; k++) { times.push(ks[k][0]); vals.push(ks[k][1]); }
  tr.setValuesAtTimes(times, vals);
  for (k = tr.numKeys; k >= 1; k--) {
    var keep = false, kt = tr.keyTime(k);
    for (j = 0; j < times.length; j++) { if (Math.abs(kt - times[j]) < 0.25 / o.fps) { keep = true; } }
    if (!keep) { tr.removeKey(k); }
  }
  for (k = 1; k <= tr.numKeys; k++) { tr.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); }
  if (L.outPoint < o.D - 0.5 / o.fps) { L.outPoint = o.D; }
  var sc = o.h / 1080 * 100;
  if (Math.abs(sc - 100) > 0.01) { L.property("ADBE Transform Group").property("ADBE Scale").setValue([sc, sc]); L.collapseTransformation = true; }
  if (o.plate) {
    var P = comp.layers.add(o.plate);
    P.name = "GUIDE_PLATE";
    P.startTime = -o.inS;
    P.guideLayer = true;
    P.audioEnabled = false;
    P.moveToEnd();
  }
  return { id: o.id, D: o.D, min: min, missing: missing, overflow: over };
};
// The whole film in AE: the plate as a NORMAL layer and every slot comp at its time. QA frames come
// from here: a capture of a slot comp alone drops its guide plate (quirk 186). Slots are added in the
// order given (overlays first, inserts last), so inserts end up on top.
G.preview = function (name, durS, fps, w, h, plate, slots, folder) {
  var comp = G.find(name, CompItem), i;
  if (!comp) { comp = app.project.items.addComp(name, w, h, 1, durS, fps); }
  comp.duration = durS;
  comp.parentFolder = folder;
  while (comp.numLayers > 0) { comp.layer(1).remove(); }
  if (plate) { comp.layers.add(plate).name = "PLATE"; }
  for (i = 0; i < slots.length; i++) {
    var c = G.find(slots[i].id, CompItem);
    if (c) { comp.layers.add(c).startTime = slots[i].inS; }
  }
  return comp;
};
