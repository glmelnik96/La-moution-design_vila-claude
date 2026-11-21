# ExtendScript patterns (ES3, copy-ready)

Working snippets for driving After Effects from ExtendScript. Every mutating
snippet: (a) guards the active comp, (b) wraps mutations in
`beginUndoGroup`/`endUndoGroup`, (c) ends with `JSON.stringify({ok:true, ...})`.

> **matchName verification:** the `matchName` strings below (e.g. `ADBE Fill`,
> `ADBE Drop Shadow`, `ADBE Slider Control`) are the standard English AE
> internal names and are stable across locales, but they MUST be confirmed
> against a real AE in the live-smoke task. Ones flagged `<!-- VERIFY -->` are
> the ones to double-check first. On a localized AE the *display* names differ —
> reference effects by matchName, not display name.

---

## 1. Read active comp summary (name, duration, fps, layers)

Read-only — no undo group needed, but still guard the active item.

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  var layers = [];
  for (var i = 1; i <= comp.numLayers; i++) {
    var L = comp.layer(i);
    layers.push({ index: L.index, name: L.name, enabled: L.enabled });
  }
  JSON.stringify({
    ok: true,
    name: comp.name,
    duration: comp.duration,
    fps: 1 / comp.frameDuration,   // frameRate; derive from frameDuration
    width: comp.width,
    height: comp.height,
    numLayers: comp.numLayers,
    layers: layers
  });
}
```

## 2. Create a solid / shape / text layer

Note the text+font sequence from quirk #9 — attach the doc, read the *live* doc
back, mutate font on it, then `setValue` again.

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Create layers');
  var out = {};
  try {
    // --- solid ---
    var solid = comp.layers.addSolid([1, 0, 0], 'MySolid',
      comp.width, comp.height, 1, comp.duration);
    // Quirk #7: a solid's color cannot be changed later — recolor via ADBE Fill.
    out.solidIndex = solid.index;

    // --- shape ---
    var shape = comp.layers.addShape();
    shape.name = 'MyShape';
    out.shapeIndex = shape.index;

    // --- text (with font, per quirk #9) ---
    var textLayer = comp.layers.addText('Hello');
    var srcText = textLayer.property('Source Text');
    var doc = srcText.value;              // detached template
    doc.text = 'Hello';
    srcText.setValue(doc);               // attach
    var live = srcText.value;            // read the LIVE doc back
    live.fontSize = 120;
    live.font = 'ArialMT';              // PostScript name, not display name
    srcText.setValue(live);            // save again on the live doc
    var fontWarning = (live.font !== 'ArialMT')
      ? ('font fell back to ' + live.font) : null;
    out.textIndex = textLayer.index;
    out.fontWarning = fontWarning;
  } finally {
    app.endUndoGroup();
  }
  out.ok = true;
  JSON.stringify(out);
}
```

## 3. Add keyframes with temporal easing

Position / Scale / Opacity, then apply `setTemporalEaseAtKey`. See quirk #5 for
the temporal-vs-spatial distinction and the array-arity traps (live-verified).

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Add eased keyframes');
  try {
    var L = comp.layer(1);
    var pos = L.property('ADBE Transform Group').property('ADBE Position');

    // two position keyframes
    pos.setValueAtTime(0,   [0,   comp.height / 2]);
    pos.setValueAtTime(1.0, [comp.width, comp.height / 2]);

    // ease-out on key 1, ease-in on key 2 (KeyframeEase: speed, influence%)
    pos.setInterpolationTypeAtKey(1,
      KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.BEZIER);
    pos.setInterpolationTypeAtKey(2,
      KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.LINEAR);

    // LIVE-VERIFIED: temporal ease on a NON-SEPARATED spatial property (Position)
    // is a SINGLE-element array [ease] — one scalar for the whole property, NOT
    // one-per-dimension. Passing [e, e] throws "Value array does not have 1 elements".
    // (Separate Dimensions first if you need per-axis temporal ease.)
    var easeOut = new KeyframeEase(0, 75);
    var easeIn  = new KeyframeEase(0, 75);
    pos.setTemporalEaseAtKey(1, [easeOut], [easeIn]);
    pos.setTemporalEaseAtKey(2, [easeOut], [easeIn]);

    // Opacity (1D) example:
    var op = L.property('ADBE Transform Group').property('ADBE Opacity');
    op.setValueAtTime(0, 0);
    op.setValueAtTime(0.5, 100);
    op.setTemporalEaseAtKey(1, [new KeyframeEase(0, 75)]);
    op.setTemporalEaseAtKey(2, [new KeyframeEase(0, 75)]);
  } finally {
    app.endUndoGroup();
  }
  JSON.stringify({ ok: true });
}
```

## 4. Apply an expression to a property path

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Apply expression');
  var result = { ok: true };
  try {
    var L = comp.layer(1);
    var rot = L.property('ADBE Transform Group').property('ADBE Rotate Z');
    rot.expression = 'time * 90';       // spin 90 deg/sec
    // Read back any error — AE puts raw \r\n here (quirk #2); ship via
    // resultToJson / JSON.stringify which escapes control chars.
    if (rot.expressionError && rot.expressionError.length > 0) {
      result.ok = false;
      result.expressionError = rot.expressionError;
    }
  } finally {
    app.endUndoGroup();
  }
  JSON.stringify(result);
}
```

