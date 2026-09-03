# Motion vocabulary — catalogue of techniques, with the Cloud.ru filter

What good, *expensive-looking* motion is made of, technique by technique, and how each one
is built in the two engines of this skill. Read this when you are designing a sequence and
need more than "ease it and stagger it". Brand doc: `brand/cloudru-motion-brand.md`.
Engine APIs: `M.*` = `scripts/lib/cloudru-motion.jsx` (AE), `Motion`/`Brand` =
`html/engine/*.js` (HTML). Recipe files: `reference/ae-cloudru-recipes.md`,
`reference/html-engine.md`.

---

> Market baseline with sources and numbers: `reference/motion-best-practices.md`. This catalogue
> maps techniques to the two engines; that document says why they matter and how much.

## A. What separates pro motion from amateur motion

Ten things an art director sees in the first two seconds:

1. **Easing has intent.** Arrivals decelerate, departures accelerate, on-screen moves are
   in-out. Linear = mechanical only. (`motion-design-principles.md` §1–2.)
2. **Hierarchy in time.** The primary element moves first or biggest; support follows with a
   stagger; nothing important moves simultaneously with something else important.
3. **Overlap, not steps.** The next element starts at 50–70% of the previous one; a sequence
   that waits for every element to finish reads like a slideshow.
4. **Distance ↔ duration.** Bigger element / longer travel → longer duration (Carbon rule).
   A 40 px slide takes 400 ms; a full-frame wipe takes 600–800 ms; a 1000 px flight is a
   mistake unless it is a wipe.
5. **Masks, not fades.** Text and blocks appear from behind an edge (clip / matte), which
   creates a *place* they came from. Pure opacity fades are for secondary body copy only.
6. **Nothing idles.** After landing, elements are still. Perpetual wiggle/float on titles is
   the canonical amateur tell (IBM: "avoid motion that is purely decorative").
7. **One material.** Flat fills stay flat, lines keep their weight, corners keep their angle
   through the whole move. A shape that changes material mid-animation (gets a shadow, a
   glow, a gradient) reads as a bug.
8. **Frame discipline.** Keys on whole frames; entrances 5–12 frames at 25 fps; exits ~70% of
   entrances; holds long enough to read (title ≥ 2 s, KPI ≥ 2.5 s).
9. **Counter-motion.** A wipe going right can be answered by content entering from the left;
   opposing vectors create tension and keep the eye centred.
10. **Verification.** Beats are captured and judged as stills; every frame must survive a
    screenshot (`M.capture`, `html/render/render.js --beats`).

## B. Technique catalogue

Each entry: what it looks like · when it earns its place · AE build · HTML build · Cloud.ru
verdict (✅ core / ⚠️ conditional / ❌ forbidden).

### B1. Line-mask reveal (text rises from behind its own line box)
- Look: each line of a heading slides up ~100% of its line height from behind an invisible
  clip; no blur, no scale. The classic "premium" title entrance.
- AE: text layer per line (or one layer with the mask animated per line); rectangular mask
  = line box; animate Position from `+lineHeight` to `0` with `enter`. `M.lineReveal(L, t0)`.
  Alternative: Text Animator with Position + a Range Selector by *lines*
  (`extendscript-patterns.md` §8) — one layer, per-line offset.
- HTML: `Brand.lines(el)` wraps each measured line in `.line-mask > .line`, then
  `tl.reveal(lines, {at, stagger})`.
- Cloud.ru: ✅ the default heading entrance.

### B2. Slide-in with fade (block travels 40–80 px along one axis while fading in)
- AE: Position + Opacity keys, `enter`; flatten spatial tangents (`M.flatten`).
  `M.slideIn(L, t0, {dx:0, dy:40})`.
- HTML: `tl.fromTo(el, {y:[40,0], opacity:[0,1]}, {at, dur, ease:'enter'})`.
- Cloud.ru: ✅ for cards, columns, plates, logos. Distance ≤ 80 px @1080p.

### B3. Block wipe (a hard-edged rectangle sweeps the frame)
- Look: colour plate enters from one edge, covers the frame, then either stays as the new
  ground or leaves the opposite edge revealing the next scene.
- AE: full-frame solid; animate Position across the frame (or Scale `[0,100]→[100,100]` on
  a rect anchored to the edge) with `wipe`. Motion blur ON, shutter ≤ 90°. `M.blockWipe(...)`.
