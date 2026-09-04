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

## 25. A modal error dialog in AE BLOCKS the CDP bridge — and every retry queues another one (LIVE-VERIFIED)

When a script throws a *syntax* error, AE does not return it over the bridge — it puts
up a modal **"Unable to execute script at line N"** dialog and waits for a human. The
CEP panel cannot answer CDP while that modal is up, so `ae.js` sits until its own
`CDP timeout (120s)`.

The trap is the retry. Each further call is accepted, blocks, times out, and leaves
*another* queued dialog behind it. Three "let me just check the state" probes produced
four stacked dialogs and ~8 minutes of dead time.

**Rule: on `CDP timeout (120s)`, STOP calling AE.** Ask the user to clear the dialogs
(or reload the panel), and only then send one lightweight ping before resuming. Do not
probe "just to see" — probing is what multiplies the dialogs.

Reading the line number: `es-json.jsx` (38 lines) is prepended and joined with `\n`, so
**the payload's own line 1 is reported as line ~40.** A reported line just above 39
means the fault is at the very top of your jsx, not in the prelude.

Related: this is a second reason to follow #19 and keep non-trivial jsx in a FILE rather
than passing it inline through the shell — inline payloads can be mangled in transit,
and a mangled payload is exactly what raises the blocking syntax dialog.

## 26. Trim layers by SAMPLING visibility, not by remembering when you keyed them

To make a timeline honest ("слои стоят там, где они существуют на видео"), do not trust
your own build-time bookkeeping. Sample the composite state per frame:

```js
for (var fr = 0; fr <= END; fr++) {
  for (var s = 0; s < 2; s++) {            // two probes - HOLD keys flip mid-frame
    var t = (fr + 0.25 + s * 0.5) * FD;
    var o = op.valueAtTime(t, false);
    var v = sc.valueAtTime(t, false);      // max |component|, dimension-agnostic
    ...
  }
}
L.inPoint  = first * FD;                    // quirk #14: inPoint FIRST
L.outPoint = (last + 1) * FD;               // +1: the frame must stay on screen
```

Two details that matter: probe **twice per frame** (a HOLD key landing mid-frame is
invisible to a single sample), and set `outPoint` to `last + 1` frames — an outPoint of
exactly `last * FD` cuts the layer off *before* its final frame renders.

Check `Opacity` **and** `Scale`: a layer scaled to 0 is invisible at full opacity, and
snap-on rigs routinely park layers at scale 0.

## 27. `saveFrameToPng` is asynchronous, and it honours the comp's Resolution

Two independent traps, and together they will make you review the *wrong* picture and
conclude your change did nothing.

**It returns before the file is on disk.** The JSX resolves as soon as the frame is
queued; AE keeps writing in the background. If the very next command converts or reads
those PNGs, it reads the *previous* build's frames. At 4K this window is several
seconds. Poll until both the file count and the sizes stop changing:

```bash
rm -f cloud_*.png                       # never trust leftovers
node scripts/ae.js '@_build/shot.jsx'
for i in $(seq 8); do
  a=$(ls -l cloud_*.png | md5sum); sleep 3; b=$(ls -l cloud_*.png | md5sum)
  [ "$a" = "$b" ] && [ $(ls cloud_*.png | wc -l) -eq 9 ] && break
done
```

Deleting first is the important half: if the write has not started, a stale file with a
plausible timestamp is indistinguishable from a fresh one.

**It writes at the comp's Resolution, not full size.** A 4096x2160 comp set to Quarter
saves a 1024x540 PNG. Fine for judging layout, useless for judging type crispness — and
it silently breaks any crop coordinates you computed in comp space. Check `im.size`
before cropping, or set `comp.resolutionFactor = [1, 1]` for the capture.

## 28. Scaling a 1x1 solid gives you a 1-px tick, not a rule

`addSolid(col, name, 1, 1, 1)` then `Scale = [46, 400]` reads as "46 wide, 400 tall" if
you think in pixels. Scale is a *percentage*: the result is 0.46 x 4 px — a speck that
looks like sensor dirt on the render, not a design element.

Build rules, bars and underlines at their **final pixel size** and animate `Scale` from
`[0, 100]` to `[100, 100]`. That also gives a wipe-on for free, and the growth is
linear in pixels so the easing reads the way you designed it.

## 29. Parenting AFTER positioning rewrites your values — parent FIRST, and neutralise the null

Assigning `L.parent = nul` preserves the layer's *world* transform, so AE silently
rewrites Position (and every Position keyframe) into parent space. Set one value before
parenting and it still looks right; write 129 keyframes before parenting and AE
re-bases all of them behind your back.

Two rules that make a control null harmless:

1. **Parent before writing any transform keys.**
2. Give the null `Anchor Point == Position == comp centre`. Then a child's own
   coordinates *are* comp coordinates while the null sits at 100%, so packed/computed
   layouts can be written in straight (`[CX, CY]` maths, no offset bookkeeping) — and
   scaling the null still scales about the comp centre.

An anchor of `[50, 50]` on a null positioned at `[CX, CY]` (the AE default shape) offsets
every child by `[CX-50, CY-50]`. That is the source of the classic "everything jumped
when I parented it" bug.

## 30. `setValueAtTime` on Position creates SPATIAL keys — they swoop unless you flatten them

Position is a spatial property. Every key AE creates gets **auto-bezier spatial
tangents**, so a layer moving A -> B -> C does not travel in straight lines: it arcs
through the corners and overshoots past them. Temporal easing does nothing about this —
the curve is in the motion *path*, not the timing.

For layout moves (word clouds, grids, anything that has to land exactly where the packer
said) flatten every key:

```js
for (var k = 1; k <= p.numKeys; k++){
  try { p.setSpatialAutoBezierAtKey(k, false); } catch (e) {}
  try { p.setSpatialTangentsAtKey(k, [0,0,0], [0,0,0]); } catch (e) {}
}
```

Zero tangents on both sides = linear path, exact arrival. Keep the ease-out in the
*temporal* ease, where it belongs.

