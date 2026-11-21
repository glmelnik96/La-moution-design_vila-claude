# After Effects and ExtendScript quirks

Use these notes when writing or debugging host code, captures and HTML renders. Entry numbers are retained for lookup from other skill files.

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

Register helper and probe layers in the same windowing logic as the visible scene. A temporary layer left at its default in/out can affect other scenes.

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

## 19. Generate non-trivial jsx from Python, written with `encoding="ascii"`

Emitting the payload from a Python generator and writing it with
`open(path, "w", encoding="ascii")` forces every non-ASCII char to `\uXXXX`,
which is the only reliably safe way to get Cyrillic into AE text layers. Bonus:
the encoder **fails loudly** if a stray Cyrillic character slipped into a JS
identifier (a Cyrillic `о` in `var nо = ...` was caught this way before it ever
reached AE).

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

When shortening a transition, move its keys or retime the interval. Trimming mid-flight changes the motion at the cut.

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

Include a sample near the end of an ease-in. Midpoint captures can miss most of the visible movement.

## 70. Two helpers that tween the same prop on the same element cancel each other — camera on a wrapper

When two helpers animate the same property, put the camera transform on a wrapper and the local transform on its child.

## 71. `render.js` defaults to a 1920×1080 viewport — a story page is silently cropped

Pass the intended width and height to the renderer. The default viewport is 1920×1080.

## 72. CJK text and the line mask: split per character, and give the mask room

Use per-character splitting when a CJK string has no word spaces. Leave enough height for the glyph and its antialiasing.

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

Escaping to `\uXXXX` makes the *source* ASCII, but ExtendScript's `File()` on Windows is
not reliable with non-ASCII paths, so the fix is to mirror the assets to an ASCII root
(a local scratch directory) and reference that. Cheap, and it removes a whole class of flakiness.

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

## 86. `sourceRectAtTime(0)` includes the Text Animator's offset — read the rect BEFORE adding the cascade

**Same trap as quirk 81:** measure before adding a Text Animator.

Rows that persist across a cut were placed 7 px right / 11 px high on the next slide. Their
travel targets were computed from `L.sourceRectAtTime(0, false)` taken after `cascade()`
had been added: at t = 0 the selector offset is −RAMP, so every word is displaced by the
animator's Position (rise) and the reported box moves with it. Measure the layer once,
right after `align()`, and keep that rect for every later position.

## 89. Figma strokes sit INSIDE the rect (path inset 0.5) — AE rect shapes centre the stroke on the path

