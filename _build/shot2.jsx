var STEP_ = "init";
try {
  var JOBS = [["Comp 2", "v2"], ["Comp 3", "v3"]];
  var FRAMES = [37, 63, 300, 599, 660, 700];
  var out = [];
  for (var j = 0; j < JOBS.length; j++) {
    var comp = null;
    for (var ci = 1; ci <= app.project.numItems; ci++) {
      var it = app.project.item(ci);
      if (it instanceof CompItem && it.name === JOBS[j][0]) { comp = it; break; }
    }
    if (!comp) throw new Error("no comp " + JOBS[j][0]);
    var FD = 1 / comp.frameRate;
    for (var i = 0; i < FRAMES.length; i++) {
      var fn = JOBS[j][1] + "_" + FRAMES[i] + ".png";
      comp.saveFrameToPng(FRAMES[i] * FD, new File(Folder.temp.fsName + "/" + fn));
      out.push(fn);
    }
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, dir: Folder.temp.fsName, n: out.length });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
