# After Effects / ExtendScript quirks

Battle-tested gotchas found while validating tools against a **real** running
After Effects via CDP (source: `Extensions-LLM-Chat` live-validation, commit
`60f2b79`). These are not theoretical — each one produced a silent failure or a
thrown error in a live AE session. Read before writing host code or expressions.

---

## 1. `string + Array` throws "invalid numeric result"

ExtendScript (ES3) does **not** coerce an `Array` to a comma string when you
concatenate it with a `string`. `"pos=" + [100, 200]` throws
`invalid numeric result` at runtime — not a silent `"pos=100,200"` like browser
JS would give you.

**Fix:** call `.join()` explicitly when reading multi-dimensional property values
into a string (e.g. expression readback): `"pos=" + value.join(",")`. Never rely
on implicit Array→string coercion.

## 2. AE puts raw `\r\n` in `expressionError` — never hand-build JSON

After Effects writes raw CRLF control characters into error strings such as
`property.expressionError`. If you build JSON by hand (string concatenation),
those raw control chars produce **invalid JSON**, and the panel silently parsed
`ok:true` on what was actually an error.

**Fix:** always serialize results through the `es-json.jsx` / `resultToJson`
polyfill — it escapes control characters correctly. Never hand-assemble JSON in
ExtendScript.

## 3. `addProperty()` invalidates sibling property references

Calling `addProperty()` (e.g. adding a shape operator or an effect) invalidates
previously captured references to *sibling* properties in the same group. Reusing
a stale reference throws `Object is invalid` — and, worse, sometimes returns a
false `ok:true`.

**Fix:** capture the names/paths of everything you need **immediately** after the
`addProperty()` call that created them, and re-resolve (re-look-up by name/path)
before every reuse. Shape tools now return ready-made property paths (`sizePath`,
etc.) captured at creation time for exactly this reason.

## 4. `Layer` has no `moveTo(index)` — use the move* methods

There is no `layer.moveTo(index)` in the AE DOM. A `reorder_layer` implementation
built on `moveTo` never worked.

**Fix:** reorder with the real methods:
`layer.moveBefore(otherLayer)`, `layer.moveAfter(otherLayer)`,
`layer.moveToBeginning()`, `layer.moveToEnd()`.

## 5. Temporal vs spatial easing — both scriptable, don't conflate them

**Correction (LIVE-VERIFIED against AE 2024, was overstated before):** the
scripting DOM DOES expose spatial tangents. For Position you set the motion-path
handles with `setSpatialTangentsAtKey(index, inTangent, outTangent)` plus
`setSpatialAutoBezierAtKey` / `setSpatialContinuousAtKey`. Confirmed working live:
setting `[120,-60,0]` read straight back via `keyOutSpatialTangent`. The earlier
"impossible" claim was wrong.

**Arity trap (both live-verified):**
- Spatial tangents are **3-element `[x, y, z]` vectors even in a 2D comp** (use
  `z = 0`). A 2-element array throws *"Value array does not have 3 elements."*
- Temporal ease on a **non-separated** Position is a **single-element** array
  `[ease]` (temporal ease is one scalar for the whole property), NOT one-per-
  dimension. `[e, e]` throws *"Value array does not have 1 elements."* Separate
  Dimensions first if you need per-axis temporal ease.

What genuinely does **not** exist: there is no single call that mirrors the Graph
Editor's combined handle drag. Temporal and spatial are separate axes:

- **Temporal** (the *speed/timing* of the move) → `KeyframeInterpolationType`
  (LINEAR / BEZIER / HOLD) + `setTemporalEaseAtKey(index, [inEase], [outEase])`
  with `KeyframeEase(speed, influence)` objects. This is your primary easing lever
  (see `motion-design-principles.md`).
- **Spatial** (the *curvature of the path through space*) → the
  `setSpatialTangentsAtKey` family above.

**CONFIRMED (2026-07-22 smoke run):** `setSpatialTangentsAtKey` behaves as
documented against the running AE — set an out-tangent `[120,-60,0]` on a Position
key and `keyOutSpatialTangent` read back `120,-60,0` exactly. The 3-element arity
(`[x,y,z]`, `z=0` in 2D) is the real trap; the tangent math itself is sound.