- HTML: `tl.fromTo(plate, {clip:['inset(0 100% 0 0)','inset(0 0 0 0)']}, {ease:'wipe'})`.
- Cloud.ru: ✅ the scene transition. Never a cross-dissolve.

### B4. Portal wipe / portal build (stepped rectangles, one after another)
- Look: N rectangles offset by one step each (the brand "portal"), sweeping in sequence with
  a tight stagger — the frame appears to open in steps.
- AE: `M.portal(name, {steps:4, step:40})` builds N rect groups in one shape layer;
  `M.portalWipe(layer, t0, {dir:'right'})` animates each group's rect size/position with
  stagger `tight` and `wipe`. HOLD-keyed variant = "build" (steps pop in).
- HTML: `Brand.portal({steps:4})` + `tl.stagger(steps, ...)` or `ease:'steps(4)'`.
- Cloud.ru: ✅ the brand signature. Use once per piece as the *hero* transition, plus as a
  static container elsewhere.

### B5. Count-up (big numbers)
- Look: digits roll from 0 (or from the previous value) to the target; ease `count` so most
  of the change happens early; unit/percent sign stays still and arrives after the number.
- AE: Slider Control "Progress" 0→1 keyed with `count` ease; Source Text expression formats
  the value (tabular via monospaced digit font or fixed-width layer). `M.counter(L, t0, t1, from, to, {decimals, suffix})`.
- HTML: `Brand.counter(el, {from, to, decimals, suffix})` returns a `set` function for a
  tween: `tl.fromTo(el, {n:[0,199]}, {set: counter, ease:'count'})`.
- Cloud.ru: ✅ KPI scenes. Thousands separator U+202F; one green number only.

### B6. Odometer / step number (digit swaps by vertical slide under a mask)
- AE: two text layers in a masked precomp, or a single layer with Text Animator Position on
  a Range Selector; `enter`, `fast`.
- HTML: stacked `.line` elements inside `.line-mask`, tween `y` between them.
- Cloud.ru: ✅ for "01 → 02" step numbers and section indices.

