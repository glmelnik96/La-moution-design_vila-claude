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

## 73. `app.project.activeItem` is read-only — open the comp instead of assigning it

LIVE-VERIFIED 2026-09-08. `app.project.activeItem = someComp` throws
`Unable to set “activeItem”. It is a readOnly attribute.` Capture/mutate a named
comp with `M.use(comp)` (and `comp.openInViewer()` if the panel must show it).
Do not assign `activeItem`.

WRONG:
```javascript
app.project.activeItem = slow;
M.active();
M.capture([25, 50], "logoA", dir);
```

RIGHT:
```javascript
try { slow.openInViewer(); } catch (e0) {}
M.use(slow);
M.capture([25, 50], "logoA", dir);
```

## 74. Pixel art on a web stage: measure the on-screen pixel, render at size, land 1:1

From unifying the gct-runner sprites (a 1080 HTML stage) into one 8-bit style. The complaint
was "pixels of different sizes"; measured, the on-screen pixel ranged from ~1 px (a smooth
heart icon) and 2 px (hero, mic, calendar) to 10 px (clouds) - and the clouds alone ran
7.7-12.4 px, because each puff CSS-scaled one PNG by its own factor.

- **Measure it, don't eyeball it.** On-screen pixel = native block x display scale. The block
  is the peak of the autocorrelation of the colour-edge signal along x and y; it works for
  hand-drawn nearest-upscaled art and for AI "pixel art" with noisy blocks alike. A weak peak
  (< ~0.3) means the asset is not pixel art at all.
- **A non-integer CSS scale changes the pixel size**, so "size variety" by scaling a sprite is
  incompatible with a shared grid. Get variety by rasterising at the size shown (the runner
  now draws each cloud puff per size on a canvas at art resolution, then upscales x8).
- **Write sprites pre-upscaled to exactly the box they are drawn in.** `object-fit: contain`
  then lands on scale 1.0 and the browser never resamples. A box wider than the image because
  a caption stretched the grid track is harmless - contain is height-limited at 1.0.
- `image-rendering: pixelated` on everything, including the canvas and the 1:1 images: the
  recorder bakes at `device_scale_factor=2`, which is itself a 2x upscale.
- Particles and glows are pixels too: snap FX to the grid (whole grid pixels, no rotation,
  blink out instead of alpha fade), and replace a blurred `drop-shadow` glow with four
  chained zero-blur `drop-shadow`s at +/-8 px - a hard one-grid-pixel ring.

## 75. An AE mask is in LAYER space, so it travels with the layer

The classic "the line rises from behind its own line box" reveal needs a window that stays
put in COMP space while the content slides up through it. A mask cannot be that window by
itself: mask vertices are layer coordinates, so animating `position` carries the mask along
and it clips nothing. The first build of the Cloud.ru deck therefore turned every headline
reveal into the headline popping in 90 px below its place at full opacity — the keyframes
were all correct and the result was wrong.

Three ways out, in order of preference:
- **Counter-animate the mask.** If the layer is offset by `dy(t)`, the mask rect must be
  `y in [-dy, h-dy]` in layer space to hold a fixed comp-space window. Both properties
  take the same ease so they stay in register.
- **Precompose** the moving layer and mask the precomp layer.
- **Don't translate.** Reveal a static layer by animating the mask shape only; that is
  always safe and is what panels and table rows use.

**General shape:** in AE, "mask" and "matte" are not the same tool. A mask belongs to the
layer it is drawn on and inherits every transform on it.

## 76. Figma's `contentsOnly` export crops to rendered ink, not to the node's box

`get_screenshot(nodeId, contentsOnly: true)` on a text node returns the node's *rendered*
bounds. A headline whose Figma text box is 1808x180 came back 1196x175, and its metadata
`x, y` was NOT the placement: the ink starts 6-7 px right and down of the box origin (side
bearing plus the gap above the cap line). Placing the PNG at the metadata coordinate put it
6 px off, which is exactly the kind of error that ruins a "1:1 with the design" claim while
looking almost right.

Recover the placement by measurement, not by metadata: template-match the export against a
full-frame render of the same frame, scoring only the export's opaque pixels. On the case
above the metadata position scored a mean error of 143/255 and the matched position 5/255 -
a 28x separation, so the match is unambiguous.

Two useful facts from the same tool:
- A node export IS clipped to the frame when the node is a background that overflows it:
  a 9146x9358 gradient came back as 1920x1080. That is what makes it possible to pull a
  slide's background out as its own layer.
- The renderer will not upscale: asking `maxDimension` 3840 for a 1920-wide frame returns
  1920. Fine when the comp is 1920 too, but there is no free 2x master.

## 77. The ASCII-only JSX rule also covers the asset PATH

Quirk #58 is about content. The same writer breaks on a path: this project lives under
`C:\Users\Глеб\...`, so every `new File(...)` line in the emitted script carried Cyrillic
and the ASCII write failed tens of thousands of characters in.

Escaping to `\uXXXX` makes the *source* ASCII, but ExtendScript's `File()` on Windows is
not reliable with non-ASCII paths, so the fix is to mirror the assets to an ASCII root
(`C:/dev/...`) and reference that. Cheap, and it removes a whole class of flakiness.

## 78. Setting `app.project.workingSpace` opens a modal — and it silently shifts every import

Two things, one line of code.

