var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var red = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    if (L.name.substr(0, 2) !== "W ") continue;
    var d = L.property("Source Text").value;
    var c = d.fillColor;
    if (c[0] > 0.5 && c[1] < 0.2) red.push(L.name + " sz" + Math.round(d.fontSize));
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, nRed: red.length, red: red });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