## 31. Reflow reads as mush unless travelling elements are ghosted

A word cloud that re-packs (the way a live poll cloud does) has elements crossing each
other for 10-18 frames at a time. At full opacity two words on top of each other is
unreadable garbage for half a second, and it looks like a bug rather than a transition.

Dip a travelling element to ~40-45% at ~45% of its journey and back to 100% on arrival,
but only for real travel (> ~150 px at 4K) — nudges should stay solid, or the frame
starts flickering. The crossing then reads as intentional motion blur, and the layout
change is legible.

## 32. Motion blur stacks destructively with ghosting, and ruins HOLD teleports + hero type

Turning on comp motion blur after building a reflow looks like a free upgrade. It is not:

- **Blur + opacity ghost = mush.** The 40-45% dip from quirk 31 assumes crisp glyphs.
  With blur on, raise the dip to ~60% — the blur already sells the travel, and 42% on top
  of it leaves nothing readable.
- **Never blur a layer whose keys are HOLD.** A marker/underline that teleports from word
  to word gets its instantaneous jump smeared into a white streak across the whole frame.
  Set `layer.motionBlur = false` on anything that snaps.
- **Never blur the hero title.** At 370 pt the smear doubles the glyphs on entrance and
  deforms the brand word — exactly what the "no deformation on brand titles" rule forbids.
- **Shutter angle 180 (or 150) is a film default, not a graphics default.** For type moving
  fast across a 4K frame, 90 keeps the letterforms legible.

## 33. Render out of process with aerender.exe — never block the live session

`renderQueue.render()` over the CDP bridge blocks AE's UI thread; a 4K render will time the
bridge out, and per the bridge-safety rule you then have to stop calling AE altogether.
Instead: `app.project.save(new File(path))` (an untitled project gains a home, no loss), then
shell out:

```
aerender.exe -project P.aep -comp "Comp 1" -RStemplate "Best Settings" \
             -OMtemplate "H.264 - Match Render Settings - 15 Mbps" -output out.mp4
```

`Best Settings` forces Full resolution, so the comp being parked at 1/4 for preview does not
leak into the render. 30 s of 4096x2160 with 41 animated text layers took ~45-55 s per comp.
The live AE session stays interactive throughout.

## 34. `saveFrameToPng` honours the comp's preview resolution factor

A comp parked at 1/4 for interactive work writes 1024x540 PNGs, silently. Every "defect"
you then diagnose is really a resampling artefact — I once spent a round chasing a marker
that appeared to strike through a word, and at 1:1 the marker was nowhere near it.

```js
var keep = comp.resolutionFactor;
comp.resolutionFactor = [1, 1];
comp.saveFrameToPng(f * (1 / comp.frameRate), new File(path));
comp.resolutionFactor = keep;      // always restore, the user is still working in it
```

Unlike `aerender`, there is no "Best Settings" to force full res for you here.

## 35. A reflowing layout is only clean at its keyframes — sweep every frame

A packer that guarantees no overlap at each layout event says nothing about the straight
line between two events. Words swapping slots pass straight through each other, and a spot
check of four frames will not find it: v4 looked clean at every frame I sampled by hand and
had 59 real collisions in transit.

Sweep the generator's own state lists frame by frame, offline, before touching AE. Then:

- **Sweep to the end of MOTION, not the last arrival.** `F_LAST` was the last word landing
  at f545, but the vote ladder kept reflowing to f604 and states ran to f620. The sweep
  stopped at f585 and left the busiest stretch of the spot unexamined — fixing the bound
  alone took collisions 3 -> 1. Use `max(s[-1][0] for s in STATES)`.
- **The sweep and the offline checker must agree on "live" and "hidden".** Every time they
  disagreed (different entrance offsets, the sweep not knowing which words it had already
  blanked) the disagreement was hiding a real defect.
- **A blanked word cannot collide.** Read opacity, not just geometry, or you re-report
  crossings you already solved and start blanking innocent bystanders.
- **One pass is not a fixed point.** Blanking a word frees the slot it was fighting over,
  exposing a crossing that was masked behind it. Iterate until nothing new turns up.
- **Merge a word's overlapping blank windows, darkest floor wins.** Left separate, one
  window's ramp back to full opacity lands inside the next window's blank and cancels it:
  the word strobes on-off-on instead of going away.
- **Fixed ramp lengths, not proportional.** Merging lengthens the window, and a
  proportional ramp then bottoms out well after the crossing it was minted for.

## 36. Hiding crossings is a budget — count how many words vanish at once

Blanking a word in transit is the right move (a word that dissolves and re-forms elsewhere
is the language of a live poll), but it is a cost. Audit concurrency, not just totals: v4
had one collision left and *nine words gone simultaneously*, six of them bunched in the
same flank — a hole punched in one side of the cloud, which is a worse defect than the
crossings it cured. Check the spatial spread too; scattered blanks read as a re-shuffle,
adjacent ones read as a dropout.

Two things that fixed it, and one that did not:

- **Keep hand-scheduled "act break" events clear of the automatic ones.** A hero surge
  landing 3 frames from a routine climb sets two full re-packs rippling at once, and
  overlapping ripples cross far more often than either alone. A guard band (13 frames)
  took concurrency 9 -> 7 and cost nothing.
- **Do NOT lengthen the ripple stagger to spread the load.** It is the obvious move and it
  is backwards: a longer stagger keeps words in flight longer, and a word in flight is a
  word that can be crossed. Concurrency went 7 -> 9. Words shoved as one block travel in
  parallel and never meet.

## 37. A geometry model is not the render — audit collisions from AE, not from the packer

LIVE-VERIFIED. `check_overlap.py` swept every frame of the v4 cloud and reported **1 real
collision**. The rendered frames showed words sitting on top of each other, including in
the held final layout that carries the last five seconds of the spot. The sweep was not
lying about its own numbers; it was auditing the *packer's* idea of where the words are,
which is not where AE puts them.

