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