## 6. Operate on the active composition only

Tools assume the user's currently-open comp. Do not walk `app.project.items`
looking for a comp by name.

**Fix:** guard every mutation with
`var comp = app.project.activeItem;` then
`if (!(comp instanceof CompItem)) { /* bail: no active comp */ }`.
`activeItem` may be `null`, a `FootageItem`, or a `FolderItem` — the `instanceof
CompItem` check is mandatory.

## 7. Solid color can't be changed after creation

A solid layer's color is baked at creation. There is no writable `.color` you can
reassign afterward.

**Fix:** to recolor an existing solid, apply the **Fill** effect
(`ADBE Fill`) and drive its color, rather than trying to mutate the solid source.

## 8. `capture_comp_frame` captures the current playhead only

The frame-capture host function has **no time parameter**. It captures whatever
frame the comp playhead is currently sitting on.

**Fix:** if a specific frame is needed, move the comp time first
(`comp.time = t`) before capturing. Do not promise "capture at 3s" as a single
call — it is playhead-relative only.

## 9. Text + font: set the font on the live doc, then `setValue` again

After `layer.property("Source Text").setValue(textDocument)`, the TextDocument you
mutate is detached. Setting `.font` / `.fontSize` on your local variable and
saving once throws
`Unable to set value as it is not associated with a layer`.

**Fix:** the working sequence is:
1. `sourceText.setValue(doc)` (attach the text),
2. read the *live* doc back: `var live = sourceText.value;`
3. mutate `live.font` / `live.fontSize` on that live doc,
4. `sourceText.setValue(live)` again.

Also compare requested vs `value.font` after saving to detect silent font
fallback (a `fontWarning`).

## 10. Always wrap mutations in an undo group

Without an undo group, a single tool call can leave several separate entries on
the undo stack — one user Cmd+Z / Ctrl+Z only reverts part of the operation.

**Fix:** bracket every mutating operation:
```jsx
app.beginUndoGroup("Descriptive label");
try {
  // ... all mutations for this one logical action ...
} finally {
  app.endUndoGroup();
}
```
One undo group per logical action → one Cmd+Z fully reverts it.

## 11. Inline jsx with nested quotes on Windows can wedge the whole host

**LIVE-INCIDENT (2026-07-22):** a `node scripts/ae.js "…"` call with nested quotes /
a regex inside the inline jsx got mangled by Windows bash escaping and reached AE as a
syntax error. AE showed a modal *"Unable to execute script at line 40. Syntax error"*.
That modal **blocks the ExtendScript host thread**, so every subsequent `ae.js` call
just times out (CDP page still answers `/json`, but `evalScript` never calls back).
Worse: several already-queued/stuck `ae.js` clients kept re-firing the same bad script,
so the dialog reappeared each time the user dismissed it. Only the user can dismiss an
AE modal — script can't, because the thread is blocked.

**Fixes / discipline:**
- For anything beyond a trivial one-liner, **always write a `@file.jsx`** and run
  `node scripts/ae.js '@_build/foo.jsx'`. Never hand-build inline jsx with nested
  quotes/regex on Windows bash.
- **Never run AE calls concurrently.** `evalScript` is single-threaded and queued; one
  stuck call blocks all others and stacked clients spam any modal.
- **Verification must not depend on a full render if an expression might throw** —
  reading `property.expressionError` (lightweight) is safe; `saveFrameToPng` renders
  the frame and a throwing expression during render can pop a blocking modal. Read
  errors first, then capture.

## 12. Temporal-ease arity — use an adaptive retry, don't hard-code

Confirmed again live (2026-07-22): temporal ease on a **non-separated Position** takes
a **single-element** array `[ease]`; Scale (2D) takes 2; Opacity/Rotation take 1. But
AE occasionally rejected a hard-coded count on a fresh key with *"Value array does not
have N elements."* The robust pattern is to **try the expected arity, then fall back**
through `[n,1,2,3]` catching the error each time:

```jsx
function setEase(prop,k,inInf,outInf,n){
  prop.setInterpolationTypeAtKey(k,KeyframeInterpolationType.BEZIER,KeyframeInterpolationType.BEZIER);
  var tries=[n,1,2,3];
  for(var a=0;a<tries.length;a++){var m=tries[a];var ein=[],eout=[];
    for(var i=0;i<m;i++){ein.push(new KeyframeEase(0,inInf));eout.push(new KeyframeEase(0,outInf));}
    try{prop.setTemporalEaseAtKey(k,ein,eout);return;}catch(e){if(a===tries.length-1)throw e;}}
}
```

## 13. Windowed multi-scene comps — every helper/probe layer MUST be tracked

Live-confirmed (2026-07-22) building the 6-scene GRID & RUPTURE piece. When a single
comp holds several time-windowed scenes (each scene's layers get `inPoint`/`outPoint`
+ opacity fades so only its 5s slot is visible), the failure mode is a **stray helper
layer left visible for the whole 30s**. Cause: a font-detection *probe* text layer
(`mkText(...,"CourierNewPSMT",...)` just to read back the resolved `.font`) was created
but never pushed into the `made[]` array, so it was never windowed or faded — it sat
center-frame across every scene.

Rule: **anything `addText`/`addShape`/`addSolid` creates must either be pushed into the
scene's tracked array (that gets `win()` + `fadeInOut()`) or be removed with
`.remove()` in the same undo group.** Probe layers that only exist to read a value
should be `.remove()`d immediately after you read `.property("Source Text").value.font`.
After each scene, verify `comp.numLayers` matches expectation and capture a frame from
a *neighbouring* scene's window to confirm nothing bleeds across.

## 14. `layer.inPoint` SHIFTS source-less layers — set `inPoint` BEFORE `outPoint`

LIVE-VERIFIED. For layers with no footage source (shape, text, null), the
`inPoint` setter does **not** trim — it *moves* the layer, preserving duration.

```js
// WRONG — outPoint ends up at 1.56, not 0.84
S.outPoint = 0.84;   // no-op, already comp duration
S.inPoint  = 0.72;   // duration (0.84) preserved -> out becomes 1.56

// RIGHT
S.inPoint  = 0.72;   // shifts, out -> 1.56
S.outPoint = 0.84;   // now trims correctly -> 0.72 .. 0.84
```

Rule: **always assign `inPoint` first, then `outPoint`.** `startTime` stays `0`,
so keyframe times remain plain composition time — no offset math needed.
Read both back after setting; do not assume the trim landed.

## 15. Ink-tight boxes behind text: parent the shape, don't compute comp coords

To place a shape exactly behind a text layer, do **not** transform
`sourceRectAtTime` into comp space (you must then replicate scale/rotation, and
it desyncs the moment the user nudges the text). Instead:

```js
var r = T.sourceRectAtTime(T.inPoint + FD * 0.5, false); // ink bounds, layer space
var S = comp.layers.addShape();
rectSize.setValue([r.width + PADX*2, r.height + PADY*2]);
S.parent = T;                                            // set parent FIRST
S.property("Transform").property("Anchor Point").setValue([0, 0]);
S.property("Transform").property("Position").setValue([r.left + r.width/2,
                                                       r.top  + r.height/2]);
S.moveAfter(T);                                          // directly BELOW the text
```

Set `parent` *before* writing Position — assigning `.parent` preserves world
transform by rewriting the child's local values, so any earlier Position is lost.
Padding is in **layer units**; the parent's Scale applies it automatically.
For inverse text contrast add an `ADBE Fill` effect to the text layer
(color prop = `ADBE Fill-0002`) rather than keying `Source Text` — it is a clean,
removable overlay that leaves the original character fill intact.

---

## 16. "AE returned empty result" == an uncaught ExtendScript error (LIVE-VERIFIED)

`ae.js` reports `ERROR: AE returned empty result` for **any** uncaught throw. You
get no message, no line, nothing. Never debug this by bisecting the script — wrap
the whole payload and carry a progress marker.