**On a 3D layer `sourceRect * scale` is NOT the on-screen box** — it skips the camera
projection, and `Layer.toComp()` does not exist in this build (verified: `typeof L.toComp
=== "undefined"` on a layer with `threeDLayer === true`). Project by hand:

```jsx
// anchor is [0,0], so scale multiplies the source rect about the layer origin
var r = L.sourceRectAtTime(t, false);
var p = L.position.valueAtTime(t, false);        // world x, y, z
var s = L.scale.valueAtTime(t, false)[0] / 100;
var wl = p[0] + r.left * s, wt = p[1] + r.top * s;    // world-space ink box
// then through the camera (cam = its Position value, ZOOM = its Zoom):
//   screen_x = CX + (wl - cam[0]) * ZOOM / (z - cam[2])
```

Getting this wrong both invents defects and hides real ones. Same frame, three answers:

| f625, held final layout | packer model | `sourceRect * scale` | projected properly |
|---|---|---|---|
| ink overlaps | 0 | 6 | **6 — a different 6** |
| МОЩЬ x ЛЮДИ | clean | 43.7%, 100x61 px | **clean** — pure arithmetic artefact |
| ДВИЖЕНИЕ x КОЛЛЕКТИВ | clean | clean | **113x90 px** — the one you can see |
| ПРОФЕССИОНАЛЫ x КОМАНДА | clean | 74x72 px | 13x77 px — renders "ПРОФЕССИОНАЛЬ" |

Only the last column matches the rendered pixels. Check an auditor against a render before
trusting any number it prints.

The packer column is clean for a second reason on top of the projection: its ink boxes were
stale and too narrow, so in its own world the words really did not touch. Two wrong models
agreeing on "clean" is not corroboration — see the differencing recipe below.

- **Measured boxes go stale silently.** `boxes.json` is a snapshot of ink boxes at the
  moment `measure.jsx` ran. Every later edit to sizes, tiers or the vote ladder invalidates
  it — and so does anything that changes how the font resolves — and nothing complains.
  Re-measure in the same session you build in.
- **Ink boxes do not scale linearly.** A word set at 200 pt is not its 100 pt box doubled;
  hinting, side bearings and tracking all shift. Modelling size change as `BOX * ratio`
  accumulates error exactly where the v4 vote-climb applies the largest ratios.
- **Area fraction is the wrong metric for type.** «8% of the smaller box» sounds like a
  brush-past and is in fact a 29x69 px letter-on-letter hit — a long word's box is mostly
  empty, so real glyph collisions score tiny. Gate on **minimum px gap between boxes**
  (negative = overlap), not on overlapped area.
- **Audit the held frames hardest.** A crossing during a re-pack is on screen for 5 frames;
  a defect in the final layout holds for seconds and is the frame that gets screenshotted.

### The actual culprit: a stale `boxes.json`, found by differencing model against AE

My first diagnosis was the camera, and it was wrong. Write the differencing script before
writing the explanation — the explanation is cheap to invent and always sounds plausible.

Difference the model against AE one layer at a time, in this order:

1. **Transforms.** Read `position` / `scale` from AE at one frame and compare with what the
   generator thinks it wrote. Here they agreed to **0.5 px on all 41 words** — so the
   keyframe authoring, the depth compensation and the easing were all exonerated at once,
   and the whole camera theory with them.
2. **Boxes.** Same frame, compare cached `BOX[i]` against `sourceRectAtTime`. Heights and
   `left`/`top` matched; **every width was 5–8% short.** КОЛЛЕКТИВ: cache 2149, AE 2323.
   The deficit scaled with character count x font size — a per-glyph advance difference,
   i.e. the cache had been measured under a font that resolved differently.

That is the entire bug. A packer given boxes 7% too narrow packs a layout that is 7% too
tight, and the overlaps land exactly where the longest words meet. Re-measuring dropped the
disagreement to zero; the packer still fit with 0 bails. **`boxes.json` is a build artifact,
not input** — regenerate it in the same session that builds the comp.

The tell that it is the boxes and not the transforms: heights match and widths do not. A
projection or scale error moves both.

### Camera drift is real, but it is a ~13 px effect — size it before blaming it

The depth trick (`scale = k`, position pushed out from centre by the same
`k = (z + CAMD) / CAMD`) reproduces the packed 2D layout **exactly, and only while the
camera sits at home** `z = -CAMD`, `zoom = CAMD`, centred. Once the camera drifts, each tier
is magnified and slid by a slightly different amount, so cross-tier pairs do move relative
to one another. That part is true.

But arithmetic it before building a theory on it. For `CAMD = 5200`, tiers at
`z = -520..+520`, camera at `(2121, 1041, -5095)`:

| tier | z | magnification | x shift |
|---|---|---|---|
| H | -520 | 1.0229 | -83.0 |
| B | -230 | 1.0217 | -78.0 |
| M | +180 | 1.0199 | -72.0 |
| S | +520 | 1.0186 | -67.6 |

Worst cross-tier differential: **~11 px of shift and 0.3% of scale.** It cannot produce a
113 px overlap. A camera excursion this gentle is comfortably inside normal packer padding
(`PADX = 26`).

- **The give-away that a layout is depth-compensated** is several distinct scale values on
  the settled final frame (here 90 / 95.6 / 103.5 / 110, one per tier). Every audit of such
  a layout must go through the camera — but going through the camera is a correctness fix,
  not necessarily a *large* one.
- **Parallax and a guaranteed layout are the same budget spent twice.** Either the camera
  returns home by the time the layout must be clean, or the packer carries inter-tier margin
  sized for the camera's worst excursion. Size that excursion first: if it is 11 px, the
  padding already covers it and there is nothing to buy.

## 38. Reordering a sequence breaks every index that was standing in for a time

Reversing the reveal (hero first -> hero last) needed one line in the ordering
function. It also silently disabled the collision blanker, because the blanker
opened with:

```python
for f in range(int(FRAME[0]), end):
```

