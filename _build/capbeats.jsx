// Frames chosen at the NEW beats, not the old ones: the rim opening, the mid
// fill, the last supporting answer, the silent gap, and each of the hero's
// three sizes. Reviewing the old timecodes would miss every change.
var c = app.project.activeItem;
var fps = c.frameRate;
var frames = [40, 150, 300, 420, 480, 515, 565, 630];
var out = [];
for (var i = 0; i < frames.length; i++) {
  var f = new File(Folder.temp.fsName + "/beat" + frames[i] + ".png");
  c.saveFrameToPng(frames[i] / fps, f);
  out.push(f.fsName);
}
JSON.stringify({ done: true, files: out });