**RIGHT**

```js
var STEP_ = "init";
try {
  STEP_ = "rows";   /* ... */
  STEP_ = "result"; /* ... */
  STEP_ = "done";
} catch (err) {
  STEP_ = "FAILED after: " + STEP_ + " | " + err.toString() + " @line " + err.line;
}
JSON.stringify({ step: STEP_ });
```

`err.line` is the line number **in the payload as sent** (remember `es-json.jsx`
is prepended, so offsets shift — compare against the generated file, not your
source template).

---

## 17. Never emit an N×M grid as raw rects — use stacked Repeaters (LIVE-VERIFIED)

29 rows × 40 cols = ~1160 `ADBE Vector Shape - Rect` properties in one group
killed the script outright (empty result, no message). Two stacked
`ADBE Vector Filter - Repeater` properties give the same grid from **one** rect.

```js
var c = grp(S, "dots");
c.addProperty("ADBE Vector Shape - Rect"); // the single seed cell
var r1 = c.addProperty("ADBE Vector Filter - Repeater");
r1.property("ADBE Vector Repeater Copies").setValue(nx);
r1.property("ADBE Vector Repeater Transform")
  .property("ADBE Vector Repeater Position").setValue([step, 0]);
var r2 = c.addProperty("ADBE Vector Filter - Repeater");
r2.property("ADBE Vector Repeater Copies").setValue(ny);
r2.property("ADBE Vector Repeater Transform")
  .property("ADBE Vector Repeater Position").setValue([0, step]);
```

---

## 18. Temporal-ease arity, part 2: TEXT-layer Scale is 3-dimensional (extends #12)

A shape layer's Scale reads back 2 elements; a **text** layer's Scale reads back
**3**. Hard-coding `(d === 2) ? 2 : 1` produced
`Unable to call "setTemporalEaseAtKey" because of parameter 2. Value array does
not have 3 elements.` Derive the count from the property and keep a fallback
chain — `p.value.length` is right in every case observed so far, but AE
occasionally disagrees with itself.

```js
function ease(p, k, i, o){
  var d = (p.value instanceof Array) ? p.value.length : 1;
  var a = [], b = [];
  for (var z = 0; z < d; z++){ a.push(new KeyframeEase(0,i)); b.push(new KeyframeEase(0,o)); }
  try { p.setTemporalEaseAtKey(k, a, b); }
  catch(e1){ try { p.setTemporalEaseAtKey(k, [a[0]], [b[0]]); }
             catch(e2){ p.setTemporalEaseAtKey(k, [a[0],a[0]], [b[0],b[0]]); } }
}
```

---

## 19. Generate non-trivial jsx from Python, written with `encoding="ascii"`

Emitting the payload from a Python generator and writing it with
`open(path, "w", encoding="ascii")` forces every non-ASCII char to `\uXXXX`,
which is the only reliably safe way to get Cyrillic into AE text layers. Bonus:
the encoder **fails loudly** if a stray Cyrillic character slipped into a JS
identifier (a Cyrillic `о` in `var nо = ...` was caught this way before it ever
reached AE).

---

## 20. A full-frame MULTIPLY overlay is NOT chip-safe

