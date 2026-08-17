// v5 beats. The hero now lands at f250 instead of f500, so the v4 frame list
// would sample the one change the cut was made for and miss it entirely.
//
//   40  opening, first answers only
//  150  early fill
//  275  25 f after the hero seats itself at 102 pt - it must NOT read as the
//       winner yet, only as one more big answer
//  400  mid, hero fully camouflaged in the crowd
//  515  after the hero's hidden 102 -> 168 rung at f490 - still tied with LYUDI
//  570  after the first step (168 -> 240 at f548)
//  620  after the second step (240 -> 370 at f598)
//  700  final hold
var c = null;
for (var i = 1; i <= app.project.numItems; i++) {
  if (app.project.item(i) instanceof CompItem && app.project.item(i).name == "Comp 5") {
    c = app.project.item(i);
  }
}
if (!c) { throw new Error("Comp 5 not found"); }
var fps = c.frameRate;
var frames = [40, 150, 275, 400, 515, 570, 620, 700];
var out = [];
for (var k = 0; k < frames.length; k++) {
  var f = new File(Folder.temp.fsName + "/v5beat" + frames[k] + ".png");
  c.saveFrameToPng(frames[k] / fps, f);
  out.push(f.fsName);
}
JSON.stringify({ done: true, comp: c.name, files: out });