## 5. Add an effect by matchName and read/set its properties

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Add effects');
  var out = { ok: true };
  try {
    var L = comp.layer(1);
    var fx = L.property('ADBE Effect Parade');

    // Drop Shadow — read/set a property by name
    var ds = fx.addProperty('ADBE Drop Shadow');        // <!-- VERIFY -->
    ds.property('Opacity').setValue(200);              // 0..255
    ds.property('Distance').setValue(25);
    ds.property('Softness').setValue(30);
    var dsOpacity = ds.property('Opacity').value;       // read back

    // Slider Control — add and rename (renaming needed for expression rigs)
    var slider = fx.addProperty('ADBE Slider Control');  // <!-- VERIFY -->
    slider.name = 'Wiggle Amp';
    slider.property('Slider').setValue(50);
    var sliderVal = slider.property('Slider').value;

    out.dropShadowOpacity = dsOpacity;
    out.sliderValue = sliderVal;
  } finally {
    app.endUndoGroup();
  }
  JSON.stringify(out);
}
```

## 6. Import a file and add it to the active comp

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Import + add to comp');
  var out = { ok: true };
  try {
    var PATH = 'C:/path/to/asset.png';
    var f = new File(PATH);
    if (!f.exists) {
      out.ok = false;
      out.message = 'file not found: ' + PATH;
    } else {
      var io = new ImportOptions(f);
      var footage = app.project.importFile(io);
      var layer = comp.layers.add(footage);   // add imported footage as a layer
      out.footageName = footage.name;
      out.layerIndex = layer.index;
    }
  } finally {
    app.endUndoGroup();
  }
  JSON.stringify(out);
}
```

## 7. Parent / reorder layers (quirk #4 methods)

`Layer` has no `moveTo(index)` — use `moveBefore` / `moveAfter` /
`moveToBeginning` / `moveToEnd`.

```jsx
var comp = app.project.activeItem;
if (!(comp instanceof CompItem)) {
  JSON.stringify({ ok: false, message: 'no active comp' });
} else {
  app.beginUndoGroup('Parent + reorder');
  try {
    var child  = comp.layer(1);
    var parent = comp.layer(2);

    // parent layer 1 to layer 2
    child.parent = parent;

    // reorder (NO moveTo — quirk #4):
    child.moveToBeginning();        // to top of stack
    // child.moveToEnd();          // to bottom
    // child.moveBefore(parent);   // just above `parent`
    // child.moveAfter(parent);    // just below `parent`
  } finally {
    app.endUndoGroup();
  }
  JSON.stringify({ ok: true });
}
```

---

## 8. Text Animators (per-line / per-character motion inside ONE layer)