`M40 0.5H…` in every Figma SVG: a 1-px stroke occupying exactly the outer pixel row. An AE
Rect shape of the same size strokes on the path itself, so the stroke straddles the edge —
two half-covered rows, a dim 2-px halo, and the ink box grows by one px on every side (also
breaks a `>60` verification where a #4C4C4C box at 50 % falls below the threshold). Emit
the rect as `[w − sw, h − sw]` at the same centre with roundness `r − sw/2`.

## 95. ExtendScript parses a nested ternary LEFT-associatively — `a ? X : b ? Y : Z` picks the wrong branch

`live.justification = (j === "center") ? CENTER : (j === "right") ? RIGHT : LEFT;` set every
centred paragraph to RIGHT. ExtendScript evaluates it as `((a ? X : b) ? Y : Z)`: for
"center" the inner result CENTER is truthy, so the outer picks RIGHT; for "right" the inner
gives `true`, so RIGHT again (correct by accident); only "left" falls through to LEFT.
Probe: three 2-line layers built with the same function came back 7414 / 7415 / 7414.
Use `if / else` (or parenthesise every nested ternary) in anything sent to AE. `M.text` itself used
this ternary until 2026-09-25 (fixed with if/else).

**Verification:** a block's bounding box can be identical across alignments. Compare the
visible ink range of each line in both renders.

## 100. Figma soft line breaks are U+2028 and can break MCP transport

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

Apply the inverse image-fill transform before computing AE anchor and position. See `art-kit.md` for the affine map.

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

## 110. `getStyledTextSegments` gives everything per run in one call

Per-run fontSize, fontName, fills, lineHeight, letterSpacing, listOptions and indentation in a
single call per text node — no second "details" query, and it exposes list paragraphs (#103)
without a separate `getRangeListOptions` sweep. Store `[start, end, rgb, size, style, lh, ls,
listType, indent]` and derive paragraph indices from the "\n" count before `start`.

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

## 123. An "upscaled" PNG may have lost its alpha

The 2× upscale of the emblem (Lanczos through the generation pipeline) came back flattened on
white; only the original export kept transparency. When a logo shows a plate behind it, check
`Image.open(f).mode` / alpha extrema of the SOURCE file before blaming blend modes — and keep the
original next to the upscale.

## 126. Hue/Saturation matchNames are off by one from the panel order

`ADBE HUE SATURATION-0004` is **Master Hue**, `-0005` Master Saturation, `-0006` Master Lightness,
`-0007` Colorize (`-0002` Channel Control, `-0003` Channel Range — there is no `-0001`). Setting
`-0004` to −72 rotates the hue by 72° instead of desaturating: duotone book scans came out green and
magenta and the mistake is invisible on neutral photos. Dump the effect once (name | matchName) before
setting anything by number; the review captures caught it, the numeric result did not.

## 143. A 120 s CDP timeout is not a modal: check the CPU before you stop

A long composition build can hold up the bridge while the host continues working. Check host activity before retrying; use milliseconds for the timeout.

## 156. Blend modes over an empty comp background render as Normal: lay an opaque floor

A composition background colour does not create pixels. Add an opaque floor if a blend mode needs a base layer.

## 159. Setting `inPoint` moves `outPoint`: always assign startTime -> inPoint -> outPoint

Set `startTime`, then `inPoint`, then `outPoint`. Read the values back if the source has been retimed or moved.

## 160. Effect point parameters on a TEXT layer are comp coordinates, not `sourceRectAtTime` space

Effect points on text layers may use composition coordinates. Verify with a captured frame before placing a ramp from ink bounds.

## 167. Effects on shape layers do not scale with the parent

**Same mechanism as quirk 160:** effect points are in comp pixels.

LIVE-VERIFIED 2026-09-23. Shape layers are continuously rasterised: their effects run after the
layer transform, in comp pixels. A Gaussian Blur on a shape layer parented to a shrinking door keeps
its screen radius — a 150 px shadow blur on a door shrunk to 190 px swamps it. Drive the radius by
the parent's scale: `base * thisLayer.parent.transform.scale[0] / 100`. Solids and footage (not
continuously rasterised) apply effects in layer space and scale on their own.

## 170. `ae.js --timeout` is in milliseconds; "CDP timeout (0s)" means units, not a modal

**See quirk 63** (the same linter false positive).

LIVE-VERIFIED 2026-09-23. `--timeout 300` failed at once with "CDP timeout (0s) — a modal dialog is
probably blocking AE", but there was no modal: the payload kept running in AE and finished (the file
it writes appeared). WRONG `--timeout 300`; RIGHT `--timeout 300000`. When the message says (0s) or
(1s), check the file/state the payload produces before calling AE again — a second call queues
behind the one still running. Separately: `lint-jsx.js` warns "last statement does not call
JSON.stringify" for every multi-line `JSON.stringify(M.run(...))` payload, because it only scans
the last three lines; the payload returns normally.

## 175. Resolve the target comp by exact name

Resolve the target comp by exact name, check that it is unique, then read its layer names before writing.

## 176. Verify collapse transformations on pixels

Compare a captured frame after changing Collapse Transformations and cameras. Composition metadata alone can miss a change in projection.

## 180. Keep composition identity during a duration change

