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

**LIVE-VERIFIED 2026-11-02 — GUI queue fallback when aerender never starts frames.**
AE 26.5: two small aerender probes stopped after the version banner, with near-zero CPU,
no renderer child and no output file; the exact cause was not established. Do not keep launching
copies or infer a project defect. Stop only the identified, task-owned stalled probe, preserving
the GUI and other Adobe processes. Build and inspect the render queue via JSX, save, then click
**Render in the GUI** through desktop control (not `renderQueue.render()` inside CDP).
The GUI queue produced a verified 1920×1080, 25 fps, 600-frame MP4 from the same saved project.
While it runs, monitor output files and the UI; do not queue more host scripts behind rendering.
An `.m4v` temporary file can stay at 0 bytes during processing: use changing UI frame counts,
not its size alone, as the progress signal. Verify the finished MP4 with ffprobe and a decode.

**LIVE-VERIFIED 2026-11-18 — asynchronous GUI queue fallback and delayed MP4 visibility.**
In the Люди ремесла v08 award batch, `aerender` again stopped at the version banner with no child renderer and near-zero CPU. The already saved GUI queue was valid. `app.scheduleTask("app.project.renderQueue.render();",1000,false)` returned immediately through the bridge and started that queue a second later. This avoids keeping a CDP evalScript promise open for the whole render. Once scheduled, do not send further host scripts until rendering ends; monitor the render log and completed outputs. Use only when the saved queue has been inspected and contains exactly the authorized outputs.
The first 60 s / 25 fps FullHD award took four minutes. Its temporary `.m4v` remained zero bytes until finalization, while AE CPU time grew; this alone was NOT a stall. The completed MP4 contained all 1500 frames and passed full decoding. GUI accessibility progress can remain stale during scripted rendering: prefer completed-composition log entries and ffprobe. A warning about renaming `Prefs-indep-render.<pid>.<tid>.txt` was cleared by the user; do not repeatedly enqueue save or queue mutations behind this modal. No root cause of that preference warning was established.

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

**Rechecked 2026-11-02 — editable metallic type, including a scale/position entrance.**
Before tuning effect colours, capture one word with a conspicuous ramp: wrong coordinates can
make both the ramp and sweep look static. Use these expressions on the TEXT layer itself:
```js
// Ramp Start; End uses r.top+r.height instead of r.top.
var r=thisLayer.sourceRectAtTime(10,false);
thisLayer.toComp([r.left+r.width/2,r.top]);
```
Here 10 is a settled reference time; adapt it when source text changes over time. A tested stack
is `ADBE Ramp` → `ADBE Bevel Alpha` → `CC Light Sweep`; retain editable text. At 5120×2880,
bevel 3.3 px / intensity 0.6 on large headings, 1.2 px / 0.32 on supporting type kept thin strokes
readable. These are starting values, not scale-independent defaults. See #208 for the moving band.

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


**Rechecked 2026-11-02 — expression sweep with an unlit reset.** For a 10 s pass on text:
```js
// Center (comp coordinates; #160)
var r=thisLayer.sourceRectAtTime(10,false);
var u=((time+0)%10)/10; // replace 0 by the same phase in BOTH expressions
var s=clamp((u-0.12)/0.76,0,1);
thisLayer.toComp([r.left-1.2*r.width+3.4*r.width*s,r.top+0.5*r.height]);
// Sweep Intensity
var u=((time+0)%10)/10;
var s=clamp((u-0.12)/0.76,0,1);
38*Math.pow(Math.sin(Math.PI*s),2);
```
Smooth shape, direction −25°, width around 0.7×glyph height worked for large gold headings;
supporting silver used intensity 13 and phase 2.4 s. Fade to zero during reset as well as moving
outside the glyphs. Verify the settled interval: capture t, t+period and t−1/fps, t+1/fps.
Equality of t and t+period alone proves periodicity, not a smooth seam; compare the adjacent
steps too. Tested 10/20 s frames were identical, with equal steps either side of 10 s.

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

## 307. `precompose()` leaves the moved layers' references dead; undo a failed run with command 16

LIVE-VERIFIED 2026-10-27. A group null and its children went into a precomp, then `pl.label = g.label` read the moved
null: `ReferenceError: Object is invalid`. The run stopped with half its work in the undo group.
- **WRONG:** touching a layer you just moved with `comp.layers.precompose(idx, name, true)`.
- **RIGHT:** read what you need (label, geometry, names) before the call. Afterwards find the new layer by
  `layer.source.id === newComp.id`; the moved layers live in `newComp` now.
- **Undo a failed `M.run`:** `app.executeCommand(16)` is Edit › Undo and reverts that whole group. Read the state back
  (item and layer counts) before you rerun. `app.findMenuCommandId("Undo <label>")` returns 0, and
  `findMenuCommandId("Undo")` returns an unrelated id (2371): use 16.

## 308. One precomp per asset, sized to the asset, with no pixel of change

LIVE-VERIFIED 2026-10-27. Two scene comps held 12 imported Figma assets (texts and shapes, a group null each). Each went
into a comp of its own size. Full-res frames before and after differ by at most 2/255.
- **Box:** the corners of `sourceRectAtTime(0, false)` through the parent chain (position, anchor, scale, rotation),
  nulls skipped. The rect leaves out strokes (a horizontal line has height 0), so pad it.
- **Origin and size:** origin = floor(box) − pad; size = ceil(box) + pad − origin, rounded up to even.
- **Move:** `precompose(indices, name, true)`, then `newComp.width/height = W/H`. The layers keep their coordinates from
  the top-left; shift the top-level ones by −origin, and the children follow their parents.
- **Place:** precomp layer anchor = [W/2, H/2], position = origin + [W/2, H/2]. Both are whole pixels, so nothing is
  resampled, and the content keeps its fractional offsets inside.
- A group null whose children all move goes in with them, and the hierarchy stays. A child that moves without its parent
  gets `L.parent = null` first: that compensates, `setParentWithJump` would not.

## 309. A callout line between a block and a track point: two nulls and `parent.toComp(position)`

LIVE-VERIFIED 2026-10-27. Callouts (number block → shelf line → diagonal → square on the tracked object) had to stay
movable after tracking. The block goes into a precomp; the line and the square stay outside it.
- **Rig:** the polyline is a 2D shape layer with an identity transform, its path built by `createPath` in an expression.
  Null A is parented to the block's precomp layer at the line's start, with a Slider for the shelf length. Null B is the
  track point: the user parents it to a tracker null or applies 2D track data. The square's position follows B by
  expression.
- **The screen point of a null, whatever its own 3D switch** (a 2D null parented to a 3D null, with a camera):
  - WRONG: `C.toComp(C.anchorPoint)` returned [780, 640], the parent's position plus the child's offset. The camera, the
    Y turn and the depth were dropped.
  - RIGHT: `C.hasParent ? C.parent.toComp(C.position) : C.toComp(C.anchorPoint)` returned [877.5, 765.0], the point of a
    3D null at the same local position.
- **The shelf follows the block:** the elbow is `A.parent.toComp(A.position + [shelf, 0, 0])`, in the parent's space. It
  turns, scales and foreshortens with the block, 2D or 3D. Checked on a throwaway copy of the scene: an 8° turn; a 3D
  block turned 35° in Y under a camera; a track null pushed back in Z. A red 3D marker rendered exactly under the square.
