// Trim every CODE_FX layer to the frames where it is actually visible.
// Visibility is SAMPLED, not assumed: a layer counts as on-screen at a frame
// when its Opacity and its Scale are both non-zero somewhere inside that frame.
// Quirk #14: for source-less layers inPoint SHIFTS, so assign inPoint first.
var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var FD = 1 / comp.frameRate;
  var END = 20;                     // the effect owns frames 0..20

  app.beginUndoGroup("CODE_FX trim");
  STEP_ = "scan";
  var rep = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    if (L.comment !== "CODE_FX") continue;

    var tr = L.property("Transform");
    var op = tr.property("Opacity");
    var sc = tr.property("Scale");

    var first = -1, last = -1;
    for (var fr = 0; fr <= END; fr++) {
      var on = false;
      // two probes per frame - HOLD keys can flip the value mid-frame
      for (var s = 0; s < 2 && !on; s++) {
        var t = (fr + 0.25 + s * 0.5) * FD;
        var o = op.valueAtTime(t, false);
        var v = sc.valueAtTime(t, false);
        var sm = 0;
        for (var d = 0; d < v.length; d++) if (Math.abs(v[d]) > sm) sm = Math.abs(v[d]);
        if (o > 0.5 && sm > 0.5) on = true;
      }
      if (on) { if (first < 0) first = fr; last = fr; }
    }

    if (first < 0) { L.enabled = false; rep.push([L.name, "never visible"]); continue; }

    STEP_ = "trim " + L.name;
    L.inPoint  = first * FD;          // shifts the layer
    L.outPoint = (last + 1) * FD;     // now trims for real
    rep.push([L.name, first, last, Math.round(L.inPoint / FD), Math.round(L.outPoint / FD)]);
  }
  app.endUndoGroup();
  STEP_ = "done";
  JSON.stringify({ step: STEP_, trimmed: rep.length, rows: rep });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
