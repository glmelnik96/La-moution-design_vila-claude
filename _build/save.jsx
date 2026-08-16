var STEP_ = "init";
try {
  var dst = new File("C:/dev/temp/yanos_cloud.aep");
  app.project.save(dst);
  STEP_ = "done";
  JSON.stringify({ step: STEP_, path: app.project.file.fsName });
} catch (e) {
  JSON.stringify({ step: STEP_, error: e.toString(), line: e.line });
}
