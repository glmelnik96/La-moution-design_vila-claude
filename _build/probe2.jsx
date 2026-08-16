// Probe the active comp + find the real PostScript names of the Arial family.
var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var info = null;
  if (comp && comp instanceof CompItem) {
    var ls = [];
    for (var i = 1; i <= comp.numLayers; i++) {
      var L = comp.layer(i);
      ls.push(i + " " + L.name.substr(0, 34));
    }
    info = { name: comp.name, w: comp.width, h: comp.height, fps: comp.frameRate,
             dur: comp.duration, n: comp.numLayers, layers: ls };
  }

  // AE 2023+ exposes the font list; fall back to trial assignment.
  STEP_ = "fontlist";
  var arial = [];
  if (app.fonts && app.fonts.allFonts) {
    var all = app.fonts.allFonts;
    for (var k = 0; k < all.length; k++) {
      var ps = all[k].postScriptName;
      if (ps && ps.toLowerCase().indexOf("arial") === 0) arial.push(ps);
    }
  }

  STEP_ = "done";
  JSON.stringify({ step: STEP_, comp: info, arial: arial, nArial: arial.length });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
