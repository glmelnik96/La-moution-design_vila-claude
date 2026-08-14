var c = app.project.activeItem;
var t = 3.1;
var f = new File(Folder.temp.fsName + "/ae_cap.png");
c.saveFrameToPng(t, f);
JSON.stringify({ done: true, t: t, path: f.fsName });
