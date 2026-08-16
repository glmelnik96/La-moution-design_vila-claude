var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var FD = 1 / comp.frameRate;
  var rows = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    if (L.name.substr(0, 2) !== "W ") continue;
    rows.push({ n: L.name, f: Math.round(L.inPoint / FD) });
  }
  rows.sort(function (a, b) { return a.f - b.f; });
  var out = [];
  for (var k = 0; k < 12; k++) out.push(rows[k].f + " " + rows[k].n);
  STEP_ = "done";
  JSON.stringify({ step: STEP_, n: rows.length, first12: out,
                   last: rows[rows.length - 1].f });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