`FRAME[0]` is the hero's arrival frame. It was written when the hero opened the
spot, so `FRAME[0]` and "the first thing that happens" were the same number and
either spelling worked. After the reorder `FRAME[0]` became f500 and the sweep
skipped the first twenty seconds - which is where every crossing lives. The
generator reported `crossings hidden: 44` and the offline auditor reported 29
real collisions in the stretch the blanker never looked at.

**The tell is two of your own tools disagreeing.** A blanker that claims to have
solved crossings and an auditor that still finds them are not both wrong about
geometry; one of them is not being run over the same frames. Diff their loop
bounds before you diff their math.

The fix is to stop letting an index proxy for a time:

```python
for f in range(int(min(FRAME.values())), end):
```

Grep for every `[0]` and `[-1]` subscript on an ordered collection before
reordering it. Each one is an assumption about position that the reorder is
about to falsify, and none of them will raise.

## 39. Never blank a word that has just appeared - blank its counterpart

The crossing blanker hides a word by dipping its opacity to zero while it moves.
A separate rule holds every dip until `FRAME[i] + 6` so a dip cannot land inside
the word's own 5-frame entrance and make it strobe on-off-on.

Those two rules collide when the crossing happens *at* `FRAME[i] + 6`: the
blanker mints a dip, the clamp shoves its start to exactly the colliding frame,
and the word is still at 85% opacity through the whole crossing. Three
collisions survived four sweep passes this way, and each extra pass just minted
another dip that the clamp ate identically - a fixed point the `if not got:
break` loop cannot detect, because it counts mints, not effect.

The fix is in the choice of victim, not in the clamp:

```python
order = (i, j) if WORDS[i][2] <= WORDS[j][2] else (j, i)
if f < FRAME[order[0]] + 12 and f >= FRAME[order[1]] + 12:
    order = (order[1], order[0])
```

A word that has been on screen for half a second can dissolve without the drop
reading as a glitch; a word that appeared four frames ago cannot. 29 -> 3 came
from fixing the loop bound in quirk 38; 3 -> 0 came from this.

**General shape:** when a guard clause and a solver both act on the same
timeline, the guard will quietly neutralise the solver at the boundary. Check
whether the solver has a second candidate to act on instead of weakening the
guard.

## 40. `saveFrameToPng` returns before the file is on disk

The call returns, the JSON payload comes back listing eight paths, and reading
them immediately gives:

```
OSError: image file is truncated (0 bytes not processed)
```

`ls -la` showed six of the eight files present and the seventh still growing.
The return value reports that AE *accepted* the render, not that it finished
writing. At 4096x2160 the flush takes seconds per frame.

Sleep before reading — 25–30 s for a batch of eight at this size — or poll the
file sizes until two consecutive reads match. Do not treat the returned path
list as a completion signal.

Related: render each version's frames under a distinct prefix (`v5beat400.png`,
not `beat400.png`). Stale PNGs from the previous version sit in `Folder.temp`
with plausible names and are indistinguishable from fresh ones once you are
reading them by path.

## 41. Truncating an in-flight move in time is a random speed-up

A word asked to move again before its last move finished has to have that move
cut short. The obvious spelling cuts the keyframe's *time*:

```python
st[-1][0] = max(t0, st[-2][0] + 4.0)
```

The word still travels the full distance to the old destination — it now just
does it in the frames that remain. Interrupt at 20% of the way through and you
have applied a 4.5x speed-up to a move that was authored at a calm speed. That
is the "word appears and then flies across half the screen" complaint, and it is
invisible in the duration constants because nothing in them is wrong.

The fix is to truncate in space as well: sample where the word actually was at
`t0`, make that the endpoint, and re-derive the remaining distance and duration
from it.

**General shape:** a keyframe pair encodes distance *and* time. Editing one
without the other silently edits velocity, and velocity is the thing a viewer
perceives.

## 42. Peak speed comes from the slope, not the ceiling

```python
return max(8.0, min(18.0, 7.0 + d / 85.0))
```

Reads like a speed limit. It is not one. For large `d` the `min` never binds, so
the duration is `d/85` and the speed asymptotically approaches **85 px/frame**
however the ceiling is set. A 2084 px eviction ran at 98 px/f with the ceiling
at 28, because `move_len` returned 31 frames and the cap was never reached.

To actually slow long moves, halve the divisor and raise the ceiling until the
slope is what binds. Cap and slope pull in opposite directions: the ceiling
limits how long a move may take, the slope limits how fast it may go.

**General shape:** in `min(cap, a + d/k)`, `k` is the speed and `cap` is a
deadline. If you want a speed guarantee, read `k`.

## 43. A guard that protects one event type does not protect the others

`HERO_GUARD` keeps ordinary size climbs off the hero's beats, so the hero's
growth reads as a solo. It says nothing about *arrivals*. Every hero beat in v4
happened to fall after the last word had landed, so the gap never mattered and
was never written down.

v5 hand-scheduled one extra hero rung at f400, inside the arrival window
(`F_LAST = 470`). The surge re-packed the layout and rippled straight through
two words that had appeared a second earlier — 700 px at 50 px/f each, exactly
the defect the version existed to remove. Moving the rung to f490, past the last
arrival, cost nothing and fixed both.

**General shape:** a guard's coverage is defined by the events it was written
against, not by its name. Before scheduling a new event by hand, check it
against the *windows* other events live in, not just against the guard.

## 44. A deadband's real clearance is `PAD - 2*DAMP`

`stay_put` lets a word ignore a displacement smaller than `DAMP` so the layout
stops fidgeting. The packer lays out a grid with `PADX` of clearance between
neighbours, so the comment claimed the worst case was `PADX - DAMP`.

Both words either side of a gap may ignore a move, and they may ignore them
*toward each other*. The guarantee is `PADX - 2*DAMP`. With `PADX=26` and
`DAMP=24` that is −22 px — the two words are allowed to touch.

The measurement that finds this is not the collision checker.
`check_overlap.py` gates on intersection, so two words 1 px apart score exactly
as well as two 100 px apart, and a pair that reads on screen as one run-on word
scores clean. `gaps.py` reports the distribution of the *gap* instead.

