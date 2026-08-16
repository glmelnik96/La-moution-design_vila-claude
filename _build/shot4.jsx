var STEP_ = "init";
try {
  var FRAMES = [130, 300, 450, 625, 700];
  var comp = null;
  for (var ci = 1; ci <= app.project.numItems; ci++) {
    var it = app.project.item(ci);
    if (it instanceof CompItem && it.name === "Comp 4") { comp = it; break; }
  }
  if (!comp) throw new Error("no comp Comp 4");
  var FD = 1 / comp.frameRate;
  var keep = comp.resolutionFactor;
  comp.resolutionFactor = [1, 1];
  var out = [];
  for (var i = 0; i < FRAMES.length; i++) {
    var fn = "v4_" + FRAMES[i] + ".png";
    comp.saveFrameToPng(FRAMES[i] * FD, new File(Folder.temp.fsName + "/" + fn));
    out.push(fn);
  }
  comp.resolutionFactor = keep;
  STEP_ = "done";
  JSON.stringify({ step: STEP_, dir: Folder.temp.fsName, n: out.length });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
