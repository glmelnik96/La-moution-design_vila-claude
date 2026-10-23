# After Effects / ExtendScript quirks

Battle-tested gotchas found against a **real** running After Effects via CDP. The early sections
come from the `Extensions-LLM-Chat` live validation (commit `60f2b79`); later ones from production
jobs (a word cloud, Cloud.ru decks, an LED-wall show: 120–184). Each one produced a silent failure
or a thrown error in a live AE session. Read before writing host code or expressions. Code and docs
cite these numbers: never renumber; mark superseded text and point forward instead.

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

## 6. Operate on the active composition only

**See quirk 73** (`M.use(comp)`) and quirk 175 (select a comp by its exact name).

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

**Legacy panel tool only.** `M.capture(frames, …)` takes frame times (quirk 27).

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

Do not trust `value.font` after saving to detect a silent font fallback: it echoes any
name (quirk 80). Measure the width of a fixed word instead.

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

**See quirk 25:** a mangled inline payload is what raises the blocking dialog.

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

**See quirk 159:** solids and precomp layers slide as well; assign `startTime` → `inPoint` → `outPoint`.

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
chain — `p.value.length` is not reliable: a 2D layer's Scale reads 3 but takes
2 eases (quirk 181). Count the failures.

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
probe "just to see" — probing is what multiplies the dialogs. First rule out a long build (AE busy on
the CPU: quirk 143) and a timeout passed in seconds (quirk 170).

Reading the line number: `es-json.jsx` (38 lines) is prepended and joined with `\n`, so
**the payload's own line 1 is reported as line ~40.** A reported line just above 39
means the fault is at the very top of your jsx, not in the prelude. With `--lib`, 1131
prelude lines come first (quirk 180).

Related: this is a second reason to follow #11 (and #19) and keep non-trivial jsx in a FILE rather
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
before cropping, or set `comp.resolutionFactor = [1, 1]` for the capture (quirk 34).

## 28. Scaling a 1x1 solid gives you a 1-px tick, not a rule

`addSolid(col, name, 1, 1, 1)` then `Scale = [46, 400]` reads as "46 wide, 400 tall" if
you think in pixels. Scale is a *percentage*: the result is 0.46 x 4 px — a speck that
looks like sensor dirt on the render, not a design element.

Build rules, bars and underlines at their **final pixel size** and animate `Scale` from
`[0, 100]` to `[100, 100]`. That also gives a wipe-on for free, and the growth is
linear in pixels so the easing reads the way you designed it.

## 29. Parenting AFTER positioning rewrites your values — parent FIRST, and neutralise the null

**See quirk 171:** `setParentWithJump` parents without rewriting the child's values.

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
bridge out, and per quirk 25 you then have to stop calling AE altogether.
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

LIVE-VERIFIED. `_build/check_overlap.py` swept every frame of the v4 cloud and reported **1 real
collision**. The rendered frames showed words sitting on top of each other, including in
the held final layout that carries the last five seconds of the spot. The sweep was not
lying about its own numbers; it was auditing the *packer's* idea of where the words are,
which is not where AE puts them.

**On a 3D layer `sourceRect * scale` is NOT the on-screen box** — it skips the camera
projection, and `Layer.toComp()` does not exist in ExtendScript — it is an expression method
(quirks 160, 176; verified: `typeof L.toComp === "undefined"` on a layer with `threeDLayer === true`). Project by hand:

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

**Same trap as quirk 27** (and quirk 99): wait on size-stable files.

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
scores clean. `_build/gaps.py` reports the distribution of the *gap* instead.

**General shape:** every tolerance that both parties to a constraint may spend
independently costs the constraint twice. And a checker that gates on a
threshold cannot tell you how close you are to it — to see margin, measure
margin.

## 45. Read a logo's silhouette off its alpha, radially — never off the picture

A client's mark looked like "a blue Я inside a ring". It is not. A radial profile
of the alpha (`_build/form_ya.py`, a probe script) gives, as
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

Verify with a checker that does **not** share the packer's grid. `_build/ya_gaps.py`
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

**Same trap as quirk 27** (and quirk 99): wait on size-stable files.

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

`_build/ya_check.py` was written to draw the same frozen layout in the real palette
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

The helper in `_build/gen_cloud.py` is `easeKey(p, k, inf0, inf1)` and it calls
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

**See quirk 19** (the same ASCII-only rule).

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
the Python step (`_build/mark_fit.py` does the crop and the write in one pass) and
import that.

## 60. A window-clipping containment test accepts boxes that hang off the mask

`form_ya.py`'s `Field.legal()` tests a candidate slot with `win()`, which
**clips the window to the grid** and then computes `need` from the clipped
indices. A box hanging off the letterform is therefore only tested on the part
still on the grid — and passes. `_build/mark_probe.py` measured the result: 32 of 112
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
`_build/coll_fit.py` bisects from 0.60 down to 0.02 and never finds a clear scale,
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
that. It looks at the last three lines (quirk 170), and the house pattern

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

**See quirk 93:** the same working space later measured 0.4–0.7/255 — measure before blaming it.

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

**Same trap as quirk 81:** measure before adding a Text Animator.

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
first key, not the current state (#81, #85).

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
Use `if / else` (or parenthesise every nested ternary) in anything sent to AE. `M.text` itself used
this ternary until 2026-09-25 (fixed with if/else).

**Verification lesson:** an ink-box comparison cannot see justification — the block's bbox
is identical for left / centre / right. Multi-line text needs a per-line x-extent check
(`assets/cloudru-art/tools/verify_deck.py`, `line_ranges`), which is what finally exposed this.

## 96. Figma MCP responses over ~19.5 KB fail to parse ("EOF while parsing a string at column 19xxx")

**Cause found in quirk 100** (U+2028, not size); a ~20 KB cap also exists (quirk 109).

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
it as a line end, and the client sees a truncated frame. Size was not the cause here (a ~20 KB cap also exists, quirk 109): an 8-node
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
implementation (`assets/cloudru-art/tools/inkmeasure.py`), or "both wrong the same way" passes the check
(a 2-line text drawn on one line passed the bbox check; only the per-line extent check caught it).

## 107. Line bands: threshold per run, not per element

Rows holding ≥8 % of the element's PEAK row lose a short label line next to long body lines
("Что сделали:" 65 px/row beside 341 px/row lines): its thinner rows fall under the threshold,
the band fragments, and the paragraph's body is never wrapped. Find coarse runs first (rows ≥3 %
of the peak, ≥2 px), then keep rows ≥8 % of THAT run's peak. Two lines whose descenders meet the
next ascenders still part at the sparse valley.

## 108. Figma text boxes lie about their height (and INK text needs its plate)

**Superseded by quirk 119:** size the box to (n + 1.2) line boxes and stop growing at any visible node.

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

`importFile` names the FootageItem `page122_image-000.png` / `gen_A1_dark_bed_loop.mp4`, not the
stem. A lookup by name without the extension finds nothing and the build "succeeds" with missing
layers (the preshow came back with seven "missing" drawings). Either rename on import or search
with the extension. Also: a directory import must filter by prefix — a generation output folder (`out/*.mp4`)
pulled 63 unrelated clips into the project before the `gen_` filter existed.

## 122. Centre text by its measured box, not by justification

**Probably quirk 95, not AE:** `M.text` set justification with the nested ternary that ExtendScript
mis-parses (CENTER became RIGHT); fixed with if/else on 2026-09-25. Centring by the measured box stays right.

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

