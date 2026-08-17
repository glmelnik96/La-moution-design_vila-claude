var STEP_ = "init";
try {
  var dst = new File("C:/Users/Глеб/Documents/YANOS Cloud/yanos_cloud_v4.aep");
  STEP_ = "save";
  app.project.save(dst);
  STEP_ = "verify";
  var f = app.project.file;
  JSON.stringify({ step: "done", path: f ? f.fsName : null,
                   exists: f ? f.exists : false,
                   bytes: f ? f.length : null,
                   items: app.project.numItems });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