- **Keep the layout's end offset.** Measure where the line ends relative to the square's centre in the source: here
  (−0.72, 0.5) in one design, and (0, 10.5), the square's bottom edge, in the other. Add it in screen px. Without it the
  diagonal turns by a fraction of a degree, and the frames no longer match the layout.

## 310. An odometer roll on a live text layer: two copies, one keyed slider, a mask window

LIVE-VERIFIED 2026-10-27. Six infographic numbers («100 %», «1.933.948 ₽», «1,62», «+37 %», «15», «11») had to land with a
digit roll, and the last frame had to stay the designer's text.
- **Check that the digits are tabular first.** Measure the right ink edge of "0d0" for d = 0…9: SB Sans Interface Semibold
  gives 242.37 px for every d (150.66 pt, tracking −30). Then any digits keep the layout, and one text layout serves every
  state of the roll.
- **CUR (the original layer):**
  - a Slider «Счёт» keyed 0→100 with the `count` ease;
  - the Source Text expression builds the string column by column:
    `p = (digit + 10·turns) · clamp(slider.valueAtTime(time − col·stagger) / 100)`, and the shown digit is floor(p) mod 10.
    Separators stay as they are;
  - an animator with Position [0, −pitch] and an Expression Selector (`ADBE Text Expressible Selector`, amount
    `ADBE Text Expressible Amount`) lifts each digit by its phase, frac(p).
- **NXT (a duplicate):** shows floor(p) + 1 and sits (1 − phase)·pitch lower. Its separators get 100 %, which pushes them
  out of the window. Its opacity and position are expressions of CUR's, and its own copy of the slider is removed.
- **The window:** one rectangular mask per layer.
  - Span: from the cap top (−0.72·size) to the baseline (+0.02·size, or +0.19·size with a comma), plus 0.07·size of padding;
    feather [0, 0.05·size].
  - Pitch: the window's height + 0.06·size.
  - Masks are in layer space, so the animator moves the glyphs while the window stays.
- `turns = 1` makes zero columns roll a full turn. Columns land left to right, 60 ms apart, with layer motion blur on. The
  last frame matches the static text to 0–1/255.
- `addProperty("ADBE Text Animator")` by script adds no Range Selector: add the Expression Selector yourself.

## 311. Stagger on the brand curve: one keyed slider read at `time − i·stagger`

LIVE-VERIFIED 2026-10-27, on the same blocks.
- **The pattern:** a Slider keyed 0→100 with M.tween's exact bezier carries the ease. An expression reads
  `slider.valueAtTime(time − i·st)`, where i is a character (`textIndex` in an Expression Selector), a digit column or an
  icon's bar. Every element gets the same curve, shifted; the timing lives in one property in the Graph Editor.
- **A label on a wiping plate:**
  - The plate's group anchor moves to its left edge (position compensated), and Scale X goes from 0 to its final value.
  - The label's characters rise from under the plate: an animator with Position [0, 1.3·size] and amount
    100 − slider(time − (textIndex − 1)·18 ms).
  - The label's mask is the plate's rectangle, and its right edge follows the plate. The mask path expression scales the
    width by `content("rect").transform.scale[0] / finalScale`, so the dark text never shows past the white plate.
- **Stroked icons grow without stretching the stroke:**
  - Bars are path expressions: `createPath`, with the top vertices at bottom + (top − bottom)·u.
  - An arrow's shaft extends from its start vertex, and its head opens from the corner vertex: `add(c, mul(sub(p, c), u))`.
    The JavaScript engine needs add/sub/mul for arrays.
  - Zero-length paths with butt caps draw nothing.
- **A Trim Paths draw-on must sit above the Stroke.** `addProperty("ADBE Vector Filter - Trim")` appends it after the Stroke;
  follow it with `moveTo(strokeIndex)`.

## 312. Retime a precomp layer so that its frame 0 is the entrance

LIVE-VERIFIED 2026-10-27. Precomp layers placed by tracking started at 0 with a trimmed in-point (2.46 s, 3.33 s), so the
animation inside would have had to start at those times.
- `L.startTime = t` moves the in-point and the out-point with it. Set `L.inPoint = t` and `L.outPoint = oldOut` afterwards.
- Do it only when the layer's transform has no keyframes (they move with startTime) and no time remap. Tracking through a
  parent null is safe.
- Every block then animates from its own frame 0, and sliding the layer in the scene retimes the whole block.

## 313. A new shape layer sits at the comp centre: paths drawn in comp pixels land half a comp away

LIVE-VERIFIED 2026-10-27. `comp.layers.addShape()` creates the layer with Position at the comp centre and Anchor
[0, 0]. Its layer space is therefore shifted by half the comp:
- a rule written in comp coordinates went off the bottom edge;
- corner brackets bunched up in the middle;
- a background panel slid into the bottom-right quarter.

**RIGHT:** right after `addShape()`, set Position (and Anchor) to [0, 0] whenever you draw in comp coordinates.

## 314. A number that keeps growing after it lands, and styling variants made by copying

LIVE-VERIFIED 2026-10-27.
- **Growth.** This extends the odometer of quirk 310.
  - The slider keeps going past 100: 0→100 is the entrance, and every further 100 is one step to the next value of a
    list (all values the same width).
  - Per column, p gains the forward digit delta × clamp((s − 100k) / 100). Carries come for free: 19→20 rolls both
    columns.
  - The steps are keyed with M.tween (`enter`, 300–350 ms), so the user retimes the growth in the Graph Editor.
- **Grid cells grow with the count:** a white Rect + Fill subgroup inside a stroked cell, scaled up from its bottom edge.
- **Variants:**
  - `CompItem.duplicate()` keeps keys and expressions, and `thisComp.layer(...)` references resolve inside the copy.
  - A scene copy plus `layer.replaceSource(variantComp, false)` keeps the tracked transforms and the parenting. The layer
    name follows the new source if it was never renamed.
  - A variant comp made taller at the bottom keeps its place in the scene, because the scene layer's anchor stays.
- **Quirk 95 struck again** in a generated payload: `k === "B" ? f() : k === "V" ? g() : h()` ran both f and g. The linter
  now rejects a ternary nested in an else branch.

## 315. A tracked callout from a 3D block to a 3D track point: put the elbow on the target's side, and decide it once

LIVE-VERIFIED 2026-10-27, in two scenes with a 3D Camera Tracker camera.
- **The rig** is quirk 309 on 3D blocks:
  - null A (2D) is parented to the block's 3D precomp layer at the rule's start;
  - null B is the tracker null;
  - the polyline runs shelf, then diagonal.
