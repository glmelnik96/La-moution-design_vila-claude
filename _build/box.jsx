var comp = app.project.activeItem;
var FD  = 1 / comp.frameRate;

var DARK  = [0.13333, 0.13333, 0.13333]; // #222222
var LIGHT = [0.96863, 0.96863, 0.96863]; // #f7f7f7

var PADX = 13;   // layer-space padding (inherits text scale via parenting)
var PADY = 7.5;

function hold(prop){
  for (var k = 1; k <= prop.numKeys; k++)
    prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
}

app.beginUndoGroup("BOX behind text");

// --- idempotent: clear previous BOX layers + previous contrast Fill on text
for (var i = comp.numLayers; i >= 1; i--){
  var Lx = comp.layer(i);
  if (Lx.name.indexOf("BOX ") === 0) { Lx.remove(); continue; }
  try {
    var fxg = Lx.property("ADBE Effect Parade");
    for (var e = fxg.numProperties; e >= 1; e--)
      if (fxg.property(e).name === "BOX CONTRAST") fxg.property(e).remove();
  } catch(err){}
}

// --- collect text layers
var texts = [];
for (var i = 1; i <= comp.numLayers; i++)
  if (comp.layer(i) instanceof TextLayer) texts.push(comp.layer(i));

var made = [];
for (var n = 0; n < texts.length; n++){
  var T  = texts[n];
  var r  = T.sourceRectAtTime(T.inPoint + FD * 0.5, false);

  var W  = r.width  + PADX * 2;
  var H  = r.height + PADY * 2;
  var cx = r.left + r.width  / 2;
  var cy = r.top  + r.height / 2;

  // parity checkerboard so the field flickers, not flashes in unison
  var A = (n % 2 === 0) ? DARK  : LIGHT;
  var B = (n % 2 === 0) ? LIGHT : DARK;

  var t0 = T.inPoint;
  var t1 = T.inPoint + FD;                 // hard cut on the next frame

  // ---- BOX shape layer
  var S = comp.layers.addShape();
  S.name = "BOX " + T.name;
  var grp  = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  grp.name = "BOX";
  var cont = grp.property("ADBE Vectors Group");
  var rect = cont.addProperty("ADBE Vector Shape - Rect");
  rect.property("ADBE Vector Rect Size").setValue([W, H]);
  rect.property("ADBE Vector Rect Position").setValue([0, 0]);
  rect.property("ADBE Vector Rect Roundness").setValue(0);
  var fill = cont.addProperty("ADBE Vector Graphic - Fill");
  var fc   = fill.property("ADBE Vector Fill Color");
  fc.setValueAtTime(t0, A);
  fc.setValueAtTime(t1, B);
  hold(fc);

  // source-less layers: setting inPoint SHIFTS and preserves duration -> set in first, then out
  S.inPoint  = T.inPoint;
  S.outPoint = T.outPoint;
  S.parent   = T;                                    // lock to text transform
  S.property("Transform").property("Anchor Point").setValue([0, 0]);
  S.property("Transform").property("Position").setValue([cx, cy]);
  S.moveAfter(T);                                    // directly BELOW the text

  // ---- inverse contrast on the text itself
  var cf = T.property("ADBE Effect Parade").addProperty("ADBE Fill");
  cf.name = "BOX CONTRAST";
  var tc = cf.property("ADBE Fill-0002");
  tc.setValueAtTime(t0, B);
  tc.setValueAtTime(t1, A);
  hold(tc);

  made.push({ box: S.name, w: Math.round(W), h: Math.round(H),
              inP: S.inPoint, outP: S.outPoint, idx: S.index, parent: S.parent.name });
}

app.endUndoGroup();

JSON.stringify({ ok:true, count:made.length, total:comp.numLayers, sample:made.slice(0,3) });