**Geometry superseded** by quirks 171 (4608x768) and 179 (4608x896); the method stands.

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
k+1 starts with `--first <last frame of k>` (flags of the project's generation pipeline, not `scripts/gen.js`; exact), and chains that must land on a designed
picture (a loop's anchor, an AE handoff) end with `--last <anchor>` plus a 6–10 frame crossfade in
the edit. Anchors that come from existing takes are extracted with ffmpeg at the pipeline
resolution; anchors that come from the archive are graded per era first (sepia / cold BW /
vintage / clean), because a start frame sets the look of the whole clip. Write the pack as data
(in the generator's own shot-list format plus a CSV) so the other agent queues it
without re-reading prose.

## 126. Hue/Saturation matchNames are off by one from the panel order

`ADBE HUE SATURATION-0004` is **Master Hue**, `-0005` Master Saturation, `-0006` Master Lightness,
`-0007` Colorize (`-0002` Channel Control, `-0003` Channel Range — there is no `-0001`). Setting
`-0004` to −72 rotates the hue by 72° instead of desaturating: duotone book scans came out green and
magenta and the mistake is invisible on neutral photos. Dump the effect once (name | matchName) before
setting anything by number; the review captures caught it, the numeric result did not.

## 127. `"text" + err` inside a catch throws its own error in ES3

**See quirk 1** (the same `+` family in ES3).

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

**Levels takes neither expressions nor keys in AE 26** (quirks 163, 181.2): animate with Brightness &
Contrast 2, or fade the effect's own mix (quirk 183).

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
windows: same section ≈ 0.15–0.28, unrelated ≈ 0.03. A small project-side script (`vocal_map.py`) does it.
Verified on a 4:04 anthem: intro 14.7 s, 2 verse blocks and 2 chorus blocks of 34 s each at 109 bpm
(bar 2.20 s), every stanza landing on the measured boundaries.

## 132. `M.capture` returns before the PNGs exist — never chain a cropper onto it

**Same trap as quirk 27** (and quirk 99): wait on size-stable files.

`saveFrameToPng` queues the write; the call that follows it in the same shell line runs while AE is
still flushing. A crop/compose step chained after a capture (`node ae.js … && python crop.py`) dies
on `FileNotFoundError` for files the capture "returned", and a file that does exist may still be
half-written. Wait on size-stable files first (a project-side `review_sheet.py` polls; or
`until [ -f f ] && [ "$(stat -c%s f)" -gt N ]; do sleep 4; done` plus a few seconds of slack), then
crop. Cost of ignoring it: a whole build round looks failed when only the cropper was early.

## 133. `timeRemapEnabled = true` resets the layer's outPoint to the source duration

**See quirk 183:** with this order and a remap expression, a slowed clip still rendered blank past its
source length; keys over the whole life fixed it (cause not isolated).

Setting `layer.outPoint` before enabling time remapping is silently undone: switching the flag on
re-derives in/out from the footage length, so a 49-second corridor segment built from a 5.17 s clip
ends after 5.17 s and the rest of the window plays black. Always order it
`startTime → inPoint → timeRemapEnabled = true → remap expression → outPoint`. The failure is
invisible in the build result (no error, the layer exists, the expression is right) and only shows
up as missing footage in a capture several seconds past the clip length.

## 134. Prefix matching picks the wrong clip when ids share a stem

`gen_N3a_quality_…mp4` and `gen_N3a_sq_quality_…mp4` both satisfy `name.indexOf("gen_N3a_") === 0`,
and a "take the last by name" tiebreak hands you the square version for the wide slot — silently, in
a build that reports success. Any id scheme with a suffixed variant (`sq`, `loop`, `alt`) needs an
anchored match, not a prefix: build it from the id and the known tier names,
`new RegExp("^gen_" + id + "(loop)?_(quality|balanced|draft)")`. ExtendScript constructs RegExp from
a string fine. Cheap rule: whenever generated assets are looked up by name, the lookup must be able
to say no to a longer id, and the build log should print which file each slot resolved to so the
mismatch is visible without opening the comp.

## 135. A `\b` written through a code-generating patch becomes a real backspace byte

Patch scripts that rewrite emitters are the usual way to evolve a build, and they are one escaping
level deeper than the code they write. A regex `\b` that loses one backslash on the way through a
non-raw string is not a syntax error: Python writes byte 0x08 into the file, the emitter still runs,
the regex silently matches nothing, and the only symptom is a slot that never fills. Two other
escapes on the same line (`\s`, `\d`) survived, so the file "looked" right in an editor.
Catch it by asserting on the written text (`assert "\x08" not in src`) and by reading the result
through `cat -A` rather than a normal view. Prefer character classes with no short escapes
(`[0-9]` over `\d`) in generated regexes, and keep any regex that must survive two levels in a
separate constant rather than inline in the patch string.

## 136. Timing a narrated film: transcribe it, do not listen for pauses

An envelope/pause analysis finds where speech stops; it cannot tell you *what* stops, so a chapter
boundary and a breath look identical. `faster-whisper` runs locally (large-v3, int8 on CPU, ~80 s for
a 4.5-minute track, models already cached under `~/.cache/huggingface/hub`) and returns word-level
timestamps, which give the boundary as the first word of the next chapter — exact and re-checkable.
Two traps: whisper merges a long musical gap into the preceding segment, so read the *word* times,
not the segment start (a segment beginning at 119.35 s had its second word at 143.54 s — the 24 s
gap was the film's key transition); and VAD occasionally emits a stray one-word fragment at the gap
start. Tool: a project-side `transcribe.py`, not shipped with this skill. Use it to compare two versions of a track as well — align the
per-second RMS envelopes first to find *where* they differ, then read the transcripts only there.

## 137. `setValue` on a keyframed property aborts the whole build, silently mid-loop

Hiding an element by `M.opacity(L).setValue(0)` after something already animated it (here
`M.premiumIn` had written opacity keys) throws inside the loop that was building eight award comps.
The run still reported `ok: true` from an outer handler, the first comp kept the layers made before
the throw, and comps 3–8 silently kept the *previous* build's layers because their `M.clean()` never
ran — so the review sheet showed a mix of new and stale frames and looked like a lookup bug.
Rules: never `setValue` a property you may have keyframed — branch earlier and don't create the
element at all; and when a build loops over sibling comps, check the layer list of the LAST comp in
the loop, not the first, before trusting a capture. `M.summary` or a layer-name probe catches it in
seconds. No earlier quirk covers the throw itself; the damage here is the aborted loop.

## 138. Two emitters that both own a comp: the later build silently empties it

`numbers_jsx.py` laid out every number from the timeline, and the hymn was in its list; `n4_jsx.py`
built the hymn in full (39 photographs, lyrics, scrims). Each starts its comp with `M.use(c);
M.clean();`. Whichever ran last won, so a day of edits ended with the hymn comp holding two layers
and no error anywhere — the numbers pass had "successfully" laid out a segment that says only
"AE builds this". Ownership of a comp must be exactly one emitter; a shared list (here `LAYOUT`) is
where that gets violated by accident. The cheap detector is a health probe after a build session:
list every delivery comp with size, duration and layer count, and look for the outlier — one comp
with two layers among comps with twenty stands out instantly, where a capture of a single frame
would have looked merely dark.

## 139. A 3D layer under a camera needs its POSITION compensated for depth, not just its scale

**See quirk 37** (the same depth compensation in the word-cloud build).

LIVE-VERIFIED 2026-09-22 (LED-wall show pre-show). With the camera at `-CAMZ` looking at the `z = 0`
plane and zoom `CAMZ`, a layer at depth `z` is magnified by `CAMZ / (CAMZ + z)` — and so is its
offset from the centre of the comp. Compensating only the scale leaves the composition wrong:
a fragment authored at `x = 4060` on a 4608-wide wall at `z = -580` projects to 4622 and is gone.

WRONG
```js
var k = 100 * (targetH / cropH) * (CAMZ + z) / CAMZ;   // size is right
M.pos(L).setValue([x, y, z]);                          // position is not
```
RIGHT
```js
var dp = (CAMZ + z) / CAMZ;
M.scale(L).setValue([100 * (targetH / cropH) * dp, ...]);
M.pos(L).setValue([CX + (x - CX) * dp, CY + (y - CY) * dp, z]);   // lands where it was composed
```
Drift amplitudes written into the position expression need the same `* dp`, or near layers crawl
and far ones barely move. Scatter particles the same way: generate SCREEN x/y, convert on the way
in, and leave the scale alone so far motes stay small and near ones blur out in the DOF.

## 140. A mask feather wider than the gap to the layer edge is cut off there — a hard seam

LIVE-VERIFIED 2026-09-22. A 700x1400 solid with a full-bleed rectangular mask and feather 340
does not fade out: the feather is clipped at the layer boundary and the result is a hard diagonal
edge across the wall, which reads as a render bug. The layer has to be bigger than its mask.

WRONG `M.solid(n, c, 700, 1400)` + mask `[[0,0],[700,0],[700,1400],[0,1400]]`, feather 340
RIGHT `M.solid(n, c, 1500, 2000)` + mask `[[420,320],[1080,320],[1080,1680],[420,1680]]`, feather 300

It also appears when a script MOVES somebody else's masked layer (2026-09-23, LED-wall show awards): the
client's white glow was a 2048 px solid filling MAIN, with the mask's feather running out exactly at the
comp edge. The emitter shifted the layer 166 px left with the logo row, so the solid's edge landed
inside the frame and cut the feather into a vertical line (-13 levels) the client spotted. To move
what a masked layer shows, move its MASK vertices (all keys) and leave the layer where it is.

## 141. A mask lives in LAYER space: on a scaled layer, comp coordinates put it somewhere else

**See quirk 75** (the same layer-space rule).

LIVE-VERIFIED 2026-09-22 (LED-wall show splash). The active band of the wall is x 768..3840, so the
mask on the texture layer was given those vertices — but that layer is a clip scaled ~300% and
shifted, and the mask scales with it. The right edge landed at 4248 and painted the side screen
that was supposed to be off. It is invisible in a thumbnail: brighten the band 6x to see it.

```js
function bandMask(L, cx0, cx1) {                 // comp x -> layer x
  var px = M.pos(L).value, sc = M.scale(L).value[0] / 100, an = M.anchor(L).value;
  var lx0 = an[0] + (cx0 - px[0]) / sc, lx1 = an[0] + (cx1 - px[0]) / sc;
  ...
}
```
Check it by measuring, not by eye: `Image.crop(band).getextrema()[1]` per captured frame. A value
that is identical on every frame is a static leak; one that changes is something drifting in.

## 142. CC Light Sweep is the metallic glint, and it must leave the layer between passes

LIVE-VERIFIED 2026-09-22. Params are ordinary match names: `CC Light Sweep-0001` Center,
`-0002` Direction, `-0003` Shape (2 = smooth), `-0004` Width, `-0005` Sweep Intensity,
`-0006` Edge Intensity, `-0007` Edge Thickness, `-0008` Light Color, `-0009` Light Reception
(2 = composite). Center is in LAYER space, so drive it from `L.source.width/height` (on text and
shape layers effect points are comp coordinates: quirks 160, 167).

A cyclic scene must not pulse, so run the band across in the first quarter of the cycle and let
it sit off the layer for the rest — off the layer means nothing on screen at all, no fade needed:
```js
e.property("CC Light Sweep-0001").expression =
  "var T = 8, ph = 0; var u = ((((time - ph) % T) + T) % T) / T;" +
  " var s = Math.max(0, Math.min(1, u / 0.26)); var k = s * s * (3 - 2 * s);" +
  " [" + (-0.45 * sw) + " + k * " + (1.9 * sw) + ", " + (sh / 2) + "]";
```
Width above ~10% of the logo reads as a wash over dark type, not as metal. Narrow it and pay for
the read with Edge Intensity instead.

## 143. A 120 s CDP timeout is not a modal: check the CPU before you stop

LIVE-VERIFIED 2026-09-22. `ae.js` defaults to a 120 s CDP timeout and a 171 KB build (40 extruded
blades plus eight award comps) takes about four minutes, so it reports the modal-dialog error
while AE is working perfectly. The script keeps running inside AE after the client gives up.

Tell the two apart before applying quirk #25: `Get-Process AfterFX` and compare
`TotalProcessorTime` across a 12 s window. A full core busy plus `Responding = True` means it is
computing; a title bar that loses its `*` means `app.project.save()` at the end of the run landed.
The fix is `node scripts/ae.js --lib --timeout 540000 "@file.jsx"`, not a retry.

## 144. On an LED wall, small dark dots read as dead pixels

LIVE-VERIFIED 2026-09-22. A dust pass built as MULTIPLY dots of 2-6 px at 12-26% over a white
field is invisible in the render and reads as broken hardware on the wall. Bright motes on ADD
are self-masking instead: over a white field ADD changes nothing, so they only appear where the
picture is dark, and no mask is needed. Clamp their drift to the active band all the same —
an ADD dot that wanders onto a screen which is meant to be off is a lit pixel on black.

## 145. Box text wraps before you can measure it, so a type fit overshoots

LIVE-VERIFIED 2026-09-22 (LED-wall show award plates). Fitting a long line into a panel by measuring
`sourceRectAtTime` and scaling down does not converge: a box-text layer wraps inside its own box,
so the measurement returns the WRAPPED block (width capped at the box, height doubled) rather than
the real line width. An iterative shrink then chases the height guard and lands far too small — a
60 px line came back at 45 px on one pass and stayed at 60 as two lines on another, depending only
on how wide the box happened to be.

Widen the box beyond any possible line, measure, then divide once:
```js
var doc = td.value; doc.text = txt; doc.fontSize = base;
if (doc.boxText) doc.boxTextSize = [4000, boxH];       // no wrapping at any plausible size
td.setValue(doc);
var sr = L.sourceRectAtTime(L.inPoint, false);          // the REAL single-line width
if (sr.width > maxW) size = Math.floor(base * maxW / sr.width);
// apply size, nudge down 1 px while still too wide, then pin the box just outside the line
```
Checking width alone never detects wrapping — a wrapped block is narrower than the box. Check the
height against the base size, or keep the box wide while measuring.

## 146. `M.exprErrors()` reads M.comp: it throws in a payload that never called M.use

LIVE-VERIFIED 2026-09-22. A surgical payload that edits existing layers and builds nothing has no
reason to call `M.use`, and the habitual `out.errs = M.exprErrors();` at the end then fails with
`TypeError: null is not an object` from inside the library — the reported line number is in the
prepended lib, not in your code, which is what makes it confusing. Either drop the call or set a
comp first.

## 147. When the client finishes a comp by hand, the emitter has to be switched off

LIVE-VERIFIED 2026-09-22. The award plates were built by an emitter step that does `ensure()` then
`M.clean()` per comp. The client then finished plate 1 by hand — screen-frame guides, a different
set of emblems, their own logo row, the corner emblem and the issuer placeholder deleted — and
deleted plates 2-8. Re-running the emitter would have rebuilt the OLD layout and wiped all of it.

Two moves, both required:
- Guard the step off (`var BUILD_AWARDS = false;` plus a note in the output) so no later rebuild of
  the same file can touch those comps.
- Generate the siblings from the hand-finished comp instead: `ref.duplicate()`, rename, and change
  only the wording. Read each text layer's settled centre BEFORE editing and restore it after, so
  the layout stays exactly as the client left it.

Before writing to a comp you did not build in this session, list its layers. Names like
`emblem wing L 2` (an AE duplicate suffix) or a guide layer that your emitter never creates are the
signal that a person has been in there.

## 148. Quirk 135 again: a backslash escape does not survive the shell into a generated file

LIVE-VERIFIED 2026-09-22. Writing `"\r"` inside a heredoc-fed Python patch produced a REAL 0x0D
byte in the emitted source, breaking the string literal it landed in — the same failure as quirk
135 with `\b`. Do not pass backslash escapes through a shell into code you are generating. Put a
plain sentinel in the data and expand it in code: `c.replace("|", chr(13))`, and compare with
`String.fromCharCode(13)` on the ExtendScript side. Assert the raw byte is absent before writing.

## 149. The closed link: how to make a long bed out of a short clip without a loop

LIVE-VERIFIED 2026-09-22 (LED-wall show). A 5 s generated clip looped over a 160 s window repeats
thirty-two times, and cross-dissolving the seams only turns the repeat into mush. The fix is not a
better dissolve, it is a different structure — generate 15 s links whose ENDPOINTS are pinned to
the local clip's endpoints:

```
link.firstFrame = local.lastFrame        (First Video Frame = <base>_last.png)
link.lastFrame  = local.firstFrame       (Last  Video Frame = <base>_first.png)
```

Then `[local][link]` joins seamlessly on BOTH sides and needs no dissolve at all, and every extra
link is a different road between the same two points. Five links turn a 5 s repeat into a 20 s
cycle whose 15 s middle is new every time.

Verify the pinning by measurement before you build on it: extract the link's first and last frame
and compare the mean absolute difference against both anchors. Correct pinning showed 8 and 9
levels against the right anchors versus 73 against the swapped ones. Under ~10 a four-frame fade
hides the residue; a hard cut would show a small jump because the platform re-renders the endpoint.

Links cannot be chained to each other: link N ends on `first` and link N+1 starts on `last`, which
are different frames. The local take must sit between them, so the cycle is fixed at
local + link.

## 150. Place a sequence of shots, not a loop: slots, natural speed, four-frame joins

LIVE-VERIFIED 2026-09-22. Replacing eleven looped 5 s corridor clips with twenty-two 15 s takes
removed every loop from a 253 s film. The placer that worked:

- a block of the timeline gets an ordered LIST of shots; slot = block length / count;
- if slot <= clip duration, play at natural speed and let the clip stop early (trim);
- if slot > clip duration, stretch, but never speed up — a hurried dolly reads as nervous.
  Choose the shot count so the stretch stays above ~0.9;
- the join is a four-frame fade on the INCOMING layer over the outgoing one (`outPoint = a1 + 0.08`,
  opacity `100 * Math.min(1, u / 0.08)`). It reads as a cut and kills a luminance flash;
- assert in the emitter that no shot id appears twice in the table. That single assertion is what
  guarantees "no repeats" instead of hoping.

A full-wall white flash on a transition must be short: 0.18 s in, 0.32 s out, peak ~88 rather than
100. Held at full white for 0.7 s it reads as the blink the client complained about.

## 151. A shot's description is not evidence: look at the frames before you cut it in

LIVE-VERIFIED 2026-09-22. Two clips whose prompt carried the client's explicit "completely
unmarked aircraft" sentence came back with red stars on the fuselage and with a national flag plus
a registration number on the tail. The generation platform silently ignores part of a prompt, and
the index file only records the id, the size and the duration.

Before placing any generated shot that shows hardware, extract three frames — start, middle, end —
with `ffmpeg -vf "select='eq(n\,30)+eq(n\,200)+eq(n\,370)',tile=1x3"` and look at them. Two of the
five aircraft takes in this batch were unusable, and the description of one of them ("цех, две
фигуры у станков") turned out to be a modern blue-lit hall that would have sat in a 1916 chapter.

## 152. Archive stills as a memory: a feathered oval, a ceiling on the whites, and headroom

LIVE-VERIFIED 2026-09-22 (LED-wall show intro and hymn). The client asked for the photographs to lie
on the wing screens "like the drawings, as a memory, a bit abstract, and the frame edges must not
read". Three things made it work, and two of them were mistakes first.

**An oval, not a rectangle.** A rect mask with a big feather still reads as a frame, because the
corners give the eye a shape to latch onto. An ellipse with a feather of ~26 % of the short side
dissolves the photograph into the dark on every side. Keep the oval AND its feather inside the
layer bounds — `rx = w/2 - feather*0.62` — or the feather is clipped at the edge and hands back
the hard line you were removing (quirk 140).

**No bloom.** `ADBE Glo2` over that oval looked right on a dark photograph and blew a bright one
into a white patch, which also destroyed the legibility of the lyric text sitting on the wing. A
ceiling on the whites does the job instead: `ADBE Easy Levels2` output white 0.82, gamma 1.08. The
wing then physically cannot out-shine the centre.

**Headroom when a full-wall image becomes a band.** The same still that used to cover 4608 px at
2.25x covers a 3072 px band at 1.5x, and the vertical overflow that used to hide the scan's own
dark border is gone — the border appears inside the frame as a rectangle. Do not answer that with
a soft edge: at a panel seam a soft edge spills onto a screen that now shows something else.
Answer it with scale: `cov = max(band / w, (H + 220) / h)`, so the scan's edge is always outside
the visible band and the crane still has room to travel.

## 153. A glass wipe that hides sloppy joints: fluted displacement, frozen holds, one shared matte

LIVE-VERIFIED 2026-09-23 (LED-wall show, the splash, AE 26.3). Generated clips placed
end-to-end never match at the cut (a title that is 2 % bigger, a different grade, a jump from the
title to a white sky). A pane of fluted glass sliding across the frame hides every one of them,
provided the old/new boundary rides UNDER the glass instead of the cut happening all at once.

- **Fluted glass** = Displacement Map (Use For Horizontal: Luminance = 5, Vertical: Off = 11,
  Behavior: Stretch Map to Fit = 2, Expand Output 0) on a moving adjustment layer, the map being a
  precomp of 45 px solids with a black-to-white Gradient Ramp each (a sawtooth). Each rib then
  shows a squeezed slice of the picture, and any edge under it is broken into strips.
- **Both clips on screen at once** without handles: duplicate the outgoing layer, time-remap it to
  a constant = its last visible source frame (`(idx + 0.5) / srcFps`), and duplicate the incoming
  layer frozen on its first frame. Duplicates keep parenting and transforms, so a user's
  hand-aligned framing survives untouched.
- **One matte for all of them**: `layer.setTrackMatte(matte, TrackMatteType.ALPHA)` for the old
  side and `ALPHA_INVERTED` for the new side (AE 23+). The matte is a wide solid whose feathered left
  edge follows the pane centre; `matte.enabled = false` and it still works as a matte.
- Overlays that END on the cut (logos, a white plate) get the same treatment: a duplicate on the
  old side, so the curtain carries them off instead of letting them pop.
- Put the glass set ABOVE everything, logos included — a pane that passes under a logo reads as a
  HUD, and a logo that must leave with the old frame cannot leave under glass it sits above.

## 154. Glass on white: Soft Light and Add do nothing there; a fast periodic pattern strobes

LIVE-VERIFIED 2026-09-23. Two failures that only showed on real frames.

- On a white sky the pane read as a **white bar**: a Levels lift, a Soft Light tint, a bloom and a
  sheen each brighten, and on 255 they all clip. Soft Light with any blend value leaves pure white
  unchanged, Add and Screen cannot go above it. Glass that must read on white needs DENSITY:
  Levels output black 0.02 / output white 0.965, a Multiply tint (inside a precomp it needs an opaque
  floor, quirk 156) of a cool near-white
  `[0.95, 0.968, 0.99]`, and a thin Multiply line at every rib trough (the ribs precomp through
  Levels input white 0.08). Highlights (Add) are for the dark parts only.
- A periodic pattern that moves with a fast pane **strobes like a wagon wheel**: with strong easing
  the pane peaks at 80-100 px per frame and 45 px ribs travel more than a period per frame. Keep
  the per-frame shift of a periodic texture under half its period: the ribs drift at 15 % of the
  pane speed (a null inside the map precomp, expression `((-(P - xa) * 0.85) % rib + rib) % rib`)
  while the soft refraction envelope moves at full speed.

## 155. Easing by Graph Editor influence, and a transition across a loop point

LIVE-VERIFIED 2026-09-23.

- A designer's "make the speed more nonlinear" maps to keyframe influence. Cubic-bezier
  `(a, 0, 1-a, 1)`: a = 0.33 is Easy Ease, a -> 0 is linear. Peak speed over average: a = 0.6 ->
  2.5x, 0.7 -> 3.3x, 0.75 -> 4x, 0.8 -> 5x; smoothstep is 1.5x. Solve x(t) = u by Newton
  (12 iterations, clamp t to 0..1), then y = t*t*(3 - 2t). Expose `a` as a slider in percent.
- A **loop** transition is one more joint cut in half by the comp boundary. Put virtual joints at
  0 and at `comp.duration` into the same motion expression: with a symmetric ease, u = 0.5 falls
  exactly on the boundary and ease(0.5) = 0.5, so the pane stands in the centre on the last frame
  and on frame 0. Holds: the first clip frozen on its first frame at the end, the last clip frozen
  on its last frame at the start. Measured frame-to-frame change across the loop 14.87 against
  15.09 and 14.21 on either side — the seam is a normal frame step.
- Carry overlays across the loop by shifting the duplicate's `startTime` by `-comp.duration`: its
  fade-in keys fall into negative time and the layer holds its end state on 0..T/2.

## 156. Blend modes over an empty comp background render as Normal: lay an opaque floor

LIVE-VERIFIED 2026-09-23 (LED-wall show, the hymn). The comp background colour is not a layer. Where
nothing lies under a Multiply / Soft Light / Screen layer, it has nothing to blend with and is
composited as Normal: a cool near-white Multiply tint over the black opening of a slideshow lit up
as a pale slab (measured 99/255 against 0 without the glass layers; the Multiply tint alone
accounted for 38 of it). In a comp whose footage always covers the frame this never shows; in a
comp that opens from black, or has gaps, put an opaque black solid at the very bottom.

## 157. Faces without a download: the Windows face detector from PowerShell, and framing by score

LIVE-VERIFIED 2026-09-23. `Windows.Media.FaceAnalysis.FaceDetector` ships with Windows and is
reachable from Windows PowerShell 5.1 through WinRT (`[Type, Namespace, ContentType=WindowsRuntime]`
plus an `AsTask` helper to await `IAsyncOperation`). Gotchas, in the order they bite:

- `BitmapDecoder.GetSoftwareBitmapAsync(Gray8, ...)` fails on PNG ("pixel format is unsupported").
  Decode `Bgra8` + `Premultiplied`, then `SoftwareBitmap::Convert($bmp, Gray8)`.
- On a whole 3136 px group photo it finds 0-3 faces: faces of 30-60 px are below what it detects.
  Decode at 2x through `BitmapTransform` (`ScaledWidth/Height` + `Bounds` = one tile), 1600 px tiles
  with 360 px overlap, detect per tile, map back by `/2`, merge duplicates by centre distance.
  35 photos went from 1-8 found faces each to all visible faces.
- It still reads a stage light or a portrait on a banner as a face: keep a per-image ignore band.

Framing a 4:1 band out of a 21:9 photo (58 % of the height): head = face box from -0.35h to +1.12h
(a -0.6h/+1.25h head made large foreground faces "not fit" and forced needless pans). Score every
band position: a face fully inside counts +height, a face cut by the band edge -1.5 x height. Hold
still at the best position that contains every "main" face (>= 35 % of the biggest); if none, retry
without the push-in; only then pan, each end chosen by the same score so the edge passes between
faces, and end on the biggest face. Run the pan from the cut to the START of the next pass: over
the whole layer life the end framing arrived only under the next glass.

## 158. Slideshow with glass passes: per-slide mattes, no holds; bloom that stays tasteful

LIVE-VERIFIED 2026-09-23. With stills, the glass wipe of quirk 153 needs no frozen duplicates:
every slide lives from the start of its incoming pass to the end of the outgoing one, and each
slide has its OWN edge matte (ALPHA_INVERTED) that parks off-left before its pass and off-right
after it. A shared matte cannot work here: parking it for the next pass would hide the slide on
screen.

On bright daylight photos `ADBE Glo2` at threshold 82 %, radius 90, intensity 0.28 already reads
as haze, and a "hit" pulse to intensity 0.9 / radius 160 on a chorus cut washed the frame to white.
Threshold 88, radius 60, intensity 0.18, pulse +0.22 / +30 px is visible and clean. A light sweep
reads as gloss only with a crisp core: a soft band at 35 % mask opacity plus an 18 px core with an
8 px feather, Add 30 %; the soft band alone read as fog.

## 159. Setting `inPoint` moves `outPoint`: always assign startTime -> inPoint -> outPoint

LIVE-VERIFIED 2026-09-23 (AE 26.x, LED-wall show award screens). Trimming a layer "out first, then in"
silently shifts the out point. Measured on a 200 s solid: `outPoint = 32.16` gives (0, 32.16), then
`inPoint = 3.1` gives **(3.1, 35.26)** — the layer slid instead of trimming. On a precomp layer after
`startTime = 32.16; outPoint = 64.3`, assigning the SAME in point (`inPoint = 32.16`) restored the out
point to the source end (68.66). A fresh, untrimmed layer does trim (`inPoint = 3.1` -> (3.1, 36.5)).
The build reported ok; the damage showed only as overlays living 3 s into the next cycle and keep
copies stretching to the next joint.

WRONG `L.outPoint = t1; L.inPoint = t0;`
RIGHT `L.startTime = s; L.inPoint = t0; L.outPoint = t1;` — and for a duplicate that must start where
its source ends (a glass "keep" copy), in first (it may slide), then out, which pins it. After any
batch of trims, dump `[name, inPoint, outPoint, startTime]` of the new layers before capturing.
When the new in point lies past the current out point (a duplicate of a time-remapped layer moved later,
LIVE-VERIFIED 2026-10-11), do `out = max(t1, out); in = t0; out = t1`. In that case "out first, then in"
slid the duplicate by the in-delta: (46.4, 56.44) came out as (46.4, 63.24).

## 160. Effect point parameters on a TEXT layer are comp coordinates, not `sourceRectAtTime` space

LIVE-VERIFIED 2026-09-23. A Gradient Ramp on a point-text layer given its points from
`sourceRectAtTime` (top -69 .. 0, layer space around the anchor) painted the whole glyph in the END
colour: the ramp was above the letters. The same points shifted by the layer position
(`[x, pos.y + rect.top]` .. `[x, pos.y + rect.top + rect.height]`) gave a clean red-to-blue ramp,
for two layers at different positions — the effect sees the text layer as comp-sized with its origin
at the comp's top-left. Holds for an untransformed text layer (no parent, scale 100, rotation 0);
anything else, compute through `toComp` in an expression. Symptom in a dimensional-type build: the
face came out uniformly dark and the silver rim uniformly grey — every pixel got the end colour.

## 161. Dimensional metal type that keeps a per-word text animator

LIVE-VERIFIED 2026-09-23 (LED-wall show award titles, Manrope ExtraBold 48 px on a light field, matching
the chrome «110» emblem). Construction that survives a word cascade with blur, because every part is
an effect on a text layer that carries the same animator:

- One **face** + one **side** text layer PER LINE (a lacquer gradient is per line; one multi-line
  layer gets one ramp top-to-bottom). Side = duplicate of the face, below it, fill + stroke 3 px
  silver, `strokeOverFill = false` -> a 1.5 px rim shows around the face.
- Face: `ADBE Ramp` over the cap height (points per quirk 160) `[0.90,0.24,0.27] -> [0.58,0.04,0.09]`,
  then `ADBE Bevel Alpha` thickness 1.2, angle -40, intensity 0.6. Thickness 1.8 / intensity 0.75 at
  48 px shades half of an 8 px stroke and the face goes maroon.
- Side: silver ramp, then SIX `ADBE Drop Shadow` of 1 px each, opacity 255, softness 0, direction 205,
  colours stepping from `[0.78,0.79,0.82]` (near) to `[0.46,0.47,0.51]` (far): each shadow is cast by
  the result of the previous one, so they stack into an extrusion that follows the words as they
  rise and blur. Then one soft cast shadow (opacity 70/255, distance 8, softness 16).
- Glint: CC Light Sweep on an adjustment layer at the top of the title precomp (quirk 142 timing).
- Word cascade across line layers with ONE global stagger: Range Units = Index (2), Based On = Words
  (3), Ramp Up, Ease High 20 / Ease Low 100, `ADBE Text Index Start` 0, `End` R = WORD_DUR / STAG,
  `ADBE Text Index Offset` linear from -R at `T0 + first*STAG` to n at `+ (n + R)*STAG`, where
  `first` = words on the previous lines. Percent units cannot do this: the ramp is capped at 100 %,
  so a three-word title staggers 0.33 s and a nine-word one 0.12 s.

## 162. A door transition: fly back out of one room into the next

**Superseded by quirk 166.**

LIVE-VERIFIED 2026-09-23 (LED-wall show intro, 39 transitions). The outgoing shot stays inside an
arch and the arch recedes into the incoming shot, so the camera seems to fly backwards out of one
room into another. All archive generations were pull-backs, so the move always reads as one motion.

- A null at the vanishing point; the outgoing layer is parented to it and track-matted
  (ALPHA) by an arch-shaped shape layer that is also parented to the null.
- Scale the null in LOG space: `k = exp(log(s1) * ease(u))`. A linear scale from 1 to 0.1 spends
  90 % of the time on the first half of the move and looks like a snap at the end.
- The arch frame is an OPEN path (a door has no line on the floor; a closed arch read as a window).
  Keep its stroke constant on screen: `width / (parent.transform.scale[0] / 100)`.
- Depth: a blurred open-path shadow around the opening (32 % max; 58 % read as dirt) and an Add
  radial light spilling out of the doorway; the incoming room arrives 1.22x and slightly dark
  (Brightness & Contrast keys -34 -> 0) and pulls back to 1.0 with ease-out.
- Chapter changes get a wide gate instead of a door; the propeller-to-turbine moment gets a circle.

## 163. Things that failed in AE 26 and what worked instead

LIVE-VERIFIED 2026-09-23.

- `ADBE Easy Levels2` parameters refuse expressions: "Can not set expression or expressionEnabled
  on this property." They take no keys either (quirk 181.2): animate with `ADBE Brightness & Contrast 2`.
- A luma matte built from a duplicate of the layer with `ADBE Threshold2` on it rendered solid black
  (solo render: rgb mean 0), so the "develop" reveal showed the whole photo at once. What works:
  `ADBE Gradient Wipe` on the layer itself, Gradient Layer = its own index, Invert Gradient on,
  Completion from max to 0 — the darkest tones appear first, like a print in the developer.
  Its Softness is 0..1, not percent (28 -> "out of range 0 to 1"); read Completion's range from
  `hasMax / maxValue` instead of assuming 100.
- `layer.duplicate()` copies the parent AND the track matte. Make every copy of a shot BEFORE you
  hang it on a door null and matte it, or the copies silently inherit both.
- A shot split into two layers (one part under a circle matte, one part carrying the exit door)
  must keep one clock: write the time remap against a constant start, `time - 139.18`, never
  `time - inPoint`, because the second part's in-point differs.
- `String#indexOf` is ES3 and always works; only `Array#indexOf` is missing (the linter flags every
  `.indexOf`).

## 164. Lettering that draws itself without installing the font

LIVE-VERIFIED 2026-09-23 (508 letters, Tektur OFL). Convert glyphs to AE shape paths in Python
with fontTools and never touch the system font folder or restart AE:

- `instancer.instantiateVariableFont(font, {"wdth": 75, "wght": 620})`, then draw each glyph with a
  BasePen; quadratic TrueType segments become cubic exactly: `c1 = p0 + 2/3 (q - p0)`,
  `c2 = p + 2/3 (q - p)`. AE tangents are relative to their vertex; flip y (`base - y * k`).
- A drafting slant is a shear: `x + tan(15 deg) * y` in font units, before scaling.
- Kerning lives in GPOS PairPos (format 1 pair sets, format 2 class pairs), often wrapped in
  Extension lookups (type 9 -> `ExtSubTable`). Without it "ТЬ" and "АТ" gape.
- Per letter: a "pen" group (Trim Paths end 0 -> 100 over 0.24 s, stroke 2.2 px, then fades) and an
  "ink" group (fill, group opacity 0 -> 100 from +0.12 s). Guide lines ruled 0.5 s before the first
  letter make it read as drafting. Time each word to the transcript word, letters staggered 35-90 ms.

## 165. Generated "archive" clips: they inherit the photo and invent the rest

**See quirk 151** (look at the frames, not the description).

LIVE-VERIFIED 2026-09-23. The client's folder of animated archive photos (Kling/Seedance
image-to-video) is only as safe as its source photos plus whatever the model adds:

- an animated Victory-train photo carried the original's portrait of Stalin on the locomotive;
- an animated engine-installation photo gained dark chevrons on the wing that read as markings;
- a clean frontal Li-2 had a background plane with a tail emblem entering after 5 s — solved by
  capping the source time (`maxsrc`) instead of dropping the shot.

Check three frames of EVERY clip you place (start, middle, the last frame you will actually reach),
and check the band crop, not the full frame. And check a real scan before using it full-bleed: a
2048x1041 archive scan at 1.5x on the main screen fell apart into black blotches; a cleaner
2048x1228 scan of the same era held up.

## 166. A door that never shows the clip's edges: sweep in, hold, fly back, with parallax

LIVE-VERIFIED 2026-09-23 (LED-wall show intro, replaces the door of quirk 162). The first door
parented the outgoing shot to the door and matted it with the arch: a tall arch over a 2.35:1 clip
left the clip's top and bottom edges visible inside the arch — "a crooked crop". The client's fix,
which works: the door appears first and covers the edges, then flies back.

- The door is a doorway in the NEW room: an arch-shaped matte on the outgoing shot plus an opaque
  casing (graphite stroke along the arch, width in door-local units so it scales with the door).
  At scale 1 the opening contains the whole band (check the band corners against the arch circle,
  not just the jambs: a semicircle of radius 1600 cut the top corners of a 3072x768 band; 1760 did not).
- Door scale in log space as a sum of three smooth terms — sweep in (ease-out to ~0.42), a slow
  drift through the hold (x0.92), fly back (ease in-out to ~0.06). A sum of smooth ramps has no
  velocity jumps, unlike piecewise segments with a flat hold (a separate tail still jumped: quirk 178).
- The outgoing room sits DEEPER than the doorway: parent it to its own null whose scale follows the
  door by perspective, `sR = K / (K + (1/sD - 1))`, K = 8. The room shrinks slower than the door,
  so the opening keeps showing the middle of the room and its edges stay hidden. Add a floor:
  `sR = max(sR, need)` where `need` is the visible part of the opening (clamped to the band) over
  the room's half extents (minus / plus its vertical framing shift), with 3 % margin.
- Parenting compensation uses the comp's current time: set `comp.time = 0` (where every null is at
  scale 1) before `layer.parent = null`, then set the child's position explicitly.
- Stack per transition: casing, inner shade (on the old room), old room (matted), light spill and
  outer shade (on the new room), new room.

## 167. Effects on shape layers do not scale with the parent

**Same mechanism as quirk 160:** effect points are in comp pixels.

LIVE-VERIFIED 2026-09-23. Shape layers are continuously rasterised: their effects run after the
layer transform, in comp pixels. A Gaussian Blur on a shape layer parented to a shrinking door keeps
its screen radius — a 150 px shadow blur on a door shrunk to 190 px swamps it. Drive the radius by
the parent's scale: `base * thisLayer.parent.transform.scale[0] / 100`. Solids and footage (not
continuously rasterised) apply effects in layer space and scale on their own.

## 168. A soft glow without edges: radial ramp to black on an oversize layer in Screen

LIVE-VERIFIED 2026-09-23. A halo made as a feathered ellipse mask on a small solid showed straight
horizontal edges on the wall (the feather reached the layer bounds, quirk 140). Robust recipe: a black
solid larger than the frame, `ADBE Ramp` radial from white at the centre to black at the radius you
want, blend Screen, and squash it with a non-uniform scale for an ellipse. Black does nothing in
Screen, so the layer's own edges can never show (inside a precomp, Screen needs an opaque floor:
quirk 156).

## 169. Tidying a live project: what `usedIn` misses, and proof that no comp changed

LIVE-VERIFIED 2026-09-23 (an LED-wall show project: 1058 -> 513 items, 552 unused removed, 55 moved,
9 folders made, 2 emptied folders dropped — all in about 1 s, one undo group).

- `FootageItem.usedIn` lists comps that hold a LAYER with that source. An expression that pulls
  footage by name (`footage("data.json")`) is not a use, and removing that item breaks the
  expression. Before a purge, walk every property of every layer and collect expressions that
  contain `footage(` (1795 layers / 1253 expressions scanned in ~4 s here; none named footage).
- Removing an item that IS used deletes every layer that uses it, silently. Re-check
  `usedIn.length === 0` at execution time; never trust a list made in an earlier call.
- Address items by `id` through a map built once at the start: ids survive moves, renames and
  saves; indexes shift after every `remove()`.
- Prove it in the same call: before and after, one string per comp,
  `id|name|parentFolder.id|numLayers|layer source ids`; equal strings = nothing in any comp moved.
  Compare a fresh full inventory afterwards too (names, folders, layer counts, sizes, durations,
  the set of used footage ids, missing footage).
- Media Encoder: "Add to Media Encoder Queue" saves a reduced copy of the project to
  `<project>.aep_AME/tmpAEtoAMEProject-<comp>.aep` (4 MB copies next to a 42 MB project), and the
  queue renders those. Reorganising the main project does not touch queued renders; still keep comp
  names and folders when the user says the comps go out through the encoder.
- Emitters that find a folder by name (`folderMake("I2 archive clips")`, a project emitter helper) recreate it at the root on
  their next run: when a tidy renames or nests a folder, patch the name in the live emitters.
- "Collect Files" leaves `(Footage)/<panel folder path>/...` on disk plus `<project>Report.txt`;
  after that, panel folders and disk paths are independent — reorganising the panel needs no relink.
- Back up first: save in place, copy the `.aep` elsewhere, `cmp` the two. `app.project.save(file)`
  is Save As and would repoint the open project.

## 170. `ae.js --timeout` is in milliseconds; "CDP timeout (0s)" means units, not a modal

**See quirk 63** (the same linter false positive).

LIVE-VERIFIED 2026-09-23. `--timeout 300` failed at once with "CDP timeout (0s) — a modal dialog is
probably blocking AE", but there was no modal: the payload kept running in AE and finished (the file
it writes appeared). WRONG `--timeout 300`; RIGHT `--timeout 300000`. When the message says (0s) or
(1s), check the file/state the payload produces before calling AE again — a second call queues
behind the one still running. Separately: `lint-jsx.js` warns "last statement does not call
JSON.stringify" for every multi-line `JSON.stringify(M.run(...))` payload, because it only scans
the last three lines; the payload returns normally.

## 171. Moving a finished comp onto a bigger canvas without losing editability

LIVE-VERIFIED 2026-09-23 (AE 26, LED-wall show: ten 2048x512 comps moved into the MAIN area of a
4608x768 LED wall, 31-78 top-level layers each, glass wipes with ~70 position expressions).

- `comp.width/height` grow the canvas from the top-left; nothing moves. Add a null with anchor
  [0,0] at the region's corner ([1280,128]) and hang every top-level video layer on it with
  `layer.setParentWithJump(ctrl)` (`ctrl` = that null; exists in AE 26): unlike `layer.parent = x` it keeps the child's
  values, keys and expressions, so the content moves by exactly the null's offset and the null's
  space IS the old comp. Expressions reading other layers' `transform.position` stay consistent
  (both sides live in null space); only `thisComp.width/height`, `toComp/fromComp` and comp-space
  hard-codes in emitters (`Z.height / 2`) change meaning — grep for them first.
- Layers larger than the old frame (3136 px slides, 6400 px glass mattes, 2600 px frosted fields)
  were cropped by the old comp edge and now spill onto the neighbouring screens: put a black solid
  on top with a SUBTRACT mask of the region.
- Prove it by pixels, not by layer lists: `saveFrameToPng` the same frames before and after, crop
  the region out of the new frame, diff. Here 14 of 19 frames matched to 0-1 levels. The rest was
  real: (a) an adjustment layer that slides in from off-frame (a glass pane) is no longer clipped
  by the comp edge, so its Displacement Map is laid over the whole pane instead of the visible part —
  the rib phase differs while the pane enters or leaves (the new behaviour is the steadier one);
  (b) a dark rim at an inner edge — quirk 172.
- Per-screen render comps: one layer of the master, anchor = master centre, position =
  `[W/2 - x0, H/2 - y0]`; copy the master's fps, duration, motion-blur switch and shutter. Checked
  against a crop of the master frame: max difference 0.
- Emitters that built the old comp keep laying out in the old space; end them with a helper that
  hangs new top-level layers on the null (setParentWithJump), puts the black frame back on top and
  rebuilds the edge mirrors. Their "rebuild" loops must skip the helper layers (a glass emitter
  duplicated every layer that lasts to the end of the comp into its loop — that would have included
  the null and the black frame).
- A previz of the wall: put the per-screen comps back at their rects in a wall-sized comp (it shows
  exactly what goes out; the wall outside the screens stays black) and lay the guide comp on top.
  Guide layers of a NESTED comp do not render — duplicate the guide comp, switch `guideLayer` off
  and extend its duration and layer out points. Keep audio on ONE nested screen layer: five nested
  copies of the master sum its track five times.

## 172. Adjustment-layer effects read beyond their own bounds: mirror the region at an inner edge

LIVE-VERIFIED 2026-09-23. A frosted-glass field (adjustment layer 2600x900, Box Blur 14 x3 with
Repeat Edge Pixels on, Levels, desaturate) that was clean at the right edge of a 2048 comp showed a
dark rim (-15..-36 levels, 11 px) at the same edge once the comp was 4608 wide: the blur now pulled
in what lies beyond the region (a 14 px sliver of clip, then empty) instead of repeating edge
pixels — Repeat Edge Pixels only acts at the COMP boundary.

- Pinning the adjustment layer's own rect to the edge (anchor following position, the mask moved
  by a path expression instead) changed nothing: the effect does not read only its layer's rect.
- A white strip beyond the edge at the bottom of the stack removed the rim (-0.6): the input is
  the composite outside the layer too.
- Fix: directly under every run of adjustment layers that can reach past the region, a
  comp-sized adjustment layer with four `ADBE Mirror` effects on the region's edges — Reflection
  Angle 0 reflects left onto right, 180 right onto left, 90 top onto bottom, 270 bottom onto top.
  Effects above it see a continuation of the picture; the black frame on top hides it. Awards went
  from max 38 to max 3. Inside the region the Mirror copies pixels exactly.
- Not under an adjustment layer lying exactly on the region (static 2048x512 grade with Glow): it
  matched the old render without help, and a mirror under it added +4 levels of glow at the edges
  (the reflected highlights glow; the old comp had nothing beyond the edge).

## 173. Renaming a live project to a naming scheme: what breaks and how to prove nothing did

**See quirk 169** (mutating a collection while iterating it).

LIVE-VERIFIED 2026-09-23 (LED-wall show: 104 comps and 26 folders renamed to the client's TZ numbering,
26 comps moved, precomps regrouped by number).

- `item.name = ...` on a comp does NOT rewrite `comp("old name")` in expressions: two glass
  expressions still carried the old names after the rename and had to be rewritten (split/join on
  the exact `comp("...")` string). Scan every expression for `comp("` + each old name.
- `app.project.item(i)` is re-sorted when items are renamed or moved. A loop that moves items while
  indexing skipped one of two same-named solids. Collect the targets first, then mutate. For the
  same reason a before/after snapshot string built in item order differs after a rename even when
  nothing changed — key it by `id` (or sort it); the inventory diff by id showed 0 changes.
