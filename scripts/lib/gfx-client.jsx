// Prepared client templates live in the working AEP's root TEMPLATES. They are read-only.
// A generated item is recognizable across builds, and a copy of its ownership comment
// does not confer ownership of the new object (the tag includes AE's persistent item ID).
var C = {};
C.stamp = function (item, seq, name) {
  return "ae-motion-live/gfx/v1 " + seq + " " + item.id + " " + name;
};
C.findItem = function (name, kind, parent, globalName) {
  var found = null;
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (!(it instanceof kind) || (!globalName && it.parentFolder !== parent)) { continue; }
    if (it.name.toLowerCase() !== name.toLowerCase()) { continue; }
    if (found || it.name !== name || it.parentFolder !== parent) { throw new Error("ambiguous or occupied project item: " + name); }
    found = it;
  }
  return found;
};
C.folder = function (name, parent, create) {
  if (!parent) { return null; }
  var item = C.findItem(name, FolderItem, parent, false);
  if (!item && create) { item = app.project.items.addFolder(name); item.parentFolder = parent; }
  return item;
};
C.owned = function (name, kind, parent, seq) {
  var item = C.findItem(name, kind, parent, kind === CompItem);
  if (!item) { return null; }
  if (item.comment !== C.stamp(item, seq, name)) { throw new Error(name + ": existing item belongs to the author or another build"); }
  // A designer may have added a layer to a generated wrapper. Preserve it and flag the
  // conflict; only wrappers made entirely of the builder's own layers may be refreshed.
  var i;
  if (kind === CompItem && name.slice(-5) !== "__tpl") {
    for (i = 1; i <= item.numLayers; i++) {
      var layer = item.layer(i);
      if (layer.comment !== C.stamp(layer, seq, name)) { throw new Error(name + ": contains a manually added or duplicated layer " + layer.name); }
    }
  }
  var uses = item.usedIn;
  for (i = 0; i < uses.length; i++) {
    var c = uses[i];
    if (c.comment !== C.stamp(c, seq, c.name)) { throw new Error(name + ": used by an author composition " + c.name); }
  }
  return item;
};
C.checkSize = function (comp, spec) {
  if (comp && (comp.width !== spec.w || comp.height !== spec.h || Math.abs(comp.frameRate - spec.fps) > 0.001)) { throw new Error(comp.name + ": linked comp has different dimensions or frame rate"); }
};
C.template = function (templates, row, fps) {
  var tpl = C.findItem(row.template, CompItem, templates, false), fields = [], i, j;
  if (!tpl) { throw new Error("missing prepared composition TEMPLATES/" + row.template); }
  if (tpl.width !== 1920 || tpl.height !== 1080 || Math.abs(tpl.pixelAspect - 1) > 0.001) { throw new Error(tpl.name + ": prepare a 1920x1080 square-pixel template"); }
  for (i = 0; i < row.fields.length; i++) {
    var field = row.fields[i].target, suffix = field.toUpperCase(), texts = 0, boxes = 0;
    fields.push(field);
    for (j = 1; j <= tpl.numLayers; j++) {
      var L = tpl.layer(j);
      if (L.name === "TXT_" + suffix) {
        texts++;
        var group = L.property("ADBE Text Properties"), st = group && group.property("ADBE Text Document");
        if (!st || st.numKeys || st.expressionEnabled || L.locked) { throw new Error(tpl.name + "/" + L.name + ": prepare an unlocked static Source Text field on the template copy"); }
      }
      if (L.name === "BOX_" + suffix) {
        boxes++;
        if (!L.guideLayer || !L.property("ADBE Root Vectors Group")) { throw new Error(tpl.name + "/" + L.name + ": expected a guide shape"); }
      }
    }
    if (texts !== 1 || boxes !== 1) { throw new Error(tpl.name + ": expected one TXT_" + suffix + " and one BOX_" + suffix); }
  }
  var info = G.tplInfo(tpl), probs = G.tplProblems(info, fields);
  if (probs.length) { throw new Error(probs.join("; ")); }
  var min = G.minSec(info.T, info.tin, info.tout);
  if (row.D < min - 0.5 / fps) { throw new Error(row.id + ": shorter than " + min + " s for " + tpl.name); }
  return tpl;
};

