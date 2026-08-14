var c = app.project.activeItem;
var ts = [0.00, 0.04, 0.20, 0.44, 0.76];
var out = [];
for (var i = 0; i < ts.length; i++){
  var f = new File(Folder.temp.fsName + "/box_" + i + ".png");
  c.saveFrameToPng(ts[i], f);
  out.push(f.fsName);
}
JSON.stringify(out);