**General shape:** every tolerance that both parties to a constraint may spend
independently costs the constraint twice. And a checker that gates on a
threshold cannot tell you how close you are to it — to see margin, measure
margin.

## 45. Read a logo's silhouette off its alpha, radially — never off the picture

The YANOS mark looked like "a blue Я inside a ring". It is not. A radial profile
of the alpha (`form_ya.py`, probe in `C:/dev/temp/probe_mark.py`) gives, as
fractions of the mark's own diameter:

| region | radius | opaque |
|---|---|---|
| outer ring | 0.90 .. 1.00 | yes — only **5% of D** thick |
| gap | 0.82 .. 0.90 | no |
| inner disc | 0.00 .. 0.82 | yes, with the letter **knocked out** |
| letterform | < 0.75, bbox 0.473 × 0.447 D, area 0.1615 D² | (the knock-out) |

Two decisions turned on numbers that eyeballing got backwards:

* I first read the opaque region as "ring + letter" and built the whole packer
  on it. It is "ring + disc − letter". That inverts what the pack *means*.
  Two different arithmetic reconstructions both matched the opaque-pixel count,
  so counting was not enough either — the only honest test was to render the
  mask alone and look at it.
* "The ring is ~13% of D, thick enough for small words" was a guess. It is 5%
  (98 px at D=1960). That is why words never landed there on their own.

**General shape:** a logo is a *measurement*, not an impression. Profile the
alpha before writing anything that depends on its shape.

## 46. Pack by ink AREA, not by type size

Greedy shape-packing placed words biggest-point-size first. The long words —
ОСНОВОПОЛАГАЮЩИЙ, ПРОФЕССИОНАЛЫ, ОБЪЕДИНЯЮЩИЙ — are *small type but wide*, so
they sorted last, by which time every long horizontal run in the figure had been
chopped up by earlier arbitrary placements. They then failed at all six shrink
steps and fell out of the shot: 15 words auto-shrunk, several to 15–27 pt,
unreadable.

Sorting by `w*h` at the target size instead puts the long words in while the
runs still exist. Letter mode went from 40/41 with 14 pathological shrinks to
**41/41 with two mild ones**.

Related: a search that walks a spiral and takes the **first** legal slot is not
a packer, it is a random placer. Score *every* candidate with a summed-area
table (`integral` / `all_on_ink`, O(1) per box) and take the legal slot nearest
the word's anchor. Grid sampling instead of the integral is not just slower, it
is **wrong** — an annulus or a letter's notch lets a box put every sample point
on ink while straddling a hole between them.

**General shape:** greedy order should rank by what is *scarce* (contiguous
area), not by what is *conspicuous* (point size).

## 47. A reserved region needs an explicit target, not a preference

Nothing steers a word onto a 98 px ring when the objective is "nearest to where
you already rest" and every resting place is central. The ring stayed empty and
the mark read as a word blob inside a circle somebody else drew.

Fix: reserve the N narrowest words whose ink height clears the band, give each
an evenly spaced **angular target** on the ring, and restrict their candidates
to `radius > 0.86`. They then form a rosette instead of clumping.

Residual, and geometric rather than fixable: at 3 and 9 o'clock the band runs
vertically, so a horizontal word crossing it needs band width ≥ word width.
Ring words will always cluster near 12 and 6 unless they are set on a path.

## 48. On a grid, round the *test* outward and the *mark* outward — both

A packer that snaps candidates to a grid has two conversions from px to cells,
and they must round in opposite senses from what feels natural:

| operation | naive | correct | why |
|---|---|---|---|
| "is this box clear?" | `int(hw/SX)` | `ceil(hw/SX)` | the window tested must **contain** the box |
| "mark this box taken" | `searchsorted(xs, x0)` | `searchsorted(xs, x0, "right") - 1` | the cells marked must **cover** the box |

Both naive forms round *inward*. With `SX=8` and `PAD=5` the inward rounding ate
the entire clearance, so `form_ya.py` reported a clean pack while neighbours
touched. Rounded outward the test is conservative: it can refuse a legal slot,
never accept an illegal one — which is the direction you want to be wrong in.

Verify with a checker that does **not** share the packer's grid. `ya_gaps.py`
reads the frozen layout and measures continuous-space gaps between ink boxes;
re-using the packer's own `Field` to check the packer would only confirm its
rounding back to itself.

Related: the audit must strip `PAD` before measuring. The packer reserves pad
around each word, and a check that keeps it is grading itself on its own
reservation rather than on what the viewer sees.

## 49. Repeated words need a minimum separation, or they read as a typo

Filling a shape needs more instances than there are words, so words repeat —
the client's own reference repeats freely. But the fill was greedy row-major,
so two copies of СИЛА landed side by side in one line and ДОМ twice in the top
bar. On screen that does not read as a device, it reads as a duplication bug.

Fix: keep the centres of each word's existing instances and mask candidates
within `MINSEP` (620 px at a 3860 px figure, ~16% of its width). Cost was zero —
still 112 instances at 87% coverage, because the shape has plenty of alternative
slots at that size.

**General shape:** "how many did we fit" is a packing metric. Whether the result
looks *authored* rather than *generated* needs its own constraint.

## 50. `saveFrameToPng` returns before the file is closed

The JSX finishes and reports the paths, but PIL opening the first PNG straight
away raised `OSError: image file is truncated (0 bytes not processed)`. The file
was not corrupt — at 4K a frame is ~5.5 MB and the write was still draining when
the bridge handed control back. Listing the directory a moment later showed all
six complete.

Fix: poll `os.path.getsize` until it stops changing before opening. Do not
"retry the open" — a retry loop on a still-growing file can succeed on a
partially-written PNG and give you a half-rendered frame to review, which is
worse than an exception.

**General shape:** an async writer's return value tells you the *request*
finished, not the *bytes*. Gate on the artifact, not on the call.

## 51. A shape-cloud only passes if it passes the squint test

Every offline check said the letter was correct — 0 overlaps, 0 pairs under
12 px, ink bbox centred to the pixel, margins symmetric. None of those measure
the one thing that matters: whether the silhouette reads as «Я». They measure
the words, and the shape is made of the *gaps*.

