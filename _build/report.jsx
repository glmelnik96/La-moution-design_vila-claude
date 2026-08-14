// Report the in/out window of every layer in the active comp, in frames.
var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var FD = 1 / comp.frameRate;
  var fx = [], other = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    var w = L.name.substr(0, 16) + "  " +
            Math.round(L.inPoint / FD) + "-" + Math.round(L.outPoint / FD);
    if (L.comment === "CODE_FX") fx.push(w); else other.push(w);
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, comp: comp.name, n: comp.numLayers, fx: fx, other: other });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
