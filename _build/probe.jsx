var STEP_ = "init";
try {
  var comps = [];
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (it instanceof CompItem)
      comps.push({ nm: it.name, w: it.width, h: it.height,
                   fr: it.frameRate, du: it.duration,
                   ly: it.numLayers, mb: it.motionBlur,
                   res: it.resolutionFactor.join("x"),
                   act: (it === app.project.activeItem) });
  }
  STEP_ = "done";
  JSON.stringify({ step: STEP_, ver: app.version,
                   file: (app.project.file ? app.project.file.fsName : null),
                   dirty: app.project.dirty,
                   rq: app.project.renderQueue.numItems,
                   comps: comps });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
