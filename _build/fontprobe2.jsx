// Find the real PostScript names for Arial by trial assignment.
// Also clean up any stray probe layer named "Ag".
var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  app.beginUndoGroup("font probe");

  STEP_ = "cleanup";
  for (var i = comp.numLayers; i >= 1; i--) {
    if (comp.layer(i).name === "Ag") comp.layer(i).remove();
  }

  STEP_ = "api";
  var api = { hasFonts: (app.fonts ? true : false) };
  if (app.fonts) {
    try { api.n = app.fonts.allFonts.length; } catch (e1) { api.nErr = e1.toString(); }
  }

  STEP_ = "trial";
  var t = comp.layers.addText("Ag");
  var d = t.property("Source Text").value;
  var names = ["ArialMT", "Arial-BoldMT", "Arial-Black", "Arial-ItalicMT",
               "Arial-BoldItalicMT", "ArialNarrow", "Arial-BlackItalic"];
  var res = [];
  for (var k = 0; k < names.length; k++) {
    try {
      d.font = names[k];
      t.property("Source Text").setValue(d);
      var got = t.property("Source Text").value.font;
      res.push(names[k] + " => " + got + (got === names[k] ? "  OK" : "  MISS"));
    } catch (e2) {
      res.push(names[k] + " => THROW " + e2.toString());
    }
  }
  t.remove();
  app.endUndoGroup();

  STEP_ = "done";
  JSON.stringify({ step: STEP_, api: api, trial: res, n: comp.numLayers });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