Extend the existing composition when its identity matters to Dynamic Link. Recheck keyframes, layer visibility and expressions after a duration change.

## 181. Snapshot the comp before rebuilding and escape string literals

Duplicate the target before a destructive rebuild. Use a generated file for non-ASCII JSX and escape string literals before calling the bridge.

## 182. Save the correct render state

A solo switch changes every comp that uses the source. For unattended rendering, save the intended state and verify the result in a separate process.

## 183. Verify retimed source boundaries

Check the rendered interval at the source boundary when changing clip speed or extending a template. Inspect a captured frame at the actual seam.

## 184. Verify unattended aerender output

Use a watchdog, inspect the output with ffprobe and distinguish encoding from finalization. A process that returns or stalls may still leave an invalid container.

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

Use the installed PostScript name for each type style. In SB Sans Display, the bundled SemiBold uses `SBSansDisplay-Semibold`. Check the resolved font.

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

Split large Figma reads into bounded requests. Export JSON to a local file when text, geometry and style runs would exceed the response cap.

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

## 193. Render delivery sizes with a device scale factor, not a CSS scale()

Set the device scale factor and viewport dimensions explicitly. Rendering larger with a CSS scale can introduce resampling.

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

## 196. Shared fractional edges: Figma blends by coverage, the browser composites in order

Adjacent fractional edges can leave a seam when the browser composites their coverage. Overlap them or paint a common background below both.

## 197. Review comments with the matching frame revision

When the connector cannot retrieve comments, request comment text or a screenshot and verify which frame revision it refers to.

## 198. A fractional text baseline lands on a whole pixel — Chrome and Figma may pick different ones

Compare Figma and Chrome baseline rounding by sampling text ink at the target device scale. Adjust the placement without moving unrelated lines.

## 199. A frame's stroke in the dump can be invisible in the render: its children cover it

Check the export before drawing a stroke from metadata. Children can paint over it when the frame does not clip them.

## 200. Animate does not kern CFF fonts (no legacy `kern` table): GPOS kerning has to go into letter spacing

LIVE-VERIFIED 2026-10-02 (Animate 2024 24.0.15, SB Sans Text Medium / Display, static text, autoKern on or off).

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

## 205. Published static text and complex shapes are 2× bitmaps

LIVE-VERIFIED 2026-10-02 (Animate 2024 default HTML5 Canvas profile: export as spritesheet, resolution 2).

- Static text and the vector logo were exported as `CachedBmp_N` sprites in an atlas at 2× the stage; plain shapes
  stayed vector. On a 2× screen it is crisp; at 11× (a 728x90 shot at Figma scale) text and logo are soft while
  boxes and dots are sharp.
- **RIGHT:** verify a canvas publish at stage size or 2×; tell the client Publish Settings → Image → Resolution 3
  for 3× phones (heavier atlas).

## 213. A Figma frame's own fill shows wherever its children leave a gap

- The state frames of one section had fills of their own — white, brand green or #222 — under every child. A dump
  that walks only `frame.children` misses it. The gaps were small (the strip of a header band beside its plates), but
  on three formats the HTML showed the page colour there and the diff tripled (mean 4 → 1.8 after the fix).
- Read `frame.fills` and paint it as the first layer; in a fluid banner it extends with the background.

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

Read the current platform documentation and verify whether size limits apply to a ZIP, HTML file or asset before implementing the package.

## 217. `copyToComp` pastes above the selected layer of the target comp, not at index 1

LIVE-VERIFIED 2026-10-08 (AE, an LED-show film rebuilt). Building a comp from layers of another one:

## 218. Time remap on a layer that was just moved: enable it first, set in/out after, read back

Enable Time Remap first, then set the layer's in and out points and read them back before changing the keys.

## 220. Removing every Time Remap key switches the property off

Keep at least one Time Remap key while updating the curve. Removing them all can disable the property.

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