### B7. Rule / underline growth (a line grows from 0 to 100% width)
- AE: rect shape at final size, Scale `[0,100]→[100,100]` anchored left (quirk #28). `M.rule`.
- HTML: `transform: scaleX(0→1)` with `transform-origin: left` — `tl.fromTo(el,{scaleX:[0,1]})`.
- Cloud.ru: ✅ 2–4 px, square ends.

### B8. Trim-path draw-on (a stroke draws itself)
- AE: shape layer + Trim Paths End 0→100 (`extendscript-patterns.md` §9). Square caps
  (`ADBE Vector Stroke Line Cap` = 2? — VERIFY enum) and miter joins.
- HTML: SVG `stroke-dasharray`/`stroke-dashoffset` tween; `Brand.drawOn(svgPath)`.
- Cloud.ru: ✅ for linear illustrations (cloud, star ✦, arrow) and scheme arrows. Weight 2/4/6 px.

### B9. Pattern build (dots / grid / ЛЛЛЛ appear by rows or outward from a focal point)
- AE: ONE seed cell + two stacked Repeaters (quirk #17); animate the group's Opacity or
  the second repeater's Copies count (integer, HOLD keys) for a row-by-row build; or animate
  a rectangular mask on the layer for a directional sweep. `M.dots`, `M.grid`, `M.llll`.
- HTML: `Brand.dots({cols, rows})` creates cells; `tl.stagger(cells, {each:30ms, from:'left'})`.
- Cloud.ru: ✅ backgrounds of divider/title/finale. Idle drift ≤ 2 px/s allowed.

### B10. Stagger cascade (many similar elements, offset starts)
- AE: `M.stagger(layers, t0, eachMs, function(L, t){ M.slideIn(L, t) })`; or an expression
  `valueAtTime(time - index*delay)` on duplicates.
- HTML: `tl.fromTo([...els], props, {stagger: 0.07})`.
- Cloud.ru: ✅ reading order or outward from the accent; `tight/base/loose` tokens.

### B11. Squash & stretch, overshoot, spring, bounce
- Look: elasticity, weight, cartoon energy.
- AE: 3-key overshoot or the inertial/overshoot expressions in `expression-library.md`.
- HTML: `ease:'spring'`-style beziers (`y > 1`) or explicit overshoot keyframes.
- Cloud.ru: ❌ on brand elements. ⚠️ ≤ 2% overshoot on non-brand product UI mockups only.

### B12. Typewriter / per-character tumble
- Cloud.ru: ⚠️ only as a code/terminal metaphor (monospace, rectangular cursor). ❌ on headings.

### B13. Camera moves (2.5D parallax, dolly, orbit)
- AE: 3D layers at different z + camera; Position on the camera with `move`; `M.parallax`.
- HTML: per-layer `x/y` tweens at different rates (`Brand.parallax(layers, depthArray)`).
- Cloud.ru: ⚠️ linear dolly / parallax ≤ 3% of frame; ❌ orbits, swoops, handheld shake.

### B14. Split-screen / column wipe transitions
- Frame divides into 2–4 vertical bands that wipe with a stagger — a "productive" cousin of
  the portal wipe. ✅ for content-to-content transitions.

### B15. Colour cut on the accent (an element turns green)
- AE: Fill effect colour keyed with 2 HOLD keys or a 200 ms linear ramp; HTML: `color` tween.
- Cloud.ru: ✅ the last beat of a KPI scene; ≤ 1 element per frame.

### B16. Isometric / 3D chip assembly
- The brand's 3D chips (green hexagon inserts) assembling: components slide along axes
  into place with `enter`, stagger `base`. AE: prerendered PNG/3D layers; HTML: SVG groups.
- Cloud.ru: ✅ premium titles / product illustrations; strictly axis-aligned motion.

### B17. Data reveal (bars, lines, areas)
- Bars grow from the baseline (`scaleY`, `enter`, stagger); line charts draw-on (B8); areas
  wipe left→right; labels fade after their mark lands. Palette: green + one extra colour.
- Cloud.ru: ✅; ❌ pie "spins", 3D charts, gradients.

### B18. Cursor / UI demo motion
- Cursor moves `move` ease along straight segments, clicks with a 120 ms `ui` scale dip
  (98%), UI responds with `ui` tokens. ✅ for product demos.

### B19. Loop / ambient (idle background life)
- ✅ only on the pattern layer: 1 px/s drift or a 2 % opacity breathe at ≥ 8 s period.

### B20. Glitch, flicker, RGB split, shake, particles, lens flares, light leaks, grain
- ❌ for Cloud.ru. (Kept in `expression-library.md` for non-brand work.)

## C. Choreography patterns (how to sequence a scene)

- **Ground → frame → content → accent.** The ground (colour/wipe) settles first, then the
  framing devices (bracket, rule, pattern), then the message (title/number), and the accent
  (green mark, colour cut) lands last. Reverse the order on exit.
- **Beat sheet first.** Before building anything, write the table: `t (ms) | element | action |
  ease | dur | note`. Both engines consume the same sheet. Sum the holds — a 30 s piece with
  fifteen 2 s scenes has no room for a 1.4 s counter; cut scenes, not durations.
- **Tempo map.** Alternate fast and slow scenes: title (slow, hero) → divider (fast, hard cut)
  → content (medium) → KPI (slow) → content (medium) → finale (slow). Same rule as the slide
  deck rhythm: no more than two scenes of the same tone in a row.
- **Anticipation without bounce.** Cloud.ru anticipation is *timing*, not counter-movement:
  a 3–5 frame hold of the empty ground before the title arrives reads as intent.
- **Exit ratio.** Exits are 70% of entrances and use `exit`. A scene that exits as slowly as it
  entered feels like it is apologising.
- **Hero solo.** When the hero element moves (the big number climbing, the portal opening),
  nothing else moves — the tag-cloud work in `_build/` (quirk #43) is the record of why.

## D. Judging frames (review protocol)

1. Capture the *beats*, not random times: last frame of every entrance, first frame of every
   exit, mid-wipe, and the held frame of each scene.
2. For each still ask the slide-skill's five questions (Philosophy / Hierarchy / Detail /
   Function / Innovation, ≥ 4/5 each) plus the motion ones: is there exactly one moving
   subject, does the ease read as decisive, is anything idling, is any edge not straight?
3. For sequences, sample *every* frame of any layout change offline (quirk #35) and measure
   px/frame (`_build/speed.py`); > 60 px/frame at 4K reads as a jump.
4. Fix the worst defect, re-capture, repeat. Do not present a frame you have not looked at.
