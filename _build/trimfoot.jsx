// Trim the first-shot footage to the cut: the V4 layers are fully covered by
// V5 from frame 20 on, so they should not run to the end of the comp.
var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var FD = 1 / comp.frameRate;
  var CUT = 20;

  app.beginUndoGroup("trim footage to cut");
  STEP_ = "scan";
  var rep = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    if (L.comment === "CODE_FX") continue;
    if (L.name.indexOf("V4-") !== 0) continue;
    STEP_ = "trim " + i;
    L.outPoint = CUT * FD;
    rep.push([i, L.name.substr(0, 10), Math.round(L.inPoint / FD), Math.round(L.outPoint / FD)]);
  }
  app.endUndoGroup();

  STEP_ = "report";
  var all = [];
  for (var j = 1; j <= comp.numLayers; j++) {
    var M = comp.layer(j);
    if (M.comment === "CODE_FX") continue;
    all.push([j, M.name.substr(0, 18), Math.round(M.inPoint / FD), Math.round(M.outPoint / FD)]);
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, trimmed: rep, layers: all });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