The project was on a **Rec.709 Gamma 2.4** working space, so every imported sRGB PNG was
colour-converted on the way in. Held frames still matched the Figma reference to 0.000 % of
pixels past a threshold of 16, but the mean difference ran 0.1-9.8/255, largest on the
bright gradients — a small hue shift that no per-pixel pass/fail would have caught. If a
build must match a design byte for byte, read `workingSpace` before trusting any diff.

Assigning it is the trap: `app.project.workingSpace = "None"` raises a confirmation dialog,
which blocks the CEP bridge and produces a CDP timeout (quirk #25). Colour management is a
project-wide setting and changing it repaints everything already in the project, so it is
the user's call, not a build step.

## 79. Cutting a design into rectangles from its own render is 1:1 by construction

The general technique behind the deck, worth keeping. The brief was "layout must be exactly
as in Figma" and the type is set in a font AE does not have, so native text was out.

Instead: render each frame once from Figma as ground truth, then cut the *animation units*
out of that render as plain rectangles and place each at the coordinate it was cut from.
Every pixel is Figma's, so the held frame is the design — no font, no kerning, no line
breaking to re-derive. On a flat background an opaque cut can also be translated freely,
because the background it carries is identical to the background beneath it.

What it costs: a cut carries its own background, so translating one over *artwork* smears;
those slides get the artwork as its own exported layer and reveal by opacity only. And a
cut cannot be split into parts that were composited together in Figma - to stagger a card's
title after its panel you need the panel exported separately.

The check that makes it a claim rather than a hope: stack every cut at its stored
coordinates and diff against the ground-truth render. 17 of 18 slides came back at exactly
0 differing pixels, which also catches the opposite error - a unit rectangle that missed
visible content reports it as uncovered.

## 80. `app.fonts.allFonts[i].postScriptName` is undefined — and `textDocument.font` echoes anything

Two font-API traps that together made an installed font look absent.

`app.fonts.allFonts` (AE 24+) returned 148 entries, and every `.postScriptName` and
`.familyName` on them read `undefined` — so a filter on those properties matched nothing and
"SB Sans Display" was declared missing while it sat in the Character panel. The names ARE
there, one level down: the objects are families whose string dump lists the styles
(`SBSansDisplay-Thin SBSansDisplay-Light SBSansDisplay-Regular …`). Scan every property of
each entry with `for (k in obj)` rather than the two you expect.

Then the assignment side: `doc.font = "anything"; st.setValue(doc); st.value.font` echoes
the string back verbatim — for a real PostScript name, for the family alone, and for
`"NoSuchFont-Xyz"`. The echo proves nothing. Measure: `sourceRectAtTime().width` of a fixed
word at a fixed size is the fingerprint. `SBSansDisplay-Semibold` set "Главный" at 90 px to
344.99 px; `SBSansDisplay` (no style) and the garbage name both gave 314.97 — identical, i.e.
the same silent fallback. Only the full PostScript name with the style resolves. And 344.99
vs 345 px measured off Figma's render is the number that licenses native text at all.

## 81. Place type by its measured ink, not by baseline arithmetic

To land native text exactly on a Figma design, do not derive a baseline from ascender,
leading and box top — the two apps disagree on all three. Create the layer, read its own
ink box with `sourceRectAtTime(0,false)` (left/top are relative to the anchor), and set
`position = target - [r.left, r.top]` where `target` is the element's ink box measured off
the design's render. Two measurements, one subtraction, and every element on the pilot came
out at dx = dy = 0 against Figma.

Three ways this went wrong before it went right:
- Measure BEFORE adding a Text Animator. Its offset is in the rect.
- Read the rest position ONCE, into a variable, before any keyframe exists. `pos.value`
  after a key is set returns the value at the comp's current time — the first key — so
  reusing it for the exit put a slow 14 px drift into every hold.
- The measurement rectangle must contain exactly one element. A rect that started 4 px too
  high caught the descenders of the line above and put the second headline line 6 px high.
  On artwork, key the mask on the element's fill colour; differencing against a "clean"
  background failed because exported line art does not reproduce antialiasing bit for bit,
  and a residual on one ray pulled a target 146 px sideways. Every one of these showed up
  as a per-element bbox delta and none of them by eye.

## 82. Tracking is per element, not per deck

Figma reports `letter-spacing` in px; AE tracking is 1/1000 em, so AE = px / size × 1000.
This deck's kicker (−0.64 @ 32), headline (−1.8 @ 90) and statement (−2.76 @ 138) all
come to exactly −20, which invites a global constant — but the card titles, bodies and the
footnote have no tracking class at all, i.e. 0. The global −20 doubled every card title
horizontally in the diff. Carry tracking on the element.

## 83. Exit stagger must fit inside the exit lead

`exit_i = end − LEAD + STAG × (n−1−i)` looks right and silently fails: with 15 layers,
50 ms × 14 = 700 ms > a 620 ms lead, so the first elements' exits started after the comp
ended and never played. Derive the stagger from the count: `min(STAG, (LEAD − DUR)/(n−1))`.
Same family as #66 — a sum the library does not check for you.

## 84. Range Selector "Ease High / Ease Low" — which one shapes the landing depends on sweep direction

A word cascade built as Ramp Up + Percent Offset swept from −RAMP to 100 was reviewed as
"robotic", and the centroid track showed why: the word crawled while still invisible and
then covered its last 24 px in TWO frames. Setting `Ease High = 100 / Ease Low = 25` — the
intuitive "ease into the top" — was the cause.

As the ramp sweeps right, each character crosses it from the HIGH end (selected → offset
applied → hidden) to the LOW end (rest). So the curve that shapes the arrival is **Ease
Low**, and Ease High only shapes the departure from the hidden state. For an ease-out
landing: `ADBE Text Levels Min Ease` (Ease Low) = 100, `ADBE Text Levels Max Ease` (Ease
High) ≈ 20. Widening the ramp (`Percent End` 45 → 60) gives each word more frames in
transition. Result on the same track: 11.5 → 6.3 → 3.6 → 1.8 → 0.6 px/frame, a x3.6
deceleration, and a 0.6 s landing instead of a snap.

Matchnames, read off a live selector: `ADBE Text Range Advanced` holds `Range Units`,
`Range Type2` (Based On: 1 chars, 3 words, 4 lines), `Selector Mode`, `Selector Max Amount`,
`Range Shape` (1 square, 2 ramp up, 3 ramp down, 4 triangle, 5 round, 6 smooth),
`Selector Smoothness`, `Levels Max Ease`, `Levels Min Ease`, `Randomize Order`, `Random Seed`.

**General shape:** measure the thing the review complained about. "Robotic" was a shape
on a graph — one number (px/frame per frame) found the cause where three viewings of the
contact sheet had not.

## 85. A property holds its FIRST keyframe before it in time — a stale `rest` variable moves a layer for its whole life

Badges and pills vanished from every rest frame while their labels stayed. The generator
emitted the shape's exit as `tw(pos(S), ex, ex+360, [rest[0], rest[1]], …)` after the
label had been created — and `var rest = pos(L).value` had been re-declared for the
label. The exit keys therefore held the LABEL's position, and since AE holds the first
key's value at all earlier times, the shape sat at the label's coordinates from frame 0.
Rule: capture each layer's rest in its own variable (`var restU = rest;`) before any
other layer's `rest` is read, and never emit keys for layer A after layer B's rest.

## 86. `sourceRectAtTime(0)` includes the Text Animator's offset — read the rect BEFORE adding the cascade

Rows that persist across a cut were placed 7 px right / 11 px high on the next slide. Their
travel targets were computed from `L.sourceRectAtTime(0, false)` taken after `cascade()`
had been added: at t = 0 the selector offset is −RAMP, so every word is displaced by the
animator's Position (rise) and the reported box moves with it. Measure the layer once,
right after `align()`, and keep that rect for every later position.

## 87. Figma's design-context box width does not reproduce its line breaks — fit breaks from the render

`w-[735px]` on a paragraph does not mean the text wraps at 735: boxes are wider than the
text they hold, some breaks are manual, and Figma's break of "Платить за готовую мощность
| или инвестировать …" cannot be produced by ANY greedy wrap width. AE box text with the
same width therefore wrapped differently on 14 of 31 paragraphs. What works: measure each
line's ink width in the reference (bands of inked rows, keep bands at least an x-height
tall so breves/descenders/dots drop out), then choose the break positions whose lines,
set with PIL metrics of the same OTF, match those widths best, and emit explicit `\r`
lines as point text. PIL `getbbox` widths of SB Sans Display run ~1.2 % wider than Figma's
ink (a constant factor — fine for deciding breaks, wrong for verifying placement).

