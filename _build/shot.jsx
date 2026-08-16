var STEP_ = "init";
try {
  var comp = app.project.activeItem;
  var FD = 1 / comp.frameRate;
  var frames = [40, 120, 276, 284, 296, 596, 604, 616, 700, 745];
  var out = [];
  for (var i = 0; i < frames.length; i++) {
    var fn = "cloud_" + frames[i] + ".png";
    comp.saveFrameToPng(frames[i] * FD, new File(Folder.temp.fsName + "/" + fn));
    out.push(fn);
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, dir: Folder.temp.fsName, res: comp.resolutionFactor.join("x"), files: out });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