- Numbered folders repeat across bins after such a scheme (`00_PREVIZ/06_…`, `02_NUMBERS/06_…`,
  `03_PRECOMPS/06_…`): emitters that find a folder by name alone pick the wrong one. Look folders up
  by FULL path (`folderPathMake("03_PRECOMPS/05_Интро")`, a project emitter helper), and clean up an emitter's own precomps by
  an explicit list or a tag — not by a name prefix that the screen comps and previz now share.
- Comp names become render file names: underscores, a zero-padded number first (`07_Номер_Путь_MAIN`)
  so the panel and Explorer sort the show in running order.
- Tooling trap: `\uXXXX` typed into any tool call (a bash heredoc, the Write tool) arrives decoded as
  real Cyrillic (quirks 100, 181). Put non-ASCII values through `json.dumps` / `ensure_ascii` in the
  emitter (as it already did for its other names).

## 174. A generated "loop" that starts and stops: retime it to constant speed from its own motion profile

LIVE-VERIFIED 2026-09-23 (LED-wall show diagonal turbines, a 24 fps loop of 124 frames, first ~ last).
A generated clip whose first and last frames match is not a usable loop by that fact alone: this
fan turned exactly one blade pitch with an ease-in and an ease-out — frame-to-frame difference
0.3 at the start, ~10 in the middle, 0.25 at the end — so a plain cycle stops every 5 s (the
client: "it must move constantly, without stopping"). There is no internal loop point either (the
best inner seam was 10.5 against a normal step of 2-8).

- Profile the motion: mean abs difference of consecutive frames inside a disc around the rotor
  (the static nacelle adds only noise), minus a noise floor (~0.8 x the 3rd percentile).
- Cumulative sum, normalised to 0..1 = a lookup table "share of the turn -> source frame".
- Time remap by expression: `u = (time % PER) / PER`, binary-search the table, interpolate the
  fractional frame, `f / fps`. `layer.frameBlendingType = FrameBlendingType.FRAME_MIX` and the
  comp's frameBlending on, so the slowed middle frames blend instead of stepping. (Later: Frame Mix
  pulses, and on turbine blades both Frame Mix and Pixel Motion read as judder — quirks 181, 184.)
- PER = cycle / N with N whole turns (96.48 / 19): the show loop wraps without a jump too.
- Result, measured on 50 rendered frames across the joint: steps 1.7-2.9 (one 3.8 at the joint)
  instead of 0.25-10.6.

## 175. Emitters inside a converted comp: default positions, prefixes, string reads, scripted save

**See quirks 134 and 173** (prefix matching), **1** (an array inside a string) and **182** (the scripted save).

LIVE-VERIFIED 2026-09-23 (AE 26, LED-wall show: the award emitter rebuilding 15 screens in 4608x768 comps).

- `comp.layers.add(item)` places the layer at the CURRENT comp's centre. In the old 2048x512 comp
  that was the right spot by accident; in the 4608x768 one the award titles landed at (2304, 384)
  and, hung on the MAIN-offset null, went onto the right diagonal under the turbine. Set every
  emitted layer's position explicitly.
- Select comps by the exact name, not a prefix: `06_Награждение_14_` matched the title precomp
  `06_Награждение_14_титр` before the screen itself (quirks 134, 173).
- Concatenating an effect colour value into a string (`"x = " + prop.value`, Leave Color's
  Color To Leave) threw "invalid numeric result (divide by zero?)" and aborted the build after the
  effect was set (a colour value is an array: quirk 1). WRONG `"x = " + prop.value`; RIGHT
  `"x = " + JSON.stringify(prop.value)`.
- `app.project.save()` from a script blocked for 2 min behind a modal (the file was written when
  the user closed it). `app.project.dirty` exists in AE 26: check it, copy the saved file as the
  backup, and let the user press Ctrl+S when a save is due. (Later the scripted save worked when run in
  the background with a watch on AE's windows: quirk 182.)

## 176. Collapse Transformations on a 3D precomp of 2D layers renders it FLAT; a photo-wall camera without moving the camera

LIVE-VERIFIED 2026-09-23 (AE 26, Classic 3D; a hymn faces mosaic on the wall — 126 photo tiles).

- A precomp whose layers are all 2D, placed as a 3D layer with Collapse Transformations on, renders
  as a flat 2D layer: z position and X rotation are ignored, magnification stays 1 — although
  an expression's `toComp()` on that layer reports the full 3D projection (300 wall px -> 1030 screen px) and the
  camera's focus expression reads the right distance. Collapse OFF renders the 3D correctly, but the
  precomp is rasterised at its own size first (a 600 px tile magnified 3.4x goes soft).
  RIGHT: make the layers INSIDE the precomp 3D (`threeDLayer = true` on every tile and the background)
  and keep Collapse ON — the parent camera then renders each tile from its own 2400 px source.
- Moving a camera over a flat wall is easier inverted: keep the camera still at [cx, cy, -Z] (zoom Z)
  and drive the wall: anchor point = the wall point you want in the centre of the frame, position =
  [cx, cy, Z/m - Z] for magnification m, rotations for tilt. The anchor makes the target land in the
  centre whatever the tilt; interpolate m in log space so zooms read evenly; focus distance =
  `Z + wall.position[2]` keeps the centre tile sharp and lets depth of field blur the rest.
- Check a render, not the numbers: every property read-back here was correct while the frame was wrong.

## 177. Spreading a one-screen picture onto the neighbouring screens: 2D plates scale, a 3D camera widens

LIVE-VERIFIED 2026-09-23 (LED-wall show hymn: MAIN 2048x512 -> MAIN + both diagonals, a 3072x768 band).

- A 2D source cannot keep its scale: the outpainted 21:9 plates (3136 px) exactly filled MAIN; to fill
  the band at the same scale they would need 4704 px. Without generating more width, scale the whole
  local scene (one null: position [768, 0], scale 150 %). The cost is on MAIN: it now sees the middle
  2/3 of the band, 523/k plate px of height instead of 784/k. Re-frame per screen — a face on MAIN has
  to fit MAIN's height, a face on a diagonal the whole band — and keep the band on the plate (MAIN then
  never reaches the plate's top or bottom 130 px). A face taller than MAIN (a selfie) or at the plate's
  edge: pan to it, framed as close to its eyes as the plate allows; a bare "centre of the image"
  fallback put both faces of a portrait above MAIN.
- A 3D camera scene widens instead: keep the camera (zoom, distance, aperture) and enlarge the comp
  (2048x512 -> 3072x768), place it at 66.667 % under the 150 % null. MAIN keeps its exact old picture;
  the diagonals see more of the scene. The first try scaled everything 1.5x (zoom 3600, 3600 px hero
  textures) — MAIN became a 1.5x tighter crop that cut the faces the old frame held.
- Then check the widest shot: at magnification 0.27 the 3072 px band sees 11378 wall px, more than
  the 8760 px wall. Add columns outside the old grid (3 each side) and fill only them, so MAIN's
  neighbours stay where they were.

## 178. A clean "ink drawing" from a photo; light lines over a photo from inside a precomp; smooth multi-phase scale

LIVE-VERIFIED 2026-09-23 (LED-wall show intro v3, AE 26).

- Find Edges on an archive-style photo traces every brick and every grain and, on a moving clip,
  the lines crawl: the client called it "dirty". Cartoon (`ADBE Cartoonify`) with Render = Edges
  smooths the picture first and keeps only the structure: `-0001` = 2 (edges), `-0002` detail
  radius 10, `-0003` detail threshold 30, `-0009` edge threshold 2.0, `-0010` width 1.1,
  `-0011` softness 55, then Invert and Tint for light lines. A median before Find Edges also cleans
  up but leaves the lines broken. Freeze the frame for the drawing phase (a constant time-remap
  expression equal to the frame the photo develops from): a drawing does not move.
- Line drawings inside a precomp that sits over a photo: Screen inside the precomp has nothing under
  it and composites as Normal (quirk #156), so the black paper of an inverted scan darkens the whole
  photo. Key the paper out instead: Shift Channels, Take Alpha From = Luminance (`property(1)` = 5),
  then Tint to the ink colour. The lines stay, the paper is transparent, and the layer stays Normal.
  Unmasked layers only (quirk 181.3).
- Effect property INDEX is not the matchName number. `ADBE Unsharp Mask2` `property(1)` is Color
  Mode (0..1, `-0004`); Amount is `-0001` (index 2). Set effect values by matchName (quirks 126, 130):
  WRONG `fx.property(1).setValue(v)`; RIGHT `fx.property("ADBE Unsharp Mask2-0001").setValue(v)`. (Levels:
  `-0005` gamma, `-0006` Output Black, `-0007` Output White — see quirk 130; writing
  "darker" into `-0006` lifts the blacks instead.)
- A portal that sweeps in, holds and flies back: the old arch summed three eased phases and then ran
  a separate tail — the speed jumped where the tail began, which the client saw as jitter. One curve
  over the whole life (sweep in -> hold -> fly back -> fade) in log scale, through 4 keys with
  Fritsch-Carlson (PCHIP) tangents, evaluated as a cubic Hermite in the expression: continuous speed,
  monotone (no overshoot). Check it numerically: sample `valueAtTime` every 0.02 s and look at the
  first and second differences of log(scale).
- Grading black-and-white footage: its colour IS the tint. Lowering the tint amount to "let colour
  through" lowered the saturation (chroma 15 -> 9.7). Measure colourfulness as mean(max - min) of
  RGB, not HSV saturation (HSV S is large on dark grey pixels).

## 179. Growing a live wall to a taller screen (4608x768 -> 4608x896): what moves, what doesn't, what shows up

**See quirks 140** (the same glow solid) **and 183** (`replaceSource` scales anchor and masks).

LIVE-VERIFIED 2026-09-23 evening (LED-wall show, 26 masters, 96 screen comps; MAIN 2048x512 -> 2048x896, the other
screens re-centred at y 64..832).

- 2D numbers: a null with anchor = the OLD wall centre, position = the NEW centre, scale = new/old height,
  and every top-level video layer `L.setParentWithJump(ctrl)` (`ctrl` = that null) — the layers keep their values, so they stay
  editable exactly as before. Skip sound layers, cameras and (in a camera comp) the 3D layers.
- A camera comp needs no translation: a two-node camera projects its point of interest to the CURRENT comp
  centre, so making the comp taller re-centres the 3D scene by itself. Scale it with the zoom (x new/old);
  a 2D parent null would scale the camera's x/y position and bend the perspective instead.
- A y-scaled adjustment layer does NOT resample what lies under it: 1-px lines under a Levels adjustment
  at scale [100, 175] kept std 124.0 vs 124.1 outside. Stretching glass panes, grades and vignettes
  (scale y only; their masks follow) to the taller screen is safe; so is a Displacement Map on it.
- A shared solid (the black frame of every converted comp) cannot be resized in place — replace it with a
  new solid of the new size and give it its mask in comp px (anything that reads the hole from the mask
  vertices reads layer px).
- The taller window shows MORE OF EVERY CLIP: the client's generated splash poster had its own logo row
  and a baked-in "С ДНЁМ ПРЕДПРИЯТИЯ!" title above and below the 512-px strip — both appeared, the title
  cut by the new bottom edge, and on the award screens the title does not belong at all. Before growing a
  screen, look at the full frame of every clip that is cropped by it.
  Fix used ("то, что было обрезано, не должно попадать в кадр, можно крупнее"): measure the clean band
  between the baked elements in the SOURCE frame (here rows 296..874 of a 1228-px poster), scale the clip
  until that band fills the new height (101 % -> 155 %), and scale only the clip's root layers (the client
  had parented the enter clips to the hold clip; its stop-frame copies hung on the null and needed the
  same transform). Then check the hero's margin on renders across the whole loop: a colour threshold put
  the emblem's edge at x 243 when its dark edge was at 194, and the enter animation carries it further left
  than the hold. Scale the text column as a group on a pivot null (per-screen fit to the edge margin) so
  the title keeps its weight next to the bigger picture.
- A taller window also uncovers CUTS that used to sit on the old screen edge: the client's white glow was
  a 2048x512 solid whose mask feather (187 px) ran past its top edge — hidden while that edge was the top of
  the 512 strip, a hard line (-36 levels) inside the 896 MAIN. Pad such solids (+300 px each side via `replaceSource`, then set the anchor
  and mask vertices shifted by the same amount — `replaceSource` scales them, quirk 183) so every
  feather ends inside its layer.

## 180. A thinner cut than the font family has; a loop made longer in place; `M.exprErrors` without `M.use`

**See quirks 146** (`M.exprErrors` without `M.use`) **and 147** (client hand edits).

LIVE-VERIFIED 2026-09-24 (LED-wall show pre-show: 60 -> 180 s loop plus a slogan "тонким шрифтом" in Tektur).

- **Thinner than the lightest weight.** Tektur stops at wght 400 (stem 7 px on a 50 px cap = 0.14, a Regular).
  WRONG: a negative Offset Paths (`ADBE Vector Filter - Offset`) in every letter group. Letters without counters
  (С Н Л И М Е) thin nicely, but О А Д Р В З Ь come out SOLID: AE offsets each closed path on its own and the
  counter stops cutting the fill. The client caught it on the first look ("с багами").
  RIGHT: thin the outline before it reaches AE. Flatten the glyph contours (~1.2 px steps), find each ring's ink
  side from its nesting depth and signed area, move every edge by d toward the ink, mitre the joins (bevel past
  4d), then apply the skew and send straight segments (a project-side `tektur_thin.py`). At 80 px with d = 1.8 px:
  stem 3 px on a 56 px cap (a Light), counters open, chamfers intact. Preview it with a PIL XOR fill (one
  polygon mask per ring, XOR = even-odd) before spending an AE build.
- **Thin display type: no glow, Normal blend.** Glow 26 px at 0.45 around 3-px strokes read as "не резко"; Add
  over a dark bed also softens the edge. Keep the defocus only on the way in and out (blur 12 -> 0, back to 8).
- **Make a loop longer IN PLACE when the comp carries the client's hand edits.** Here: his own precomp chain
  looped at 60 s and a disabled layer; the old emitter would have rebuilt the comp from scratch.
  - Everything periodic must close on the new period T. Camera, focus and particles become sums of harmonics
    n·2π/T with integer n; use n >= 3 so the path does not come back every minute.
  - A footage loop of length d gets a whole number of passes: k = round(T/d)·d/T, time remap `(time * k) % d`.
    Here the speed changed by +0.46 %.
  - The client's precomp keeps its own period via time remap `time % 60`.
  - A single 20-s light sweep becomes eight passes with uneven gaps, in both directions.
  - Reschedule the appearances over the whole T and check them every 0.25 s across the wrap: a minimum count
    on screen, no two centres closer than 700 px, one sheet never twice at once. Relax the minimum only where
    a title needs the centre clear.
  - Seam check: last frame -> frame 0 differed by 0.25 levels, a normal frame step by 0.17.
- **Screen comps built at the master's duration:** extend them in place (comp duration, work area 0..T, layer
  in/out 0..T) instead of rerunning the rebuild of all of them. The rebuild deletes the comps, and with them any
  render-queue items that point at them.
- **`M.exprErrors()` walks `M.comp`.** In a payload that never called `M.use(comp)` it throws
  `TypeError: null is not an object` under the step name of the last `M.step`, so that step looks broken.
  Everything before it had been applied. The error line counts from the start of the COMBINED script:
  es-json + tokens + cloudru-motion = 1131 lines in front of the payload, so line 910 = lib line 716
  (`M.comp.numLayers`). Subtract the prelude lengths before hunting in the payload.

## 181. A number re-cut from chained generations: joins, reversals, a hero at the frame edge, five AE traps

**See quirks 12 and 18** (ease arity), **147** (client hand edits) **and 169** (mutating a collection while
iterating it).