- **The elbow side:** if the target sits left of the shelf's middle, the path is [right end, left end, target];
  otherwise [left end, right end, target]. Without this the diagonal doubles back over the block.
  - Decide once, at a reference time (the block's start + 1.2 s), with `toComp(point, t)` and
    `position.valueAtTime(t)`.
  - Deciding per frame flips the elbow whenever the camera carries the target across the middle.
- **Scale:** stroke width and marker size follow the block's projected scale,
  k = max(|projected shelf| / shelf, |projected 100 px up| / 100).
- **Timing:**
  - The draw-on is trim End = expo-out of (time − pre.startTime − delay), so sliding the block in time retimes its line.
  - The line exits with the block when the block's out-point comes before the comp's end.
- **A target right above the block** makes the diagonal cross the numbers. Give such a block no callout; here that was
  profit, which has no physical object to point at.

## 316. Cells that light up and then fill: hold-keyed flicker, and the helper outline off at the fill

LIVE-VERIFIED 2026-10-27. Grid squares (5 × 4, 8 filled in the design) had to light up and then fill, instead of scaling
in.
- **Light up in place:** group opacity hold keys 0 → 100 → 30 → 100, one frame apart, in a pseudo-random order over
  about 0.4 s. Seed the order the same way for every copy of a block.
- **A cell that ends filled needs an outline before it fills.** Add a sub-group: a rect 2 px smaller than the cell with a
  2 px stroke, which matches the hollow cells. Fill Opacity then goes 0 → 100, with a dip, in counting order.
- **Switch that outline off once the cell is filled.** A fill and a stroke whose outer edges coincide compound their
  antialiasing: the last frame differed from the layout by 64/255 along the edges. With the outline off it differs by 0.

## 317. An odometer that counts the real value — carries both ways, leading zeros hidden

LIVE-VERIFIED 2026-10-27. «Загрузка кранов» had to count 0 → 100 % over 3 s and later fall slowly to 0 %. «Продавцы»
had to count to 9, then 10, then 11. The per-column roll of quirk 310 lands on the right digits, but its intermediate
numbers are not real values.
- **Model:** one Slider «Значение» holds the value V; the keys carry the easing. A column of power 10^i sits at
  pos = floor(V / 10^i) + clamp((V mod 10^i) − (10^i − 1), 0, 1); units sit at pos = V.
  - The shown digit is floor(pos) mod 10, the incoming one is floor(pos) + 1, and the phase is frac(pos).
  - CUR/NXT and the window from quirk 310 stay as they are.
  - A falling V rolls the digits downward with the same code.
- **Leading zeros:** a second animator with Opacity 0 and an Expression Selector makes a CUR digit transparent when
  i > 0 and floor(pos) == 0. The string keeps its length, so per-character indices never shift, and «9» sits in the units
  slot of «11».
- **Grid fill with the value:** fill cell k when V crosses gridMax·(k + 1)/cells. Find the crossing times by sampling
  `valueAtTime` frame by frame, and never fill a cell before its own light-up.
- **Easing:** a front-loaded count ease (`count`) makes the first digits, and the cells, race. For visible counting use
  a gentle ease such as [0.3, 0.15, 0.3, 1].

## 318. A callout to a person's body: track the torso with OpenCV, write the track into a 2D null

LIVE-VERIFIED 2026-10-27. The 3D Camera Tracker nulls sat on a client's face and on a static point that a moving seller
walked off. The user wanted the dots on the bodies.
- **Tracking:** LK optical flow (`goodFeaturesToTrack` inside a head-to-waist box, `calcOpticalFlowPyrLK` with a
  forward-backward check under 0.8 px). Move the box by the median flow and scale it by the median change of pairwise
  distances, clamped to ±5 % per frame. The dot sits at a fixed offset from the box centre (head → chest), scaled with
  the box.
- **Drift between neighbours:** during a fast pan, the backward track from a late reference jumped to the man standing
  next to the client. Track that early segment from its own reference frame and blend the two tracks over 6 frames.
  Review zoomed crops every 4–6 frames before using a track.
- **Occlusion:** while someone walks in front, the dot has no body to sit on. Start that line's draw-on once the person
  is visible (here 0.95 s after the block appears), and hold the first tracked key before it.
- **Into AE:** with the footage at identity in a comp of its size, comp px = footage px.
  `position.setValuesAtTimes(times, values)` writes about 100 keys in one call; set them LINEAR. The quirk 315 rig then
  targets the 2D null unchanged.

## 319. A value odometer that starts at a non-zero value: the digits rise into their window, then step

LIVE-VERIFIED 2026-10-28. «Продавцы» had to appear at 9 and step up to 15 «по-тихоньку»; «загрузка кранов» had to
appear at 15 and grow to 100 together with the building in the footage. Both run on the value odometer (quirk 317).
- **Entrance without counting from 0:**
  - the value slider holds the start value: `setValue(start)`, then the first tween key starts at the same value;
  - a third animator `CR_in` on CUR has Position [0, pitch] and an Expression Selector with amount
    100 − clamp(slider(time − (textIndex − 1)·60 ms), 0, 100), driven by a keyed Slider «Появление».
  - The CR_window mask lives in layer space, so the digits rise from under the baseline. NXT stays one pitch below,
    hidden, because the phase is 0.
- **Steps that settle:** one M.tween per +1 step (200 ms, `enter`). Space the step starts with slowly growing gaps
  (here 230 → 270 ms) and leave at least 0.4 s on the final value before the layer ends.
- **A grid that grows with a non-zero start:** the cells worth the start value (gridMax·(k+1)/cells ≤ start) fill in a
  fixed counting-order cascade right after they light up. Each later cell fills when V crosses its threshold, found by
  sampling `valueAtTime` frame by frame.
- **Re-time an entrance inside the precomp when the scene layer can't move.** Here the layer's position was keyed for
  tracking, so moving `startTime` would shift those keys (quirk 312). Instead move every key inside the precomp by Δ:
  - read time, value, in/out interpolation, temporal ease and spatial tangents;
  - remove all keys, `setValueAtTime(t + Δ)`, then restore interpolation, `M._setEase` and tangents;
  - clear the value slider first, because the keys you re-create replace its old ones.

## 320. Figma text into AE 1:1: one layer per style run, placed by ink-box centre against a 1:1 render

LIVE-VERIFIED 2026-10-28. A Figma section with two infographic blocks was rebuilt as AE layers, in the structure of an
earlier import: a null at the plate centre, «плашка X / …» children, geometry 1:1 in Figma px plus one offset.
- **Data:** a section gives only sparse metadata. Ask `get_design_context` for each child node: font, run sizes,
  tracking, colours and borders. The icon SVGs come as assets.
- **Reference:** `get_screenshot` of the section at maxDimension ≥ its size renders 1:1 with a 40 px margin
  (3012×1190 → 3092×1270). Check the margin with a known white rect before measuring.
- **Splitting runs:** a mixed-size text node («50%»: 117.461 and 87.46 px; «1.933.948 ₽») becomes one text layer per
  run. A run's extent on the render is the ink run between empty columns.
- **Placing text:**
  - Ink box on the render: per edge, the first ink column (or row) + (1 − its max coverage). Coverage =
    (lum − bg)/(fg − bg).
  - Make the AE layer LEFT_JUSTIFY at [0, 0], read `sourceRectAtTime(0, false)`, and set position so the two ink-box
    centres match.
  - All six boxes matched within 1 px, and the finished precomps differed from the render only along antialiased edges.
- **Figma → AE gaps:**
  - Figma tracking in px → AE tracking = px / size · 1000.
  - `text-transform: lowercase` → write the lowercase string; AE has caps options only.
  - A CSS/Figma *inside* border, either:
    - a rect filled with the border colour plus an inner rect inset by the width (fill on top: the first group in a
      shape layer renders on top), or
    - a stroke on a rect inset by width/2.
  - SVG paths → `Shape` vertices, with `Z` closing and the duplicate end vertex dropped. Keep open subpaths open.
    SVG's default butt caps and miter joins match AE's defaults.
- Then `make_restructure`-style precomposition (quirk 308) gives one precomp per block at its size.
- **A bash heredoc collapses `\` in a Windows path inside a JSX string.** Write the path with Python's `json.dumps`,
  as the generators do.

## 321. Finding the moment a hand-held prop starts to move: track the shape of its bright blob

LIVE-VERIFIED 2026-10-28. The user wanted the graphic to start «when the tablet starts tilting back». The tablet's
white screen is the largest component brighter than 235 below the sky band.
- Per frame, take its bbox h/w ratio, its area and its centroid. The tilt onset is where h/w starts to fall
  (foreshortening) and the centroid starts to drop at the same time; here frames 30–31 (h/w 0.706 → 0.668).
- A sheet of every second frame with the time printed on each tile confirms the onset.
- For «grows together with the building»: a contact sheet every 2 frames (start of the frame build-out: frame 64–66; top
  out: 88–90). Key the value over that span with a gentle ease ([0.25, 0, 0.2, 1]).

## 322. A grid that follows a growing value keeps the layout's scale; cells it never reaches stay empty

LIVE-VERIFIED 2026-10-28. «Клиенты» had to start at 2, count to 15 (the layout's value), then grow twice more, to 22.
- **What went wrong:** I stretched the grid so all 20 cells were full at 22, as the sellers' grid is at its last
  value. The user rejected it: «сетка квадратиков клиентов не должна заполняться полностью».
- **Take the scale from the layout.** The layout shows 8 of 20 cells filled at 15, so one cell is worth 1.875.
  - gridMax = layoutValue · cells / layoutFilled = 37.5;
  - cell i fills when V ≥ gridMax·(i+1)/cells.
- **Result:** the frame at 15 matches the layout, and each step adds cells in proportion (9 at 18, 11 at 22).
- **Fill the whole grid only when the brief asks for it.**
- **A cell the value never reaches keeps its layout state.** Don't fall back to filling it at the block's end.
  - An outline cell: remove the fill the generator added.
  - A design-filled cell: Fill Opacity 0, and its CR_outline stays at 100.
- **Bringing a stepped count's last value earlier** («15 пусть заполнится чуть раньше»):
  - place the steps on whole frames: here one step every 5 frames, each 4 frames long;
  - end the start-value cascade before the first step, or cells fill out of counting order.

## 323. «Рост скачками с лёгким ускорением»: a jump schedule, meters driven by the value, a preview outside the scene

LIVE-VERIFIED 2026-10-28. Brief for two factory blocks: «ощущение увеличения производства, но не постоянно, а
скачками и с лёгким ускорением каждый раз». The blocks: 50 % with a 4-bar level meter, and 510 шт with a progress bar.
- **Schedule** (value odometer, quirk 317):
  - five jumps; each comes sooner (24, 20, 17, 15 frames start to start), runs shorter (12 → 8 frames) and adds more
    (+3 … +7 %, +40 … +85 шт);
  - ease [0.4, 0, 0.2, 1]: a slight run-up, then a firm landing;
  - the second block follows each jump 3 frames later, as cause and effect;
  - pick the values backwards from the layout, so the last jump lands on it.
- **Level meter:**
  - recolour each bar's inner rect to the empty colour;
  - put a white `CR_charge` rect on top. Its expressions read the value:
    u = clamp((V − k·step)/step, 0, 1) · intro, size [W·u, H], position [x0 + W·u/2, cy];
  - at u = 1 it covers the inner exactly, so the final frame matches the layout.
- **Progress bar:** width = min(outer frame width, V · layoutWidth/layoutValue) · intro, at the layout's scale.
- **Intro:** a slider («Заряд», 0 → 100 after the bars light up) fills in the start value. The meter lights up empty,
  then charges (the rule for small cells).
- **When the user is tracking the same scene:**
  - keep all animation inside the precomps;
  - delay a block by shifting its precomp keys, not the scene layer;
  - don't save over their unsaved work;
  - preview by compositing the precomps' PNG frames over the footage, decoded with ffmpeg, at the layout positions.
- **Check:** compare the final composite with a capture made before the animation. Only 1 px antialiased edges may
  differ; compositing outside AE leaves those.

## 324. HTML 1:1 (§5f): Figma's percent tracking does not survive the local OTF; words must stay inside opening boxes

LIVE-VERIFIED 2026-10-30 (RK 2026 «Выбери», section 738, 7 frames at 1080×1920 ×0.7324).
- **Tracking:** Figma's `letterSpacing −5 %` on SB Sans renders about 0 against the local OTF. Using ls −0.05 em makes
  lines 10–30 px narrower than the Figma render.
  - Calibrate per line by ink width: crop each line in the 1:1 Figma PNG and in a still, compare the inked column span,
    then solve for ls.
  - Results here: words −0.0033 em, headline −0.0065 em. The headline's first line («Облако») needed −0.022 em, so
    split a multi-line headline into one `Fig.text` per line when the lines disagree.
- **Words inside opening boxes:** while a selection box grows (h 0 → 137, or a slim 39 px box growing into a full
  one), the word inside slides past the box edges. Tween the word's `cT`/`cB` clip with the box's own timing and ease.
  Drop the clip (`cT −1e5`, `cB 1e5`) when the box starts moving with a different word.
  - When a slim box (39 px) grows into a full one, a word placed at its final offset inside the box sits below the
    slim box: the clip shows only the tops of its letters, and the user reads it as «мимо плашки».
  - Tween the word's y from (box centre − half the glyph box) to its layout y, using the box's own ease, so it
    stays on the centre line. Fade it in only once the box is taller than the x-height.
- **Ask which storyboard frames are holds.** Here F2 (one box plus an empty slot) and F4 (mid-push) were
  pass-through poses, and the user rejected a pause on F2. Start the next move while the previous one is still
  landing, and verify only against the frames that are real holds.
- **Elements that aren't in the reference** (the arrows here) need their own motion. A static slide-in was
  rejected as «стрелки не анимированные».
  - **Draw on** each shaft from just off the left edge to the tip, then open each chevron from the tip outward.
    Start the shaft off-edge, or the off-frame tail eats the draw time.
  - **Exit through the opposite edge**, like a train. «Появляются из-за левого края — пусть уедут за правый».
    Two exits were rejected:
    - retracting into the tip;
    - sliding the group sideways, which leaves the chevrons crawling alone after the shaft is gone.
  - **The train exit:** make the shaft a dash window [tail, head] on a path extended straight past the tip by
    RUN = Ltip + clearance:
    - dasharray `vis 100000`, dashoffset `−tail`;
    - head = d·Ltip + e·RUN, tail = e·RUN;
    - chevrons translated by e·RUN.
    The arrow keeps its length and runs out along its own track.
- **Capitals give the font away.** This headline is set in SB Sans *Text* Medium, and our Display cut matched
  its lowercase to the pixel.
  - After the copy change to «Облако и ИИ», each capital И came out 72 px wide against Figma's 66.
  - Fix: set the capitals in `font: 'text'` with Figma's own −5 % tracking, which then fits exactly.
  - Figma's word spaces in that line were also wider than uniform tracking allows, so the line is three
    `Fig.text` words placed at the measured ink x positions.
- **Run measuring scripts from files on this machine.** `python -c` with a Cyrillic path fails silently in
  PowerShell (the profile's Add-Content noise hides the traceback), and the stale output then looks like a
  result. Write the script to a file using `\u` escapes in the paths and log to a file. Run it from an ASCII
  cwd (`cd C:\dev\temp`): with the shell parked in the Cyrillic project folder, script runs and
  `Copy-Item` to that folder failed silently too. Confirm each copy by size and mtime.
  - Never put a render and its copy or check in separate tool calls of the same batch. They run in parallel,
    so the copy grabs the previous file and the check reads a stale log. Chain them in one shell command.
- **A «live frame» variant** (`?live`, same timeline): a controller registered last moves the black frame,
  linearly and with no easing. Eased nudges with holds were rejected as «дерганное».
  - The top notch under the header (the narrowing that cramps the logo) is part of the frame, a step in its
    lower edge, not a separate plate. Animate the step: the band stays anchored at x 0.
    - Final motion: the step creeps right at about 24 px/s, with a light ease-in only, from frame 0 until
      the header has lifted out of frame (F6 → F7). It resets unseen while the header is gone, so the header
      drops back in its opening state.
    - Rejected along the way:
      - travelling back on screen;
      - 191 → 511 per half loop, still «медленнее в 2 раза»; the step should barely creep.
    - Running it all the way to 791 linearly was «слишком быстро, до конца».
    - Sliding the rectangle (x) was rejected, because it opens a gap behind it on the left.
    - Running it out through the right edge and back in from the left was also rejected.
  - The legal bar top drifts ±4 px, with the bottom notch riding on it.
  - The bottom notch width drifts ±12 px, right edge pinned, in segments of 1.8–3.2 s.
  Everything is back at 0 at END, so the loop seam holds. `motion.js` re-applies every element's state on
  every seek, so offsets applied on top never accumulate.
- **A Figma hairline between touching shapes.** The bottom notch ends at y 1310 and the legal bar starts at
  1310.16, which renders as a green seam. Run the notch 4 px under the bar so the frame reads as one piece.
- **F2 had no hold at all:** the stack starts dropping as soon as the first box is up, and boxes 2 and 3 open
  under it on the way down. Move all three boxes on one y ease with fixed spacing. A follow controller,
  registered after the boxes and the words, clips each word to its box every frame (box moving and opening at
  once). Each word rises into its box with `ry`.
- **Leaving the same way they came:**
  - plates fold to their centre line, but only after their word has risen out inside them;
  - headline lines rise in and out through per-line windows (`ry` with `cT`/`cB`);
  - notches slide behind the legal bar instead of fading.
  Never scroll dark plates up under a dark header: they merge into one shape.
- **Check:** compare the marks against the 1:1 PNGs (mean |diff| ≤ 1.7/255 on flat frames, about 3.5 on the headline
  frame from glyph antialiasing). Also review contact sheets every 0.12–0.2 s: the defects here (words outside boxes,
  the card opening over the outgoing headline) showed only between the marks.


## 325. Render a one-time entrance plus one settled cycle for repeated award tails

LIVE-VERIFIED 2026-11-02. Sixteen 60 s award cards had a one-time 0–10 s entrance and an
exactly periodic 10 s tail. Rendering 0–20 s per card and repeating frames 250–499 four
additional times reduced expensive AE frames from 24,000 to 8,000 for the award set.
The final MP4 remained 1920×1080, 25 fps, 1500 frames / 60.000 s. INTRO and splash were
rendered for their full durations.

- WRONG: repeat the entire 20 s intermediate — the entrance repeats too.
- RIGHT: preserve frames 0–249 once, then use five copies of the settled 250–499 interval.
  Example after rendering 20 s at 25 fps:
  `ffmpeg -i intermediate.mp4 -vf "loop=loop=4:size=250:start=250,setpts=N/(25*TB)" -frames:v 1500 -an -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart final.mp4`
- Only use this when ALL visible layers and expressions repeat over that interval: text
  sheen as well as the background. Randomness, footage, audio or a later change can invalidate it.
  Prove periodicity and the seam before shortening the render (#208); derive indices from fps.
- Keep intermediates separate from final delivery. Verify the final frame count, duration,
  dimensions, audio policy and full decode, not just the input segment or encoder exit code.
- For lossless masters, render a lossless intermediate; this verified H.264 preview route
  incurs another encode and is not a lossless substitute for a master render.

## 326. TextDocument tracking requires an integer

LIVE-VERIFIED 2026-11-03, AE 2026. CSS letter-spacing 1.6 px at 29 px converted to 55.1724 AE tracking units caused an exception and interrupted a build.

- WRONG: `doc.tracking = letterSpacingPx / fontSizePx * 1000;`
- RIGHT: `doc.tracking = Math.round(letterSpacingPx / fontSizePx * 1000);`
- Keep font size and letter spacing in the same coordinate scale before conversion. Verify the live glyph bounds; echoed font names alone do not prove a match.


## 327. Match SVG paint order when translating nested filled paths to AE

LIVE-VERIFIED 2026-11-03. Nine progressively scaled, alternating filled contours matched the SVG geometry but looked different in AE because the larger shape group covered the smaller ones.

- WRONG: append SVG paths to one Shape Layer and assume SVG's last-painted-on-top ordering.
- RIGHT: explicitly order the native groups. For groups named `Cut 0` through `Cut 8`, created in that SVG order, `for (var i=0;i<9;i++) contents.property("Cut "+i).moveTo(1);` placed the smallest/latest SVG contour above the earlier larger contours in this build.
- Capture the same settled frame and compare silhouette, crop and negative space before rendering motion. Do not solve a stacking mismatch by changing the source path geometry.


## 328. Fit calligraphic Cyrillic by ink bounds, not inherited baselines

LIVE-VERIFIED 2026-11-03, AE 2026. Replacing an upright serif with GreatVibes-Regular preserved nominal sizes but extended a surname descender into the following line. The initial ink boxes overlapped by 25 FullHD pixels; moving the next line below the actual ink bottom left a clear 48 px gap.

- WRONG: reuse the previous serif baselines or add negative tracking to a connected script.
- RIGHT: start with tracking 0, set the final font and size, then read `sourceRectAtTime`. With an unparented, unscaled 2D text layer and anchor [0,0], align its ink top-left using `[targetX-r.left,targetY-r.top]`. Place following lines from `targetY+r.height+gap`; transform coordinates first if the layer is parented/scaled.
- Check the actual Cyrillic glyphs in AE, not just the returned font name. Great Vibes from the official Google Fonts ofl/greatvibes family contains Cyrillic in the tested release; this does not establish coverage in older installed copies.
- Render a settled full-frame preview before batch export: uppercase swashes and descenders can collide even when the typographic baselines appear comfortably separated.

## 329. Verify FontObject.isSubstitute before fitting text in AE

LIVE-VERIFIED 2026-11-10, AE 2026. TextDocument.font returned GreatVibes-Regular while AE rendered an upright fallback. The TTF existed, but its registration was absent in the active user's Windows Fonts registry.

- WRONG: accept a matching PostScript name or existing TTF file as proof the intended font is rendering.
- RIGHT: inspect app.fonts.getFontsByPostScriptName(name), require a returned FontObject with isSubstitute=false, then visually inspect Cyrillic. Repair registration only within the authorized font setup and broadcast WM_FONTCHANGE; re-query AE before continuing.
- Re-measure sourceRectAtTime and re-fit positions after the actual font loads. Bounds fitted with a substitute remain wrong even after the font has been restored.

## 330. For Blender assets, GPU rendering does not imply GPU denoising

LIVE-VERIFIED 2026-11-10, Blender 4.5 / RTX 5060 Ti, Cycles 48 samples, FullHD silver ring. The GPU renderer with CPU OpenImageDenoise took about 4.2 seconds per frame. Keeping OpenImageDenoise and setting scene.cycles.denoising_use_gpu=True reduced tested frames to roughly 0.5 seconds. Numbers are scene-specific.

- WRONG: assume cycles.device='GPU' accelerates every render stage, or lower samples before identifying the bottleneck.
- RIGHT: inspect frame timing, test the existing denoiser on GPU, compare the same camera frames, then use one consistent denoiser configuration throughout the sequence.
- OptiX denoising was fast but left visible noise in this test; it was not used for delivery. Applying a static subdivision modifier did not remove the main bottleneck.


## 331. Compare exported audio after measuring codec-sized delays

LIVE-VERIFIED 2026-11-10, AE 2026 H.264/AAC export from a 60-second MP3. Source and output were both 60 seconds; zero-lag waveform correlation was only 0.060. Cross-correlation measured a constant output delay of 21.333 ms (1024 samples at 48 kHz). Aligning by that measured delay raised correlation to 0.996. The layer startTime was 0 and the selected source file was correct.

- WRONG: conclude the wrong track was used from low zero-lag waveform correlation, or loosen the acceptance threshold without diagnosing it.
- RIGHT: decode both to the same mono PCM rate, estimate lag within a bounded search, compare aligned overlapping samples, and report delay separately. Verify the source path, layer timing, stream durations and actual musical transitions as well.
- The measured delay here was below one 25 fps frame. That is a project-specific acceptance decision, not a universal tolerance; sample-accurate requirements need a corrected mux and another timing check.

## 332. Native script handwriting from glyph centre lines; verify the final composite

LIVE-VERIFIED 2026-11-10, AE 26.5, GreatVibes-Regular Cyrillic. Seven title/name layers retained editable source text while native Shape Stroke + Trim Paths layers revealed their actual strokes.

- Render the installed font at its actual baseline/size, skeletonise the glyph ink, simplify centre lines and order short paths by character/stroke progression. Stroke width follows local distance-to-edge. Font substitution, tracking, transforms and baseline mismatch invalidate the paths: check the actual AE ink first (#328–329).
- Use the paths as an Alpha Track Matte on the editable text. One Write progress slider drives sequential Trim End expressions. A brief final coverage pass inside the matte restores antialiased edges after the drawing finishes. This is a reusable construction technique, not proof of natural pen order for every glyph: inspect early, middle and complete frames, especially flourishes and crossings.
- A black-backed logo using Screen looked correct over the scene but showed a black rectangle when moved into a transparent title precomp. Enabling collapseTransformation on that title precomp layer preserved the inner blending against the actual scene. Verified by before/after FullHD capture; do not apply collapse indiscriminately to unrelated 3D/effect stacks.
- Create the capture destination before M.capture. The helper does not create it. saveFrameToPng queued warnings for all missing paths even though the script returned success; output existence and a decoded image are the evidence. Close only the identified export warnings, create the folder, and repeat the failed capture.
- For retimed impacts, inspect source contact frames rather than assuming the prompt's requested rhythm. Six visually identified hammer contacts were mapped to musical attacks with monotone time-remap keys and Pixel Motion. Add desired Time Remap keys before removing default ones (#220); removing every key disables the property.

**Export follow-up (same session):** H.264 Output Audio = Auto emitted an all-zero AAC stream even with generated clip audio disabled. For an explicitly silent delivery, choose Output Audio = Off before rendering, or verify decoded peak = 0 and remux with video copy / no audio; preserve the original AE export. Completed RenderQueueItems reject output-module settings changes while their status is DONE. Do not try to repair a finished MP4 by changing its completed queue item. Five final outputs passed full decode and exact frame-count checks; the opening retained its original track (aligned waveform correlation 0.996, measured AAC delay 21.333 ms, #331). GUI Render worked after aerender again stalled at its version banner (#33).

**Physical-quality follow-up to #332 (2026-11-11):** the user subsequently rejected the craft visuals, including a blurred hammer. The v05 impact section had been strongly retimed with Pixel Motion; this is a possible additional source of deforming contours, not an established sole cause. The mapped contact times above prove timing work, not acceptable tool geometry. Compare native-speed source with final composite around each approach/contact/rebound. Prefer selecting clean contacts and modest retiming; do not stretch rapid strikes with optical flow or add blur to hide generation defects. New motion tests were pending at this update; no corrected-video success is claimed.


## 333. Reflective deformation loops: avoid doubled silhouettes at a crossfade

LIVE-REVIEWED 2026-11-11, AE 26.5. A scored 8-frame overlap between similar silver-ribbon poses looked acceptable as separate frames but created two visible edges in the composite. Replacing it with a single forward/back source removed the double contour.

- For reversible abstract motion, map one source interval through a triangular time phase with quadratic 0.6-second ramps at both turns. The tested 20-second cycle traversed source 0.125–9.86 seconds forward in the first 10 seconds and back in the second 10. Velocity reaches zero at either turn. Disable Frame Blend and Pixel Motion on this construction; do not combine two silhouettes.
- Check frames before, at and after both turns and compare repeat frames one actual period apart. Do not retain an old 10-second period in a verifier after switching the comp to 20 seconds. If the first cycle has a text entrance, compare the ribbon region at wrap or compare settled later cycles.
- Reverse only suitable abstract deformation. Craft operations and impacts remain in their original time direction; verify source contact frames before retiming them.
- A save-time Prefs-paint rename warning blocked the CDP response after a build had already completed. Inspect and dismiss only the identified modal, then probe project identity and existing comp IDs before retrying a mutation. In this case a coordinate click on the visible OK worked; Return did not. The timed-out build was not repeated.


**Source sampling at the turn (final-export verified):** an upper Time Remap endpoint exactly at 9.875 seconds equalled source frame 237 at 24 fps, while both adjacent 25 fps output frames still sampled frame 236. This produced a one-frame contour excursion even though the time expression had zero derivative. Moving the upper endpoint inside frame 236 (9.86 seconds) made the three captured turn frames identical; final H.264 adjacent-frame and period checks then passed. Inspect sampled source-frame indices as well as the continuous easing function. Preserve the failed export for comparison rather than masking the failure with a looser verifier threshold.

**Deformation envelope before batch render:** the settled tall pose cleared a long surname, but the broad intermediate pose crossed its final letters. Check text against the moving object's extreme silhouette, not only the approved still or settled frame. A source-frame scan plus AE ink bounds exposed the overlap; uniformly scaling the surname and its handwriting matte together preserved alignment and left a clear gap. Inspect these extremes and both loop turns in a short proof before exporting every derivative card.


## 334. Reduce a generated deformation by selecting its envelope before slowing it

LIVE-REVIEWED 2026-11-11, AE 26.5, FullHD/25 fps. The client found the full ribbon deformation excessive and requested slower movement. Merely stretching the whole clip would retain the unwanted collapsed/wide poses. A contact-sheet review selected source 8.30–9.86 seconds, excluding them, then expanded its forward/back cycle from 20 to 60 seconds with 1.8-second turn ramps.

- WRONG: describe a threefold longer cycle as exactly one-third angular speed after also changing the source interval. State period and amplitude separately.
- RIGHT: select a visually coherent source interval first, then set the period. In this stable abstract ribbon, Pixel Motion made the heavily slowed source continuous; set layer.frameBlendingType=FrameBlendingType.PIXEL_MOTION and enable frameBlending on the source comp and nested output comps. This is a scoped exception to the non-interpolated v06 construction in #333, not permission to use optical flow on fast craft impacts.
- Verify the actual render: the 60-second background decoded all 1500 frames, the loop seam's mean RGB difference in the ribbon ROI was 0.418/255 and sampled turn differences stayed below 0.289/255. Sampled adjacent motion away from the turns stayed nonzero. Visual captures retained a clear single contour and excluded the rejected broad/collapsed poses. These checks establish technical continuity; the client's aesthetic acceptance was still pending.
- A 20-second card using a 60-second background cycle is an excerpt, not a 20-second seamless loop. Deliver the complete 60-second background separately when assessing the wrap.
- SaveAs isolation is easier to audit in a separate operation: save the new project without comp edits, verify its exact full path and unchanged original hash, then run a guarded mutation that requires the verified destination. Do not retry a combined build after an ambiguous save response.


## 335. Final delivery from a hand-edited live project; queue indices and UI focus

LIVE-VERIFIED 2026-11-11, AE 26.5. The user changed the opening timeline after v07 delivery: enabled two former archived layers, shifted the ribbon and moved the title entrance earlier. Existing build scripts and the previous export no longer represented the requested final.

- WRONG: rerun a builder or reuse old exports for a request to render the user's latest edits. RIGHT: inspect the live project and exact output comps, snapshot the saved AEP, then queue those existing comps to a fresh delivery directory. Compare new MP4 frames to captures of this current project rather than enforcing the previous timeline.
- RenderQueueItem.index returned an undefined/null result in this session. After adding one item, app.project.renderQueue.numItems gave its actual 1-based index; store that with the verified comp ID and output path. For later completion checks, require both the matching comp ID and RQItemStatus.DONE. Do not infer completion from a non-empty file.
- A native getScreenshot on an inactive AE binding captured the foreground Codex/Premiere surface. Do not click presumed AE coordinates on that image. Activate the bound AE window through supported native control, verify App: AfterFX.exe in fresh AX state, then take a fresh screenshot before clicking Render. Here an Escape input to the bound AE window activated it without changing the composition.


## 336. True 3D relief from outline-only Corel artwork; initialize the render device per process

LIVE-VERIFIED 2026-11-11, Blender 4.5.3 LTS / RTX 5060 Ti, RR35 badge. A Corel CDR contained a raster preview plus real vector artwork. LibreOffice headless SVG export preserved the contours, but nearly all were open strokes rather than filled shapes.

- Inspect the SVG structure before extrusion. Deduplicate identical paths, sample the original Bezier curves, snap near-coincident endpoints at a scale justified by the drawing, and polygonize the line network. Here 437 SVG paths reduced to 329 unique paths and 282 closed faces; a 4-source-unit snap was below one output pixel. Check the resulting faces against the original CDR preview before assigning relief heights. Do not assume a CDR thumbnail is vector artwork or that every open path should become a solid tube.
- Build real closed meshes: triangulated front/back caps, side walls, shallow relief levels and bevels. A relief depth and plain reverse inferred from a front drawing are design assumptions, not manufacturing data. Inspect front, oblique, edge and reverse before animation. Animate actual area lights for highlights; use the solid model for rotation.
- In a fresh background Blender process, explicitly select the Cycles compute device and enable the intended device in preferences. Loading a .blend with scene.cycles.device='GPU' does not establish the active preference/device configuration. In this job, explicit OptiX selection plus GPU denoising rendered the 64-sample FullHD proofs in about 0.5–0.65 seconds after initialization; the earlier process without explicit device setup took 8–11 seconds at 48 samples. Inspect the reported device list and frame timing, not the saved scene toggle alone. See also #330: denoiser quality and performance must be checked on the actual asset.
- Blender 4.5 Principled BSDF uses the socket name `Anisotropic`. Probe available sockets rather than guessing a version-specific name. Radial anisotropy on a plain badge back caused an unwanted star-shaped reflection here; setting anisotropy to zero on the back/edge material removed it.
- For a continuous full turn with a faster rear, solve theta + a*sin(theta) = 2*pi*t/T. With a=2/7, rear/front angular speed is 1.8; velocity remains continuous at wrap. Save the loop endpoint as a key, render only the preceding N frames, and verify first/endpoint object and light matrices plus the exported seam. This curve controls speed, not a change to the 3D shape.


**Openwork follow-up to #336 (2026-11-11):** the user found the first fully backed relief too flat and monolithic despite its real 3D geometry. The revision removed the backing, separated the oval into three rails, retained solid letters/numerals with open counters, and added narrow bridges. About 47% of the original silhouette became open space. A front and oblique proof were reviewed before batch rendering; aesthetic acceptance of the revision remained with the user.

- WRONG: preserve a solid backing while expecting negative spaces in raised face geometry to read as holes. RIGHT: explicitly subtract the intended counters and fields from the complete stack. A union of filled SVG regions can silently refill counters; maintain their negative shapes separately and reapply them after the union.
- A previously occluded oval became visible through the newly pierced number cartouche and crossed the digits. Trim the rails to the cartouche's outer envelope when that overlap should remain hidden. Inspect layers that the former solid plate had masked.
- Verify holes in rendered alpha from both front and reverse, using sample patches inside the opening rather than on bevel/antialias edges. Six opening locations in each view were fully transparent here. The 105 source solid meshes had every undirected edge shared by exactly two faces. Projected connectivity alone does not establish a 3D joint: also inspect connector depth overlap and the oblique/reverse views.



## 337. Deep vector relief: preserve clean curves, share cavity vertices, repair cap T-junctions

LIVE-VERIFIED 2026-11-11, Blender 4.5.3 LTS, RR35 V04. After approving a GPT Image material study, the user requested satin-silver letters/numerals, burgundy nonmetal enamel and substantially recessed monogram centers. The finished model retained actual openwork; generated imagery was a look reference only.

- A polygonized face network can contain tiny endpoint perturbations at the intersections of hatching lines. Extruding that repaired boundary produced regularly spaced highlight ribs inside a counter. Reusing the original clean closed SVG curve for that boundary removed the ribs. Use the snapped network to discover faces; preserve original authored curves for final visible contours wherever available. A subpixel 2D deviation can remain conspicuous in a reflective 3D sidewall.
- Build a deep recess as one closed mesh with a back cap, raised rim cap, lower floor cap, outer walls and inward-facing cavity walls. Share equal vertices, and assign different materials by face. Overlapping full-outline extrusions leave coincident sidewalls. The checked V04 monogram used floor z=.10 and rim z=.36, a real .26 depth, while retaining through-holes.
- Earcut omitted three collinear boundary midpoints in each outer cap, producing 18 unmatched edges against the subdivided wall boundary. Split the affected cap edges at the existing intermediate vertices instead of ignoring the defect or filling holes arbitrarily. All 53 source meshes and all evaluated Blender meshes after beveling passed the closed-edge/manifold check.
- Dissolve coplanar cap triangulation before the final bevel where appropriate, retain boundary vertices and sharp transitions, and inspect front/oblique renders. This improved the oval rail bevels in this asset. Merely changing smooth/weighted normals did not remove the contour-induced ribs described above.
- A front-facing sway replaces the full-turn angle function: theta(t)=30°*sin(2*pi*t/20s) gives ±30° and zero speed at both extremes. Verify evaluated angles, not just a text label: frame 1/126/251/376/501 at 25 fps gave 0/+30/0/−30/0. Render 500 frames, retain frame 501 only as the cycle endpoint key. The old accelerated-back segment is no longer part of this motion.


## 338. Reuse an approved background render for large award batches

LIVE-VERIFIED 2026-11-18, AE 26.5, Lyudi Remesla. Eighteen new 60-second cards reused the previously verified FullHD Mobius background, while names remained editable native text with their own handwriting mattes. The first two exports took 85 and 77 seconds, compared with roughly four minutes per card in the earlier five-card batch. This is a scene-specific observation, not a general speed guarantee.

- WRONG: repeatedly evaluate the same expensive retimed background for every recipient, or flatten the whole card and lose editable text.
- RIGHT: keep a full-resolution master with the original background source, and build the FullHD delivery from the already approved background movie plus a separate native type comp. After the last intentional type animation, freeze only the type comp at its settled frame (6.24 seconds here); never freeze the moving background. Check that no intended later type effect is removed by the hold.
- A transparent type precomp containing a black-backed Screen logo needs its inner blend to reach the real background. collapseTransformation=true on the outer type layer fixed the black rectangle here, as described in #332. Inspect the final encoded MP4, not only text bounds.
- Duplicate surnames must not share output paths. This list contained two Erteleva, two Lapina and two Kuznetsova entries; full surname + given name + patronymic in filenames prevented overwrites. Preserve repeated people across different award categories when the source explicitly lists them.

**Delivery follow-up (2026-11-18):** inspect a contact sheet of the encoded cards, including every duplicate-surname entry. For mixed photo/award layouts, use cover for intentional portrait crops and contain for the whole award object; the same scaling rule is not suitable for both. After a local image-fit correction affecting only the first 51 seconds, re-render that AE block and join it to the already verified, unchanged 69-second title block. Verify the rebuilt 120-second file again. This avoids repeating unaffected work while retaining the corrected editable full composition.


## 339. Handwriting mattes must follow the live AE text layout, not external font advances

LIVE-VERIFIED 2026-11-20, AE 26.5, Great Vibes Cyrillic / Lyudi Remesla. A client reported broken, dotted letters during an award entrance. The completed text was intact; the reveal matte drifted horizontally against the native text.

- WRONG: position per-glyph stroke paths from Pillow font advances and assume they match AE's optical kerning. At a font size of 400.928, the second glyph origin in the tested surname was about 482 in the external layout versus 588.162 in AE. The discrepancy accumulated into large uncovered holes. A correct full-text bounding box alone does not verify intermediate glyph positions.
- RIGHT for the tested point-text construction: use a temporary native AE text layer with the exact font, size, tracking and kerning settings. Measure each prefix through the current glyph; subtract the standalone current glyph's baseline end from the prefix baseline end (`TextDocument.baselineLocs[2]` for a single left-aligned line). Use these measured origins when placing externally derived skeleton paths. Preserve the native text as the visible layer; use Trim Paths strokes as its alpha matte. Recheck this method for ligatures, complex scripts or different justification instead of assuming universal glyph decomposition.
- Verify early, middle and complete encoded frames. Twenty-five revised name cards retained editable native text. The reviewed intermediate exports no longer had the old scattered gaps; the current glyph remains intentionally incomplete while writing. The old final type pass by itself had hidden the geometry error after the animation ended.
- For an entrance-only repair, keep the full updated AE comps but render only the changed 156 frames at 25 fps. Join them to the unchanged original remainder starting exactly at frame 156, then encode the delivery. This is only valid when later type/background behavior is unchanged. In this batch, 24 joins had mean adjacent RGB differences below 0.45/255; every rebuilt file passed full decode and exact frame-count checks. Inspect the seam visually as well as numerically.
- Batched `saveFrameToPng` captures in this session intermittently showed truncated static text. A subsequent GUI-encoded proof after a cache purge showed the complete text. Do not redesign valid text from a suspicious capture alone: inspect native properties and a short encoded proof. The exact cache/capture cause was not established.

## 340. Top-level ExtendScript variables survive separate CEP calls

LIVE-VERIFIED 2026-11-02. A pilot build declared `var PILOT = 4` at top level. A later payload
without that declaration still saw `typeof PILOT !== "undefined"` and built only slot 4.
The AE project and the bridge were healthy; the stale global silently filtered the build.

WRONG: use an optional top-level pilot/debug variable as an implicit selector on later calls.
RIGHT: put selectors inside the build function, set them explicitly on every invocation, or
generate a pilot payload whose filter is local to that call. Verify the returned comp count
against the requested slot count. The corrected build returned all 35 comps.

## 341. Paragraph text inherits justification and uses its own box origin

LIVE-VERIFIED 2026-11-02. addBoxText produced a centred paragraph in a left-aligned intro,
although its layer Position matched the planned x coordinate. Explicit LEFT_JUSTIFY and an
anchor [sourceRect.left, sourceRect.top] made the rendered ink start on the intended guide.
WRONG: assume addBoxText defaults or layer Position alone establish the paragraph's left edge.
RIGHT: set TextDocument.justification explicitly, set the document, read sourceRectAtTime,
then set the anchor and animate Position. Verify the rendered paragraph, not just its bounds.

## 342. File.name may percent-encode Cyrillic while fsName is the native path

LIVE-VERIFIED 2026-11-02. A guard comparing Cyrillic project-name text with File.name rejected
an otherwise correct open AEP because name was percent-encoded.
WRONG: compare raw Cyrillic text with File.name to authorize the focused project.
RIGHT: compare app.project.file.fsName with new File(expectedPath).fsName; the live guard then
accepted only the intended project without renaming it.