Fix: greyscale the rendered frame, downscale to ~160 px wide, scale back up
nearest-neighbour. Type disappears and only mass remains, which is what a viewer
gets in the first half-second. The bowl, the stem and the descending leg were
all legible — and the same test exposed the ragged right edge of the stem, which
is invisible at full resolution because the eye reads the words instead.

**General shape:** validation at the resolution you author at will miss defects
that only exist at the resolution the work is *seen* at.

## 52. Extending a timeline strands the constants tuned for the old ending

v6 pushed 750 frames to 1000 and added a closing act. Every timing constant kept
working — the build was clean, no assertion fired — but `F_SWEEP = 636` had been
placed "just before the sign-off" when f750 *was* the sign-off. At 1000 frames it
fires into the middle of a hold the viewer is about to leave, and the last 100
frames (4 s, 10% of the spot) were a completely dead frame.

Nothing catches this: the sweep still renders, still eases, still crosses. It is
correct code pointed at a moment that no longer means anything.

Fix: `F_SWEEP = 912 if FORM else 636`. Two frames of the new tail were rendered
to confirm the 9% ADD bar still reads over the finished letter without touching
the type.

**General shape:** when you extend a duration, audit every constant that was
expressed relative to *the end* — they are now relative to the middle. A
comment saying "just before the sign-off" is the flag to grep for.

## 53. A glyph-shaped pack is not centred on its own bounding disc

The Я pack was solved inside the mask's frame and looked centred there. Rendered
into the comp it sat 200 px right of centre (margins L1155 R754) with only 14 px
between the figure and the logo lockup. Я has a leg: its ink is not symmetric
about the disc the packer works in.

Fix: measure the ink bbox of the placed slots and apply a **rigid** translation
(`FORM_DX = -200.5, FORM_DY = +11.1`), in memory, leaving the signed-off layout
file untouched. Re-solving with a centring term would have been the obvious move
and the wrong one — it invalidates every gap the audit already verified, for a
correction a translation makes exactly.

**General shape:** if the fix is a rigid transform, apply the transform. Do not
re-run the solver, because a solver returns a *different* answer, not a shifted
one.

## 54. Repetition multiplies an accent colour past the point where it accents

The 41 answer words carry brand colours assigned once; 7 are red. Filling the
letter needs 112 instances, and inheriting each word's colour turned 7 red marks
into ~15 scattered ones. Red stopped being the accent and became a texture — the
palette was tuned for N instances and broke at 3N.

Fix: base instances keep their word's colour; **repeats are coloured by size**
(`BLUE_L / BLUE / BLUE_D`), never red. Size-keyed colour also buys tonal
recession for free, which is what the fill needs anyway.

Second finding from the same fix: the ramp stops one rung *below* white. A white
top rung was tried and rejected on the render — the 78 pt fill happened to land
mostly in the right-hand stem, so white lit that stem and left the bowl
mumbling. Reserving white for the 41 real answers is also the honest reading:
white means "somebody voted for this word".

**General shape:** a colour rule written for a set stays correct per-item while
becoming wrong in aggregate. Re-judge the palette at the final instance count,
not the design-time one.

## 55. Two previews of the same layout are two different reviews

`form_ya.py` previews the pack with type coloured by size. That is a *geometry*
review — it answers "is there a big word here, does it fit". It cannot answer
"does this frame look right", because the comp gives every word the brand colour
it has carried for 28 seconds and parks a logo lockup bottom-right.