## 231. ffmpeg `apad` before `amix=duration=longest` never ends: 140 GB in four minutes

Bound padded audio before mixing with `amix=duration=longest`. Verify the final output duration.

## 233. Before `proj.save()`, check every render lane, not only the one you started

LIVE-VERIFIED 2026-10-13. With three render lanes running (two from one script, one from another), a save was cleared
by looking at one lane's progress. Another lane's part had 98 frames left; at about 100 frames a minute its next
aerender would have started within a minute, in the middle of the 10-second save (quirk 225). It finished after the
save by luck.
- Before every save, read the last PROGRESS frame of every running aerender log against that part's end frame.
- Save only when each one has more than about two minutes left, or has just started rendering (past its launch).
- A part that renders static stretches can speed up several times near its end, so leave a wider margin there.

## 239. Figma layers one by one: `get_screenshot(child, contentsOnly)` is transparent, `download_assets` is not

Test exported layers against the composited frame. Some Figma export modes flatten against background colour; use an alpha-capable route for isolated layers.

## 241. motion.js: a lone `tl.set(el, {opacity: 0}, t)` hides the layer from frame 0

LIVE-VERIFIED 2026-10-13. Before its first tween a property holds that tween's FROM value. A layer that should be visible
until 2.42 s and vanish then, written as `tl.set(dark, { opacity: 0 }, 2.42)`, was invisible from the first frame; the
page still looked plausible because other layers covered most of it.
WRONG `tl.set(dark, { opacity: 0 }, 2.42)`
RIGHT `tl.fromTo(dark, { opacity: [1, 0] }, { at: 2.42, dur: 0, ease: 'linear' })`

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

## 260. A warm-up film that cuts into a loop file: render its tail at negative loop time

To continue a loop from an introductory file, render the intro tail at negative loop time. Use positive modulo for periodic functions.

## 264. A font installed per user stays invisible to AE until the Windows session loads it

Check font availability in the Windows session running AE. After installing a per-user font, reopen the app and verify its PostScript name.

## 265. A layer placed at a negative startTime: set its outPoint after its inPoint

Set a negative `startTime` before setting the in and out points. Read the visible interval back.

## 287. Figma's SVG export drops image adjustments; bake them with a 3-D colour table fitted on the two renders

Compare an SVG image fill with the Figma raster. If adjustments disappear in SVG, export that layer from Figma or recreate the colour transform.

## 288. Dashed strokes: Figma lays the dashes out per side and fills under the whole stroke; the SVG export does neither

Compare dashed strokes per side and rebuild with explicit SVG paths if the export changes the dash cadence or exposes the fill.

## 290. A curtain in the top layer hides the slide it opens; a growing carry-over plate goes under the outgoing content

Put a carry-over wipe behind outgoing content when the new surface must emerge under it. Audit stacking order at the first uncovered frame.

## 305. Verify the delivered QR code

Replace links only with provided destinations. Verify the QR decodes from the final compressed frame after cropping and scaling.

## 306. Git Bash's `sed` drops the CR of CRLF lines: a patch copied from its output does not match

LIVE-VERIFIED 2026-10-26. A scripted replace guarded by `s.count(old) == 1` failed on a CRLF `deck.js`. The old text had
been copied from `sed -n` output.
- MSYS `sed` reads in text mode and prints LF: `sed -n 7,10p f | od -c` shows no `\r`, while `sed -b` and `cat` keep it.
  A `grep -c $'\r$'` on the file counts every line.
- **RIGHT:** take line endings from the bytes (`open(f, 'rb').read().count(b'\r\n')`). Read with `newline=''`, turn the
  patch's `\n` into the file's newline before matching, and write back with `newline=''`.
- Write such patch scripts to a file, not a Bash heredoc: the heredoc turns `\\r` into `\r`, and the script then writes a
  real CR into the text. Git stops normalising a file with a lone CR, and the whole file shows as changed.