// Read the entire selected batch and every existing output the preview will use before writing.
C.inspect = function (spec) {
  var root = app.project.rootFolder, seq = spec.seq, templates = C.folder("TEMPLATES", root, false);
  if (!templates) { throw new Error("prepare template copies under the root TEMPLATES folder of the working AEP"); }
  var gfx = C.folder("GFX", root, false), copies = C.folder("_tpl", gfx, false), plates = C.folder("PLATE", root, false);
  var preview = C.owned(spec.preview, CompItem, gfx, seq);
  var plate = C.owned("WORKFLOW_I_PLATE", FootageItem, plates, seq);
  C.checkSize(preview, spec);
  var inputs = [], slots = {}, names = [spec.preview.toLowerCase()], i;
  for (i = 0; i < spec.timeline.length; i++) {
    var id = spec.timeline[i].id, copyName = id + "__tpl";
    if (M.indexOf(names, id.toLowerCase()) >= 0 || M.indexOf(names, copyName.toLowerCase()) >= 0) { throw new Error("slot/preview name collision: " + id); }
    names.push(id.toLowerCase(), copyName.toLowerCase());
    slots[id] = C.owned(id, CompItem, gfx, seq);
    C.checkSize(slots[id], spec);
  }
  for (i = 0; i < spec.rows.length; i++) {
    var row = spec.rows[i], tpl = C.template(templates, row, spec.fps);
    var old = C.owned(row.id + "__tpl", CompItem, copies, seq);
    if (old) {
      var uses = old.usedIn;
      for (var k = 0; k < uses.length; k++) {
        if (uses[k] !== slots[row.id]) { throw new Error(old.name + ": template copy is shared with " + uses[k].name); }
      }
    }
    inputs.push({ row: row, tpl: tpl, old: old });
  }
  return { inputs: inputs, slots: slots, preview: preview, plate: plate };
};
C.usePlate = function (item, folder, file, seq, refresh) {
  if (!item) {
    item = app.project.importFile(new ImportOptions(file));
    item.parentFolder = folder;
  } else if (refresh || !item.file || item.file.fsName.toLowerCase() !== file.fsName.toLowerCase()) {
    item.replace(file);
  }
  item.name = "WORKFLOW_I_PLATE";
  item.comment = C.stamp(item, seq, item.name);
  return item;
};

// Build new layers above the old ones. A failed text edit, fit or remap keeps the previous
// linked comp and its layers; the caller can retry after fixing the prepared template.
C.slot = function (input, comp, spec, gfx, copies, plate) {
  var row = input.row, info = G.tplInfo(input.tpl), copy = input.tpl.duplicate();
  var text = {}, overflow = {}, i, fields = row.fields, first = !comp;
  var oldDuration = comp ? comp.duration : 0, oldLayers = comp ? comp.numLayers : 0;
  try {
    for (i = 0; i < fields.length; i++) { text[fields[i].target] = fields[i].value; }
    var missing = G.setTexts(copy, text, true);
    if (missing.length) { throw new Error("template copy lacks mapped field " + missing.join(", ")); }
    for (i = 0; i < fields.length; i++) {
      var f = fields[i], px = G.overflow(copy, f.target, info.tin);
      if (px > 1) { overflow[f.key] = Math.round(px); }
    }
    if (!comp) {
      comp = app.project.items.addComp(row.id, spec.w, spec.h, 1, row.D, spec.fps);
      comp.parentFolder = gfx;
      comp.comment = C.stamp(comp, spec.seq, row.id);
    }
    comp.duration = row.D;
    // Attach only after the template has been personalized. Keep direct layer references
    // because the new guide moves to the bottom, below the old layers.
    var keep = [], j;
    for (j = 1; j <= oldLayers; j++) { keep.push(comp.layer(j)); }
    G.addSlotLayers(comp, copy, { D: row.D, fps: spec.fps, h: spec.h, plate: plate, inS: row.inS }, info);
    for (i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      if (M.indexOf(keep, layer) < 0) { layer.comment = C.stamp(layer, spec.seq, row.id); }
    }
    copy.parentFolder = copies;
    copy.name = row.id + "__tpl";
    copy.comment = C.stamp(copy, spec.seq, copy.name);
  } catch (e) {
    if (first && comp) { comp.remove(); }
    else if (comp && keep) {
      for (i = comp.numLayers; i >= 1; i--) { if (M.indexOf(keep, comp.layer(i)) < 0) { comp.layer(i).remove(); } }
      comp.duration = oldDuration;
    }
    copy.remove();
    throw e;
  }
  for (i = 0; i < keep.length; i++) { keep[i].remove(); }
  if (input.old) { input.old.remove(); }
  return { comp: comp, result: { id: row.id, D: row.D, min: G.minSec(info.T, info.tin, info.tout), overflow: overflow, missing: [] } };
};
C.build = function (spec, refresh) {
  var f = new File(spec.plate), root = app.project.rootFolder, i;
  if (!f.exists) { throw new Error("plate not found: " + f.fsName); }
  var state = C.inspect(spec);
  var gfx = C.folder("GFX", root, true), copies = C.folder("_tpl", gfx, true);
  var plate = C.usePlate(state.plate, C.folder("PLATE", root, true), f, spec.seq, refresh);
  var result = [];
  for (i = 0; i < state.inputs.length; i++) {
    var input = state.inputs[i], id = input.row.id;
    var built = C.slot(input, state.slots[id], spec, gfx, copies, plate);
    state.slots[id] = built.comp;
    result.push(built.result);
  }
  var preview = state.preview;
  if (!preview) {
    preview = app.project.items.addComp(spec.preview, spec.w, spec.h, 1, spec.duration, spec.fps);
    preview.parentFolder = gfx;
    preview.comment = C.stamp(preview, spec.seq, spec.preview);
  }
  preview.duration = spec.duration;
  while (preview.numLayers > 0) { preview.layer(1).remove(); }
  preview.layers.add(plate).name = "PLATE";
  var omitted = [];
  for (i = 0; i < spec.timeline.length; i++) {
    var at = spec.timeline[i], c = state.slots[at.id];
    if (c) { preview.layers.add(c).startTime = at.inS; } else { omitted.push(at.id); }
  }
  for (i = 1; i <= preview.numLayers; i++) { preview.layer(i).comment = C.stamp(preview.layer(i), spec.seq, spec.preview); }
  app.project.save();
  return { slots: result, preview: { name: preview.name, omitted: omitted }, saved: app.project.file.fsName };
};