The engine behind every "premium" text reveal. An Animator holds *properties* (Position,
Opacity, Scale, Tracking…) and *selectors* that decide which characters/words/lines they
apply to. Animating the animator property (or the selector's Offset) moves glyphs **inside**
the layer, so a layer mask stays put — that is how `M.lineReveal` clips a rising line without
a matte.  <!-- VERIFY: addProperty("ADBE Text Animator") creates a default Range Selector? The lib adds one if none -->

```jsx
var tp   = L.property("ADBE Text Properties");
var anim = tp.property("ADBE Text Animators").addProperty("ADBE Text Animator");
anim.name = "rise";
var sels = anim.property("ADBE Text Selectors");
if (sels.numProperties === 0) sels.addProperty("ADBE Text Selector");     // Range Selector
var sel  = sels.property(1);
// Units / Based On live under "ADBE Text Range Advanced": Based On 1=chars 2=chars excl. spaces 3=words 4=lines <!-- VERIFY -->
try { sel.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").setValue(4); } catch (e) {}
var posP = anim.property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
posP.setValueAtTime(0,   [0, 120, 0]);
posP.setValueAtTime(0.6, [0,   0, 0]);
M.bezierEase(posP, 1, CR.EASE.ENTER);
```

Per-character cascade (only for code/terminal metaphors in Cloud.ru): keep Based On = chars and
animate `sel.property("ADBE Text Percent Offset")` from `-100` to `100` with Start 0 / End 20 —
a 20 % window sweeps across the string. Add `"ADBE Text Opacity"` to the same animator for a
combined fade.

Other animator property matchNames: `ADBE Text Opacity`, `ADBE Text Scale 3D`,
`ADBE Text Tracking Amount`, `ADBE Text Rotation`, `ADBE Text Fill Color`, `ADBE Text Anchor Point 3D`.

## 9. Shape paths, strokes and Trim Paths (draw-on)

```jsx
var S = M.shape("arrow");                       // anchor == position == [0,0]
var g = M.group(S, "line");                     // returns the GROUP
var c = M.inner(g);                             // its Contents
M.pathIn(c, [[100, 500], [600, 500]], false);   // open path (Shape object)
M.pathIn(c, [[586, 490], [600, 500], [586, 510]], false);   // arrowhead
M.stroke(c, CR.COLOR.ARROW, 2);                 // square caps, miter joins
var trim = c.addProperty("ADBE Vector Filter - Trim");
M.tween(trim.property("ADBE Vector Trim End"), 0, 400, 0, 100, "enter");
```

Order matters inside a group: paths first, then the Trim Paths operator, then Fill/Stroke —
AE evaluates top-down. Adding a property invalidates sibling references (quirk #3), so re-resolve
the group with `M.groupByName(S, "line")` before touching it again.

Bezier paths: set `shape.inTangents` / `shape.outTangents` (arrays of `[dx,dy]` relative to
each vertex) before `setValue`. For the brand, tangents are `[0,0]` — straight segments only.

## 10. Masks and track mattes (revealing without moving)

**Mask on the layer itself** — layer space; moves with the layer; ideal for `M.wipe` (the
layer is still, the mask path animates):

```jsx
var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
m.maskMode = MaskMode.ADD;
var sh = new Shape(); sh.vertices = [[0,0],[600,0],[600,120],[0,120]]; sh.closed = true;
m.property("ADBE Mask Shape").setValueAtTime(0, sh);
// mask-shape keys interpolate; ease them by influence only (no speed term for shapes)
```

**Track matte** — a separate layer supplies alpha/luma; the content layer can move freely
under it. AE 23+: `L.setTrackMatte(matteLayer, TrackMatteType.ALPHA)` (matte can be
anywhere); older: `L.trackMatteType = TrackMatteType.ALPHA` with the matte directly ABOVE.
`M.lineReveal(L, t, { mode: "matte" })` wraps both.  <!-- VERIFY on the installed AE version -->

## 11. 3D layers, camera, parallax (brand: linear dolly only)

```jsx
var cam = comp.layers.addCamera("cam", [comp.width / 2, comp.height / 2]);   // 2-node camera
cam.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2, -2000]);
L.threeDLayer = true;
L.property("ADBE Transform Group").property("ADBE Position").setValue([x, y, -300]);   // closer = bigger
// dolly 3 % of the frame over the scene, linear-in-space, `move` in time:
var cp = cam.property("ADBE Transform Group").property("ADBE Position");
M.tween(cp, 0, 4000, [960, 540, -2000], [960, 540, -1940], "move");
```

Text-layer Scale is 3-D (quirk #18); `sourceRect * scale` is NOT the on-screen box on 3D
layers — project through the camera (quirk #37) before auditing overlaps.

## 12. Precompose, adjustment layers, markers

```jsx
var pre = comp.layers.precompose([1, 2, 3], "scene 1", true);   // moves attributes into the precomp
var adj = comp.layers.addSolid([0,0,0], "adjust", comp.width, comp.height, 1, comp.duration);
adj.adjustmentLayer = true;                                     // effects apply to everything below
L.property("ADBE Marker").setValueAtTime(1.0, new MarkerValue("beat"));   // layer marker
comp.markerProperty.setValueAtTime(2.0, new MarkerValue("scene 2"));      // comp marker
```

Comp markers named by scene are the cheapest "beat sheet inside AE": expressions can read
`marker.key(n).time` and `M.capture` can be driven from them.

## 13. Expression controls rig (one null drives many layers)

```jsx
var ctl = comp.layers.addNull(comp.duration); ctl.name = "CTL";
var sl = ctl.property("ADBE Effect Parade").addProperty("ADBE Slider Control"); sl.name = "Progress";
var cb = ctl.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control"); cb.name = "Dark";
var col = ctl.property("ADBE Effect Parade").addProperty("ADBE Color Control"); col.name = "Accent";
// consumer expressions
opacity.expression = 'thisComp.layer("CTL").effect("Dark")("Checkbox") == 1 ? 100 : 0';
fillColor.expression = 'thisComp.layer("CTL").effect("Accent")("Color")';
```

Property-index addressing (`("ADBE Slider Control-0001")` / `(1)`) survives renaming and
localisation; display names (`("Slider")`) do not.

## 14. Reading back what you built (the verification half)

```jsx
JSON.stringify(M.run("audit", function () {
  M.active();
  var out = [];
  for (var i = 1; i <= M.comp.numLayers; i++) {
    var L = M.comp.layer(i);
    out.push({ name: L.name, win: M.visibleWindow(L), box: M.bounds(L, L.inPoint + M.FD),
               keys: M.pos(L).numKeys, font: (L.property("ADBE Text Properties") ? M.srcText(L).value.font : null) });
  }
  return { layers: out, errs: M.exprErrors() };
}))
```

Use it after every build step: intended windows vs `visibleWindow`, intended layout vs
`bounds`, requested font vs read-back font, and zero `expressionError`s before any capture
(a throwing expression during `saveFrameToPng` can raise a blocking modal — quirk #11).