`ya_check.py` was written to draw the same frozen layout in the real palette
with the logo's footprint outlined, and it immediately caught two defects the
size-ramped preview had shown cleanly for days: the 200 px offset (#53) and the
red saturation (#54).

**General shape:** a diagnostic view and a composition view are not
interchangeable, and the diagnostic one is the more persuasive of the two —
it looks deliberate, so it gets trusted. Render the real thing before signing
off.

## 56. `addComp` runs once; anything set there is never re-applied

The generated JSX finds the comp by name and only calls
`app.project.items.addComp(name, w, h, par, dur, fps)` when it is missing. So
`dur` — and `w`, `h`, `fps` — are whatever the **first** build happened to set,
for the whole life of the project. v6 extended the spot from 40 s to 45 s, the
generator emitted the new length, the build reported success, and the timeline
stayed at 40 s.

The failure is silent in the worst way: AE does not error on a `setValueAtTime`
past the comp end, and `saveFrameToPng` past the end just hands back the last
frame. Five seconds of new animation existed as keyframes and rendered as a
freeze, six times.

Fix: re-assert comp-level properties unconditionally, right after the
find-or-create.

```javascript
if (!comp) comp = app.project.items.addComp(TARGET, W, H, 1, DUR, FPS);
comp.duration = DUR;      // addComp only ran the first time
```

**General shape:** in an idempotent build script, `create-if-missing` silently
turns every constructor argument into a write-once value. Anything that can
change between runs has to be set on the object, not passed to its constructor.

## 57. `setTemporalEaseAtKey(k, inEase, outEase)` — argument order bites

The helper in `gen_cloud.py` is `easeKey(p, k, inf0, inf1)` and it calls
`p.setTemporalEaseAtKey(k, eb, ea)` where `eb` carries `inf1` and `ea` carries
`inf0`. So **`inf0` is the OUT influence and `inf1` is the IN influence** —
the reverse of how the parameter names read.

That makes the house default `easeAll(p) = easeKey(p, k, 16, 88)` a *front-
loaded* curve: influence 16 leaving a key, 88 arriving at one. Brisk departure,
soft arrival. It is exactly right for an entrance, which is why it was never
questioned.

It is wrong for a contraction. Applied to a 4x shrink it put most of the scale
change into the first second: measured on the render, at 55% of the beat the
figure was already down to 28% of its width, and it read as being sucked away
rather than compacted. A symmetric `easeKey(p, k, 70, 70)` fixed it.

But the same reasoning does *not* transfer to every property in the gesture.
The mark's opacity was given the symmetric curve too, for consistency, and the
crossover frame came back as a ghost of a ring around a block of type — the
disc, the whole mechanism of the shot, had not yet become a surface. Opacity
wanted the front-loaded curve: establish fast, spend the rest of the beat
settling.

**General shape:** "one gesture" does not mean "one curve". Scale wanted
symmetric, opacity wanted front-loaded, in the same beat, on the same two
frames. And check which end an influence number actually lands on before
reasoning about it.

## 58. The emitted JSX is written as ASCII

`gen_cloud.py` writes the `.jsx` with a plain `open(...).write()`, so a single
Cyrillic character anywhere in the template — including in a *comment* — raises
`UnicodeEncodeError` at write time, tens of thousands of characters into the
file. The generator itself is UTF-8 and Cyrillic is fine there; the constraint
applies only to text that ends up inside the emitted script.

Word content survives because it goes through `js()`, which escapes to `\uXXXX`.

## 59. After Effects will not import WEBP

The brand pack ships the mark as `.WEBP`. `app.project.importFile` fails on it,
and it fails at *import* — so with a `try/catch` around the block the layer is
simply absent and the shot renders looking finished but empty. Convert to PNG in
the Python step (`mark_fit.py` does the crop and the write in one pass) and
import that.

## 60. A window-clipping containment test accepts boxes that hang off the mask

`form_ya.py`'s `Field.legal()` tests a candidate slot with `win()`, which
**clips the window to the grid** and then computes `need` from the clipped
indices. A box hanging off the letterform is therefore only tested on the part
still on the grid — and passes. `mark_probe.py` measured the result: 32 of 112
packed boxes are not fully on the glyph, the worst 68% off, and some sit across
the letter's internal counters.

So the "figure packed into the shape of Я" is Я-*ish*, not congruent with the
glyph, and no match cut to the real mark exists at any scale — scaling the
letter scales its holes too.

**General shape:** a containment predicate that clips its own test window is a
predicate that always says yes at the boundary. Test the unclipped box, or test
the mask, but do not let the clip decide the domain.

## 61. Fit to the mask, not to the mask's bounding box — then find out you can't

Having fitted the collapsed word figure bbox-to-bbox into the mark's knock-out,
the render showed the brand's hero word both **legible and sliced** by the
letter's shoulder. A word cut mid-stroke does not read as "behind the mark", it
reads as a clipping bug.

The obvious fix — shrink until nothing overhangs — turned out not to exist.
`coll_fit.py` bisects from 0.60 down to 0.02 and never finds a clear scale,
because the knock-out is not the solid slab it looks like: it carries the mark's
internal blue strokes, so it is a thin branching shape and the centre of its own
bounding box is *on* blue (`LETTER[lf_cx, lf_cy] == 0`). There is no useful
rectangle inside a Я, and the figure is a rectangle of rectangles.

Cropping was therefore unavoidable and had to be **dressed instead of removed**:
retire the words in size order, biggest first, so that whatever is still inside
the letter when the mark goes opaque is too small to read as a word at all.
Nobody notices a truncated word they could not have read.

**General shape:** when the geometric fix is impossible, the remaining lever is
usually legibility — a defect that cannot be seen has been solved.

## 62. `core.autocrlf=true` fails the token-sync check on Windows

`node --test` comes back 56/57 and `build-tokens.js --check` reports three STALE files on a
fresh clone. Nothing is stale: the generated token files are committed with CRLF, git hands
them over unchanged, and the generator writes LF, so the byte-for-byte comparison in
`tokens.test.js` fails on line endings alone.

Running `node scripts/build-tokens.js` makes the tests green but then shows the three files as
modified forever. The real fix is a `.gitattributes` pinning the generated files (they are
compared byte-for-byte, so they must be `eol=lf`):

```
scripts/lib/tokens.jsx   text eol=lf
html/engine/tokens.js    text eol=lf
html/engine/tokens.css   text eol=lf
```

**General shape:** any test that compares generated text byte-for-byte is a line-ending test on
Windows unless the file is pinned.

## 63. `lint-jsx.js` false-positives on a correctly terminated payload

The linter warns `last statement does not call JSON.stringify(...)` on payloads that do exactly
that. It looks at the last *line*, and the house pattern

```javascript
JSON.stringify(M.run("label", function () {
  …
}));
```

ends on `}));`. The warning is harmless — the payload returns fine — but it fires on every
correct file, which trains you to ignore the one case where it is real.

## 64. An HTML page without an explicit `<body>` renders black, with working controls

`Brand.canvas(document.body, '1080p')` at parse time in a page that omits `<head>`/`<body>`
gets `document.body === null`. The canvas is built and never appended; `Motion.mount` runs
later (after `document.fonts.ready`, when the implicit body exists) and adds the scrubber, so
`window.__motion` reports a healthy 5.00 s / 125-frame timeline and `render.js` says
`page ready`. Every still is black.

The tell: `document.querySelector('.cr-canvas')` is null while `window.__motion` is true. Copy
the `<html><head>…</head><body>` skeleton from `html/templates/showreel.html` rather than
writing a bare fragment.

## 65. `render.js` cannot take a query string on a file path

`fileUrl()` passes `http(s)://` through but runs `path.resolve()` on anything else, which
mangles `page.html?scene=kpi`. To render a parameterised page — `?scene=`, `?format=`, or your
own switch — serve it and give the renderer an http URL:

```bash
node html/render/serve.js . 8093 &
node html/render/render.js "http://localhost:8093/html/templates/x.html?v=lib" --out out/x --beats 0.4,1.0,2.4
```

## 66. An exit only reads in its last four frames — and can silently overrun the comp

`M.exitOut` defaults to `CR.ENTRANCE.EXIT_FRAMES_MAX / fps` = 400 ms on the `exit` ease
`[0.7, 0, 0.84, 0]`. That ease is deliberately ease-IN, and it is steep: measured on the
build, opacity is **99.6 % at 33 % of the tween** and only collapses over the last ~4 frames.
Judging an exit on a frame sampled at its midpoint therefore shows a fully present element and
reads as "the exit is not working". Sample the last quarter.

The second half of the trap: a reverse-stagger exit chain adds up. `M.followThrough(layers,
4420, …, 50)` over five layers starts the last one at 4620 ms, which needs until 5020 ms — past
the end of a 5 s comp. Nothing errors; the last element is simply cut off mid-exit at 96 %
opacity, which looks like a broken exit rather than an overrun.

**General shape:** `t0 + offset·(n−1) + dur ≤ comp.duration` is a check the library does not do
for you. It is the "sum the holds against the target length" step of the workflow, and skipping
it produces a defect that looks like an easing bug.

## 67. Long JS/HTML written through a Bash heredoc can die on quoting — use the Write tool

Two files written with `cat > file << 'EOF'` — a 230-line JS module and a 150-line HTML page —
both failed with `unexpected EOF while looking for matching '` at a line well inside the
content, while a 100-line Markdown heredoc in the same session went through. Both failing files
mixed `'` and `"` heavily (SVG strings, `"You'll …"`). A quoted heredoc *should* be literal, so
the cause is somewhere in the shell wrapper rather than in bash itself; not verified, and not
worth the time. The Write tool has no shell in the path and took both files first time.

Rule: source files with mixed quotes go through Write; heredocs are for short, plain text.

## 68. The timeline's state contract, and the two setter patterns it forces

`Motion.stateAt` (html/engine/motion.js): per element and per prop, **the latest tween that
has started wins; before any has started the first tween's `from` holds**. Custom setters are
deduplicated per element and each is called with the element's *merged* state.

Two consequences that bit while building `Demo.*`:

- An element whose only tween is an exit (`opacity: [0.9, 0]` at t) is **visible from t = 0**,
  because its `from` holds until the tween starts. Anything that appears only briefly (a click
  ripple, a swapped-in pill) needs `tl.set(el, { opacity: 0 }, 0)` first — and a second set
  after, or it holds its last `to`.
- Never let a setter and the engine write the same style. A blinking caret driven by a setter on
  `style.opacity` fights the engine's own opacity write on every seek. Drive it through a prop
  the engine does not own (`visibility`), and gate it with a custom `show` prop set by
  zero-length tweens: `show 0 @0 → 1 @t0 → 0 @t1`. Same setter on all four tweens is fine —
  it is deduplicated.

## 69. Ease-in beats read as "nothing happened" at their midpoint — sample the last third

Same family as #66, seen on the whip this time. `Demo.whip` is 6 frames on the `exit` ease
`[0.7, 0, 0.84, 0]`. A still at 40 % of it showed the card sitting in place with no blur and
looked like a broken whip; at 68 % the card was a full-width smear leaving the frame, and at 88 %
the next card was already flying in behind it. Nothing was wrong — ease-in spends its first half
almost still by definition.

Corollary for anything with a tail: a stagger × n or a particle life must fit inside the scene
window. `tl.scene` cuts with `display: none` on the frame, so a sparkle burst whose fade starts
after the scene ends is simply never seen — the first pass of the demo's sparkles had 2 of 12
visible for exactly that reason.

## 70. Two helpers that tween the same prop on the same element cancel each other — camera on a wrapper

`Brand.camera(tl, sceneEl, …)` tweens `scale` on the scene root for the whole scene; 
`Brand.scaleThrough(tl, outEl, inEl, at)` tweens `scale` on the same roots for 0.3–0.44 s at
the cut. Under the `stateAt` contract (#68: latest-started tween owns the prop, and keeps
owning it after it ends) that means:

- **incoming scene**: the scale-through starts *after* the push, wins, and after it settles at
  1.0 its final value holds for the rest of the scene — the 2 % push never happens;
- **outgoing scene**: the push has reached 1.02 when the scale-through starts at 1.0 — the frame
  pops back 2 % on the cut, which reads as a glitch.

Neither helper errors and neither warns. Fix by separating the layers: the scene root takes the
transition, an inner full-size wrapper takes the content and the push
(`cn-packshots.html: scene()` returns the wrapper with `.root` attached). General rule: before
handing an element to a second choreography helper, check which props the first one already
owns on it.

## 71. `render.js` defaults to a 1920×1080 viewport — a story page is silently cropped

Rendering a `Brand.canvas(…, 'story')` page (1080×1920) without `--w 1080 --h 1920` produces
960×540 stills of the **top 1080 px of the frame with black padding on the right**, and a beat
sheet of square thumbnails. Nothing warns: `page ready` prints duration, fps and scale, not the
viewport, and every still "looks like a frame". The whole lower half — text blocks, buttons,
QR labels — is simply never reviewed.

Pass the canvas size explicitly (`--w`/`--h` match `MotionTokens.format[key]`), and check the
first still's pixel size against the format before judging anything.

## 72. CJK text and the line mask: split per character, and give the mask room

Two findings from the Cloud.ru China packshots (`html/templates/cn-packshots.html`):

- **`Brand.lines` cannot see line breaks inside Chinese.** It splits on whitespace and reads
  `offsetTop` per word span; a run of CJK with no spaces is one span that wraps *inside* itself,
  so its second and third lines are never detected and the reveal moves the whole paragraph as
  one line. `cjkLines()` in the page tokenises per character (Latin words kept whole), measures
  each span, and rebuilds the same `.cr-line-mask > .cr-line` structure — and it must add the
  `cr-lines` class to the container, because `brand.css` scopes `overflow: hidden` under it.
- **`line-height: 1` is smaller than a YaHei CJK glyph box.** With the mask the height of the
  line box (48 px at 48 px), the glyph bottoms are clipped for good, and ~7 px of the glyph tops
  stay visible *before* the reveal — a faint ghost line on the still. Designed at 1.0 in
  PingFang, rendered in YaHei it needs ≥ 1.25 (or a mask `pad`).

**General shape:** a line mask is only as good as the line box; check both the split and the
box against the font that is actually rendering, not the one in the design.