## 88. Line pitch measured from band TOPS is not the leading — measure baselines

Band-top spacing of consecutive lines came out 40 / 48 / 66 for texts whose leading was
32 / 40 / 52: the top of a band is the tallest glyph on that line (cap, ascender, or a
breve above the cap), so it shifts by up to 14 px with the glyph inventory. The body rows
(≥ 25–30 % of the peak row count) end at the baseline; baseline-to-baseline is the leading
exactly. All the "leading-[1.25]" guesses made from band tops were wrong; the design's
32-px bodies are leading 32.

## 89. Figma strokes sit INSIDE the rect (path inset 0.5) — AE rect shapes centre the stroke on the path

`M40 0.5H…` in every Figma SVG: a 1-px stroke occupying exactly the outer pixel row. An AE
Rect shape of the same size strokes on the path itself, so the stroke straddles the edge —
two half-covered rows, a dim 2-px halo, and the ink box grows by one px on every side (also
breaks a `>60` verification where a #4C4C4C box at 50 % falls below the threshold). Emit
the rect as `[w − sw, h − sw]` at the same centre with roundness `r − sw/2`.

## 90. Figma's 2× PNG icon exports are the vector's bounds, not the node box — fit them by measurement

Exports of 50×50 icon nodes came back 108×108, 82×92, 86×88; placed at the node origin at
50 % they landed within 1 px but their luminance boxes were off by 4–7 px because the soft
edge of a downscaled PNG shifts a thresholded box, and one export (s12) was simply a
different size from its instance. Downscale the PNG in Python the way AE will, threshold it
the way the verifier thresholds the frame, and solve position (and scale when the size is
off by more than 1 px) so the boxes coincide. Deterministic, no eyeballing.

## 91. Same text on the next slide with a different alignment: a hold key on Source Text at the cut

Text layers persisting across a cut (`travel()` between two measured rest positions) can
change justification mid-travel: `st.setValueAtTime(0, st.value)` then a second key at the
cut with `d.justification` changed. Source Text keys are hold keys, so the switch is one
frame, invisible inside an 800 ms move. Read the new rect with `sourceRectAtTime(cut +
0.02)` to compute the second position — the anchor-relative box changes with the alignment.

## 92. A frame that continues into the next slide can grow: keyframe the Rect path's Size / Position / Roundness

`groupNamed(S, "frame").property("ADBE Vectors Group").property("ADBE Vector Shape - Rect")`
then keys on `ADBE Vector Rect Size`, `… Position`, `… Roundness` between the two slides'
boxes (with the #89 inset applied to both). Trim Paths from the draw-on stays at 100 and
does not interfere. Pass both boxes explicitly — after the first keys, `.value` returns the
first key, not the current state (#85 family).

## 93. Colour management sanity check: `saveFrameToPng` returned #7459F9 as exactly (116, 89, 249)

Project working space Rec.709 Gamma 2.4, PNG footage and shape fills: the captured frames
match Figma's render to the unit on a flat stroke, white text and the gradient panels
(mean |diff| 0.4–0.7 / 255 against the SVG-defined radial gradient rendered in numpy).
Whatever the final export does, the frame captures used for verification carry no
colour shift, so a bbox/colour verification against the Figma PNG is valid.

## 94. Consecutive slides that share elements are one comp — detect persistence by signature

A deck review asked why the same headline "exits and re-enters" between slides. Matching
(text, font, size, colour, leading, tracking) across consecutive slides finds every
element that continues; those slides become one comp (segment) where the layer is built
once, travels to each later slide's measured rest position (#86, #91), and the absorbed
elements are simply not built. Frames match by name (#92), hairlines by name and length.
Verification still runs per state — the persisting layer gets a check point in every
slide it appears in.

## 95. ExtendScript parses a nested ternary LEFT-associatively — `a ? X : b ? Y : Z` picks the wrong branch

`live.justification = (j === "center") ? CENTER : (j === "right") ? RIGHT : LEFT;` set every
centred paragraph to RIGHT. ExtendScript evaluates it as `((a ? X : b) ? Y : Z)`: for
"center" the inner result CENTER is truthy, so the outer picks RIGHT; for "right" the inner
gives `true`, so RIGHT again (correct by accident); only "left" falls through to LEFT.
Probe: three 2-line layers built with the same function came back 7414 / 7415 / 7414.
Use `if / else` (or parenthesise every nested ternary) in anything sent to AE.

**Verification lesson:** an ink-box comparison cannot see justification — the block's bbox
is identical for left / centre / right. Multi-line text needs a per-line x-extent check
(tools/verify_deck.py `line_ranges`), which is what finally exposed this.

## 96. Figma MCP responses over ~19.5 KB fail to parse ("EOF while parsing a string at column 19xxx")

`get_metadata` on three of eighteen frames and one combined `use_figma` dump died with the same
SSE-parse error at column 19 664–21 364 — the transport truncates long replies. Not the file,
not the node: the SIZE. Split the request (one `use_figma` per frame, return compact objects,
no `relativeTransform`/children dumps) and every one of them comes back.

## 97. The slide crop is not the artwork — read the node, not the frame

Six "different" backgrounds turned out to be one 4001×4096 bitmap and one vector flower placed
at 2–3× and rotated; the frame exports (and `get_screenshot` of a child) are always clipped to
the parent frame, so they can't show that. `download_assets` on the node returns the raw fill
bitmap (`rawImages`, identical md5 across all four uses) and the unclipped SVG. Geometry comes
from the plugin API: `x,y` (un-rotated origin), `width,height`, `rotation`, `fills[].imageTransform`
(CROP: `[[sx,0,u0],[0,sy,v0]]` in normalized image space). Figma's rotation matrix in screen
space is `[[c, s], [−s, c]]` and AE's rotation is its negative — verified by rendering the node
in Python and diffing against Figma's own render (0.42/255).

## 98. Expressions with zero phase at the verified time keep "life" and 1:1 layout compatible

Breathing/wander on a gradient field: `1 + 0.03·sin((time − T0)·…)` and
`value + [16·sin((time−T0)·0.75), …]` with `T0` = the slide's rest time. The layer moves the whole
time, and the verification frame is still exactly the Figma pose, because every term vanishes at
T0. Same idea for the planet's rotation: `rot + ω·(t − vt)` through the pose at `vt`.

## 99. saveFrameToPng writes lag the script by minutes — and slow layers slow the queue

A 2913-frame capture in five scripts returned `ok` within seconds each while the PNGs trickled
out at 1–4 fps for ~12 minutes (a 4001-px bitmap at 2.3× + blur renders at ~1 fps). Anything
that reads the frames must poll for the LAST index, not trust the script result; a strip built
too early shows black tiles for the missing frames and looks like a broken build.

## 100. Figma soft line breaks are U+2028 — and they break the Figma MCP transport (the real cause of #96)

Every "EOF while parsing a string at column 19xxx" from `get_metadata` / `use_figma` traced
to ONE thing: a text node containing U+2028 (LINE SEPARATOR — what Figma stores for a
Shift+Enter soft break; hard breaks are `\n`, and some come through as U+000B). The MCP
server serialises it raw (JSON.stringify does not escape U+2028), the SSE layer splits on
it as a line end, and the client sees a truncated frame. Size was a red herring: an 8-node
dump with two U+2028 failed, a 26-node dump without any succeeded.
Fix inside `use_figma`: sanitise every string you return with a char-code loop
(`{133,8232,8233,11,12}` → `<hex>` markers) — NOT a regex literal: the tool call is JSON, so
a `\u2028` typed into the code arrives as the raw character and ExtendScript/V8 rejects
"unexpected line terminator in regexp". Convert the markers back to `\r` on the AE side
(a soft break is still a line break for the layout).

## 101. Figma's rotated CROP image fill is one affine map — derive it, don't fit it

A bitmap fill in CROP mode maps node-normalized coords through the 2×3 `imageTransform` M into
image-normalized coords: `img = diag(BW,BH)·(M_lin·node/(W,H) + t)`. Inverting and composing with
the node's rotation about its origin gives the layer transform in one shot:
`A = R·diag(W,H)·M_lin⁻¹·diag(1/BW,1/BH)`, `b = (x,y) − R·diag(W,H)·M_lin⁻¹·t`. For a similarity
transform the columns of A agree to 1e-4; scale = |A[:,0]|, AE rotation = atan2(A[1][0], A[0][0])
(screen space, clockwise positive). A crop that looks "hand-placed" (p01: M has off-diagonal terms,
scale 0.525, ~19° extra turn) comes out exact — Python re-render vs Figma's own PNG: mean
≤ 1.5/255 over the artwork, for all four planet placements.

## 102. Vertical tab (U+000B) inside Figma text renders as NOTHING

Some Figma texts carry U+000B between words ("ИИ-ассистента\x0bв региональном"). It is not a
soft break and not a space: the render shows the words joined ("ассистентав"). Reproduce it by
deleting the character (and shifting any character-indexed colour ranges after it). U+2028 is a
real soft break; `\n` a paragraph break. Treat each separately.

## 103. Figma list paragraphs draw bullets that are not in `characters`

`getRangeListOptions(start, end).type === "UNORDERED"` (with `getRangeIndentation` 1) marks
paragraphs Figma renders with a "•" and a hanging indent; the characters contain neither.
Nothing in `get_metadata`/`get_design_context` shows it — only the plugin API or the render.
Rebuild as a separate "•" text layer (SB Sans Display has U+2022, 0.36 em) plus the item's text
starting at the indent, both placed from the render; paragraph boundaries of such nodes come from
line starts (a paragraph's first line begins near the node's left edge, continuation lines at the
indent), not from the gap between lines.

## 104. Missing glyphs: AE swaps the WHOLE layer's font, Figma swaps only the glyph

"ⓒ" (U+24D2) is not in SB Sans Display. Figma renders that one glyph from a fallback face and
keeps the rest; AE's TextDocument reports the layer font as "MS-Gothic" and a strict
`font-applied` check throws. Map to a glyph the font has ("©") or set the one character with
`TextDocument.characterRange(i, i+1).font` (AE 24+; the same API sets `tracking` per character —
ABSOLUTE, replacing the layer's tracking, not added to it). Figma's arrow "→" is another case:
its own glyph exists but Figma's render used a thin long fallback arrow (97×32 px at 140 px, no
installed face matches); at 26 px Inter-Regular's arrow is within 1.3 px, at 140 px a native
shape path (shaft + open barbs, Trim Paths so it shoots out) measured from the render was the
only way to hit ≤2 px.

## 105. A count-up on Source Text keeps its style through the expression `style` API

`text.sourceText.style.setText(s)` returns the layer's base style with new text; chain
`.setFont("Inter-Regular", i, 1)` for per-character fonts inside the counting string. Plain
string returns lose per-character styling. Keep the number on its own layer when the digits
sit next to a non-text arrow: the layer's left edge is the anchor, so digit-width changes while
counting don't move anything else.

## 106. Ink measurement must be by connected components, not by a tight rect

A rect tightened to the dense rows of a text (its cap band) clips sparse extremes — the ascender
of "б", the descender of "у" — and an alignment from that box lands the whole text 7 px low
(p01's title: AE put the ascender at the clipped edge). The reverse fails too: a generous rect
picks up a neighbour's descenders or the dot of the next line. Measure the text as the union of
glyph components (scipy.ndimage.label, 8-connected) that touch its *core* — the dense rect —
plus small detached marks (≤0.28·size tall) within its span and within 0.4·size above / 0.15·size
below, never a component clipped by the rect edge. Builder and verifier must share one
implementation (tools/inkmeasure.py), or "both wrong the same way" passes the check
(a 2-line text drawn on one line passed the bbox check; only the per-line extent check caught it).

## 107. Line bands: threshold per run, not per element

Rows holding ≥8 % of the element's PEAK row lose a short label line next to long body lines
("Что сделали:" 65 px/row beside 341 px/row lines): its thinner rows fall under the threshold,
the band fragments, and the paragraph's body is never wrapped. Find coarse runs first (rows ≥3 %
of the peak, ≥2 px), then keep rows ≥8 % of THAT run's peak. Two lines whose descenders meet the
next ascenders still part at the sparse valley.

## 108. Figma text boxes lie about their height (and INK text needs its plate)

Boxes are routinely smaller than their content: a 23 px box holding two 44 px lines, a 51 px box
holding two lines — the render simply overflows. Grow the measurement box downward (up to three
line boxes, stopping above the next text node that shares its columns) and let the ink decide the
line count. Dark text on a white pill/bar (#0a0600) needs the rect clipped to the plate, because
the black ground around the plate is within the colour tolerance of the ink.

## 109. The Figma MCP response cap is 20 KB — and node NAMES carry U+2028 too

Two more faces of #100. (a) `use_figma` returns at most ~20 KB; a bigger result is cut mid-string
and the client reports the same "EOF while parsing a string at column 19xxx". Batch dumps to two
or three frames per call (~80 nodes) and keep the schema compact. (b) Figma names text nodes after
their content, so a name can hold U+2028 as well — sanitise every string you return (names
included), not only `characters`. A shallow 5-node dump of a title slide failed for exactly that.

## 110. `getStyledTextSegments` gives everything per run in one call

Per-run fontSize, fontName, fills, lineHeight, letterSpacing, listOptions and indentation in a
single call per text node — no second "details" query, and it exposes list paragraphs (#103)
without a separate `getRangeListOptions` sweep. Store `[start, end, rgb, size, style, lh, ls,
listType, indent]` and derive paragraph indices from the "\n" count before `start`.

## 111. Measuring a text in Figma's render: who else is in the box

Text boxes overlap freely in these decks (a right-aligned NDA label sits inside the hero's box,
a hero runs under a light card). Three rules keep a measurement to its own glyphs: (1) measure
texts smallest-first and subtract every measured text's glyph pixels from the later ones;
(2) clamp a single-line text's box to its expected ink width on the aligned side (PIL metrics
×1.15 + 12 px) — a label can only be where its glyphs fit; (3) exclude light plates (any solid
fill with all channels > 200), not only pure white, from white-text masks. And decide wrapping
by the number of line bands, never by the core's height — an "auto" line height (1.28×) makes a
two-line body shorter than 1.4 leadings.

## 112. Logo lockups inside stroked pills: cut them from the render

Small logo chips (a GigaChat/Qwen/GLM pill: stroke #595959 centred, r 40, two stacked image
fills, a 24 px version number) are not worth rebuilding layer by layer — the stacked identical
bitmaps hint at blend tricks the API does not expose. Draw the stroke natively (so it can draw on)
and cut the interior from the 1:1 render as one PNG; skip every node inside the pill.
Same idea as film 1's s17 chips.

## 113. A plate with a bitmap on it must be ONE layer, or the plate shows through

A QR code on its white square, a screenshot on its light card: built as two layers with their own
entrance and exit keys, they are never in phase — the code drifts off the plate on the exit, and at
50 % opacity the plate is a grey square with the background showing through the code. The user
spotted it at once ("квадрат за qr-кодами"). Precompose the pair into a comp of the plate's size
(plate at 1,1, bitmap at its offset), add that comp as one layer, anchor it to its centre and give
it a single settle-in and a single fade-out. Two layers cross-fading is not a group fading: alpha
multiplies, the group is what the viewer sees as an object.

## 114. Text animator range selectors do not count line breaks

Units = Index, Based On = Characters: the index runs over rendered characters only. A `\r` in
the source text is not an index — "AB\rCD" gives End = 4, "AB\r\rCD" gives 4 as well, spaces
do count ("AB CD" = 5). A colour range taken from Figma's `getStyledTextSegments` (string
offsets, where the line separator is one character) lands one character late per preceding
break: "ИИ-проекты —\rбольше" with the white range [13, 30) painted the "б" violet. Convert
every string offset p to `p - text[:p].count("\r")` before writing `ADBE Text Index
Start/End`. `TextDocument.characterRange()` (per-character font or tracking) stays
string-based. Probe: the End index's default value right after `addProperty("ADBE Text
Selector")` equals the counted characters — read `sel.property("ADBE Text Index End").value`;
`maxValue` is 99999 and says nothing.

## 115. A mirrored Figma node: the dump hides the flip, the bounding box reveals it

The plugin dump (x, y, w, h, rotation) cannot express a flip, but `absoluteBoundingBox` can:
rebuild the box from the rotation alone and from rotation·diag(1, −1) — the one that
reproduces the reported box is the transform. The s11 orbit vector (rot 50.886) was mirrored;
placed as a rotation it landed entirely off-frame (zero of its sampled points inside
1920×1080) and the slide simply had no rings. In AE the flip is scale [100, −100] set before
the rotation (AE applies scale, then rotation — Figma's order for R·F), and the position is
R·F·anchor + (x, y). SVG exports keep the node's local, unmirrored geometry, so the flip goes
on the layer, never into the path data.

## 116. Matching raw exports to image nodes: silhouette, not colour, not aspect

`download_assets` for a slide's images returns duplicates at several sizes and variants (one
logo as 403×125, 1024², 512² on white…) in download order, not node order. Aspect alone
confuses same-shape logos (GigaChat 3.22 vs Qwen 3.31 for a 3.35 node) and every square icon
(globe vs Z-logo). Colour comparison fails too: a black export composited on the chip ground
scores worse than a wrong violet logo when Figma shows that black art as white (blend tricks
the API does not expose). What works: the render's ink mask (pixels off the local median
ground) against each candidate's alpha silhouette (for an opaque export, its pixels off its
own median colour); take the best IoU among candidates within 0.35 of the best aspect score.
Then honour a CROP image fill (`imageTransform` ≠ identity): it shows a window of the bitmap,
so crop the export to that window and place the crop.

## 117. Ink measurement: a dash hanging past the block's edge

Component-based measurement keeps only components touching the dense core plus small marks
over the core's own columns. An em dash ending the longest line ("друг друга —") is a separate
component outside the core's columns and larger than a mark, so it vanished from the reference
line width (1603 instead of 1773) and from the expected box — and the fitter then chooses
breaks for the wrong widths. Keep components at most 0.2·size tall that lie within the core's
rows and within 1.3·size of the block's horizontal extent.

## 118. Wrapping at a run of spaces

Figma wraps "друга —  они" (two spaces) rendering neither space; replacing the first space by
`\r` leaves the second one at the start of the next line, shifting that line by a space width
(35 px at 136 px). Swallow the whole run around an inserted break and shift later character
indices accordingly (a deletion list next to the hyphen-insert list), then apply #114.

## 119. A text's measurement box is its content estimate, not its Figma box

Figma text boxes lie in both directions: a 51 px box holds five lines of 18 px, a 925 px box holds
four lines of 120 px and reaches the planet gradient below (whose violet passes the violet key and
becomes a fifth "line", so the fitter breaks the statement into five lines), a divider's box is the
whole slide with the word centred in it. Rules that survived films 1-5: estimate the line count
with a greedy PIL wrap at the box width (manual breaks added), set the box to (n + 1.2) line
boxes (n + 0.6 for a single line); a box much taller than that keeps the window of that height
holding the most ink of the text's own colours (a centred divider slides onto its word); a box
shorter than that grows down to the nearest VISIBLE node below — texts, bitmaps, logo vectors,
plates — not only texts, or a hero grows into the screenshot card under it and measures the card.
Never cap growth by font size alone: a five-line 120 px statement is as real as a five-line body.

## 120. Fractal Noise (and friends): the "Transform" / "Evolution Options" groups are headers, not groups

`effect.property("Transform")` on ADBE Fractal Noise returns a flat PROPERTY (type 6212), not a
PropertyGroup — calling `.property(...)` on it throws `Function ... is undefined`. All the controls
are direct children of the effect: `ADBE Fractal Noise-0009` Uniform Scaling, `-0011` Scale Width,
`-0012` Scale Height, `-0023` Evolution, `-0025` Cycle Evolution, `-0026` Cycle (in Revolutions),
`-0027` Random Seed (the group rows are `-0007`, `-0024`). Address them by matchName on the effect
itself. Dump `numProperties` + matchNames once per unfamiliar effect instead of guessing the tree.

## 121. Imported footage keeps its extension in `item.name`

`importFile` names the FootageItem `page122_image-000.png` / `odk_A1_dark_bed_loop.mp4`, not the
stem. A lookup by name without the extension finds nothing and the build "succeeds" with missing
layers (the preshow came back with seven "missing" drawings). Either rename on import or search
with the extension. Also: a directory import must filter by prefix — `M:/Minimax h3/out/*.mp4`
pulled 63 unrelated clips into the project before the `odk_` filter existed.

## 122. Centre text by its measured box, not by justification

Point text with CENTER_JUSTIFY set through `TextDocument.justification` did not centre on the
anchor in AE 26.3 — the string ended at the anchor (rendered as right-aligned). Box text centres
inside its box whose origin is the layer's top-left, so `x` means the box's left edge. The robust
move for both: create the layer, then `sr = L.sourceRectAtTime(L.inPoint, false)` and set position
to `[x - (sr.left + sr.width/2), y - (sr.top + sr.height/2)]` before any entrance tween reads the
rest position. Works for every font/box combination and survives re-layout.

## 123. An "upscaled" PNG may have lost its alpha

The 2× upscale of the emblem (Lanczos through the generation pipeline) came back flattened on
white; only the original export kept transparency. When a logo shows a plate behind it, check
`Image.open(f).mode` / alpha extrema of the SOURCE file before blaming blend modes — and keep the
original next to the upscale.

## 124. Building a multi-screen LED wall in one comp

Design in physical space at one pixel pitch (256 px/m here): SIDE 768×768 | DIAG 512×768 |
MAIN 2048×1024 | DIAG | SIDE = 4608×1024, regions drawn as guide layers. Delivery comps take a
SLOT comp (the whole wall) with anchor at the wall centre and position = comp centre − region
centre; the main backdrop that the TZ calls 2048×512 at 8×4 m is the same region with scale
[100, 50] (non-square pixels are the TZ's problem, not the design's). One number = one wall comp;
every reusable look (splash background, waves, portal) is a SYS precomp used as a layer, so
awards ×8, splash and the intro finale share one background build. Loops: rotation rates chosen so
one loop = one blade pitch (15° for 24 blades over 40 s), Fractal Noise with Cycle Evolution = N
revolutions and `evolution = time·360·N/T`, drifts as `sin(2π·time/T)`.

## 125. Timing-aware generation briefs: chain frames, not prompts

Five-second clips only serve a four-minute number when the brief carries the number's timeline:
per segment tc_in/tc_out, which clip (loop bed vs event), and the exact start/end frames at the
pipeline canvas (1536×672 for 21:9, 1024×1024 for 1:1). Events longer than 5 s are chains — clip
k+1 starts with `--first <last frame of k>` (exact), and chains that must land on a designed
picture (a loop's anchor, an AE handoff) end with `--last <anchor>` plus a 6–10 frame crossfade in
the edit. Anchors that come from existing takes are extracted with ffmpeg at the pipeline
resolution; anchors that come from the archive are graded per era first (sepia / cold BW /
vintage / clean), because a start frame sets the look of the whole clip. Write the pack as data
(`shots3.py` in the generator's own list format + `timeline.csv`) so the other agent queues it
without re-reading prose.

## 126. Hue/Saturation matchNames are off by one from the panel order

`ADBE HUE SATURATION-0004` is **Master Hue**, `-0005` Master Saturation, `-0006` Master Lightness,
`-0007` Colorize (`-0002` Channel Control, `-0003` Channel Range — there is no `-0001`). Setting
`-0004` to −72 rotates the hue by 72° instead of desaturating: duotone book scans came out green and
magenta and the mistake is invisible on neutral photos. Dump the effect once (name | matchName) before
setting anything by number; the review captures caught it, the numeric result did not.

## 127. `"text" + err` inside a catch throws its own error in ES3

Concatenating an Error object to a string (`out.notes.push("skipped: " + e1)`) raises
`Object of type Error found where a Number, Array, or Property is needed` — from INSIDE the catch,
so the real cause is lost and the outer M.run reports the catch line. Always `String(e1)` (the
cousin of quirk #1 for Arrays). Seen while probing an unknown effect (Polar Coordinates).

## 128. Polar Coordinates: Interpolation is 0..1, Type of Conversion 1/2

`ADBE Polar Coordinates-0001` (Interpolation, shown as %) takes 0..1 — `setValue(100)` throws
"Value 100 out of range 0 to 1"; `-0002` Type of Conversion = 2 for Rect to Polar. Recipe for a
brushed radial metal texture: Fractal Noise (Turbulent Smooth, scale width 14 / height 3000 →
vertical streaks) → Polar Coordinates (1, 2) → the streaks become radial; track-matte by the blade
alpha, Overlay ~25 %, rotate with the fan. Combined with per-blade stepped fills (7 strips across
each blade, brightness peaking in the leading third, times an angular light factor), a hub shadow
and a tip shade as matted Multiply solids, and a rim stroke offset 3 px in Screen, shape-layer
blades read as machined metal — no gradient fills needed (shape gradient colours are not
scriptable).

## 129. Extrusion is script-writable only under the Cinema 4D renderer

AE 26.3: with `comp.renderer = "ADBE Advanced 3d"` a 3D shape/text layer shows `Geometry Options`
(`ADBE Extrsn Options Group`: Bevel Styles / Bevel Direction / Bevel Depth / Hole Bevel Depth /
Extrusion Depth) and the values read fine, but every `setValue` throws "property or a parent
property is hidden" — with or without the comp open in a viewer. Under `"ADBE Calder"` (the
Cinema 4D renderer) Extrusion Depth and Bevel Styles/Depth set normally; Bevel Depth is hidden
while Bevel Style = None (1), so set the style first (2 = Angular). Material Options: Ambient,
Diffuse, Specular, Shininess, Metal, Casts Shadows are writable in both renderers; Reflection
Intensity/Sharpness/Rolloff stayed hidden in both from script. `layer.environmentLayer = true`
sets under Calder; `LightType.ENVIRONMENT` (4416) exists and a light accepts it under either
renderer (whether Calder honours it is unverified). `collapseTransformation` on a nested 3D comp
sets under Calder. Advanced-3D-only effects for volume (CC Light Rays / CC Particle World) render
in any renderer — they are 2D effects; CC Particle World with default Particle Type draws line
sparks, not dust. Ray-traced captures of a 4800 px extruded fan take minutes per frame: run
captures in the background and poll.

## 130. Levels (`ADBE Easy Levels2`) property map — LIVE-VERIFIED (AE 26.3)

`-0001` Channel, `-0002` Histogram, `-0003` Input Black, `-0004` Input White, `-0005` Gamma,
`-0006` Output Black, `-0007` Output White, `-0008`/`-0009` Clip To Output Black/White. All
levels are 0..1 (not 0..255); gamma is a plain multiplier (1 = none). Probe recipe for any
effect: add it to a throw-away solid, walk `numProperties` and print `matchName + " = " + name`,
remove the solid — ten seconds, and it ends the guessing that produced quirk #126. Used to lift a
generated clip that arrived at mean 37/255 (Input White 0.62, Gamma 1.4 on the layer — grade at
the layer, do not re-generate for exposure).

## 131. Reading a song's structure without listening: centre extraction + bar grid

To place lyrics/section text on a track you cannot hear, do not threshold the waveform — music is
loud everywhere. Estimate the vocal instead: per FFT bin, `C = max(0, |mid| - |side|)` where
`mid = (L+R)/2`, `side = (L-R)/2` (lead vocals are centre-panned, instruments are spread), sum `C`
over 300–3400 Hz on 50 ms frames. Sung phrases then separate cleanly from instrumental bars, and a
gap sweep gives first the sections (gap ≈ 2 s) and then the individual lines (gap ≈ 0.6 s). Take the
beat period from the autocorrelation of the spectral flux over lags 0.3–1.2 s; lines of a verse
almost always sit on a 2-bar grid, so `line = 2 * 4 * beat` places every line from one section
start. To tell a repeat from new material, correlate per-band log-energy feature vectors of two
windows: same section ≈ 0.15–0.28, unrelated ≈ 0.03. Tool: `tools/vocal_map.py` in the ODK project.
Verified on a 4:04 anthem: intro 14.7 s, 2 verse blocks and 2 chorus blocks of 34 s each at 109 bpm
(bar 2.20 s), every stanza landing on the measured boundaries.
