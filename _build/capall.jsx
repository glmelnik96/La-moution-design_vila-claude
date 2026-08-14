var c = app.project.activeItem;
var times = [3.1, 7.3, 12.3, 17.6, 22.3, 28.3];
var out = [];
for (var i=0;i<times.length;i++){
  var f = new File(Folder.temp.fsName + "/ae_s"+(i+1)+".png");
  c.saveFrameToPng(times[i], f);
  out.push(f.fsName);
}
JSON.stringify({done:true, files:out});