LIVE-VERIFIED 2026-09-24 (LED-wall show, a 227 s number: dark space -> clock -> galaxy -> Da Vinci
in a golden ring -> the ring turns into a turbine; the client's Seedance clips plus AE-built transitions).

- **Measure the joins before planning.** Clips generated from first/last-frame anchors chain frame to frame.
  Diff the first and last frames of every pair (small, grey): the same frame measured 0.5-3.8 levels, a
  foreign one ~40.
  - Cut on those joins; no dissolves are needed.
  - A clip whose first frame equals its last loops with `time % d`.
  - A clip that ends elsewhere (8 levels here) plays forward and then back, which returns it to its anchor.
  - Calibrate against motion. Fast shots and fine textures differ 15-24 levels between NEIGHBOURING frames
    (rails, a head-on train, chainmail). So compare a join with the clip's own frame step on both sides:
    up to ~1x is a clean join, 1.2x needs a 0.2 s dissolve, 1.5-3x needs 0.25-0.5 s. Chainmail joins made
    from the same still kept the composition but got new rings, measuring 39 against steps of 7-24. The
    generation agent's "seamless loop" claims were only true in this relative sense.
  - Cutting loops to the bars: pick each shot's source phase so a shot shorter than the loop never wraps,
    and rotate its opening phase so the same shot does not open on the same frame. A longer shot wraps in its
    middle, never next to a cut: a wrap 0.2 s after a hard cut reads as a stutter. The last shot before a
    frame-matched exit ends exactly on the clip's last frame.
- **A generated transition played backwards is a new transition.** "Da Vinci -> galaxy" reversed became
  "galaxy -> the ring forms". Its hero changes size inside the source (ring radius ~905 px at 4 s, 527 at
  1.9 s, 413 at 0), so a portal mask on a fixed curve cut the ring off. Key the mask to the hero's measured
  size at each source second, a little wider than hero plus glow.
  - Hold the reversed clip at the backdrop's cover scale until the move starts, so the cut in is seamless
    and the frame edges never show.
  - Do the whole fly-in inside one bar, landing on the downbeat.
- **A hero tight against the source frame edge.** Here the ring top sits 16 px under the frame top and its
  glow is cut there. No mask hides that without dimming the ring. Scale the layer so the source's cut edge
  lands exactly on the screen's physical edge: 448 - 429 * s = 0, so s = 104.43 %.
- **No Twirl on an adjustment layer over a 5:1 wall.** It pulls the empty space above and below the comp into
  the picture as black crescents. For a rush between scenes use:
  - over-scaled layers (135 % over cover), turned no more than 10° so they still cover;
  - a ZOOM-type Radial Blur, which samples toward the centre. Spin samples along arcs that leave the frame.
- **Traps:**
  1. Removing EVERY Time Remapping key switches remapping off. The next `setValueAtTime` throws "the property
     or a parent property is hidden". Add your keys first, then delete the default ones.
  2. Levels (`ADBE Easy Levels2`) parameters take neither keys ("canVaryOverTime is false") nor expressions
     in AE 26; static values still work. Animate brightness with Brightness & Contrast 2 (`property(1)`).
  3. Shift Channels "alpha from luminance" rewrites alpha AFTER the masks. The masked-out black, inverted,
     turned white and filled the frame. For ink over a picture, push the paper to white with Levels and
     use Multiply.
  4. Removing mask 1 of [Add circle, Intersect rect] leaves the Intersect first. A new Add mask then unions
     with the rect, which is the whole frame. Clear all masks before re-masking.
  5. In a loop that removes items by name, `break` after `remove()`. The next name check throws "Object is
     invalid".
- **The agent's Write tool decodes `\uXXXX` in file contents into real characters.** Inside a string that
  only warns; in a regex literal the lint rejects it ("non-ASCII in code"). Match Cyrillic names with
  strings and `indexOf`, or emit the JSX from Python with `ensure_ascii`.
- **Smoothness, the second round.** The client's note was "не хватает изингов и плавности".
  - WRONG: an `ease()` helper passing `value.length` eases (3 for a 2D layer's Scale, which wants 2) inside a
    silent `try/catch`. Every scale move of the film stayed linear and nobody saw an error.
  - RIGHT: set BEZIER interpolation first, try arities [n, 2, 1, 3], and COUNT failures into the result
    (`easeFail: 0`).
  - No ping-pong: a clip that does not return to its anchor dissolves into the next one; nothing plays
    backwards.
  - Joins: key the time remap at half speed into and out of each seam (`KeyframeEase(speed, 30)`, not 0).
  - When the next clip moves faster (7x here), hold its anchor frame under a 0.35 s fade and start it from
    almost still (speed 0.03, influence 75 %).
  - Measure smoothness: the mean frame-to-frame difference over +/-20 frames. A spike is a jump.
  - Slow motion from 24 fps generations: Frame Mix at 0.72x pulsed every ~3 frames (std/mean of the steps
    ~0.35); Pixel Motion gave 0.07 with no warping on particles or thin clock hands.
  - A turbine that appears spins up rather than starting at speed: time remap
    `t < R ? t*t/(2R) : t - R/2`.
- **A seamless loop carrying a long shot** (the finale's birds, 2 x 9.93 s at 0.51x; the loop's last frame
  measured 0.97 against its first, the frame step ~1.5).
  - Butt-join the passes with no dissolve and remap each one 0 -> the FULL duration. Stopping at `duration - 0.07`
    skips the last frame and jumps.
  - Split one push-in across the passes with LINEAR keys, 100 -> 103 -> 106 %. Eased keys per pass stop the
    move dead at every wrap, which reads as a hiccup.
  - Measured: the step across the wrap was 0.55 levels against 0.05-0.26 around it, which is invisible on a
    sky. The last source frame holds for about 4 comp frames at 50 fps before the wrap.
- **Rebuild scripts must not delete what the user added.** A "clean everything that is not mine" step is fine
  on the first run. From then on, remove only the layers found in the v1 backup comp, and report any others as
  `kept`. Also duplicate the current state into `_OLD` before each client-driven rebuild (`snap`, a project helper).

## 182. Solo as a render accelerator, and its trap; aerender and memory for an unattended re-render with sound

LIVE-VERIFIED 2026-09-24 (LED-wall show: six 4608x896 numbers re-rendered with their music, run remotely, the user away).

- **The user's speed trick.** A number already rendered to a movie goes back into its master as layer 1 with
  **Solo** on. AE then renders only soloed layers of that kind, so the live stack underneath (dozens of clips,
  Pixel Motion, nested comps) costs nothing.
  - An opaque full-frame layer on top alone did not speed the render; Solo did. Do not also "switch off
    the covered layers": that repeats what Solo already does.
- **The trap: layers added to a comp that already has soloed layers come in soloed** (`layers.add` returned
  `solo == true`).
  - The new layers render, but the client's clip that they dissolved into was not soloed: the dissolve went
    to black. Capture the edited range before rendering; `saveFrameToPng` respects Solo, so it shows this.
  - RIGHT: when editing a soloed master, solo every layer the edited range needs. Move the pre-render's
    in-point to the end of the edited range, where its frames equal the live ones. Check that step: a hold/change
    pattern of the 24 fps source at 50 fps (~0.07 / ~9.7 levels) is normal, a mismatch is not.
  - `layer.solo = true` on a disabled layer throws "Solo flag can not be set on a layer if the layer is not
    enabled". Unsolo before disabling a layer, and solo only enabled ones.
- **Music in a soloed master.** Solo is per layer type: soloing the music layer mutes the clips' own audio.
  Still set `audioEnabled = false` on the clips, so the mix does not depend on the Solo state.
- **aerender 26.3** (run it under a watchdog: `led-wall-pipeline.md` §17):
  - `-s/-e` take comp frames; `-close DO_NOT_SAVE_CHANGES`; it renders the SAVED file.
  - OM «H.264 - Match Render Settings - 15 Mbps» writes AAC 48 kHz stereo from the comp's audio plus H.264 VBR.
    A 3 s test averaged ~17 Mbps.
  - Timing: ~25 s to start, then the render, then ~30 s of finalising after the last PROGRESS line. Exit code 0.
    Judge success by ffprobe duration plus an audio stream, not by the exit code. Finalising can also hang
    (quirk 184).
- **Memory before a second AE instance.** After a capture-heavy session the GUI AE held 69.7 GB, with 11 GB
  free. `app.purge(PurgeTarget.IMAGE_CACHES)` brought it to 8 GB (73 GB free) without touching the project
  or undo. Purge before every aerender batch.
- **Scripted save.** `app.project.save()` over the bridge took 2 s this time (quirk 175 had hung behind a modal).
  Run it as a background call and watch AE's windows from outside the bridge (a small Win32/UIA script that lists
  AfterFX's top-level windows and closes a dialog) in case a dialog appears. A `.ps1` with Cyrillic must be UTF-8
  **with BOM**: Windows PowerShell 5.1 reads BOM-less files as ANSI and the parser breaks.

## 183. A slowed clip went blank past its source length (cause not isolated); Hue/Sat refuses keys; looped footage; a stale effect

LIVE-VERIFIED 2026-09-24 (LED-wall show, a finale: a 5.17 s sky clip slowed to fill a 27.3 s turbine core).

- **A slowed clip that vanished halfway.** It rendered at 2-5 s and showed nothing from 5.2 s on, which is the
  source's own length, although the layer read back `outPoint` 27.29, `activeAtTime(10) == true`,
  opacity 100, and the remap expression returned 1.86 s. Frame blending off and effects off changed nothing.
  - WRONG: `L.parent = P; L.inPoint = 0; L.outPoint = 27.29; L.timeRemapEnabled = true;` then
    `Time Remap.expression = "time * d / 27.29"`.
  - RIGHT: `L.timeRemapEnabled = true` FIRST, then in/out, then two LINEAR keys over the whole life
    (`setValueAtTime(0, 0)`, `setValueAtTime(27.29, d)`), and delete the default key at the source's end AFTER
    adding yours (quirk 181.1). Verified by capture at 6, 10, 18 and 25 s.
  - Check a stretched remap by CAPTURING a frame past the source's end. Read-backs do not show this.
  - The fix changed several things at once (the flag order, keys instead of the expression). Quirks 133,
    174 and 180 had remap expressions past the source length that rendered fine: treat the order as a
    precaution and the capture as the test.
- **Hue/Saturation's master params take no keys either** (Levels: quirk 181.2). In AE 26 `canVaryOverTime` is
  false for Master Hue / Saturation / Lightness and Channel Control; the Colorize params are keyable.
  To fade a grade over time, key the effect's own mix:
  `fx.property("ADBE Effect Built In Params").property("ADBE Effect Mask Opacity")` (Compositing Options →
  Effect Opacity), 100 → 0.
- **Looped footage.** A FootageItem interpreted with Loop 100x reports `source.duration` = 100 × the clip
  (1004 s for a 10 s turbine). A wrap expression `time % source.duration` is then a no-op, and the footage's
  own loop does the looping. Read `mainSource.loop` before writing a loop expression.
  - To find a clean loop period, compare frames with a mean absolute difference. Here frame 240 ≈ frame 0
    (1.7 vs 3-4 between neighbours), so the period is 240 frames = `duration - frameDuration`.
  - Both cuts of the sky clip (the take and its `loop` version) jump at their loop point (30 vs ~1.8). For a long
    hold, use ONE slow pass instead of looping.
- **Stale effect references, again (quirk 3).** `var lv = parade.addProperty("ADBE Easy Levels2")`, then
  adding two more effects, then `lv.property(...)` threw "Object is invalid". Fetch each effect again by
  match name after the last `addProperty`.
- **Parenting to a scaled parent** (quirk 29, `.parent` keeps the world transform) also rescales the child: a
  rim ring parented to a turbine keyed 225 → 1250 % came out at 8 %, a small grey ring in the middle of the sky.
  Set Scale explicitly after `.parent`, like Position.
- **`replaceSource` onto a source of another size SCALES the layer's anchor and mask vertices** by the size
  ratio. A mirrored centre extension (3072-wide comp → the 4608-wide pre-render) moved from anchor 3072 to
  4608 and slid off the wing, where only black showed. Read anchor and masks from the ORIGINAL layer, then
  set them after the swap.
  - **What exactly it scales** (LIVE-VERIFIED 2026-10-09, temp comp, 3168 → 6336 source):
    - It scales the anchor (1000,500 → 2000,1000) and the mask vertices (100…900 → 200…1800).
    - It leaves mask feather (40), mask expansion (10) and Scale (100) alone.
    - To swap footage for an upscale with the same framing, set Scale × old/new and feather and expansion ×
      new/old by hand. Do NOT rescale the vertices: a script that did ended up with ×4 masks.
    - WRONG: `L.replaceSource(big); ms.setValue(scaleShape(ms.value, 2))`.
    - RIGHT: remember vertex 0 before the swap; after it, rescale only if the vertex did not move.
  - The pattern worked: a words-free copy of the wings over a soloed pre-render, only where the words were.
    The side stack (floor, the mirrored centre taken from the pre-render itself, the wings) went into its own
    comp via `copyToComp`, used as 4 short soloed layers masked to the side screens. It matched the pre-render
    at 2.1-2.6 mean abs diff, the same as the decoder baseline on MAIN (2.0).
- **A save while aerender instances run** can raise the modal "Could not rename the file ...Prefs-indep-
  composition.<pid>.<n>.txt". The bridge call times out, but the save itself had finished (check the file time).
  Screenshot the dialog with `PrintWindow`: UIA reads no text in AE's dialogs. Then close it from outside with
  Enter or `WM_CLOSE`.

## 184. aerender at scale: a finalisation hang and a watchdog that sees it, a 25 fps template from a script, the GPU switch, shared layers rendered once

LIVE-VERIFIED 2026-09-24/25 (LED-wall show delivery: 26 walls of 4608x896 and 66 screen files, an unattended
night, then a fixed deadline).

- **A night that died: what the logs show and what they do not.** Three aerender instances (~19-25 GB each), the
  GUI AE, a browser upload and video encodes ran at the same time.
  - From ~21:10 no process could start: every agent tool call failed with `EPERM: operation not permitted,
    uv_spawn`, and from 22:00 the System log shows services failing with "Access is denied". At 00:25 Tcpip 4231
    reported the ephemeral TCP ports exhausted. In the morning the PC needed a hard reset (Kernel-Power 41).
  - There is no Resource-Exhaustion event, and 10-17 GB of RAM were free in the hour before, so it was not a
    plain RAM shortage. The cause is not established. The next day a VPN client held 150+ bound sockets: check the
    socket count (`Get-NetTCPConnection`) before a long unattended run.
  - Three renders printed their LAST frame, hung 20-30 min in finalisation until
    `After Effects warning: Failed to write XMP metadata`, and then hung for hours. The movies were complete: all
    frames, full duration.
  - Precaution (the cause is unknown): do not stack loads. At most 2 aerender instances next to the GUI AE on a 94 GB machine, GUI caches
    purged, no uploads or encodes during the peak. Keep the queue resumable (outputs that exist are skipped) and
    judge files, not exit codes, so the next session can take over where the night stopped.
- **Watchdog trap.** A hung aerender keeps printing the same `PROGRESS: 0:01:36:23 (4824)` line every minute, so
  "time since the last PROGRESS line" never fires.
  - RIGHT: count only a NEW frame number as progress.
  - On a stall after the last frame, ffprobe the output. If its duration = frames / render fps, accept the file and
    kill the process tree instead of re-rendering.
- **A 25 fps render template for aerender, from a script.**
  - `rq.setSettings({"Use this frame rate": 25})` flips "Frame Rate" to "Use this frame rate" by itself.
    Passing `{"Frame Rate": "Use this frame rate"}` throws "Invalid Value".
  - Then `rq.saveAsTemplate("Best 25fps")`, `rq.remove()` and `app.preferences.saveToDisk()`: without the last
    call aerender cannot see the template.
  - `aerender -RStemplate "Best 25fps"` with the OM "Match Render Settings" then writes 25/1 H.264, and the
    PROGRESS frame numbers count 25 fps frames.
- **The project's renderer is a project setting, and aerender honours it.** `app.project.gpuAccelType` was
  SOFTWARE (1816) and the GPU sat at 2-10 %. Set `GpuAccelType.CUDA` (1813; check `app.availableGPUAccelTypes`),
  save, then queue, and restore the user's setting afterwards. Measured on MAIN-only award renders of 2412 frames
  at 25 fps, each next to a second render: 13.6 min on Software, 9.3-9.6 min on CUDA.
- **Render the unique part once per master, the shared part once per show.** The award diagonals (a 2048²
  footage retimed by a LUT expression with Pixel Motion) cost most of every award render. With them disabled, a
  96.48 s splash fell from 47.5 min (4824 frames at 50 fps, 0.59 s a frame) to 2.4 min (2412 frames at 25 fps,
  0.06 s a frame).
  - Render MAIN only, with the shared layers disabled and a marker appended to their `comment`, so a script can
    re-enable exactly those afterwards.
  - Build the shared picture once and compose each wall in ffmpeg: overlay at the screen origins, `hflip` for the
    mirrored side. Recipe: `led-wall-pipeline.md` §17.
- **ffmpeg limits for walls.** `h264_nvenc` refuses frames wider than 4096 ("Could not open encoder … Invalid
  argument"). Encode the 4608-wide walls with libx264 (`-preset faster`, 15M) and the screens (≤ 2048) with NVENC.
  `fps=25` on a 50 fps render drops every other frame exactly.
- **Repeating blades judder under any retime: play the loop at its own speed.**
  - On the diagonals' turbine, Frame Mix stepped unevenly (steps alternating 1.2 / 2.6). Pixel Motion measured
    smooth (the frame-step spread fell to 0.09), yet on the wall the client still saw judder («дрожит»). A
    step-size metric does not see motion-estimation artefacts. Repeating blades are the worst case for them:
    every blade looks like its neighbour, so the vectors can match the wrong one.
  - RIGHT: no retime and no frame blending. For a 24 fps loop in a 25 fps render, set stretch 96 %, frame
    blending off and time remap off, so each output frame is one source frame and the loop plays 4 % fast. The
    footage item itself does the repeating: interpret it with Loop N× (`mainSource.loop`, quirk 183) so the
    layer covers the whole comp. The ffmpeg equivalent is `-stream_loop -1 -i loop.mp4 -vf "setpts=N/(25*TB)" -r 25`.

## 185. Dynamic Link to Premiere: guide layers, their audio, unsaved edits, a second AE

LIVE-VERIFIED 2026-09-25 (AE 26.3 + Premiere 26.3.2; a spike: three labelled test clips cut into an 18 s sequence,
graphics comps linked back). The Premiere half of the round trip (import, placement, export, the traps on that
side) is in premiere-autopilot `references/after-effects-link.md`.

- **Guide layers stay out of the picture.** A magenta guide solid and the edit's plate as a guide layer were absent
  from Premiere's export of the linked comp, and absent from `comp.saveFrameToPng` too. So the edit can live inside
  every graphics comp as a guide layer: the designer sees the shot, Premiere gets only the graphics with alpha.
- **Their audio does not.** With the plate as a guide layer and `audioEnabled` left on, Premiere put the comp's
  audio on A2 under the V2 clip, and the export measured -18.07 dB RMS under the graphic against -24.11 dB
  elsewhere: +6.0 dB, the dialogue doubled.
  - WRONG: `L.guideLayer = true;`
  - RIGHT: `L.guideLayer = true; L.audioEnabled = false;` for every reference layer in a comp that goes to Premiere.
- **Linked audio is conformed once and never refreshed.** Premiere writes `<aep name> <comp>.aep 48000.cfa/.pek`
  next to the .aep. Turning the guide's audio off afterwards did not change the export: not unsaved, not after a
  save (still -18.07 dB). Only removing the audio track item in Premiere fixed it (-24.09 dB). So give a linked comp
  no audio from the start.
- **Unsaved edits reach Premiere, from the project that is open in the GUI.** A text change made over the bridge and
  NOT saved was in Premiere's next export. A comp from an .aep that is not open in the GUI came from the SAVED file:
  Dynamic Link started a second, headless `AfterFX.exe` (~3.2 GB) to serve it and left it running.
- **Cost.** Premiere's export of an 18 s sequence with 11 s of linked graphics took 13.7 s against 1.9 s without
  them. A re-export with unchanged comps took 3-4.5 s: Premiere caches the linked frames and re-renders what changed.
- **A comp that grows.** `comp.duration` 4 -> 5 s, saved: Premiere's project item still reported `getOutPoint()` = 4,
  a re-import made a duplicate item (also "4"), yet a freshly placed clip ran 5 s and the old track item could be
  extended to 5 s (outPoint, then end). Design comps at their final length; if one grows, extend the track item.

## 186. Graphics over an edit: the edit as a guide plate, slots on the frame grid, QA in a preview comp

LIVE-VERIFIED 2026-09-25 (same spike as 185).

- **The plate.** Premiere renders the sequence to `plate/<seq>_plate.mov` (18 s in 1.9 s, frame-exact at both cuts).
  Import it once. Each graphic gets its own comp at the sequence size and fps, one comp per graphic, lasting the
  slot. Add the plate as a guide layer with `startTime = -slotStart`, so comp time 0 is the slot's first frame and
  the shot under the graphic is the right one. Turn its audio off (185).
- **Slots on the frame grid.** A marker at 6.5 s at 25 fps is frame 162.5. Premiere's `overwriteClip(item, 6.5)`
  landed on frame 163 (6.52 s, rounded up), while an AE layer took `startTime = 6.5` as given. The two apps then
  differ by half a frame, and keyframes evaluate between frames. RIGHT: convert every slot to whole frames first:
  `f = Math.round(sec * fps)`, AE `f / fps`, Premiere ticks `f * (254016000000 / fps)`.
- **QA needs a comp where the plate is NOT a guide.** `saveFrameToPng` drops guide layers, so a capture of a
  graphics comp shows the graphic on transparency. Build `PREVIEW_<seq>` with the plate as a normal layer and the
  graphics comps nested at their slot starts. A guide layer inside a precomp does not render in the parent, so
  nothing doubles. Captures at 0.48 / 2.0 / 4.8 / 8.0 / 13.0 s matched the plate time exactly (2.0 s showed
  "A 00:00:04.000", clip A starting at 2 s). Premiere's linked render of the same frame came out at PSNR 34.4 dB
  against the AE capture: the difference is H.264 compression only.

## 187. `CR.FONT.SEMIBOLD` is not a real PostScript name: SemiBold text renders in Times

LIVE-VERIFIED 2026-09-25. `brand/cloudru-motion-tokens.json` (and so `CR.FONT.SEMIBOLD`, `ae-mock.js`,
`lib.test.js`) says `SBSansDisplay-SemiBold`. The installed font's PostScript name is `SBSansDisplay-Semibold`,
lower-case b, as quirk 80 and `deck.py`/`figspec.py` already use. `M.text(..., {font: CR.FONT.SEMIBOLD})` set a
lower third in a serif, and `M.text` raised no warning, because AE echoes any name back (quirk 80).

- On AE 26.3 the phantom font is visible to a script: `app.fonts.getFontsByPostScriptName("SBSansDisplay-SemiBold")[0]`
  reports family `SBSansDisplay` and location `C:\Windows\Fonts\times.ttf`, where the real name reports family
  `SB Sans Display` and its own `.otf`. That is a cheap real-font check: a location that is not the font's own file
  means a substitute.
- On AE 26.3 `app.fonts.allFonts` is an array of families, each an array of font objects, and `postScriptName` /
  `styleName` read fine on the inner objects (quirk 80 saw `undefined` one level up). After the bad name had been
  used once, the list held both `SBSansDisplay-Semibold` and the phantom `SBSansDisplay-SemiBold`.
- Fixed 2026-09-25: the token, the mock and `lib.test.js` use `SBSansDisplay-Semibold`; in the live AE
  `app.fonts.getFontsByPostScriptName(CR.FONT.SEMIBOLD)[0].location` read back `...\SBSansDisplay-SemiBold.otf`.

## 188. AE holds every imported footage file open, so a re-render cannot replace the plate

LIVE-VERIFIED 2026-09-25 (the spike of 185, after a re-edit).

- **The re-render failed before it started.** After a cut, Premiere was to render the new plate over `plate.mov`.
  Moving the old file aside failed with `EBUSY`. The Windows Restart Manager (`RmGetList`, no admin rights
  needed) named one holder: the AE window with the graphics project open. The headless Dynamic Link AE did not
  hold the file.
- **`FootageItem.replace(new File(other))` lets go at once.** Right after the replace, nothing held `plate.mov`,
  and AE held the new file.
- **So a live build alternates between two files.**
  - Premiere renders to `plate.b.mov` whenever `plate.mov` is held (premiere-autopilot `prexport.freePath`).
    The plan then names that file.
  - `gfx-build.js` switches the `PLATE` item to the file the plan names, and reports `switchedFrom`.
  - `--refresh-plate` reloads the same file after it was re-rendered in place.
- The same holds for any footage a script re-renders while AE has it imported: write to a new name, then
  `replace()`.

## 189. Figma MCP: replies over ~20 KB break the transport, and Cyrillic costs 6–12× in them

LIVE-VERIFIED 2026-09-28 (a storyboard dump for §5f).

- **Symptom.** `get_metadata` / `get_design_context` / `use_figma` fail with `Failed to parse SSE message … EOF while
  parsing a string at line 1 column 20xxx`. Nothing is wrong with the call: the reply is longer than the client
  reads in one SSE message.
- **Cyrillic makes it worse.** Layer names and texts travel as `\uXXXX` escapes inside JSON inside JSON: a 6 KB
  dump of a Russian frame arrived as > 21 KB. `txt.slice(0, 6000)` did not help.
- **RIGHT:** `use_figma` read-only scripts that return ASCII only — transliterate names/characters (a 33-letter map),
  one frame per call, skip repeated chrome. Exact texts: read them off the render or ask for one node at a time.
- `get_screenshot` returns a short-lived URL (fine at any size); it never upscales past 1:1 — use
  `download_assets(defaultScale = …)` for delivery-scale references.

## 190. A Figma LINE paints its CENTER stroke over [y − weight, y]; a VECTOR line is centred

LIVE-VERIFIED 2026-09-28 against renders of the same storyboard.

- **Measured.** LINE at y 1053, 2 px, CENTER → ink rows 1051–1052. LINE at y 1139, 7 px → rows 1132–1138. So the
  whole stroke sits above the node's y (on its local −y side, which rotates with the node: a −135° diagonal is
  shifted by (+0.71, +0.71) px, a +135° one by (−0.71, +0.71)).
- **A VECTOR drawn as a straight line with the same stroke is centred** ([y − 3.5, y + 3.5]).
- **The same layer can change type between storyboard frames** (a strike-through was a LINE in one frame and a
  VECTOR in the next): check `type` per frame; `fig.js` `hline` = LINE; the strike component takes a `yo` offset.

## 191. Chrome does not put the baseline where the font metrics say; measure it

LIVE-VERIFIED 2026-09-28 (SB Sans Display / Text, Chrome 153, Windows).

- **Figma:** baseline = line top + (L − (asc + desc)·S)/2 + asc·S with the exact hhea metrics — every storyboard
  text matched this to ±0.2 px (auto-height and fixed boxes alike; CAP-trimmed boxes start at the cap top).
- **Chrome (LayoutNG) rounds ascent and descent to whole px and floors the half-leading** — the same CSS
  (`line-height: 116.619px`) put SB Sans Text 106 px 0.94 px higher, 171 px 0.99 px higher.
- **WRONG:** trusting the formula; also splitting the offset between `top` and `transform` — Chrome rounds layout
  offsets and glyph baselines separately, identical Figma baselines came out 0.2 or 0.8 px off.
- **RIGHT (`fig.js` text):** a zero-height `inline-block` with `vertical-align: baseline` inserted before the first
  character; `(marker.top − box.top) / stageScale` = Chrome's first baseline; place the glyph box so it lands on
  Figma's; layout at left/top 0, all fractions in `transform`. Result ±0.2 px on every text.

## 192. Light-on-dark browser text renders ~10 % heavier than Figma; greyscale AA is not the default either

LIVE-VERIFIED 2026-09-28.

- Headless Chrome on Windows anti-aliases with ClearType (colour fringes) — `--disable-lcd-text` is mandatory for
  Figma comparisons (and looks right on LED walls/DOOH too).
- Even greyscale, white/green-on-ink text measured ink mass 1.11 / 1.04 vs Figma (dark-on-green: 0.98–1.01).
  `--text-contrast` / `--text-gamma` changed nothing.
- **RIGHT:** export those TEXT nodes as SVG (`download_assets(defaultFormat 'svg')`) and draw Figma's outlines
  (`html/figma/extract_outlines.py`, `Fig.text({ outline })`): ink mass 0.996–1.000. Keep live text where it
  matches (dark on light) — outlines are not editable.

## 193. Render delivery sizes with a device scale factor, not a CSS scale()

LIVE-VERIFIED 2026-09-28 (791-unit Figma frames → 1080×1920 and 1440×2560).

- A stage `transform: scale(1.3654)` magnified Chrome's per-element baseline rounding: legal text +0.81 px,
  one headline +1.26 px against a Figma export at the same scale.
- `Emulation.setDeviceMetricsOverride({ width: floor(FW), height: ceil(FH), deviceScaleFactor: outW / FW })` with the
  page laid out in Figma units, clip `{ width: FW, height: FH }` → exactly outW × outH; the legal text went to −0.19.
  What remains (≤ 1.3 device px) is Chrome rounding glyph baselines to device pixels, where Figma does not.
- `html/figma/film.js --hd / --2k / --outw N` reads `Fig.FW/FH` from the page and does this.

## 194. motion.js: translate3d blurred text; `null` in a tween became 0; element order decides overrides

LIVE-VERIFIED 2026-09-28. Fixed in `html/engine/motion.js` (+ test).

- **translate3d** promoted every moving element to a compositor layer, rasterised on that layer's pixel grid: softer
  glyphs, snapped positions in every rendered frame. Now a 2D `translate()` unless rotateX/rotateY/z are in play
  (live web assets that need GPU layers can add `will-change`).
- **`null` is interpolated as 0**: `{ cL: null }` in a set meant "clip everything left of x 0" — words vanished.
  Use far sentinels (`Fig.NOCLIP = { cT: -1e5, cB: 1e5, cL: -1e5, cR: 1e5 }`).
- **Elements are applied in the order of their first tween.** A controller component created later (one progress
  prop driving four layers) overrides those layers' own tracks — give it an `on` prop and switch it off where the
  layers take over, or both fight.
- **A later `set` wins silently**: moving a start time made an F5 state (mask off) land after the mask-on key.
  `verify_anim.py` catches it; eyes do not.

## 195. Figma frames whose body starts at x 0.53 show the section colour in column 0

LIVE-VERIFIED 2026-09-28.

- Frames scaled in Figma kept a body frame at x 0.53 (and x 1 in the end card): column 0 of every export blends
  the section background (#444) — a dark hairline down the left edge. On a screen that is a defect.
- Fill the stage with the background colour; ignore column 0 in pixel diffs (`verify.py`, `verify_anim.py`).
- The same frames carry the dot-grid pattern fill from the body origin — 0.53 / 1 px phase shifts between frames:
  keep them (invisible) so each rest frame matches.

## 196. Shared fractional edges: Figma blends by coverage, the browser composites in order

LIVE-VERIFIED 2026-09-28 (a 3.07 px rule between two ink halves at y 701.42).

- Figma: the edge row = 42 % ink + 58 % rule. Browser, rule drawn over the ink half: the half's 42 % coverage
  first lets 58 % of the background through, the rule then covers only 58 % of that → 82 % green (conflation).
- **RIGHT:** draw the thin element first and the neighbours on top — the edge rows then come out as in Figma.

## 197. Figma comments are out of reach: no MCP tool reads them, the Plugin API has no comments

LIVE-VERIFIED 2026-09-28 (a client review left as comment pins on the storyboard).

- The Figma MCP server has no comment tool; `use_figma` runs the Plugin API, which exposes no comments either.
  Dev Mode annotations (`node.annotations`) are readable — they were empty; the reviewer used pins.
- The REST API (`GET /v1/files/:key/comments`) needs the user's personal token — do not ask for credentials.
  Figma in the built-in browser needs the user's login as well.
- **RIGHT:** ask for screenshots (or the text) of the comments, map each one to its frame, answer with a table
  «comment → what changes» and treat every named change as an acceptance criterion.
- Also seen in the same round: a section parked by the designer shows up as the whole section under a dark
  overlay (every pixel remapped, e.g. #26D07C → (35, 69, 52)) — ask whether that variant still lives before
  re-rendering it.

## 198. A fractional text baseline lands on a whole pixel — Chrome and Figma may pick different ones

LIVE-VERIFIED 2026-09-28 (a two-node headline: one node at y 570, the next at y 678.23, SB Sans Text 115, line 100 %).

- Both rasterisers put a text baseline on a device pixel. With the baseline at 776.59 (Figma's metrics model) the
  Figma export drew it on 776, Chrome on 777: +0.89 px on the ink centroid at 1:1, the same glyph columns. Moving the
  node by −0.25 flipped Chrome to 776 (−0.04); nothing in between — a step function.
- **Tried and dropped:** pre-snapping the baseline in `text()` — rounding to the nearest device pixel changed nothing
  (Chrome snaps on its own terms after the transform), flooring fixed that line and broke three others by the same
  amount. There is no single rule that reproduces Figma's pick across styles.
- **RIGHT:** keep the exact metrics model; expect up to one device pixel on texts whose baseline fraction sits near .5
  and read them with `inkshift.py` (identical bboxes, dy ≈ ±0.9 = this, not a layout error). At a delivery DPR the
  pixel is smaller (2K 9:16: 0.55 design units).

## 199. A frame's stroke in the dump can be invisible in the render: its children cover it

LIVE-VERIFIED 2026-09-28 (a 16:9 header frame, 3 px inside stroke #000, not clipping, three green child frames
filling it edge to edge).

- The render showed no border at the top and sides — the children, not the frame's stroke, are on top. Drawn from the
  dump the header got a black box around it and a doubled line at its foot (the stroke plus the rule under it): the
  whole header region went to 21 000 px off.
- **RIGHT:** before drawing a container's stroke, look at the render: if child fills cover the frame, the stroke is
  gone. Keep strokes that belong to the leaf rectangles.
- Related capture trap: a clip of 1653.75 CSS px at DPR 2560/2940 is 1439.9999 device px and Chrome floors it to 1439
  rows — `shoot.js` gives the clip a quarter device pixel of slack inside the viewport (16:9 2K = 1440 again).

## 200. Animate does not kern CFF fonts (no legacy `kern` table): GPOS kerning has to go into letter spacing

LIVE-VERIFIED 2026-10-02 (Animate 2024 24.0.15, SB Sans Text Medium / Display, static text, autoKern on or off).

- «ТАТА» at 100 px laid out with glyph origins at the plain advances (20, 79.4, 148.1, 207.5) — Figma and Chrome kern
  it to (20, 72.3, 133.9, 186.2). The fonts carry kerning only in GPOS (`kern` feature, pair lookups); `autoKern`
  reads the legacy table and changes nothing. On real copy: «развернуться» +3.4 % of the size, «облачные и
  ИИ-сервисы» −1.6 %.
- **RIGHT:** compute the line with fontTools (advances + GPOS pair adjustments, formats 1/2) and write one text run
  per change of spacing: letterSpacing = tracking + kern(pair) after each character, 0 after the last (Figma adds no
  trailing tracking — then Animate's right/centre alignment matches too). The text stays editable.

## 201. Static text in Animate: origin at tx, first baseline at ty + round(ascent × size), tracking at 0.1 px

LIVE-VERIFIED 2026-10-02 (25 face/size pairs, instances scaled so a pixel = 0.2 local units).

- The first glyph origin sits exactly at the text matrix tx (ink left = tx + lsb). The baseline sits at ty plus the
  hhea ascent times the size ROUNDED to whole px (Text 0.982: 60.31 px → 59, 42.67 → 42; Display 0.96: 121.93 → 117).
  The field's 2 px gutter lies outside the matrix point (addNewText at top 300 → ty 302).
- letterSpacing survives a save with one decimal (−7.31 → −7.3); size is kept to 0.05 px (bitmapSize in twips).
- Right/centre alignment counts the tracking after the last character (like Chrome); see 200 for the fix.
- **RIGHT:** ty = Figma baseline − round(ascent × size_px), tx = the Figma glyph origin; left-align and compute the
  offset of right/centre lines yourself (Figma line width = advances + kerning + tracking between characters).

## 202. A mask layer masks with its first shape only

LIVE-VERIFIED 2026-10-02 (a dot grid clipped to the union of three overlapping rectangles: three drawing objects in
the mask frame).

- Only the first rectangle clipped; the other two were ignored (Animate's own still and the published canvas).
- **RIGHT:** one shape per mask frame. For a union of rectangles: compress coordinates, mark covered cells, emit the
  boundary between covered and empty cells with the fill on the right (`xfl.shape_union`).

## 203. HTML5 Canvas publish: custom eases and tweened masks are baked per frame, filters are dropped

LIVE-VERIFIED 2026-10-02 (classic tweens with separate position/scale/colour curves; a tweened mask instance; a blur
filter tweened 0 → 20 on a cached instance).

- Tweens with custom eases come out as `.wait(1).to({…}, 0)` per frame — exact, whatever the curve. A mask layer with
  a tweened instance comes out as `mask_graphics_N` per frame. A BlurFilter (static or tweened) is not in the output.
- **RIGHT:** carry any curve as a custom ease (it survives publishing); leave filters out of a canvas banner and say
  so (a motion blur in the HTML version does not transfer).

## 204. An FLA is a zip Python's zipfile refuses; write XFL and let Animate save the FLA

LIVE-VERIFIED 2026-10-02 (FLA saved by Animate 2024).

- `zipfile` raises «Bad magic number for central directory» (unzip: «missing 63 bytes»). The local file headers are
  fine: walk `PK\x03\x04` records (data descriptors after deflated entries) to read DOMDocument.xml, LIBRARY/*.xml.
- An uncompressed XFL folder (`name.xfl` = `PROXY-CS5`, DOMDocument.xml, LIBRARY, PublishSettings.xml, META-INF)
  opens with `fl.openDocument('…/name.xfl')`; `fl.saveDocument(doc, '….fla')` writes a proper FLA. HTML5 Canvas =
  `filetypeGUID="3CE50BB6-55CF-47A6-B591-01286DDDC64C"`, xflVersion 23.0. Edges are in twips, matrices in px,
  layers top to bottom, folder children and masked layers point at their parent with `parentLayerIndex`, classic
  tween = `tweenType="motion"` + `<CustomEase target="position|scale|color|…">` points (kept to 6 decimals).

## 205. Published static text and complex shapes are 2× bitmaps

LIVE-VERIFIED 2026-10-02 (Animate 2024 default HTML5 Canvas profile: export as spritesheet, resolution 2).

- Static text and the vector logo were exported as `CachedBmp_N` sprites in an atlas at 2× the stage; plain shapes
  stayed vector. On a 2× screen it is crisp; at 11× (a 728x90 shot at Figma scale) text and logo are soft while
  boxes and dots are sharp.
- **RIGHT:** verify a canvas publish at stage size or 2×; tell the client Publish Settings → Image → Resolution 3
  for 3× phones (heavier atlas).

## 206. A CorelDRAW CDR as AE layers: LibreOffice to SVG, colours un-mixed from the flattened PNG

LIVE-VERIFIED 2026-10-08 (a splash supplied as CDR + PNG; CorelDRAW not installed, Illustrator refuses the format).

- The CDR is a ZIP (`content/data/Bitmaps.dat` holds zlib-packed bitmaps, no PNG/JPEG signatures).
  `soffice --headless --convert-to svg file.cdr` gives one embedded bitmap (all rasters merged: background, arcs,
  skyline), text as curves (user units 1/100 mm) and `linearGradient`s. Fountain fills come back wrong: a
  white-to-grey headline turned flat grey, a chrome numeral smoother than the original. Shadows are gone.
- **RIGHT:** shape from the vector, colour from the client's PNG. Rasterize each element alone (copy the SVG, drop
  the `<image>` and the other paths, crop the viewBox, headless Chrome screenshot at 2×), then solve
  `F = (C − (1−α)·B) / α` at the PNG's own scale, B = the CDR's own bitmap resized to the PNG. Fill α < 0.35 from
  the nearest solid pixel, upsample F under the 2× alpha. Recomposed against the PNG: mean error 1.2/255 (raw SVG
  render: 4.6). Rebuild shadows with Drop Shadow.
- Headless Chrome writes no screenshot and exits 0 while the user's own Chrome is running: always pass
  `--user-data-dir=<scratch folder>`.
- The `<image>` x/y/width/height of the export can be wrong for a cropped bitmap: in a second file (4:3) it
  claimed y −57, height 9259 units, and the background landed off by a few percent. Fit it instead: grid-search
  scale x/y and take the shift by phase correlation on a text-free region (here 43.60 % × 42.55 % at 0,0, NCC
  0.998; the bitmap is stretched non-uniformly in the CDR). Then check alignment per region: in that file the
  arcs matched the client's PNG exactly while the skyline sat 11 px off — the PNG came from another revision, so
  the CDR stays the source.

## 207. Effect values through a script: Drop Shadow opacity, light sweeps on white type, hidden track mattes

LIVE-VERIFIED 2026-10-08 (AE 26.5, English UI).

- `ADBE Drop Shadow-0002` (Opacity) takes and reads back 115: the scale is 0–255 (115 ≈ 45 %), not percent.
- CC Light Sweep (Light Reception Add) on near-white silver type barely shows: it adds white to white. For a
  visible animated gradient on a silver numeral: a Gradient Ramp solid in Multiply (~40 %) over the face,
  alpha-matted to the face, start/end points circling by expression (period 10 s for a 20 s loop); the bright band
  on a Screen copy of the face with Light Reception = Cutout (`CC Light Sweep-0009` = 3).
- `setTrackMatte(m, TrackMatteType.LUMA)` keeps working with the matte's eye off (`m.enabled = false`): a Fractal
  Noise solid (evolution `time/20*6*360`, Cycle Evolution on, 6 revolutions) as a luma matte over a lights layer
  gives a seamless 20 s twinkle; a blurred white band moving in x over a second copy lights the plant up behind a
  passing wave.
- Subtle motion: judge it by diffing frames of a half-res aerender preview against a rest frame (abs diff × 4).
  Every animated layer shows up there even when the thumbnails look static.

## 208. Delivering a seamless loop: sweep tails at the seam, keyframe pumping, a check that lied

LIVE-VERIFIED 2026-10-08 (a 20 s / 1000-frame splash loop, ProRes master → H.264 per screen + a common canvas).

- **CC Light Sweep reaches past its Width.** The Smooth falloff runs well beyond the core. A sweep parked just past
  the layer edge (−0.3w / 1.3w) still lit the type faintly, so the last frame (parked right) differed from frame 0
  (parked left): a visible jump at every loop. **RIGHT:** park at −1.0w / +2.0w and re-time the keys so the band
  crosses the layer at the same moment and speed. For an expression sheen, travel −1.2w … +2.2w per period.
- **Measure the seam on the master, not the encode:** step(999 → 0) must equal the ordinary frame-to-frame step.
  ffmpeg `select='eq(n,999)+eq(n,0)'` returns frames in stream order, whatever order you list them in. Key the
  results by frame number, or you compare unrelated frames (my first "seam" numbers were exactly that).
- **x264 keyframe pumping on smooth LED gradients.** At CRF 14 with GOP 50, each I-frame changed the picture 20× more
  than the normal step (0.36 against 0.02 mean, gray). `ipratio=1.0:pbratio=1.0:aq-mode=3` halved it. One GOP per
  loop (`keyint = min-keyint = frames in the loop`, `scenecut=0`) removes it inside the loop. The only I-frame is
  then the loop start.
- A 3968×2688 50p H.264 canvas needs Level 6.0 (533 Mpx/s, above 5.2's 530.8). Name it in the README and check the
  playback machine. An HEVC or HAP version is the fallback.

## 209. Scripting traps of one afternoon: ease resets LINEAR, `%` in generated JSX, stale captures, a silent save

LIVE-VERIFIED 2026-10-08.

- **`setTemporalEaseAtKey` overrides `setInterpolationTypeAtKey(k, BEZIER, LINEAR)`.** The out side becomes Bezier
  with the speed you passed (0), so a year counter meant to run linearly from key 3 to key 4 lagged eight years
  mid-way. **RIGHT:** ease first, then set the interpolation types; read values back at a few times to confirm.
- **Python `%`-formatting of a JSX template:** every `%` in an expression (`yi % P`, `c % 6`) must be `%%`, or the
  generator dies with "not enough arguments". A regex for `%(?![(%])` over the template finds the strays.
- **Stale captures:** `fix.jsx && rm old.png && cap.jsx; until [ -s old.png ]` — when the first step errors, the
  chain stops, the wait loop finds the previous PNG at once and you review yesterday's frame. Delete outputs in
  their own command before the fallible step, and check the file time.
  The same trap without AE: `ffmpeg -v error -sseof -0.05 -i clip.mp4 -frames:v 1 last.png` on a 24 fps clip wrote
  no file and exited 0. Grab a last frame with `-ss <duration − 0.1>` and test that the file exists.
- **A script can apply every change and return empty, with no save.** `proj.dirty` was still true after a long
  build that ended in `proj.save()`. Probe the state and save in a separate one-line call before rendering.

## 210. A year odometer, photo cards in 3D, and a generated loop under a sharp still

LIVE-VERIFIED 2026-10-08 (the centre screen of a 3-minute plant film, 1152×2688; a splash on a 5376×2688 wall).

- **Odometer:** one PNG strip of digits 0–9,0 (cells of fixed height, rendered in Chrome with tabular figures and a
  silver gradient). Four strip layers in a precomp, each with a position expression: year `Y` from a Slider,
  `yi = floor(Y)`, `f = Y - yi`, roll `r = smoothstep(0.86, 1, f)`; digit `d = floor(yi / P) % 10`; carry
  `P == 1 ? r : (yi % P == P - 1 ? r : 0)`; `y = top - (d + carry) * cellH`. A rewind (2026 → 1961 in 4 s) needs no
  extra code. Make the precomp taller than one cell and mask it on the parent with a 40 px vertical feather, tight
  enough that the neighbour cells' glyph tops stay outside. A 28 % roll window leaves digits half-rolled in a third
  of all frames; about 14 % reads as a mechanical tick.
- **Cards that recede:** three position keys per card (enter from below, rise, then +1900 z while fading), Y/X
  rotation easing through zero, a camera with DOF focused on z = 0. Receding cards blur by themselves. Keep them out
  of the top third where the year sits. Stills baked with rounded corners and a 3 px light border look cleaner
  than masks and render faster than video cards.
- **A low-res generated loop under a sharp still:** a generator clip (1280×720) of a locked-camera background is
  the still re-rendered. Find the exact mapping by phase correlation (here clip = still × (0.2870, 0.2860) +
  (0, −4)), scale the clip layer by the inverse and loop it (`loopOut('cycle')` on time remap, Frame Mix for 24 →
  50 fps). Put the sharp still back only inside a matte of the detailed subject (per-column top edge of edge energy,
  widened by a 25 px min-filter, with the moving light arcs removed from the edge map first, or a strip of a static
  arc appears next to the animated one). Sky, arcs, steam and floor stay generated.
- **"Static shot" is not a guarantee:** a local Minimax H3 clip pushed in 1.5–3.1 % over 5 s (80 px at the edges
  of a 5376 wall); phase correlation reported zero because it sees translation only. Check every frame against
  frame 0 with a scale search (0.97–1.04, shift by phase correlation at each scale) before laying a static still
  over a clip. Seedance 2.0 with first = last frame measured 1.000 and 0 px over 10 s.
- **The generator redraws soft content.** With first frame = the still, Seedance's frame 0 kept rigid structures
  (a refinery, ≤1 px), but moved velvet folds by a median 2.4 px at clip size (~10 px at 5376). A still laid over
  it doubles every fold edge. For deformable subjects, register the clip to the still with a smoothed,
  consistency-gated flow field before transferring detail. Exclude dust specks that exist in only one of the two
  images: the still's specks otherwise stick to the moving fabric, and the clip's print as dark dots. The detail
  transfer itself was done in a separate local-model session, which also showed that Seedance centre-crops the
  still to the output aspect; restore the cut rows from the still.
- **Looping a generated clip in a 50 fps comp:** time remap `time % P` with Frame Mix on doubles the picture at the
  wrap frame, because the blend window spans the jump from the end back to 0 and averages the whole clip. Cross-fade
  the clip into a seamless loop, retime it outside AE to exactly P seconds at the comp rate (ffmpeg: three loops →
  `setpts` stretch → `framerate=fps=50` → keep the middle cycle), then use `time % P` with frame blending off.
  Count the loop's frames first. A loop closed by a morph is shorter than the clip (241 − 12 = 229 frames). Cutting
  it to 10 s instead of stretching (`setpts=PTS*240/229`) puts a jump at every wrap.

## 211. A long build day: a timeout in ms, a non-animatable Hue/Saturation, stale shape references, AE's RAM

LIVE-VERIFIED 2026-10-08, AE 26.5.

- **Quirk #170 again: `--timeout 300` is 0.3 s.** The "(0s)" timeout came back at once while AE finished the build
  and saved it. Probe for what the build made instead of re-running; an `if (findItem("X")) return "exists"` guard
  makes a second run harmless.
- **Hue/Saturation Master Saturation cannot be keyframed from a script.** `canVaryOverTime` is false
  (`ADBE HUE SATURATION-0005`), and `setValueAtTime` throws. The script dies in the middle with an empty result.
  Set a static value and animate the effect's strength instead: `effect("ADBE Effect Built In Params")`
  `("ADBE Effect Mask Opacity")` (Compositing Options → Effect Opacity) does take keys.
- **Shape contents: use or re-fetch every reference before the next `addProperty`.** Adding a Stroke after an
  Ellipse and then setting an expression through the old Ellipse reference left a half-built layer: no
  expressions, and reading its Position threw "invalid numeric result (divide by zero?)". Set the transform first,
  then after each `addProperty` fetch the group again (`layer("ADBE Root Vectors Group").property(1)`
  `("ADBE Vectors Group")`) and set the new item's values right away. Remove the half-built comps before
  rebuilding: the failed script left its undo group open.
- **AE's own RAM on a machine shared with a GPU model.** After a day of builds and `saveFrameToPng` captures the
  interactive AE held 21.8 GB. Windows then trimmed ComfyUI's working set (32 → 10.7 GB), SeedVR2 paged, and a
  70-minute job took 96. `app.purge(PurgeTarget.ALL_CACHES)` brought AE back to 2.6 GB. Purge after every capture
  batch. Render with `app.project.gpuAccelType = GpuAccelType.SOFTWARE` (CPU only) next to a GPU job, and run one
  aerender at a time. A 176 s 1920×1080 half-res preview took 2 min 16 s on the CPU.
- **Hue/Saturation Master Hue: plus turns blue toward cobalt, minus toward cyan.** On a cyan-blue splash
  (hue ~200°), −6…−15 made it greener and more "nuclear"; +8…+16 with saturation −35…−60 gave cobalt, steel and
  night-navy. Check the direction on one frame before grading a whole wall.
- **Cap aerender's memory up front; do not plan to kill it.** `aerender.exe` starts `AfterFX.com`, the real
  renderer. That process grew to 29 GB on a 176 s preview with 38 card layers and a film layer, far above an
  estimated 4–8 GB. A guard that killed `aerender.exe` left `AfterFX.com` rendering on, and in auto mode stopping
  it was refused. Pass `-mem_usage <image_cache_%> <max_mem_%>` (e.g. `-mem_usage 10 15` on a 100 GB box) so the
  renderer stays inside its share from the start.
  - Seen again 2026-10-08 23:40. The GUI AE had grown to 27 GB from frame captures over 3–5 GB ProRes loops, and
    SeedVR2 held 39 GB. Free RAM fell to 7 GB, and the guard stopped `aerender.exe`, which again orphaned a 9.4 GB
    `AfterFX.com`.
  - Purge the GUI's caches with `app.purge(PurgeTarget.ALL_CACHES)` after every capture batch **and before each
    aerender launch**. That took the GUI from 27 GB to 3.4 GB.

## 212. MCP replies in slices: take them from the session transcript, do not retype them

- A big read-only `use_figma` result (23 formats × 5 frames = 246 KB of JSON) must come back in slices (quirk 189).
  Retyping 80 000 base64 characters into a file costs output tokens and invites a one-character error.
- Every tool result is already on disk: Claude Code appends the conversation to
  `~/.claude/projects/<project-slug>/<session-id>.jsonl` as it goes. Make each slice self-describing
  (`<total>|<offset>|<checksum>|<data>`), then a script scans the JSONL, collects the slices of that checksum, joins
  them, verifies the sum and decodes. Worked within seconds of the call returning.
- Compress inside the plugin first: the sandbox has no `CompressionStream`, `TextEncoder` or `Blob`, and
  `figma.clientStorage.setAsync` is «not a supported API», so each slice call recomputes everything. A 40-line LZW
  (variable code width) cut the JSON 3× → four calls of 20 400 characters.

## 213. A Figma frame's own fill shows wherever its children leave a gap

- The state frames of one section had fills of their own — white, brand green or #222 — under every child. A dump
  that walks only `frame.children` misses it. The gaps were small (the strip of a header band beside its plates), but
  on three formats the HTML showed the page colour there and the diff tripled (mean 4 → 1.8 after the fix).
- Read `frame.fills` and paint it as the first layer; in a fluid banner it extends with the background.

## 214. Annotation marks: on the section above the frame, light red, and under later layers; a hidden pane stops rAF

- Safe-zone marks (a pill top left, a circle top right, translucent bands over the headline) were usually children of
  the state frame with solid red fills. One state had its bands as rectangles on the section, lying over the frame: not
  in the frame's dump, but in the section render — the diff showed mean 24/255 until they were added from a
  section-level overlap query (`section.children` whose bounds intersect the frame).
- Other files draw them in #ff8a8a — detect «reddish» (R ≥ 0xE0, G and B ≤ 0xA0, R − max(G, B) ≥ 0x50), not pure red.
- Figma paints them in order, so a later opaque layer (a button band) covers part of a band; a verification overlay
  drawn on top must be cut by the opaque rectangles painted after it.
- The built-in browser pane, when hidden, does not run `requestAnimationFrame`: a playing banner shows its t = 0 frame
  forever (empty green) while `__motion` reports ready and evaluation works. Judge autoplay in headless Chrome
  (navigate without the render flag, wait real time, screenshot) or a visible window.

## 215. A headless Chrome call can hang without an error

- In a verification run one `captureScreenshot` / navigation never answered: no exception, the batch sat for
  minutes. CDP calls in `shoot.js` had no timeout. Give every CDP call one (30 s) so the run fails and says where;
  group jobs by page so a story page is opened once and seeked many times.
- Kill only the processes of that run: match their command lines (`tools/shoot.js`, the `fig-shoot-` profile dir).
  Other Chrome processes on the machine may be the user's browser or another session's.
- A CreateJS (Adobe Animate) banner page made `captureScreenshot` time out every time; reading the frame from its canvas
  (`canvas.toDataURL()` after `exportRoot.gotoAndStop(n); stage.update()`) worked. The timeout also caught one random
  hang in a long verification run of ordinary pages — re-run that format rather than trusting a partial log.

## 216. Platform specs: read the source, and read which object a rule is about

- A WebFetch summary of a platform PDF stated «15 s, 3 loops» — nothing like it was in the PDF. Read the document
  itself (PDF text via PyMuPDF; HTML pages stripped to text).
- SberSeller's «played once, replay on click» sits under **video inside an HTML creative**, not animation.
- VC's «no frame change more often than every 4 s» does apply to an HTML animation's scenes (see
  `banner-platforms.md`); Ведомости forbid relative paths in the HTML, so the only safe package is a single inline file.

## 217. `copyToComp` pastes above the selected layer of the target comp, not at index 1

LIVE-VERIFIED 2026-10-08 (AE, an LED-show film rebuilt). Building a comp from layers of another one:

- WRONG: `src.layer(name).copyToComp(dst); var L = dst.layer(1);` — the copy lands directly **above the layer that is
  selected in `dst`** (a layer just made by `dst.layers.add(...)` is selected and stays selected; the copy is not).
  The second copy went to index 2, `dst.layer(1)` was the first copy again, it got shifted twice, and the next
  `inPoint` assignment threw — the payload returned nothing (ae.js: «AE returned empty result»).
- RIGHT: deselect every layer of `dst` before each copy (then the copy goes to the top), and find the copy by its
  name, asserting there is exactly one.
- A copied layer keeps effects, masks, keys and expressions; its track matte does not come along (`hasTrackMatte`
  false). Shifting `startTime` moves the keys with it; expressions that use absolute comp time (`time - 88`) must be
  rewritten.

## 218. Time remap on a layer that was just moved: enable it first, set in/out after, read back

LIVE-VERIFIED 2026-10-08 (a 10 s Seedance clip sped up 1.8x by a time-remap expression).

- WRONG, one payload: `L.startTime = 12.6; L.timeRemapEnabled = true; …; L.inPoint = 12.6; L.outPoint = 18.18;` — the
  first run threw right after `startTime` (empty ae.js result, `timeRemapEnabled` still false); in the next run,
  with time remap already on, `outPoint = 18.18` came back as 30.78 (= startTime + 18.18). Re-setting `outPoint` in a
  later call gave 18.4 as asked.
- RIGHT: enable time remap on its own (or check `L.timeRemapEnabled` before touching it), put the expression on the
  remap property, then set `inPoint`/`outPoint` and **read them back**; correct in a separate call if they drifted.
  Wrap such multi-step edits as guarded steps (`try` per step, errors collected) so one throw does not hide where
  the payload stopped.

## 219. Linear Wipe: which side the angle hides, and In/Out for a seamless loop comp

LIVE-VERIFIED 2026-10-08 (an LED-show splash, In / Loop / Out).

- `ADBE Linear Wipe-0002` (angle) names the side that is hidden while «Transition Completion» (-0001) is above 0:
  **0° hides the bottom, 90° the left, 180° the top, 270° the right.** So a reveal that grows upward from the
  bottom is 180° with completion 100 → 0, and a title that writes on in reading order is 270°. An exit in
  reading order is 90° with completion 0 → 100. The first build had the 65 appearing from the top and the title
  from the right.
- **An In for a loop comp that ends exactly on loop frame 0.** Duplicate the loop comp and shorten it to D.
  - Set every nested comp layer's `startTime` to D − P (P = the loop period), so at D its inner time is P ≡ 0.
  - Freeze the keyed sweeps on the duplicate's own layers at their value at time 0.
  - Add the reveals on the copies.
  The seam in the review sequence measured a mean absolute difference of 0.8/255.
  An Out needs no shift: its t = 0 is the loop's end.
  `expression time` is comp time, so moving a layer's start does not move a `time`-based expression on that
  layer. Only nested comps carry the shift.

## 220. Removing every Time Remap key switches the property off

LIVE-VERIFIED 2026-10-08 (a finished 175 s cut nested into a 195 s comp, retimed to a new music track
by a piecewise-linear remap with 29 word anchors).

- WRONG: `L.timeRemapEnabled = true; while (tr.numKeys) tr.removeKey(tr.numKeys); tr.setValueAtTime(...)` throws
  «Can not "set value at time" with this property, because the property or a parent property is hidden». The
  layer is left with remap off.
- RIGHT: set all anchor keys first (`setValueAtTime` adds or overwrites keys). Then delete only the default keys
  whose times are not anchors, set LINEAR interpolation on every key, extend `outPoint`, and read back a few
  `valueAtTime` checks.
- The retime method itself worked: nest the old cut, map new word times to old word times, mute the nested
  music, and add new content only where the new track has sections the old one lacked.
- **A second new track that is a re-edit of the first** (LIVE-VERIFIED 2026-10-09: 195 s → 205.8 s, music and
  voice cut and extended together):
  - Find the edits with two alignments.
    - Words: faster-whisper on both tracks, then `difflib` on the normalised words gives the voice offsets.
    - Music: correlate 32 log bands at 20 Hz in 5 s windows against the old track, then check 1 s windows between
      the two candidate offsets. A section where the window keeps jumping by one bar length (3.75 s) is a
      repeated bar, an insert.
  - Remap: speed 1:1 under the voice; each gap absorbs its own difference.
    - Measured on the slow drifting stills: up to ×1.8 and down to ×0.44 read fine.
    - At a music cut that would need ×3.5 on motion (a crown sinking, then a plant rising), cut the remap with
      two keys one frame apart instead. Over the cut lay a second nested layer of the same cut: it keeps the
      pre-cut time and fades out over 1 s.
    - That cut outlives the material it was made for (LIVE-VERIFIED 2026-10-11). The section underneath was later
      rebuilt as one chain of generated transitions (dome → scene → refinery), each starting on the previous
      clip's last frame. The base comp then played through cleanly, but the delivered comp still jumped from mid-loop
      into mid-transition under the 1 s dissolve. That is exactly the «fade splice» the client had flagged.
      - After rebuilding anything under a retime, capture the delivered comp, not the base one.
      - Compose the remap keys of every level (delivered → intermediate → base) and print the base time at each
        cut and at every second.
    - A cut that does not show: jump by exactly one loop period, or from a loop's frame 0 into a transition whose
      first frame is that loop's frame 0. Two keys one frame apart do the jump (here 56.0 → 66.0). The loop
      must be fully opaque at the jump frame, so its fade-in has to finish before the jump. The section gets
      shorter with no dissolve and no speed-up.

## 221. H.264 from rendered RGB frames: convert with BT.709 and tag it, or the brand colour moves

- ffmpeg turns RGB into YUV with the **BT.601** matrix by default and writes no colour tags; players decode untagged
  HD as **BT.709**. A flat brand green came out visibly different in the client's player while every still was exact.
  Encode with `-vf scale=out_color_matrix=bt709:out_range=tv` and tag both the container and the stream:
  `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` plus
  `-x264-params colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv` (the VUI players read). Check: ffprobe
  lists all four fields, and a flat field decoded back is within 2–3 levels of the brand colour (limited range).
  `html/figma/film.js` does this.
- A video cut of an HTML banner starts at t = 0, like the banner. Rotating the loop to open on a fuller frame
  (`--start`) left the next loop's intro in the last seconds, and the client read it as a different animation.

## 222. A README written on Windows: CRLF once, not twice

- `open(p, 'w').write('\r\n'.join(lines))` in Python on Windows writes `\r\r\n`: text mode turns every `\n` into
  `\r\n` again. Notepad shows a blank line between all lines of the delivery README, and it went out like that
  twice. Write `'\n'.join(lines)` with `newline='\r\n'`, then count `\r\r\n` in the bytes (expect 0).

## 223. ffmpeg GIF with uneven frame times: select on a fixed-rate sequence, not the concat demuxer

- Feeding stills with per-file `duration` lines through the concat demuxer quantised every duration to 1/25 s: a
  10 fps GIF came out with delays alternating 120 / 80 ms. Render the frames at a fixed rate (50 fps), keep the wanted
  ones with `select='if(lt(n\,CUT)\,not(mod(n\,2N))\,not(mod(n-CUT\,N)))'` and `-fps_mode vfr`: the kept frames keep
  their 1/50 s timestamps, so the delays are whole centiseconds. The last frame needs `-final_delay` (cs) or the loop
  comes out short.
- `palettegen` after `select` in the same graph sees only the kept frames; `paletteuse=dither=none:diff_mode=rectangle`
  plus the muxer's default transparency diff writes only what changed.

## 224. Swapping a generated clip in place: keyed Scale refuses `setValue`, and the old fade stays

LIVE-VERIFIED 2026-10-11 (an LED-show film: a 720p transition swapped over its ×2 predecessor, then the ×2 back over it).
- `replaceSource` keeps the layer's scale. A clip of another width needs the width ratio (old / new) applied. The
  layer carried Scale keys (a slow push), and `setValue` threw: «Can not call setValue() on a property with
  keyframes». The script had already swapped the source by then, so the layer stayed half size.
  - RIGHT: `if (S.numKeys) for each k: S.setValueAtKey(k, [v[0]*r, v[1]*r, v[2]]) else S.setValue(...)`.
  - Read the keys back. A re-run that finds the new source in place gets ratio 1 and must not scale again.
- The layer's opacity keys survive the swap. The old clip faded in from 0 over 0.4 s, a dissolve that suited it.
  The new transition opens on the previous loop's frame 0, and the same keys turned the cut into a dip to near
  black (frame 66.02 s).
  - When a generated transition replaces a dissolve, clear Opacity to 100. Capture the frames right before and
    right after the join.

## 225. `proj.save()` while aerender is starting: «Could not rename the file», and the bridge hangs

LIVE-VERIFIED 2026-10-11 (a wall rebuild saved the project 20 s after an aerender run had started).
- AE saves to a temp file next to the project (`project.38788.21696.aep`), then renames it over the original.
  aerender was reading the original at that moment, so the rename failed. AE showed a modal warning, «After
  Effects warning: Could not rename the file …», over the «Save Project 100 %» progress window. The CDP call timed
  out (quirk #25) and AE sat at 0 % CPU with `*` in its title.
- **Seeing the dialog without touching it.** AE draws its dialogs itself («Drover» views inside a `#32770`), so
  `GetWindowText` on the children returns nothing. Render the window with `PrintWindow(hwnd, hdc, 2)` into a PNG
  and read that — it works when the window is behind others.
- **Dismissing it without a coordinate click.** `PostMessage(hwnd, WM_COMMAND, IDOK)` does nothing: the buttons are
  not Win32 controls. `PostMessage` of `WM_KEYDOWN`/`WM_KEYUP` with `VK_RETURN` to the untitled `#32770` presses
  its default OK. The progress window closed with it.
- After OK the project was still dirty. A plain `proj.save()` then succeeded, and AE removed its temp file.
- **Rules:**
  - never save the project while an aerender is launching. Build and save first, then start the render;
  - the next build waits until the render has finished;
  - a render from a project that has to change meanwhile goes from a copy.
- **The same hang from archived footage.** The upscaling session moved superseded clip versions to `_архив` after the
  walls had been re-pointed to the new ones. The old versions were still unused items in the project. The next
  `proj.save()` stopped on «2 footage files were saved as missing…» (an OK-only warning; the same Enter closes it).
  - Remove unused items before their files move: `if (it.footageMissing && it.usedIn.length === 0) it.remove()`.
  - Before any save during a render, test that nothing holds the `.aep`:
    `[IO.File]::Open(path, 'Open', 'ReadWrite', 'None')`.

## 226. Purge AE's caches before aerender: frame captures had grown the GUI to 48 GB

LIVE-VERIFIED 2026-10-11. Some forty `saveFrameToPng` captures of 5376×2688 walls built from 3840-wide clips left
the interactive AE at a 47.8 GB working set. The render's RAM guard (stop when free RAM < 20 GB) killed the
aerender 19 s after it started, with 2.3 GB free.
- `app.purge(PurgeTarget.ALL_CACHES)` brought the GUI back to 5.4 GB, and free RAM rose to 54 GB.
- Purge before every aerender run, and again after a batch of captures.
- **The real culprit: caching while idle.** An hour later the idle GUI was at 70 GB working set (78 GB private) with
  no script running, and free RAM was down to 5.7 GB. AE caches the comp in the viewer when idle, and the viewer
  held a 5376×2688 wall. The same growth tripped the guard on the Block 1 render at frame 6977 of 10292, and the
  killed ProRes master had no moov, so it was unreadable. Fix:
  - `C.openInViewer()` on a 16×16 «_idle_viewer» comp, then `app.purge(PurgeTarget.ALL_CACHES)`. The GUI dropped to
    0.6 GB and free RAM rose to 75 GB;
  - park the viewer there before every long render;
  - render long blocks in chunks joined by stream copy (a small shell loop over `-s` / `-e` ranges). A guard kill
    then costs one chunk, not the hour.

## 227. A capture prefix that already exists fools the tiler

LIVE-VERIFIED 2026-10-11 (second time). The capture folder still held `<prefix>*.png` from an
earlier version. The tiler waits until N files match the prefix, and the old files reached that count at once. The
sheet mixed the old night frames with half of the new ones.
- Give every capture set its own prefix.
- The capture script deletes `<prefix>*` in the folder first: `new Folder(dir).getFiles(prefix + "*")`, then
  `remove()` on each.

## 228. A probe that throws leaves its scratch comp behind

LIVE-VERIFIED 2026-10-12. A probe added a throwaway comp with a solid and an effect. It listed the effect's
parameters with `p.value` and removed the comp at the end.
- `.value` on a group (an «Evolution Options» group in Turbulent Displace) throws.
- The throw was uncaught, so ae.js printed «AE returned empty result» (quirk 16). The comp and its solid stayed in
  the project.
- Walk effect parameters by `p.propertyType === PropertyType.PROPERTY` and read `.value` inside try/catch.
- Wrap a probe in try/catch, and start it by deleting any leftover scratch items by name. Remove the solid's
  footage item as well, when its `usedIn` is empty.
- Turbulent Displace, for reference: `-0001` Displacement (1 = Turbulent), `-0002` Amount, `-0003` Size, `-0004`
  Offset, `-0005` Complexity, `-0006` Evolution, `-0008` Cycle Evolution, `-0009` Cycle (in Revolutions),
  `-0010` Random Seed, `-0012` Pinning, `-0013` Resize Layer, `-0014` Antialiasing for Best Quality.

## 229. Pixel Motion across a hard cut inside a generated clip makes one warped frame

LIVE-VERIFIED 2026-10-12 (an LED-show film). A Seedance aerial clip was slowed with Pixel Motion to remove judder.
Its source cut hard from one view to another at frame 117 → 118 (4.9 s of 10). Pixel Motion interpolated the two
unrelated frames into one smeared frame. The step at that frame measured 35.6 against a local median of 11; with Frame
Mix it had been 32. The client had flagged the spot as «скачки в конце».
- Before choosing Pixel Motion, scan the source for cuts: mean absolute difference of consecutive frames on a small
  grey copy. Here the cut stood out at 5.6× the median step.
- Split the layer at the cut into two layers.
  - The first: `Math.min(frame117 / fps, <remap>)`. The second: `Math.max(frame118 / fps, <remap>)`.
  - Each holds its own side's last or first frame, so Pixel Motion never sees both sides.
  - Fade the second in over a 1 s dissolve centred on the cut.
- After the fix the steps through the dissolve were 10-11, as in the motion around it.
- Then measure the delivered file: spikes are steps above 2.2× the median of a ±12-frame window.

## 230. `aerender -comp` cannot find a comp whose name has a character outside the ANSI code page

LIVE-VERIFIED 2026-10-12 (Windows, Russian locale, cp1251). Comps had been renamed to plain Russian names such as
«Блок 3 — холст 3968×2688 (рендер) [HOLST_B3]». aerender answered «No comp was found with the given name»,
both from Git Bash and from PowerShell.
- The project path in Cyrillic worked, and so did «—» and «».
- After replacing «×» with «x» (and «→» with words), the same call rendered.
- aerender evidently matches `-comp` in the system ANSI code page, so «×» and «→» never reach it intact.
- Keep comp names that aerender must find within that code page. Check them in Python before you rename:
  `name.encode('cp1251')` must not raise.
- When a render does fail on a name, read the log's modification time first. `*>` rewrites the log only once
  aerender starts, so a check made too early reads the previous run's error.

## 231. ffmpeg `apad` before `amix=duration=longest` never ends: 140 GB in four minutes

LIVE-VERIFIED 2026-10-13. A short sound effect was padded with `apad` so it could be mixed with a 204 s track:
`[0:a]adelay=800,apad[k];[1:a]adelay=5000[m];[k][m]amix=inputs=2:duration=longest`. `apad` makes its input
infinite, so `duration=longest` never ends. The WAV grew to 141 GB and the disk fell to 27 GB free before it was
stopped.
- Do not `apad` an input of `amix … duration=longest`: the longest real input already sets the length.
- Give every long-running ffmpeg an explicit `-t` (or `-frames:v`) as a hard stop, and `-nostdin` in scripts.
- `Stop-Process` from PowerShell did not stop that ffmpeg; `taskkill //PID <pid> //F` from Git Bash did.

## 232. A concat list built with `>>` on a busy drive can silently lose a line

LIVE-VERIFIED 2026-10-13 (Git Bash, a project drive under heavy render load). A render script built the ffmpeg
concat list for four render parts line by line: `: > list; for …; do echo "file '…'" >> list; done`. One append
failed with «Device or resource busy» (the file had just been created; most likely a scanner held it). The script went
on, and the cut script started cutting three parts instead of four: 157 s of a 209 s film, with no error.
- Write the list in one call (one `open(…, 'w').write(…)` from Python, or one `printf … > list`), not by appends.
- Check it before cutting: the number of `file` lines, and the sum of the parts' frames against the film's length.
  A cut that passes `-frames:v N` computed from the list will not notice a missing part on its own.
- Render scripts should stop on a failed write (`set -e`, or `|| exit 1` after the list is written).
- It happened twice the same night, both times on the third append of four, in two different scripts (two films of one
  show). Treat appends to a just-created file on that drive as unreliable, not as a one-off.

## 233. Before `proj.save()`, check every render lane, not only the one you started

LIVE-VERIFIED 2026-10-13. With three render lanes running (two from one script, one from another), a save was cleared
by looking at one lane's progress. Another lane's part had 98 frames left; at about 100 frames a minute its next
aerender would have started within a minute, in the middle of the 10-second save (quirk 225). It finished after the
save by luck.
- Before every save, read the last PROGRESS frame of every running aerender log against that part's end frame.
- Save only when each one has more than about two minutes left, or has just started rendering (past its launch).
- A part that renders static stretches can speed up several times near its end, so leave a wider margin there.

## 234. A render lane that asks for a comp by an old name fails in seconds and goes on

LIVE-VERIFIED 2026-10-13. Comps had been renamed the day before («Рассадка A — … (v7) [RASSADKA_A_WALL]», quirk 230),
but a new render script still asked aerender for `RASSADKA_A_WALL`. aerender printed «No comp was found with the given
name» and exited after 9 seconds; the lane logged «done RASSADKA_A_1310.mov:  / 1000» and started the next job. The
failure showed only because the empty frame count stood out in the log an hour later.
- After renaming comps, look every render name up in the rename map. Do not reuse names from an older script.
- In a render lane, compare the frame count with the expected one after each job. On a mismatch print `FAILED` and
  stop, or the cut step later works from a missing or stale master.
- An aerender job that ends in under a minute has almost certainly failed: read the tail of its log.

## 235. A full disk: aerender stops mid-part, ffmpeg exits with −28, and both look like ordinary failures

LIVE-VERIFIED 2026-10-13. A night of render parts (6–7 GB each as «High Quality» masters at 3968×2688), cuts and copies
filled a 932 GB project drive to 404 KB free. Three aerenders stopped at the same second, each having written part of
its range (1051, 2090 and 1818 of ~2600 frames) without an error in the lane log; an ffmpeg cut of a canvas exited with
status 4294967268 (= −28, ENOSPC).
- Before a render batch, check free space against the batch: parts × ~2.6 MB per frame at 3968×2688 for the masters,
  plus ~0.4 GB per minute for the delivery cuts. Stop a lane when the drive has less than that left.
- An aerender part that ends early with a short file and no error, several at the same moment, is a full disk.
- Free space by moving superseded masters to another drive (a move, not a delete), then render the failed parts again;
  aerender overwrites its output file.

## 236. «:» in a Windows file name makes a 0-byte file with a hidden stream, and the rename then fails

LIVE-VERIFIED 2026-10-13 (NTFS). A review copy was named «Заставка — IN, LOOP, OUT (инженерная: сфера из чертёжных
линий).mp4». ffmpeg did not fail: NTFS read the part after «:» as an alternate data stream, so a 0-byte file named
«…(инженерная» appeared with two hidden streams of 128 and 27 MB, and the script's `os.replace` stopped with
WinError 87 («Параметр задан неверно»).
- Never use «:» in file names on Windows; also not `\ / * ? " < > |`. Use «,» or «—» instead of a colon, «.» in time
  codes («1.30–2.10»).
- Assert it in every script that builds names from text.
- A 0-byte file with an odd truncated name is this case: `Get-Item -Stream *` shows the hidden streams.

## 237. Frame Mix on a time-remapped layer looks one frame ahead: a `%` wrap inside the loop spoils the last frame

LIVE-VERIFIED 2026-10-13. A 10 s loop comp played a generated clip slowed by Time Remap `S0 + (time % 10) * f` with Frame
Mix on. The loop's last frame was off (wrap step 1.16 against a median of 0.45), and so was the last frame of every comp
that nested it. Frame blending of the frame at t samples the remap at t and at t + 1 frame. At the last frame,
remap(10.0) wrapped to the loop start, so AE blended across the whole loop.
- Inside a comp that is exactly one loop long, write the remap without `%` (`S0 + time * f`).
- Do the wrap one level up, on the nesting layer (`time % 10` on a precomp layer without frame blending).
- Expressions that drive frame-blended layers must stay continuous at the frame after the comp's end.
- Do not re-render a whole long piece to fix only its last frames: render the range that is wrong (`-s/-e`).
  ProRes is intra-only, so the concat demuxer with `outpoint` / `inpoint` and `-c copy` splices it frame-exact.

## 238. Under heavy parallel load aerender can write one wrong frame

LIVE-VERIFIED 2026-10-13: five aerenders on CUDA at once (5376×2688 comps with glows and nested clips). One frame of a
500-frame loop came out as if rendered at another time: the rings sat in other positions and the reflection was different.
The steps on both sides of it were 2.8 against a median of 0.4, and the frames before and after it matched each other.
No error was logged, and the frame count was right.
- Scan every master for single odd frames: both steps around frame k are high, while frame k−1 and frame k+1 are close
  to each other.
- Re-render just that range and splice it in (quirk 237); here frames 105–117 took about 30 s.
- Prefer three lanes over five when the comps are heavy.

## 239. Figma layers one by one: `get_screenshot(child, contentsOnly)` is transparent, `download_assets` is not

LIVE-VERIFIED 2026-10-13 (Figma MCP, a 2304x1280 slide turned into a clip whose objects appear one by one).
- `get_screenshot(nodeId = a CHILD of the frame, contentsOnly = true, maxDimension = max(w, h) of the node)` returns an
  RGBA PNG of that node alone, 1:1, cropped to its render bounds. Place it at the integer render-bounds origin
  (`absoluteRenderBounds` minus the frame origin, from a `use_figma` dump): ten layers recomposed the slide at
  0.27/255. A mask group comes out with the mask applied; an image node with its Figma filters applied.
- `download_assets(node).export` renders the node with the frame's background baked in: opaque, useless as a layer.
- The screenshot size is ceil(render width/height) and the call never upscales — pass maxDimension ≥ the long side.
  A layer partly outside the frame (a 3680-wide image) comes back clipped to the frame.

## 240. An isolated text screenshot does not recompose: unmix solid-colour text from the slide render

LIVE-VERIFIED 2026-10-13. Text nodes with a fractional render origin, cut out by quirk 239, recomposed with errors up to
124/255 at glyph edges, at any sub-pixel shift (best 2.5/255 mean in the box): Figma rasterises the isolated node on
its own grid. Solid-colour text over known layers can be pulled out of the whole-slide render instead:
`a = Σc (R − B)(T − B) / Σc (T − B)²`, clamped to [0, node opacity], where R is the slide render, B the composite of
the layers below and T the text colour. The unmixed layers recomposed a slide at 0.18/255, max 18, and on a flat
background at 0.02/255. Gradient-filled text was fine as a screenshot (0.5/255): keep those.

## 241. motion.js: a lone `tl.set(el, {opacity: 0}, t)` hides the layer from frame 0

LIVE-VERIFIED 2026-10-13. Before its first tween a property holds that tween's FROM value. A layer that should be visible
until 2.42 s and vanish then, written as `tl.set(dark, { opacity: 0 }, 2.42)`, was invisible from the first frame; the
page still looked plausible because other layers covered most of it.
WRONG `tl.set(dark, { opacity: 0 }, 2.42)`
RIGHT `tl.fromTo(dark, { opacity: [1, 0] }, { at: 2.42, dur: 0, ease: 'linear' })`

## 242. Bring a subject out of a flat background with a colour fog, not with opacity; Chrome floors the intercept

LIVE-VERIFIED 2026-10-13 (a dark car silhouette that had to appear out of flat #222). Fading the car's opacity showed the
sky through the body: a ghost car. Keep the subject opaque and lift its colours to the background instead: an SVG
`feComponentTransfer` filter on its container, every channel `slope = k`, `intercept = (1 − k)·bg`,
`color-interpolation-filters="sRGB"`, `k` from 0 to 1, `filter: none` at 1. The first frame is then the flat background
and the silhouette darkens out of it as the light behind it rises.
Chrome renders intercept 0.13333 (34/255) as 33 and 0.1373 as 35: it floors. Bias by +0.5/255.

## 243. A fan of lines closing into one point: one shared convergence, per-line draw delays only

LIVE-VERIFIED 2026-10-13. Each line grows from its left anchor while its end swings from a spread position into the
focus: a similarity transform about the anchor maps the final polyline onto the current end, and `stroke-dasharray`
draws the first `d` of its length. With a convergence phase per line, lines at different phases crossed mid-flight
and the fan read as tangled. Drive the convergence `c(t)` once for the whole fan and stagger only `d`: the fan then
closes as one movement and never crosses. The fan was a raster in Figma. Fitting each line by alpha centroids
(sampled only where no other line is within 8 px) gave straight lines with residuals under 1 px. Two of them merged
into a neighbour before the focus, so they became polylines with a knee where they meet it. Alpha difference from the
raster was 0.006. Swap the SVG for the raster once it stands still, and HIDE the SVG then: it peeked out beside the
raster lines, up to 163/255.

## 244. The concat demuxer stops after the first file when the stream layouts differ

LIVE-VERIFIED 2026-10-13. A 31 s section of a film was rendered again and spliced into the first two ProRes parts
with `-map 0:v:0 -c copy` (`inpoint` / `outpoint`, frame-exact, 5512 frames). The cut list was then [spliced file,
part 3, part 4]. The spliced file held [video, data]; the parts held [video, audio, data].
- ffmpeg mapped part 3's audio onto stream 1 (data in the first file) and logged «DTS … out of order», then
  «New stream with index 2». The cut ended after the first file: 5512 frames instead of 11024, with exit code 0.
- `ffprobe` counted all 11024 packets through the same list, so a probe of the list does not catch it.
- Only the delivered file's frame count did, and its size: 40 % of the previous version.
- Keep every file in one concat list in the same stream layout. Or splice the whole film into one video-only file
  (`-map 0:v:0 -c copy` over the full list with its `inpoint` / `outpoint` lines) and cut from that.
- `-map 0` cannot carry the QuickTime timecode (data) stream through concat: «Cannot map stream … unsupported type».
- Cutting in place over a file that has NTFS hard links rewrites every link: the delivery folder built from links
  held the short version until the re-cut. Verify the frame count before telling anyone a file is done.

## 245. A per-line clip box shows the line above: clip each line's bitmap to its own rows

LIVE-VERIFIED 2026-10-13 (a two-line title rising line by line, HTML). Each line was the whole two-line bitmap inside
its own `overflow: hidden` box, as tall as that line's rows, and the bitmap was shifted down to hide and raised into place.
Shifted down, the line ABOVE slid into the box. «Evolution» showed twice, and line 2's box showed line 1 from frame 0.
Clip the inner bitmap to its own rows; the clip travels with the image:
`img { top: -r0px; clip-path: inset(r0px 0 (h − r1)px 0) }`, where r0..r1 are the line's rows in the bitmap.

## 246. `el.style.opacity = undefined` is a no-op: the previous value stays

LIVE-VERIFIED 2026-10-13. A custom motion.js setter wrote `f.style.opacity = s.co` for a prop that no tween had written
yet, so `s.co` was undefined. Chrome ignored the assignment, the `opacity: 0` set by an earlier hide stayed, and a box
stayed invisible through its whole build. The page threw no error.
- A setter that reads a prop no tween has touched gets undefined. Coordinates computed from it become NaN, and the
  style is dropped the same way.
- Give every optional prop a default inside the setter: `s.co === undefined ? 1 : s.co`, and for a curtain's edges
  `l ?? 1920`, `t ?? 0`.

## 247. A chained tween writer: a value written only as the next FROM never reaches the element

LIVE-VERIFIED 2026-10-13. The page's tween helper chained every prop from the last value written for it:
`go(el, {x}, at, dur)` → `fromTo(el, {x: [cur.x, x]})`. To re-place a hidden title in its new column, the code wrote
`cur.y = dy` and `cur.scale = 1` directly and tweened only x. No tween ever applied y. The title sat 1 px low in three
slides. The per-layer check (quirk 248) found it; the frame diff had not.
WRONG `W.cur(el).y = dy; go(el, { x: dx }, t, 0.85)`
RIGHT `W.cur(el).y = dy; go(el, { x: dx, y: dy, scale: 1 }, t, 0.85)`. A tween that does not change the value still applies it.

## 248. Verify a Figma rebuild layer by layer; a frame screenshot leaves out icons dropped on the page

LIVE-VERIFIED 2026-10-13 (8 slides, 85 bitmap layers from quirk 239, 1920×1080). Whole-frame means of 0.3–1.0/255 hid
single layers that were a pixel off.
- **The probe.** At each rest mark, the page lists every visible bitmap layer: `getBoundingClientRect`, effective
  opacity (the product over its ancestors) and any non-identity transform.
- **The comparison.** For each layer, compare the render with the Figma frame render over the layer's own dilated
  alpha, at every whole-pixel shift in ±2. Flag the layer when a shift beats (0,0) by more than 1/255.
- **Tools:** two short project-side scripts. A probe run through `shoot.js` lists the layers at the given times, and
  `layer_shift.py` does the per-layer search.

What the check found:
- **1 px arrows.** Thin 1 px stroke arrows placed at the rounded render-bounds origin landed 1 px off in 4 cases out of
  8. The error showed at fractions .5 and .58 but not at .65 or .93, so there is no rounding rule to apply. Use the
  measured pixel.
- **Double opacity.** A footnote's PNG already carried the node's 50 % opacity (alpha max 128), and the page applied
  0.5 again.
- **A y never applied** (quirk 247).

What it leaves alone:
- **Text edges.** What remains is glyph-edge outlines (quirk 240's isolated rasterisation), invisible in a video.
- **Icons dropped onto the slide.** If the designer drops an icon onto a slide and it ends up parented to the
  page or section, it is missing from that frame's screenshot and render. It shows only on the canvas. Find such nodes
  by intersecting page-level bounds with each frame. Here they were three bullet icons, and the film kept them.

## 249. A share link for a client: upload with curl to a host that has an upload API, not through a browser form

LIVE-VERIFIED 2026-10-13. A delivery archive had to reach a client as a download link. Upload sites that work only
through the browser form failed for the agent:
- in the app's browser pane, while the pane was hidden, clicking the file input opened no file dialog;
- the Chrome extension blocks native file choosers, and its own upload tool carries at most 10 MB per call;
- a local HTTP server, so that the page could fetch the file into its own form, was refused as a security weakening.

Hosts with a documented upload API took the file in seconds:
- `curl -F "file=@x.zip" https://upload.gofile.io/uploadfile` gives JSON with `downloadPage` and the `md5`;
- `curl -F "file=@x.zip" https://temp.sh/upload` gives a link kept 3 days. A browser shows a page with a
  download button; `curl -X POST <link>` downloads the file.
- Compare the returned or re-downloaded md5 with the local file.
- Give two links from different hosts, in case one is blocked where the client is.
- Upload under an ASCII file name: the multipart filename is the base name. UTF-8 names inside a zip survive.

## 250. Figma at 2x for a 4K film: `download_assets(node, defaultScale 2)` is the node over a flat fill — unmix it

LIVE-VERIFIED 2026-10-13 (8 slides and 85 layers, re-cut for a 4K render). `get_screenshot` never upscales
(quirk 239), so 2× layers come from `download_assets(nodeId, defaultScale: 2, defaultFormat: 'png')`.

**What the export is.**
- The node alone, with no siblings and no card fill under it, over the frame's fill (#222 here). It is opaque.
- A node parented to the page comes over the canvas grey (#444).
- It applies the node's blend mode against that fill. A 3D picture set to Lighten came out lifted to the fill
  (min 34). The `contentsOnly` screenshot of the same node was raw, with corners at 1/255.
- The 1080p film had drawn that raw screenshot with normal blending. It showed a dark vignette, which the closing
  dissolve then lifted. That was the client's «баг с градиентом».

**Recovering alpha.**
- Per pixel, project R − B on the layer colour T − B and clamp. T comes from the 1× layer's opaque pixels.
- Where the residual exceeds 6/255, take the smallest alpha that reproduces R exactly: C = B + (R − B)/α. These are
  dark details inside an icon and neutral AA.
- Composited over the same fill, the result is exact. The 2× alpha, box-downscaled, matched the 1× alpha to 0.4–3 %;
  thin lines were at 6–7 %.
- Dark text on a coloured bar would be exported over #222 and vanish. Unmix it from the 2× frame render over the
  bar's flat green instead.

**Placing it.** The export box is the node's render bounds at 2×. Place each layer by a ±6 px search against the
2× frame render (a project-side `build2x.py` does the unmixing and the search).

## 251. Figma gradient stops interpolate unpremultiplied: green@10 % → #222@0 % falls off as (1 − t)²

LIVE-VERIFIED 2026-10-13. A card fill ran from rgba(green, 0.10) to rgba(#222, 0). Measured in the Figma render, the
excess G−34 was 16.6, 13.9, 9.2, 4.0 and 1.0 at 2, 10, 25, 50 and 75 % of the width. That is (1 − t)^2.1.
- Figma blends colour and alpha separately. The colour itself drifts to the background, so the excess falls off
  quadratically.
- SVG and CSS gradients interpolate premultiplied: the same two stops draw a straight ramp, +4 levels at a quarter of
  the width.
- RIGHT: one colour and nine stops with opacity 0.10·(1 − t)².

## 252. A curtain that becomes a bar: keep it as the bar's ground and scan the content in over it

LIVE-VERIFIED 2026-10-13.
- **What broke.** The green blind shrank into the promo's brand bar. The bar's three blocks then wiped in, each over
  its own width with a 16 % feather, while the blind unwiped beneath them.
- **Why.** The blocks are 293, 1277 and 228 px wide and all wiped in the same second, so their fronts moved at
  different speeds. The dark background showed through as a dark gradient running along the bar: the client's «баг с
  градиентом на финальном кадре».
- **The fix.** Keep the blind as the ground and never unwipe it. Reveal the blocks with ONE front in page coordinates;
  each block converts it to its own mask percentages.
- **Draw what the ground covers.** Figma's blocks had hairline #222 seams between them. The green ground hid them
  until the closing dissolve brought them back.

## 253. A column accordion without collisions: a clean grid, a clipped layer per column, titles that never coexist

LIVE-VERIFIED 2026-10-13 (5 columns, one open at a time, 1080p → 4K). The client wrote «прямоугольники где-то
пересекаются, где-то промежутки, формы неправильно собраны» and «проверь, чтобы не было пересечений».
- **Rebuild the columns as a grid.** In Figma they overlapped their neighbours by −1…+3 px and their tops drifted by
  2 px, so the 2 px dividers came out 2, 3 or 4 px wide with steps at the corners.
  - One frame 60…1860; open card 944, collapsed 216, so every state sums to the frame.
  - Neighbours overlap by exactly the stroke width, giving one shared 2 px divider.
  - Interpolate two such states with one ease and every divider stays 2 px through the morph.
- **Lay out the content by role.** One rule per role, from the medians of the slides rather than each slide's own
  drift: pads +34/+36, collapsed icons centred, titles on one baseline (one generated layout table).
- **Clip each column.** Its content lives in its own full-stage layer with `clip-path: inset(...)`, set from the
  column's current rect by the column's setter. A card that opens or folds can then never draw over a neighbour. The
  title slide's text is clipped to its box the same way while the box opens.
- **Never show two titles at once.** Two titles with different line breaks (a 36 px one-liner and a 28 px two-liner)
  crossfaded mid-move and both showed. Fade the old one out in 0.32 s and start the new one at +0.46 s. Icons are one
  drawing in two sizes and coincide all the way, so they may crossfade.
- **Check it.** A probe run through `shoot.js` samples the film every 0.04 s and intersects element rects with their layer
  clips. It lists overlapping pairs, and elements cut by their layer edge while visible. Pairs that overlap by design
  are allowed by name.

## 254. Overlap probes and page variants: three traps

LIVE-VERIFIED 2026-10-13.
- **Chrome writes `inset()` short.** `el.style.clipPath = 'inset(278px 781px 117px 781px)'` reads back as
  `inset(278px 781px 117px)`. Parse 1–4 values like CSS (t, r, b, l).
- **A regex in a template literal loses its backslashes.** A page probe written as a JS template string
  (`const PROBE = \`...\``) turns `/\s+/` into `/s+/` and `\d` into `d`, with no error. The probe then misread every
  clip and reported overlaps that were not there. Double the backslashes, and make the edit with the editor tool:
  bash heredocs collapse `\\`.
- **A layer with no tween stays drawn.** motion.js applies only tweened elements, so a layer with no tween is never
  touched by the timeline. In a page with variants (`?end=title`), whatever a variant does not animate stays at its
  CSS default and is visible from frame 0. Hide it with `display: none` per variant.

## 255. 4K from DSF emulation: an `<img>` whose box is not on whole CSS px is resampled — pad it to whole px

LIVE-VERIFIED 2026-10-15 (film.js `--outw 3840`: Emulation.setDeviceMetricsOverride, deviceScaleFactor 2).
- **Symptom.** A 2x layer placed on the 0.5 px grid with its natural size (1727×150 device px → 863.5×75 CSS at
  left 61.5) did not render 1:1. Against the same pixels composited by hand:
  - the mean error was 2.8–7.6/255;
  - glyph edges showed cubic-filter ringing (34 → 41 beside an edge, 255 → 248 inside).
- **Cause.** The fitted shift was 1.0 px at the left end and 0.25 px at the right. Chrome snaps the img box to whole
  CSS px: 61.5 → 62, while the right edge stays at 925. The bitmap is squeezed by one device px. The same happened at
  an integer origin with an odd width (863.5 CSS). `image-rendering: pixelated` and removing the transform or the
  opacity changed nothing.
- **Fix.** Give every box a whole-px origin and a whole-px size:
  - pad the PNG with one transparent device px on the left and/or top when the layout puts it at x.5 / y.5;
  - pad on the right/bottom to an even device size;
  - place it 0.5 px up/left, so the ink stays put.
  The subtitle then matched Figma at 0.016/255 mean, max 1.
- A project-side script writes the four variants of every layer (none, @L, @T, @LT), and the page's image helpers pick
  one. A line mask's clip box sits on whole px too; the bitmap's rows go into `clip-path`.
- Plain divs (bullets, rules, diagram boxes) get whole-px geometry in the layout itself: Chrome snaps them the same
  way and moves them 0.5 px.
- A whole-device-px translate on a composited layer (0.5 CSS px) stays sharp, so moves between states keep working.
- The 4K films rendered before this fix (2026-10-13 and 14) carry the slight softening on every 0.5-grid layer.

## 256. A multi-line title whose lines overlap in rows: split it into line bitmaps by glyph components

LIVE-VERIFIED 2026-10-15. A 96 px three-line title had line-height < 1: the descenders of line 1 («р», «ф») reach
below the cap tops of line 2. There is no empty row between them, so a per-line clip box (quirk 245) cuts glyphs.
- Label the alpha's connected components (8-connected, alpha > 0.02).
- Assign each component to a line by its alpha-weighted vertical centre, using two cuts between the lines.
- Give every pixel of the bitmap to the line of its nearest labelled pixel (`distance_transform_edt` indices), so the
  anti-aliased fringe goes with its glyph.
- Save one full-size bitmap per line. The three alphas sum back to the original exactly (max difference 0).
- Each line then rises in its own clip box covering its full ink; neighbouring boxes may share rows.
- Trap: an i-dot of line 2 sat higher than some line-1 components' centres would suggest (its centre was 182 against
  line 1's 76–108 and line 2's 235–272). Set the cut between the clusters by looking at the centres, not at the row
  gaps.

## 257. Render hours of a deterministic page in parallel: segments per Chrome, NVENC, concat

LIVE-VERIFIED 2026-10-15 (two LED-wall films, 30 + 45 min, 2304×1280 at 30 fps: 135 000 frames in ~35 min).
- One `film.js` job captures 9–11 frames/s at this size (canvas draw 12–20 ms, PNG capture ~80 ms, JPEG q95 ~50 ms),
  so a 45-minute film alone would take 2.5 hours. Eight jobs, each its own headless Chrome seeking `f / fps`, ran at
  ~70 fps together on 16 cores.
- Encode each segment with `h264_nvenc` (p6, vbr, cq 21, high, L5.1); eight sessions ran on a GeForce. Eight
  x264 `slow` instances at 3 MP would have been the bottleneck.
- Join with the concat demuxer, stream copy: all segments share one layout (video only), so quirk 244 cannot bite.
- The page must be a pure function of time (hashes, `frac(t / period)`, births by hash); any per-frame state would
  differ between a segment's first frame and the continuous run.

## 258. A drifting lattice of sprites: reduce the drift modulo the lattice and hash the absolute index

LIVE-VERIFIED 2026-10-15. A lattice of cube PNGs drifting across the frame was first written as `dx = (t · v) mod P`
with P unrelated to the lattice: at the wrap every cube jumped, and the cubes' hashed properties (which face is lit,
when it blinks) swapped. Solve the basis for the integer part of the drift (`m, n = round(inv(B) · d)`), draw the
window of indices around the centre with the remainder as offset, and hash `(i − m, j − n)`: cubes keep their
identity and the drift is continuous for any t, including negative t.
The designer's tiling came from the autocorrelation of their pattern image: the two strongest off-centre peaks are
the basis vectors; expressed in cube widths they transfer to any cube size.

## 259. Tinting a PNG through a mask: the mask must sit in the alpha channel

LIVE-VERIFIED 2026-10-15. A greyscale (L-mode) PNG of «how green each pixel is», drawn to a canvas and tinted with
`globalCompositeOperation = 'source-in'`, filled the mask's WHOLE rectangle with the colour: an L PNG is opaque, so
`source-in` keeps everything. Every cube got a square halo. Save the mask as RGBA with the mask in alpha (RGB white),
then `source-in` tints exactly the masked pixels.
And light the face with `source-over` at ≤ 0.5, not `lighter`: `lighter` of green on an already light-green face
went cyan-white.

## 260. A warm-up film that cuts into a loop file: render its tail at negative loop time

LIVE-VERIFIED 2026-10-15. The loading film's last 30 s draw the loop's first chapter at `t − 1800` (−30…0), so a cut
from the end of file 1 to the start of file 2 continues every drift and wave. Two traps:
- births written as `-10` («already born») were in the future at t = −30: the whole chapter rendered empty; default
  births to −1e9;
- a cycle index from `floor(t / CYCLE)` goes negative: compute the chapter for the tail directly, not through the
  loop's cycle logic (which would land in the last chapter).

## 261. A wipe written as cover-then-uncover blinks at its middle frame unless u = 0 of the uncover is a full cover

LIVE-VERIFIED 2026-10-15. Chapter transitions were a bar covering the frame during [B − 0.5, B] and uncovering
during [B, B + 0.5]; both halves started with `if (u <= 0) return`. At exactly B the uncovering half has u = 0 and
drew nothing: one frame of the incoming chapter showed between two fully green frames — a 33 ms blink at every
wipe, 27 times in the film. The luminance-jump check (quirk 257's `check_video.py`: frame-to-frame mean > 40/255)
listed them as pairs «144 → 38 → 144» at the chapter times; the designed two-frame flashes stood out as
«60 → 233 → 131». The uncovering half must return only at u ≥ 1 and cover everything at u = 0. Re-render, not
splice: the fix is in the page, and the segments must all come from one page.

## 262. A kaleidoscope source must stay centred on the apex: drift inside the lattice, not by translating the context

LIVE-VERIFIED 2026-10-15. The mirrored source was a lattice of cubes drawn into an offscreen canvas after
`translate(apex) · rotate · translate(−frame/2 + drift)`; the lattice culled to its frame box, so the drift carried
the filled box away from the apex and the mandala thinned and emptied towards the end of every 60-s chapter (two of
nine cycles showed a blank frame on the contact sheet). Draw the source as a box centred on the apex (half-size ≥
corner radius / min zoom: 1500 px for a 2304×1280 frame at zoom 0.96) and pass the drift to the lattice's own
modulo reduction (quirk 258). The 2N wedges then always sample filled source. A contact sheet sampled once per
chapter per cycle is what caught it: a single test frame early in the chapter looked fine.

## 263. Parallel Chrome jobs: a job whose first frames are the heaviest flickers for minutes; warm it up, then splice by DTS

LIVE-VERIFIED 2026-10-15. Eight headless Chromes rendered a 45-min film in segments. Two segments came back with
frames alternating between the full scene and the scene without its kaleidoscope (mean luminance 58 ↔ 130, dozens of
jumps over the first minutes of each): exactly the two jobs whose FIRST frames fell inside the kaleidoscope chapter,
with its 3000 px offscreen source canvas, while eight Chromes were starting at once. Jobs that reached the same
chapter later rendered it perfectly.
- Warm up every job: seek frame 0, then the job's first frame, with short sleeps, before the capture loop; wait a
  `requestAnimationFrame` between seek and `captureScreenshot`; keep offscreen sources ≤ 2400 px.
- Replace only the bad segments: render the ranges again (4 jobs each) and splice with the concat demuxer, stream copy.
  `outpoint` is compared with DTS: with B-frames (bf 2) the next IDR has dts = pts − 2 frames, so `outpoint B` keeps two
  packets of the next segment. `outpoint B − 0.09` (3 frames at 30 fps, more than the 2-frame reorder) gave exactly the
  packet count. The demuxer then takes the piece's length from outpoint − inpoint, so the next piece's timestamps start
  0.09 s early and overlap: write `duration` for every piece explicitly. Check the result by listing all packet pts:
  count = frames, every difference = 1 / fps.
- The luminance-jump check (quirk 261) found the flicker; its decoded frame COUNT, however, follows the timestamps
  (ffmpeg drops or repeats frames at overlaps), so count packets with ffprobe when judging a splice.

## 264. A font installed per user stays invisible to AE until the Windows session loads it

LIVE-VERIFIED 2026-10-19.

**What happened.**
- I copied a TTF into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and added the HKCU `...\Windows NT\CurrentVersion\Fonts`
  value. Windows does exactly this at logon.
- After two AE restarts, `app.fonts.getFontsByPostScriptName(ps)` still returned 0, while older per-user fonts were
  listed.
- The variable file (Unbounded[wght]) was not listed either.

**RIGHT**
1. Make static instances with fontTools: `varLib.instancer.instantiateVariableFont(vf, {'wght': 900}, updateFontNames=True)`
   gives the PostScript names `Unbounded-Black` and `Unbounded-ExtraBold`.
2. Install them per user.
3. Call gdi32 `AddFontResource` on each file from PowerShell (`Add-Type` P/Invoke). Then broadcast `WM_FONTCHANGE`.
4. Restart AE: `app.fonts` now lists family `Unbounded`, style `Black`.

Before building any text, check `getFontsByPostScriptName(ps).length`. A missing font is substituted without a word.

## 265. A layer placed at a negative startTime: set its outPoint after its inPoint

LIVE-VERIFIED 2026-10-19 (AE 26.5). A 40 s precomp placed in a 20 s comp with `startTime = -20` gets
`inPoint = 0`. A later `inPoint = 15.4` left `outPoint` at 15.4 too. The layer had zero length and never rendered, and
the captures showed empty wings.
- Solids and stills behave differently: `inPoint = 10.4` on a 20 s solid slid it to 10.4–30.4.
- **RIGHT:** set `L.outPoint = Math.min(comp.duration, L.startTime + L.source.duration)` (or the wanted out) right after
  every `inPoint`. Read back in / out when a layer is missing from a capture.

## 266. In a bridge payload, `"text" + array` throws «invalid numeric result (divide by zero?)»

LIVE-VERIFIED 2026-10-19. `" pos=" + prop.value` threw that error for every layer of a comp. It looked like a broken
project. The same read with `prop.value.toString()` or `String(prop.value)` worked. Arrays in this ExtendScript context
have operator overloads, so `+` tries a numeric operation.
- **RIGHT:** convert explicitly. If a probe dies with that message, suspect the probe before the project.

## 267. Effects for an event wall: crisp lightning, Particle World units, a particle system in a seamless loop, fades on a null

LIVE-VERIFIED 2026-10-19 (LED wall 3456x1152, 25 fps).

**Advanced Lightning** (`ADBE Lightning 2`).
- Parameter indices: 1 type (2 = Strike, origin to point), 2 Origin, 3 the point, 4 Conductivity (drive it with
  `time*25` for flicker), 6 Core Radius, 7 Core Opacity, 8 Core Color, 11 Glow Radius, 12 Glow Opacity, 13 Glow Color,
  16 Turbulence, 17 Forking.
- Forking 0.4–0.55 with Glow Radius 30–80 rendered a fuzzy glowing rope.
- A crisp bolt: forking 0.15, turbulence 1.1, core opacity 100, glow opacity 45, glow radius ≈ 0.7 % of the frame width.

**CC Particle World.**
- Producer position and radii are in layer-width units: on a 384x1152 layer, Y 0.45 sat at 65 % of the height and
  Y 1.45 at the floor.
- Grid, Horizon and Axis Box are `-0055`, `-0060` and `-0061`; set them to 0.
- A burst = Birth Rate hold-keyed at 2 for 3 frames. At 18 it rendered a fuzzy ball.

**A particle system inside a seamless loop of length T.**
- Make its precomp 2T long. Inside a loop precomp of length T, layer M shows it at t + T (startTime −T, fully developed).
- Layer C shows it at t, visible from T − 2 s to T. Crossfade M out and C in over that window: frame T − 1 then lands
  on the state of frame 0.
- Without this, every wrap starts from an empty system.

**Parenting does not pass opacity.**
- A title line hung on a null with its fade on the null showed at 380 % scale from the comp's first frame.
- Put the opacity keys on the parented text layers themselves. Scale and position can stay on the null.

**Judging a loop seam against local motion.**
- A generated sky bed with lightning bursts had a whole-loop median step of 0.99. The seam measured 2.21.
- The steps in the ±12 frames around the seam ran 1.4–5.7, because the clip's first second flickers.
- Compare the seam with the local steps, not the global median, before reworking it.
- A real leftover does show up: a wrap copy still at 93 % in frame 999 gave 2.57 against the same neighbours. End the
  crossfade one frame early: fully on by frame N − 2.


## 268. A comic page flip with CC Page Turn: corner mode, and only on a layer the size of its box

LIVE-VERIFIED 2026-10-19 (AE 26.5, comic-panel flips on an LED wall: 1920x1152 centre, 384x1152 wings).
- **The mode.** Controls (property 6) = 6, «Bottom Right Corner»: Fold Position is where that corner is dragged to. A
  page that leaves by its lower right corner: Fold Position from (W, H) to (−1.15 W, −0.1 H) over 6–8 frames at 25 fps,
  Fold Radius max(30, 0.12 W), Back Opacity 100, a warm paper colour (0.93, 0.9, 0.82). The page curls away and uncovers
  the next panel under the curl.
- **WRONG:** the effect on a picture layer bigger than the screen box (a Ken Burns window cropped by the comp). The
  corner and the curl are computed on the whole picture, so the visible part turned late and left a black band along
  the bottom of the box.
- **RIGHT:** one precomp per panel, exactly W x H, holding the picture with its Ken Burns keys (anchor = subject point in
  source px, scale = box H / window H, clamped to the picture and to any frame the generator drew around it). Put the
  page turn on that precomp layer.
- **The stack:** the first page on top. Page k shows from its start minus the turn of page k−1 and leaves by its own
  turn. A row of screens turns as a wave: outer screens 4 frames ahead of the centre, inner ones 2.
- A wrapped loop (frame N == frame 0): a panel crossing the end gets a copy shifted by the loop length. Copies that
  continue from the previous lap go on top, copies waiting for the next lap at the bottom.
- Verify on captures in the middle of a turn (frames at 30–50 % of it): a black band or a page turning on the wrong
  corner is obvious there and invisible at the ends.

## 269. A greyscale PNG as a track matte: ALPHA uses its whole box

LIVE-VERIFIED 2026-10-19 (AE 26.5). The face of a digit was saved by PIL as mode «L» (white glyph on black, no alpha)
and set as `TrackMatteType.ALPHA` for a lightning layer. An L PNG imports fully opaque, so the bolt showed in a
rectangle around the digit, not inside it.
- **RIGHT:** `lt.setTrackMatte(face, TrackMatteType.LUMA)` for an L PNG, or save the mask as RGBA (white, alpha = mask)
  and keep ALPHA. Read back `trackMatteType`: LUMA = 5015.
- `setTrackMatte()` turns the matte layer's video off by itself (it read back `enabled: false`). A parented matte keeps
  following its parent: give it anchor (0, 0), position (0, 0), scale 100 % AFTER `parent =`, since parenting rewrites
  the child's transform.
- Check a matte on a capture where the matted layer is brightest: a box-shaped matte hides inside a dark frame.

## 270. A glow inside a screen-sized precomp draws a seam on a flush wall

LIVE-VERIFIED 2026-10-19 (flush 9x3 m wall: wings 384 px wide next to a 1920 px centre). An energy column on an inner
wing lived in a 384x1152 precomp (the wing's box) placed in ADD mode. Its «glow» layer was a full-width linear Ramp, gold
at the floor to black at y 420. The glow stopped dead at the box edge. Next to the centre screen that read as a hard
vertical seam: 75 vs 33 grey levels across the boundary at floor height. Two delivered versions had it before a full-res
look at the boundary caught it.
- **RIGHT:** give every glow, haze or gradient in a box-sized precomp a falloff to zero at the box edges, unless the
  picture really ends there. Here: a mask x 96–288 with feather (192, 0) on the glow layer only, so the glow became a
  soft column around the bolt. Alternatively, make the precomp wider than the screen so the light spills over.
- **The check, before every render of a multi-screen wall:** at each screen boundary x, compare the mean of columns
  x−12..x−2 with x+2..x+12 at three heights on a busy frame. A step where the picture should continue means a layer
  clipped by its box. A step at an ink frame or a panel edge is expected.

## 271. Joining AE's ProRes masters: the concat demuxer can park the second file at 10240 s; ProRes couples screens

LIVE-VERIFIED 2026-10-19 (ffmpeg 8.0.1). AE's "High Quality" output module writes a .mov with video (apcn), a silent
audio track and a timecode (tmcd) track.
- **WRONG:** `ffmpeg -f concat -i list.txt` of `INTRO.mov` + `LOOP.mov` (LOOP itself a stream-copy join of two halves),
  re-encoded to H.264. The loop's frames came out at pts 10240 s and later. The file had 1500 packets and decoded with 0
  errors, but it lasted 30 679 s. A player shows 20 s and then freezes. A checker that decodes it at constant frame rate
  writes out ~767 000 duplicated frames; one check run took 80 minutes. The stream-copy join of the two loop halves was
  fine: its pts run straight through 19.96 → 20.00.
- **RIGHT:** join with the concat FILTER, video only:
  `-i a.mov -i b.mov -filter_complex "[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]" -map "[v]" -an -r 25`.
- **Always check the container duration** against frames / fps (±0.05 s), not only the packet count. Decode for
  checks with `-fps_mode passthrough`, so a timestamp gap cannot turn into millions of frames.
- **ProRes couples regions within a frame.** The metal and comic masters had identical wings, but their wings differed
  by a mean of ~1 grey level (max 10–13). The difference map was 8×8-block noise, zero on flat black; it was not a
  shift. The same comp rendered twice was bit-exact. ProRes sets its quantisation per frame, so a different title in the
  centre changes the compression noise everywhere. For «these regions must be identical» checks, allow ~2.5 levels,
  compare two renders of the same comp, or use a lossless master.

## 272. `python -I` ignores PYTHONIOENCODING; Cyrillic output needs `sys.stdout.reconfigure`

LIVE-VERIFIED 2026-10-23 (Windows, Python 3.10, cp1251 console). `PYTHONIOENCODING=utf-8 python -I script.py` still
crashed on `print('…≤…')` with `UnicodeEncodeError: 'charmap'`: isolated mode (`-I`) drops every `PYTHON*` variable. Earlier
scripts printed Cyrillic paths as «������» for the same reason.
- `python -I -X utf8` broke even earlier on this machine: `site` died on a non-UTF-8 `.pth` file in site-packages.
- **RIGHT:** `import sys; sys.stdout.reconfigure(encoding='utf-8')` at the top of any script that prints Russian; keep `-I`
  (it is there for safety on downloaded data).

## 273. A TTS voiceover transcribes best from its own script: Whisper skips and invents

LIVE-VERIFIED 2026-10-23. faster-whisper large-v3 on a 2:02 SpeechKit voiceover (CPU int8, 246 s; CUDA failed with
`cublas64_12.dll is not found`, the CTranslate2 build has no CUDA 12 runtime here):
- it dropped a whole 10.5 s span (two phrases in the middle);
- it repeated the last sentence over the 4.6 s silent tail;
- it heard «ФСТЭК» as «в СТЭК», and the «Stack» of a product name as «STEC».
- **RIGHT for a synthesized track:** the text sent to the synthesizer is the transcript. Take phrase times from pauses in
  the audio itself: RMS at 10 ms, speech above −42 dBFS, gaps ≥ 140 ms split phrases. Map script chunks to those
  segments, and use Whisper only to confirm the boundaries; they agreed to ±0.05 s. Deliver a `.txt` per scene (speech
  window and duration, plus pronunciation notes for the synthesizer) and a phrase-level `.srt`.

## 274. Canvas transitions built from grid cells: draw the cells solid and add the seams on top

LIVE-VERIFIED 2026-10-23 (a «bits» wave of 48 px cells sweeping a 1920×1080 film). Cells drawn as `cell−2` squares
left 2 px gaps. The frame underneath showed through them as a white mesh over every white plate and the 3D image,
which read as a rendering bug.
- **RIGHT:** fill each active cell at full size, then paint 2 px seams in the ground colour along its right and bottom
  edges. The cover stays opaque and still reads as a grid.
- Hold full cover for ≥ 0.06 s around the scene switch: cover delay up to 0.62 s, a 0.1 s green lead, the reveal starting
  at 0.78 s.

## 275. Framing a screenshot «sheet» on a grid: its edges either sit on the grid or leave the frame decisively

LIVE-VERIFIED 2026-10-23 (UI screenshots moved by camera keys beside a text column). Sheet edges that landed 15–60 px from a
margin or the frame edge looked like mistakes. Examples: a top edge at 25 px, a left edge cut 22 px from the clip line
next to the column, a right edge at 1858 against a 1833 margin.
- **RIGHT:** solve every camera key for its edges:
  - left = AX − cx·z;
  - top = AY − cy·z;
  - right = left + W·z;
  - bottom = top + H·z.

  Each edge must sit on the grid (the column top, the margin) or be ≥ 40 px beyond the clip or frame edge. Overview keys
  fit the sheet exactly into the content area. Zoomed keys keep the top on the column's top line, or let the sheet bleed.

## 276. An upscaled screenshot is invisible unless the film draws it larger than the original; never judge it on a 720p proxy

LIVE-VERIFIED 2026-10-23 (a product promo; 16 UI screenshots, 1525×784, upscaled ×2 with Topaz text refine).
The client said: «the upscales are good, but in the film it looks as if they were not used». The page did load them.
- The 1080p film drew the sheet 1146–1988 px wide (z 0.75–1.3 of the original). The same frames were rendered again with
  the original JPEGs swapped in through Playwright routing. Over the sheet they differed by 0.7–1.75/255 on average:
  invisible at z ≤ 1. Only the 1.3× zooms showed the upscale.
- The review copy sent to the client was 1280×720 at 0.33 Mbit/s. It showed the sheet at 50–87 % of the original, then
  crushed it. That copy is what the client judged.
- Ruled out by measurement:
  - the H.264 master: PSNR 38.5–39.8 dB against the canvas frames;
  - canvas resampling: in headless Chrome, `imageSmoothingQuality` low, medium and high give identical pixels, at
    ~0.9× the edge energy of a Lanczos resize for scales 0.38–1.3×.
- `createImageBitmap(img, {resizeWidth, resizeHeight, resizeQuality: 'high'})` is softer: 0.64–0.84× the Lanczos edge
  energy. Do not build mip pyramids with it.
- The ×4 test (6100 px) is in generation-recipes: slightly crisper text, but a dashed border became solid.
- **RIGHT:**
  - Before spending on an upscale, compute output pixels per original pixel for every camera key. The upscale pays only
    above 1.
  - Render the master in 4K. A DPR 2 canvas puts a ×2 source at 1:1 when z = 1.
  - Frame reading holds at z ≥ 1, and keep the focus veil light (≤ 0.4) so the rest of the screen stays legible.
  - Proof for the client: render the same frame with and without the upscale, at 100 % crops.
  - Review copies go out at 1080p, CRF ≤ 20, never as a 720p proxy.

## 277. Canvas text laid out before the web fonts load: words overlap, spaces and commas vanish

LIVE-VERIFIED 2026-10-23 (an HTML canvas film; plates and lists measured once at script load and cached).
`measureText` ran before `document.fonts.load()` resolved, so it measured the fallback font. The cached word positions
were then drawn in SB Sans Display, which is wider: «Вход по доменной» came out as «Входподоменной», and commas hid
under the next word. Layouts computed lazily inside `render()` were fine, because by then the font had loaded.
- **RIGHT:** compute every cached layout (word x positions, plate sizes, list heights) in the `ready` chain after
  `document.fonts.load(...)`, and clear the layout cache there. Never at the top level of the script.

## 278. Whisper on a whole voiceover drops phrases and drifts phrase starts; transcribe phrase by phrase

LIVE-VERIFIED 2026-10-23 (a 113.7 s TTS voiceover with no script for the new take; faster-whisper large-v3, CPU int8).
- On the whole file, Whisper dropped «под конкретную задачу» (57.0–58.3 s) and stretched the next word «Вся» over the
  gap (56.82–58.74).
- Its phrase starts were 0.3–0.9 s early against the RMS onsets («Войдите» 26.82 vs 27.45), and one was late
  («Двухфакторная» 100.72 vs 100.42).
- **RIGHT:**
  - Split the track by RMS pauses (10 ms frames, speech above −42 dBFS, gaps ≥ 140 ms).
  - Run Whisper on each phrase clip padded by 0.12 s, with `condition_on_previous_text=False` and no prompt. A prompt
    with the expected text made it hallucinate a different sentence.
  - Take each phrase's first word from the RMS onset, and the other words from Whisper inside the clip. The phrase
    text came back complete. Beats synced to these times landed within ±0.1 s.
  - Keep the word table in the page (`WD`, seconds of the audio file) and derive every beat from it, so a re-voice means
    replacing one table.

## 279. Pacing a TTS voiceover: an energy minimum can be a stop closure inside a word; check each cut by transcribing both halves

LIVE-VERIFIED 2026-10-23. The client asked to «cut the speech» where the picture ran too fast. Pauses went in at 13 gaps
(+6.6 s in total).
- Gaps between sentences are easy: 100–400 ms at −85…−90 dBFS.
- Comma gaps inside enumerations («Образ, | несколько дисков», «Флейвор, | сеть») are 60–90 ms at −56…−88 dB on a
  5 ms RMS grid. They are real gaps and cut cleanly.
- **WRONG:** the deepest dip near Whisper's boundary of «Снимки, | горячее» (49.57 s, −42 dB, 60 ms). It was the «к»
  closure inside «Снимки»: the left half transcribed as «Снимка». The real comma gap was 0.3 s later (49.81–49.91 s,
  −70 dB). Whisper's word starts in a clip are ±0.2 s, too loose to choose between the two.
- No gap at all between «России» and «и внесена» (continuous at −14 dB): that pause went to the next sentence break.
- **RIGHT:**
  - Look for the gap on a 5 ms RMS profile, ±0.3 s around the ASR boundary.
  - Prefer the longest run below −50 dB over the single deepest frame.
  - Cut there with 8 ms fades and insert digital silence.
  - Transcribe the two halves separately (a 1–2 s clip each side). Both must be whole words.
  - Keep the list of cuts in the page (`EDL`, seconds of the source), so every word time shifts by itself:
    `V = t → t + VOFF + Σ(pause, cut ≤ t)`.
- **Music for the longer voice:**
  - Repeat a whole phrase (4 bars), chosen where the join is most similar: per-bar log spectra, bar i+4 against bar i
    and bar i+3 against bar i−1, compared at the same positions in the bar (0.991 here). Join with a 30 ms equal-power
    crossfade.
  - Then move the music's start so the groove ends under the final title. The beat entry moves with it; here it landed
    on a value word.

## 280. Pauses inserted before a word: Whisper's onset of that word can precede the cut, so the beat misses the pause

LIVE-VERIFIED 2026-10-23. In-phrase cuts sat in real gaps («Образ, | несколько», 41.663 s; the next word starts at
41.715). Whisper had «несколько» at 41.54, before the cut. With `V(t) = t + Σ(pause, cut ≤ t)` that word got no shift.
- Its beats fired 0.48 s early: the list tick, the focus frame, and the cut to the next screen state. The client saw
  this as «the highlight rectangles broke».
- Same for «сеть», «группа», «горячее»: every word right after an in-phrase cut.
- **RIGHT:** for each word after a cut, take its onset from the energy profile: the end of the quiet zone the cut sits
  in. Never take it from Whisper. Then check `V(word) − V(previous word)` against what you hear.

## 281. Wipes in a canvas film: the outgoing shot must keep its own camera; give it the camera from before the switch key

LIVE-VERIFIED 2026-10-23. A global camera list had a jump key (`d: 0`) at each new screenshot, 0.01 s before the
transition. The outgoing shot was drawn with `camAt(transitionStart − 0.001)`, which falls after the jump. So the outgoing
screen re-framed itself, often from a zoom to the overview, the moment the wipe began. That hid where we came from.
- **RIGHT:** put the camera jump exactly at the transition start, and draw the outgoing item with
  `camAt(start − 0.02)`.
- Page change: a horizontal push, 0.9 s. The old page leaves left, the new one enters right in the overview, with a
  6 px green seam.
- New state of the same page: a 0.3 s crossfade under one camera. Longer than 0.3 s, two different layouts read as a
  ghost image.
- Draw the focus overlay once, above both layers: a veil drawn per layer doubles.
- A drawn cursor clicks the control that causes each state change (field, list item, tab, «⋮», button). It moves
  0.65 s on glide, presses for 0.16 s at 0.86 scale, and is hidden during pushes. That is what makes a change
  «obvious» rather than «a cut».

## 282. A UI screenshot in a window of another aspect: fit the width and continue the page edges; fitting the height crops the logo

LIVE-VERIFIED 2026-10-23. Screenshots 1525×784 (1.945:1) sat in a 1256×685 window (1.834:1). The overview was fitted to the
window's height (z = 685/784), so 38 px were cut from each side: half the cloud.ru logo and the right end of the header.
The client: «скриншоты плохо обрезаны, есть обрезка логотипа и интерфейса».
- **RIGHT:** fit the width (z = window width / screenshot width). The window is then ~20 px taller than the screenshot above
  and below. Fill those bands with a one-row strip stretched vertically. For each column, take the brightest pixel of the
  first 2 rows (top band) or the last 12 rows (bottom band) of the screenshot.
- Panels, page margins and borders then continue into the band. Text that the screenshot's edge cuts does not streak,
  because a column through a glyph still has a light pixel above or below it.
- **WRONG:** stretching the last row itself. In an audit log the last rows held the tops of «Hostname:», «unknown»,
  «Name:», so the band filled with 20 px vertical streaks.
- Precompute the strips with a small script, as images. `getImageData` on a page opened from `file://` throws on a
  tainted canvas; drawing a prepared image does not.

## 283. Zoom into a UI screenshot only where every crop line falls in a gutter; otherwise stay on the overview and move the focus frame

LIVE-VERIFIED 2026-10-23. v3.2 zoomed to z 1.1–1.3 on almost every screen. The cuts went through the VM wizard's summary
panel, through the page tables behind modal windows, and through the header with the logo.
- Crop-line test: list the panel boxes of the screenshot (white components on the page grey, found by a script). A framing is
  clean only if all four edges of the view fall in a gutter between panels, or on the screenshot's own edge.
- A full-width header (logo left, account right) makes any zoom that includes it unclean: the view is narrower than the
  header. So a clean zoom has to start below the header.
- A modal over a page (QoS, network wizard) has the page's tables visible on both sides. No zoom between «whole modal» and
  «inside the modal» lands in gutters. A menu that opens over the header fails the same way.
- Here exactly one screen passed: the VM wizard, form and summary side by side, z 0.982, view x 104–1383, y 87–784. Every
  other screen stays on the overview, and the focus frame alone directs the eye.
- **Focus frame on adjacent panels:** panels 10 px apart need an outset of 2 px. With 6 px plus a 3 px stroke the frame
  lands on the neighbour.
- Take the rectangles from the panel boxes and the rows of the tables. Never guess them on a contact sheet: the «1:35 frame
  misses the block» came from such a guess.

## 284. A diagram that a push brings in must already be complete; check every hold with a timing dump

LIVE-VERIFIED 2026-10-23. Two complaints in one place: «1:09 странная склейка».
- A screenshot pushed in, held 0.96 s, and its focus frame lit for 0.2 s.
- Then a push brought an empty dark panel. The KeyVRM diagram built itself in it 1 s later.
- That reads as a broken edit, not as a transition.
- **RIGHT:** build the diagram before its push, off-screen (here 2.6 s before), and let it arrive whole. Light its states
  by the voice afterwards.
- Dump every screen's static time (next item − (start + push/fade)) and every focus frame's visible time from the page's
  own arrays. Flag anything under 1.2 s / 0.8 s. A frame visible 0.2–0.5 s reads as a flash. Fix it by lengthening the
  pause before the next section, not by shortening the frame.
- When a label changes on a crossfading element («в работе» → «нет связи»), fade the old one out over the first half and
  the new one in over the second (`alpha = clamp(2w − 1)`). Overlapped words read as garbage.
- Dark text on a chip fading from grey to green sits grey-on-green mid-way. Switch the text colour in the middle third of
  the fill change.

## 285. When the voice names abstract properties (mTLS, 2FA, SIEM), draw them; a screenshot that does not show them leaves the viewer guessing

LIVE-VERIFIED 2026-10-23. In v3.2 the security section put «взаимная проверка сертификатов, двухфакторная аутентификация,
интеграция с SIEM и LDAP» over a screenshot of the operations history, with a frame on its rows. The client: «непонятно что
выделяется и как это считывается с текстом слева и озвучкой».
- **RIGHT:** one small diagram in the same window, which arrives grey and complete. Each element lights on its word,
  together with the same item of the list in the left card:
  - mTLS: the links between the components sweep green, then the locks;
  - 2FA: a code types in, then «пройдена» and the arrow to the portal;
  - integration: arrows and blocks for SIEM (events out) and LDAP / Keycloak (accounts in).
- Keep the screenshots for what they actually show: the audit log (one event framed) and the operations history.

## 286. `use_figma` replies are capped at 48 KB; take a slide's geometry from its SVG export

LIVE-VERIFIED 2026-10-23. A plugin-API dump of one dense slide (every node's type, box, fills, strokes, text) failed on the
48 KB reply limit, and splitting it per group still clipped the diagram slides.
- **RIGHT:** `download_assets(fileKey, nodeId, defaultFormat: "svg")` per slide, then `curl` the returned URL. The SVG
  carries layer names as `id`s, text already outlined, absolute coordinates, image fills as `<pattern>` defs.
- List its elements in headless Chrome: document order is the z order, `getBoundingClientRect` gives every box.
- The export is not the reference. Compare against `download_assets(…, defaultFormat: "png", defaultScale: 2)` of the
  same node (quirks 287, 288).

## 287. Figma's SVG export drops image adjustments; bake them with a 3-D colour table fitted on the two renders

LIVE-VERIFIED 2026-10-23. An image fill with exposure +0.11 in Figma (a product render on a cover slide) came out of the
SVG export without the adjustment: 17.1/255 mean off on its opaque pixels.
- WRONG: a curve per channel (a red cast in the greys); one shared tone curve (6.88/255 left).
- **RIGHT:** rasterise the image unit alone at DPR 2 on a transparent background (`Emulation.setDefaultBackgroundColorOverride`
  with alpha 0). Map every pixel through a 3-D table fitted on the image's opaque pixels, Chrome's render against Figma's
  2x PNG: 8-level cells (32³), each the mean Figma − Chrome offset of its pixels, used where it holds ≥ 4 samples, the
  shared curve elsewhere. 0.61/255 on the opaque pixels, 0.34/255 over the slide. Switch the unit to the baked PNG.

## 288. Dashed strokes: Figma lays the dashes out per side and fills under the whole stroke; the SVG export does neither

LIVE-VERIFIED 2026-10-23. Six dotted boxes of a diagram slide landed with their dots shifted (up to 155/255 at the corners).
- Figma spaces each side's dashes evenly and symmetrically between its corners, with an L-shaped piece on every corner in
  the outer half of the stroke. The plate's fill runs under the whole stroke, so the gaps show the fill.
- The export gives one `stroke-dasharray` along the whole perimeter (Chrome starts it at the top-left corner), and the fill
  reaches only the stroke's centre line, so the outer half of every gap shows the background.
- **RIGHT:** bake each outline from Figma's 2x render. Render the film's own slide without the outline units (the exact
  background: the plate div covers the stroke), unmix the stroke colour over it inside the stroke band,
  alpha = Σ(F − B)(S − B) / Σ(S − B)², and switch the unit to that PNG. Unmixing over the export's render left 11–17
  levels in the gaps.

## 289. Chrome drawn once: hide the other slides' copies, and keep it out of every slide exit

LIVE-VERIFIED 2026-10-23. The logo and the footnote are on every slide of the export.
- An element with no tween keeps its CSS. The slides' own copies were never tweened, so they stayed visible: the footnote
  doubled on two slides. **RIGHT:** move slide 1's copies into a chrome layer; `display: none` on all the other copies.
- The moved copies still belonged to slide 1's unit list, so slide 1's exit sent them away. Slides 2–13 had no logo and no
  footnote, found only by the rest-frame diff (15 894 px off in the corner and the footer). **RIGHT:** the slide exit
  skips chrome units. The chrome changes only on purpose (the footnote fades out under a cover slide that has none).

## 290. A curtain in the top layer hides the slide it opens; a growing carry-over plate goes under the outgoing content

LIVE-VERIFIED 2026-10-23.
- The curtain panels are the top layer, so everything under the panel they shrink into stays hidden until the hand-over.
  Content that entered earlier popped into view at the hand-over. **RIGHT:** start the content under the target panel at
  the hand-over; images 0.1 s before it, so they are already fading in.
- A rule unfolding into the next slide's zone grew over the services that were still leaving, and the column split stayed
  on top of it. **RIGHT:** move the growing element to the bottom of its slide's stack (`insertBefore(firstChild)`), and
  send the lines that cross its path out first, before the slide's general exit.

## 291. An image unit from Figma's SVG export is a pattern-filled rect; scaled by CSS, the next tile bleeds in along its edges

LIVE-VERIFIED 2026-10-23. Every image entrance that scales (1.12 → 1 on the covers, 0.6 → 1 on icon bitmaps) showed a
faint 1-px line along the image box's top and left edges for its first second, there only while the scale was not 1.
- The export draws an image as `<rect fill="url(#pattern)">`, the bitmap placed in the unit tile by a transform that runs
  past the tile. Under a CSS transform Chrome re-rasterises the SVG at the new scale, and the wrapped neighbour tile (the
  bitmap's far edge) bleeds one pixel into the near edges.
- **RIGHT:** bake every image unit to a 2x PNG with true alpha (rasterise the unit SVG alone at DPR 2, transparent
  background) and switch the unit to it. It is Chrome's own raster of the same SVG, so the rest frames do not move (here
  ≤ 0.26/255 against Figma before and after); a scaled bitmap has no tiles to bleed.

## 292. A parallel render cut off by a power loss: keep the segments that closed, re-render only the open one

LIVE-VERIFIED 2026-10-23. A 4K film rendered as 4 segments of 2042 frames (a headless Chrome and a libx264 `slow` each,
all 16 threads busy) lost the machine 7.5 minutes in. Three segments had closed; the fourth was 240 frames short.
- Judge by the files, not the log. The log on the external exFAT drive lost its last lines: no «segment … done» line
  reached the disk for the three segments that had closed.
- MP4 writes its index (moov) only when ffmpeg finishes, and `+faststart` then moves it to the front. A segment cut
  off has none: `ffprobe` says «moov atom not found». It is lost; re-render it.
- A segment with an index can still hold unwritten data when the power goes right after it closed (one closed 11 s
  before). Decode each one in full (`ffmpeg -v error -i seg.mp4 -f null -` must print nothing) before keeping it.
- The kept segments must come from the page as it is now. Its file and libraries must be older than the run's start
  (the creation time of the open segment).
- **RIGHT:** re-render the open segment alone, with the frame range and encoder settings the parent gave it (job j
  covers frames j × ceil(N / jobs) up to the next job's first frame). Then join the same list with the concat demuxer,
  stream copy. One job is a quarter of the load; here it took 476 s.
- Prove the joins: compare the frames on both sides of every join against page stills, then the rest frames against
  the reference. Here every join matched to the pixel.
- Windows says why it went down. System event 6008 gives the time. Kernel-Power 41 with BugcheckCode 0 and no
  power-button press is a power loss or a hardware reset, not a software crash.

## 293. Screencast video in a canvas film: Playwright's Chromium has no H.264; play pre-cut frames, not a `<video>`

LIVE-VERIFIED 2026-10-23. A partner's demo film was rebuilt from its screencasts (H.264, 1920×1054, 60 fps). The bundled
Chromium of Playwright ships without proprietary codecs, so a `<video>` with an H.264 source never decodes there. Seeking a
WebM `<video>` per frame is not frame-exact either.
- **RIGHT:** describe each clip as `{src, in, out, speed}` (speed 0 = a still) in a JSON file. Cut its frames at the film's
  frame rate: `ffmpeg -ss in -t (out−in) -i src -vf "crop=…,setpts=(PTS-STARTPTS)/speed,fps=60" -q:v 2 -start_number 0
  frames/<id>/%05d.jpg`. Frame k of a clip is then film time t0 + k/fps, at any speed.
- The page fetches the frame and calls `createImageBitmap` on it. Keep a cache of about 16 bitmaps and `close()` the ones
  evicted. `render(T)` becomes async: it awaits the frames it needs (two during a push or crossfade), then draws
  synchronously. The renderer calls `await window.render(t)` before `toDataURL`.
- An odd crop height comes out one row shorter: `crop=1920:969` gave 968-row JPEGs, and the sheet was drawn stretched by
  a row. Crop to an even height.
- Cost: 100 s of screen at 60 fps is about 6 000 JPEGs, 0.5 GB, cut in under 10 s. Cut only the clips whose parameters
  changed (keep the parameters next to the frames).

## 294. A screencast as a sheet: cut the browser chrome and give the window the sheet's aspect

LIVE-VERIFIED 2026-10-23. The screencasts carried the browser's tab strip and address bar, which showed «localhost» on the
partner's own service. The brand film shows a sheet, not a window (§6 of product-demo-motion).
- Find the chrome's edge in the row means: the address bar ends at a 1 px separator line, and the page starts on the next
  row. Here that was y 84, the same in every recording made in that browser. Crop it off in the frame cut.
- The edge-band fill of quirk 282 cannot be precomputed for video: the page edge changes with every scroll. Give the
  window the sheet's aspect instead (here 1256×634 for 1920×968). The overview then fills it with no bands. Use
  z = window height / sheet height, so a fraction of a pixel goes off the sides rather than a hairline gap on top and
  below.
- Zooms follow quirk 283. In a web console, a wizard whose form and side panel stand centred on empty page grey allows
  z = 1. Keep the console header out of frame. Modal dialogs spanning the width, full-width record pages and dark admin
  panels with full-width cards stay on the overview.

## 295. Focus frames over screen video: only where the page stands still; find the stills by frame difference

LIVE-VERIFIED 2026-10-23. A focus rectangle is fixed in sheet pixels, so during a scroll the content slides out from under it.
- Find the still stretches first. Take the video at 10 fps, 480 px wide, in grey, and diff consecutive frames. Count the
  share of pixels that changed by more than 24 levels. Above 0.08 is a page change or scroll; 0.01–0.08 is a local change
  (typing, a dropdown, a badge); below 0.0004 the page is still. The cursor alone stays below the threshold.
- Measure the boxes on a frame inside a still stretch:
  - on a light UI, flood-fill the flat colour around a point inside the button or panel (tolerance 3–20 levels) and take
    the bounding box;
  - dark UI cards often differ from their container by only 10–40 levels and share borders, so a flood fill leaks. Read a
    luminance profile along one row and one column instead; the card edges are the steps.
- Hold each frame at least 0.8 s (quirk 284). In this film: 0.88–8.4 s, with none during the scrolls.

## 296. A loop for a booth screen: the finale rebuilds the opening title; render from the intro's rest time and diff the seam

LIVE-VERIFIED 2026-10-23. A booth film plays in a loop, so its last frame must be its first.
- Build the finale with the same title function and parameters as the intro: the same elements, the same rest
  positions. Elements that arrive differently are fine (a plate morphing back from the card, a frame shrinking back),
  as long as their rest rectangles are identical.
- The linear version renders 0 → TOTAL and builds the title from an empty frame. The loop version renders LOOP_IN → TOTAL,
  where LOOP_IN is a moment when the intro title is fully at rest. In the page, `?loop=1` sets the intro's entrance
  times far in the past.
- Verify: the still at LOOP_IN and the still at TOTAL − 1/fps must differ by 0. Here the mean and max absolute
  difference were both 0.

## 297. Recorded scrolls look jerky when sped up: hold the result, slide between freeze frames, or pan over a stitched page

LIVE-VERIFIED 2026-10-23. A screencast film played its clips at 1.4–2.5× to stay short. A wheel scroll is recorded as jumps
of 84–360 px with pauses between them, and sped up they come several times a second. The client: «скринкасты дёргаются
и где-то обрезаются на важных моментах».
- **RIGHT:** play clicks and typing at 1× (typing up to 1.25×). Hold every result as a freeze frame for 0.8–1.4 s, with a
  focus frame on it.
- **Short scroll** (the offset is smaller than the view): measure it between the two pauses (row-profile matching on the
  scrolling column; the best offset must beat the runner-up by 3×). Then slide: the old frame moves up by dy·e and the
  new one comes from +dy·(1−e). Both draw only the source rows of the scrolling region, so a fixed header never travels
  through it. Parts that do not scroll (a sticky side panel) crossfade.
- **Long form or document:** chain the offsets between consecutive pauses. A pair whose match is ambiguous over a blank
  area gets intermediate frames. Stitch the region rows into one tall page; each page pixel is the median of every pause
  that shows it, so the cursor and passing hovers vanish. The fixed parts go on top as an overlay with alpha. A camera then
  scrolls the page with ease-in-out and stops on the sections. Here: a 5708 px form from 27 pauses, a 15832 px report
  from 96.
- Progress bars may still run at 8–12×: they fill, they do not jump. A frame-difference scan of the window after the
  rework found jumps only where the UI itself changed (a dialog opening, a page loading after a click).

## 298. A Figma storyboard of builds as Path2D units on the film's canvas: rest frames exact, transitions from the layer diff

LIVE-VERIFIED 2026-10-23. A 19-frame storyboard: slides plus their «builds», frames where the next row, column or panel
appears. It went in front of a canvas screencast film as one timeline.
- **Data.** Each frame's SVG export (`download_assets`, `defaultFormat: "svg"`) gives the layer names as ids, outlined text
  and absolute path commands (M L H V C Z only). Parse it once into units:
  - a group whose children have their own ids is a container and passes only its opacity down. A column dimmed to 0.3
    keeps full-opacity units with `alpha` 0.3, so it can light up again;
  - a pattern-filled rect («dot field») becomes its grid: origin and pitch from `patternTransform`, dot size from the
    inner rect × the scale, the rect's opacity. Draw it procedurally, then it can reveal in a wave and slide;
  - text is split into lines by the vertical bands of its tall glyphs (subpaths at least 0.6× the median height). Small
    marks go to the band holding their centre. Words are split by gaps wider than a third of the line height;
  - a fill-less stroked path is a line; `Union` plus a masked image rect is the title's photo (draw it under
    `clip(Path2D(mask))`).
- **Drawing.** `ctx.fill(new Path2D(d))` with the export's fills draws the same anti-aliased outlines Chrome renders from
  the SVG. Rest frames match the design, and they stay sharp at DPR 2 and through scale morphs, unlike cut bitmaps.
- **Transitions.** Diff the layers of consecutive frames:
  - same drawing in the same place (signature = kind + hash of ops) → it stays;
  - same key, other geometry → it morphs. Rects lerp their geometry and colour; a dot field lerps its rect and grid
    origin; text and shapes crossfade while scaling by the line-height ratio, anchored top-left;
  - same key, same place, other text (slide number, a swapped heading) → it rolls: the old one exits up, the new one
    rises;
  - new → it enters by kind: words from a line mask, rules drawn on, tiles scaled in, panels wiped, dots in a wave,
    icons scaled from 0.7;
  - gone → it exits up while fading, latest-built first.
- **Z-order** is the new frame's document order, with exits underneath. An «enter everything at once» opening frame
  needs its own order (logo, shape, image, title, sub-line, dots): reading order would bring the photo in before the title.

## 299. Several versions of one film from one page: each part starts and ends on an empty frame, so every cut loops

LIVE-VERIFIED 2026-10-23. Three deliverables were asked for at the end: deck + demo, deck only, demo only.
- One page with `?mode=`, one timeline per mode, made of parts: the deck's frames, the demo with a time offset, the
  closing slide. Each deck part builds from an empty frame and ends with an exit plan to an empty frame. So the deck
  version (deck → closing slide) and the full one (deck → demo → closing slide) loop without a seam.
- The demo keeps its own seam: it starts at the moment its title is at rest, and its finale rebuilds the same title
  (quirk 296). In the full version, the same finale leaves after a hold, so the closing slide can build:
  - title words, stars, arrows and dots use the title's `out` time;
  - the frame lines fade;
  - the green plate folds to the left.
- Check each mode once: render every 0.5 s for errors, then compare the first and last frames by pixels. Here all three
  were 0.000 mean, 0 max.

## 300. A green progress bar on the bottom edge vanishes over a full-bleed photo or green shape: give it its own dark lane

LIVE-VERIFIED 2026-10-23. The deck's title has a 3D photo on a green ground that runs to the bottom edge (x 900–1860).
The §8c bar (green fill over an 8 % white track) drawn there:
- **WRONG:** fill and track straight over the slide. Over the photo's green the fill disappears, so for half of the title's
  hold the bar seems to stop growing; over the white plinth it shows. The track is invisible over both.
- **RIGHT:** under the track, a #222 lane of the bar's height at the bar's alpha. Then:
  - the unfilled part reads as a dark strip;
  - the fill front stays visible over any image;
  - the photo ends 4 px higher, which reads as the bar docked to the edge.

  The lane fades with the track, so the empty first and last frames of a part stay clean and the loop seam holds
  (diff 0).
- Check: a row of pixels at y = 1078 across the title. Here behind the front it was brand green (37, 209, 125), and ahead
  of it (51, 51, 51), the lane under the track, over the photo as well.

## 301. A hyphenated compound wider than a plate does not wrap: break it after the hyphen by hand

LIVE-VERIFIED 2026-10-23. A green card plate (40 px, max line width 432 px) got «Программно-определяемые сети».
- **WRONG:** relying on the word layout. It splits on spaces only, so «Программно-определяемые» (≈ 470 px) stayed one
  word. It ran past the plate's right edge and was cut by the plate's clip: «Программно-определяемь».
- **RIGHT:** `'Программно-\nопределяемые сети'`: the layout treats `\n` as a paragraph break, and the plate takes the
  width of its widest line.
- Dump every plate before rendering: lines and widest line against the max width. Also dump where each card list ends
  against the card's bottom. Here one install list of five steps under a three-line plate ended at y 1012 with the card
  ending at 965; four steps fit (882).

## 302. Tokens moving in a schematic collide with the ones at rest when their path crosses occupied rows

LIVE-VERIFIED 2026-10-23. VM chips migrating between hosts in a canvas diagram.
- **WRONG:** a generic path «up to a lane, across, down into the slot». An import from a side block crossed the target
  host's first row, where a chip stood. A live migration between two hosts went to a slot below two occupied ones.
- **RIGHT:** give every move a free row:
  - put the source chips on the same rows as their target slots, so an import is a straight horizontal slide;
  - send a live migration along its own row into a free slot of the neighbour;
  - when a move must change rows, run it in the gutter below the hosts (a lane under both slots), never through another
    host's slot column.
- Check with stills in the middle of every move, not only at the landings.

## 303. Focus frames on fast words: start every move from the frame as drawn; grow the frame over a list said in one breath

LIVE-VERIFIED 2026-10-23. A focus frame glides between targets in 0.6 s. The voice said «кластер — хост — виртуальная
машина» with the words 0.3 s apart. The client: «выделения… есть места, где ломаются».
- **WRONG:** lerping from the previous *target* to the new one. A new word arrived before the glide ended, so the frame
  jumped back to the previous target's rect and started over. It never settled and was caught between two rows.
- **RIGHT:**
  - the start rect of a move is the frame as drawn at the switch time, computed recursively along the chain;
  - for an enumeration said in one breath, keep one edge fixed and grow the frame over the items (cluster → +host →
    +VM). The frame moves smoothly even when the words come faster than the glide.
- Drop a focus that would live less than ~0.5 s before a page change: a 0.13 s frame on a new table row read as a glitch.
- Check with stills between the words, not only at the words.

## 304. A dragged object rides under the cursor; a restart is not a move

LIVE-VERIFIED 2026-10-23. Two diagram moves the client called sloppy («неаккуратные»).
- **Drag:**
  - **WRONG:** the chip and the cursor on separate eases, so they drifted apart. The chip was also wider than the
    focus frame, and its outer part was darkened by the veil.
  - **RIGHT:** one function gives the object's position, and the cursor is that position plus the grab offset. Show
    the cursor pressed (0.88) while dragging and released on the drop. The focus frame must hold the whole path.
- **High availability:**
  - a VM on a failed host *restarts* elsewhere: it dims on the dead host and boots on the neighbour (outline, a flash,
    the normal chip);
  - only live migration (maintenance) moves the chip. It travels along a lane under the hosts with rounded corners,
    and the lower chip of a column leaves first.
- On a green band, a moving or booting chip flashes white: green vanishes on green.
