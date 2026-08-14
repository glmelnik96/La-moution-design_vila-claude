var c = app.project.activeItem;
var FD = 1 / c.frameRate;
var fr = [13, 19];
var out = [];
for (var i = 0; i < fr.length; i++){
  var f = new File(Folder.temp.fsName + "/cx_" + fr[i] + ".png");
  c.saveFrameToPng(fr[i] * FD, f);
  out.push(f.fsName);
}
JSON.stringify(out);