Green (#26D07C) MULTIPLY over a #222222 ground does **not** leave the ground
alone — it tints the whole frame dark green. To flash only the light chips,
build the overlay from the chip rects themselves and multiply those.

```js
// WRONG - tints the entire charcoal background
chip(ign, 0, W, CY, H, GREEN); ign.blendingMode = BlendingMode.MULTIPLY;

// RIGHT - one rect per light chip, same geometry as the chips below
for (...) chip(ign, x0, x1, yc, h, GREEN);
ign.blendingMode = BlendingMode.MULTIPLY;
```

Multiply over the DARK glyphs inside the chip keeps them dark — legibility holds.

---

## 21. ES3 reserved words cannot be object-literal KEYS — and `new Function()` will not catch it (LIVE-VERIFIED)

ExtendScript is ES3. In ES3 a *future reserved word* is illegal as a property name in
an object literal. AE throws **"Illegal use of reserved word"** at the offending line.

```js
JSON.stringify({ char: 62.27 })   // AE: Illegal use of reserved word
JSON.stringify({ cell: 62.27 })   // fine
```

The trap: the usual pre-flight lint `node -e "new Function(src)"` **PASSES**, because
ES5+ explicitly permits reserved words as property names. So the syntax check gives a
false negative and the failure only shows up as a modal dialog inside AE.

Offenders seen / to avoid as keys: `char class int float double final goto enum byte
short long native super throws transient volatile abstract boolean export import
extends implements interface package private protected public static synchronized
debugger with`.

Add a regex lint alongside the parse check:

```js
const bad = /[{,]\s*(char|class|int|float|double|final|goto|enum|byte|short|long|native|super|throws|transient|volatile|abstract|boolean|export|import|extends|implements|interface|package|private|protected|public|static|synchronized|debugger|with)\s*:/.exec(src);
if (bad) throw new Error('reserved word key: ' + bad[1]);
```

## 22. `sourceRectAtTime` returns the INK box, not the advance — and mono fonts may not be mono (LIVE-VERIFIED)

Two separate traps that compound.

**(a)** `sourceRectAtTime().width` is the *inked* bounding box: it excludes the left
side bearing and the right side bearing. Dividing it by the character count gives a
number that is systematically too small, so a computed character grid drifts right and
the text walks out of its chip. Measure a true advance as a **delta**:

```js
var adv = ink("MM") - ink("M");   // 62.27 at fontSize 100, SBSansTextMono-Regular
// ink("MMMMMMMMMM")/10 = 61.219  <- WRONG, ~1.7% short, ~1 char lost over 60 chars
```

**(b)** Even then: **SBSansTextMono is not strictly monospaced.** Measured at
fontSize 100 — `M` advance = 62.27, **space advance = 65.0**. Any assumed cell drifts
on any string containing spaces.

**Therefore: do not compute layout from font metrics. Measure every token.**
Give each token its own text layer, read its `sourceRectAtTime`, and draw its chip from
that measurement plus a fixed padding. That is immune to the font's metric weirdness
and is also the only way to guarantee *identical* padding inside every chip.

Metrics worth caching for `SBSansTextMono-Regular` @ fontSize 100:
`ascender 70.4956 · descender 18.8324 · advance(M) 62.27 · lsb(M) 6.848`.
Use the FONT ascender/descender (constant) for vertical placement, never the
per-string ink box, or rows with caps/descenders will sit on different baselines.

Position compensation for the left side bearing:

```js
L.property("Transform").property("Position").setValue([x + PADX - lsb, yb]);
```

## 23. Multi-pass builds: layers made in pass 1 sit BELOW layers made in pass 2

New layers are inserted at index 1 (top), so the LAST layer created is the TOP layer.
A measure-then-draw build (pass 1 creates all the text, pass 2 creates all the shapes)
therefore buries every text layer under the shapes — chips render perfectly and the
type is simply invisible.

Fix: keep a per-group list during pass 2 and lift.

```js
for (var i = 0; i < toks.length; i++) toks[i].moveBefore(rowShape);
```

## 24. Shared COLUMN grid, not sequential flow — the cure for "выравнивание скачет"

Laying rows out by flowing tokens left-to-right (`x += w + GAP`) makes every row start
its 2nd/3rd element at a different x, because the first chip's width differs per row.
Reading down the block, the arrows and value chips visibly jitter.

Author the data as `(column, kind, value)` triples on a shared grid, then:

```js
for each item: colW[col] = max(colW[col], itemWidth)
colX[k] = colX[k-1] + colW[k-1] + GAP
x = X0 + colX[col]
```

Every element in a column starts at exactly one x. This is what a Figma auto-layout
table gives you for free and is the single biggest legibility win in a code-block
animation. Keep column *content* left-aligned inside its column; only the whole block
is centred (`X0 = (comp.width - maxW) / 2`).

Corollary: one very long token in a column blows a hole in the layout for every other
row — shorten copy (`frozen=True` → `frozen`) rather than special-casing the grid.
