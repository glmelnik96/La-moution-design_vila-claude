# HTML motion engine — `html/`

The second backend of this skill: brand-correct animation as a self-contained HTML page,
rendered to stills / video with headless Chrome, or shipped as a web asset (landing hero,
embedded product motion, presentation). Same tokens, same eases, same beat sheets as the AE
channel; no npm dependencies.

```
html/
  engine/motion.js      deterministic, seekable timeline (Motion.timeline / fromTo / scene / mount)
  engine/brand.js       Cloud.ru DOM primitives (canvas, text, lines, logo, dots, grid, llll, portal, bracket, rule, plate, arrow, star, cloud, counter, drawOn, colorMix)
  engine/brand.css      canvas, tones, type classes, line-mask, dev controls
  engine/tokens.js|css  GENERATED from brand/cloudru-motion-tokens.json (node scripts/build-tokens.js)
  engine/fonts/         SB Sans Display (Regular/Medium/SemiBold/Bold)
  templates/showreel.html   six brand scenes; ?scene=title|divider|kpi|content|scheme|finale, ?format=story|square|4k
  render/render.js      headless Chrome over CDP → beat stills, beat sheet, video (ffmpeg pipe), PNG frames
  render/serve.js       static server for live preview with controls
  motion.test.js        Node tests for the pure core
```

## 1. Why an engine and not CSS animations

Reviewing motion means looking at *stills of the right frames* and re-rendering after every
fix. CSS/WAAPI/GSAP animate against the wall clock; screenshots of them are not reproducible.
`Motion.timeline` computes every property from `t`, so `__motion.seek(t)` gives the same pixels
every time, frame by frame, in a headless browser. `play()` exists for humans; `seek()` is
the contract.

## 2. Authoring a page

```html
<link rel="stylesheet" href="../engine/tokens.css">
<link rel="stylesheet" href="../engine/brand.css">
<script src="../engine/tokens.js"></script>
<script src="../engine/motion.js"></script>
<script src="../engine/brand.js"></script>
<script>
const F = MotionTokens.format['1080p'], px = (v) => Math.round(v * F.scale / 2) * 2;
const canvas = Brand.canvas(document.body, '1080p');
const tl = Motion.timeline({ fps: F.fps });

const sc = Brand.scene(canvas, 'cr-tone-light');
tl.scene('title', 0, 4.6, sc);                                         // visibility window

document.fonts.ready.then(() => {                                       // measure real glyphs
  const h = Brand.text(sc, 'Cloud.ru снижает цену прогресса', 'cr-title', { left: F.margin, top: 400, width: 1100 });
  const lines = Brand.lines(h);                                         // .cr-line-mask > .cr-line per line
  lines.forEach((l, i) => tl.fromTo(l, { y: [Brand.lineHeight(l), 0] }, { at: 0.5 + 0.07 * i, dur: 0.7, ease: 'enter' }));
  const dots = Brand.dots(sc, { cols: 36, rows: 3, size: 4, gap: 12, pos: { left: 80, top: 960 } });
  dots.rows.forEach((row, r) => tl.fromTo(row, { opacity: [0, 1] }, { at: 1.1 + 0.03 * r, dur: 0.2, ease: 'linear', stagger: 0.004 }));
  Motion.mount(tl);                                                     // window.__motion + dev controls
});
</script>
```

### Timeline API

| Call | Meaning |
|---|---|
| `tl.fromTo(targets, { prop: [from, to], … }, { at, dur, ease, stagger, from, delay, set })` | the only tween primitive; `targets` may be an element, an array or a NodeList (arrays stagger) |
| `tl.set(targets, { prop: value }, at)` | instant state (HOLD) |
| `tl.scene(name, t0, t1, el)` | `el` displayed only for `t0 ≤ t < t1`; registers label `name` |
| `tl.label(name, t)` / `at: 'name'` | named times |
| `tl.seek(t)` · `tl.seekFrame(f)` · `tl.play()` · `tl.pause()` | deterministic seek; play is for humans |
| `tl.beatList()` / `tl.beatList('all')` | review stills per scene (first, +0.6 s, +1.4 s, mid, last) / every tween edge |
| `Motion.mount(tl, { controls, autoplay })` | exposes `window.__motion` (`seek`, `fps`, `duration`, `frames`, `beats`); adds the scrubber unless `?render` / `__RENDER__` |

Props: `x y` (px, translate) · `scale scaleX scaleY` · `rotate` (deg; brand: 0/90/180 only) ·
`opacity` · `width height` (px) · `clipL clipR clipT clipB` (% hidden per edge → `clip-path:
inset`) · any custom prop through `set` (see `Brand.counter`, `Brand.drawOn`, `Brand.colorMix`).

Eases: token names (`enter exit move wipe count ui linear`), `[x1,y1,x2,y2]`, `'steps(n)'`
(portal builds), or a function. The brand tokens have no overshoot; do not add one.

Rule of thumb for time: brand tokens are milliseconds — `sec(MS.base)`; frames are
`Math.round(t * fps)`. Keep entrances on whole frames when the target is video.

### Brand primitives

| Builder | Returns | Animate |
|---|---|---|
| `Brand.canvas(parent, formatKey)` | `.cr-canvas` sized from tokens | — |
| `Brand.scene(canvas, tone)` | `.cr-scene.cr-tone-light|gray|dark|green` | `tl.scene` |
| `Brand.text(parent, str, cls, pos)` | absolutely positioned text (`cr-title cr-divider cr-section cr-subtitle cr-colhead cr-body cr-caption cr-label cr-kpi cr-kpi-second cr-kpi-desc cr-step-num`) | `y/opacity` |
| `Brand.lines(el)` | `[.cr-line]` inside `.cr-line-mask`s (call after `fonts.ready`) | `y: [lineHeight, 0]` = line-mask reveal |
| `Brand.logo(parent, { size, pos, svg })` | placeholder lockup; pass the real SVG string in deliverables | `y/opacity` |
| `Brand.dots({cols, rows, size, gap})` | `{ el, cells, rows }` | `opacity` with stagger by row |
| `Brand.grid({cols, rows, cell, weight})` | one element | `clipR/clipB` sweep |
| `Brand.llll({cells, cell, weight})` | `{ el, cells }` | `opacity/x` with tight stagger |
| `Brand.portal({w, h, steps, dx, dy})` | `{ el, steps }` | `x: [W, 0]` with `stagger: tight` = portal wipe; `opacity` with `dur: 0` = build |
| `Brand.bracket({inset, weight, cut})` | `{ el, sides, list }` | `scaleX/scaleY: [0, 1]` per side (origins preset) |
| `Brand.rule({w, h, origin})` / `Brand.plate({pos, color})` | element | `scaleX` / `clipR clipL clipT` |
| `Brand.arrow / star / cloud` | `{ el, path }` SVG, square caps | `draw: [0, 1]` with `set: Brand.drawOn(path)` |
| `Brand.counter({decimals, prefix, suffix})` | setter for prop `n` (U+202F thousands, comma decimals) | `n: [0, 12500]`, `ease: 'count'` |
| `Brand.colorMix('#222222', '#26D07C', 'color')` | setter for prop `mix` | the one green accent, last |

### v1.1 — market-practice additions (see `reference/motion-best-practices.md`)

| API | What |
|---|---|
| `ease: 'spring:m3_expressive'` / `'spring:snappy'` / `{ stiffness, damping }` | closed-form damped spring; **time-based** — omit `dur`, the tween takes the spring's settle time (`Motion.spring(name).duration`). ζ ≥ 0.8 for Cloud.ru. |
| props `blur` (px), `letterSpacing` (em), `rotateX rotateY z` | blur is a transition aid (0 at rest); 3D props add `perspective(1200px)` |
| `opts.mblur: 1` | velocity-driven motion blur on `x`/`y` above 30 px/frame (wipes, whip pans) |
| `Brand.words(el)` / `Brand.chars(el)` | word / character spans (chars only for code) |
| `Brand.highlight(wordEl)` | the one green word: returns its underline (`scaleX: [0, 1]`, 5–8 frames after the word lands) |
| `Brand.odometer(parent, { digits, cls })` | rolling digit columns, prop `n`, `set: od.set` |
| `Brand.texture(parent, { kind:'dots'|'grid', opacity })` | ambient dot field / hairline grid, prop `drift` (seconds) with `set: tex.drift` |
| `Brand.enter(tl, targets, { at, rise, scale, blur, stagger, ease })` | the premium entrance (opacity + rise + scale + blur) |
| `Brand.exit(tl, targets, { at, dur, drop, stagger, from:'end' })` | ≤ 10-frame exits, reverse stagger |
| `Brand.camera(tl, sceneEl, t0, t1, { push, dx, layers:[{el, depth}] })` | 2–3 % push with 3-layer parallax |
| `Brand.scaleThrough(tl, outEl, inEl, at)` | hidden-cut transition: out scales 1→1.06 + blur, in scales 0.96→1. Pass the **whole incoming scene** as `inEl` (later scenes sit on top). |
| `Brand.anticipate(tl, targets, { axis, back, travel })` | 20–30 % wind-up before a big move |
| `Brand.breathe(amp, period)` | setter for prop `breath` — texture tier only |

Scene overlap: `addScene(name, tone, seconds, build, lead)` in the showreel starts a scene `lead`
seconds early so a wipe or scale-through can hide the cut; entrances may start at negative
offsets inside that lead.

## 3. Preview

```bash
node html/render/serve.js . 8093
# → http://localhost:8093/html/templates/showreel.html   (space play/pause · ←/→ frame · Home)
# → …/showreel.html?scene=kpi      one scene     …/showreel.html?format=story   9:16 canvas
```

## 4. Render (review stills, beat sheet, video)

```bash
node html/render/render.js html/templates/showreel.html --out out/showreel --scale 0.5 \
     --beats auto --sheet out/showreel/sheet.png                     # stills + one contact sheet
node html/render/render.js html/templates/showreel.html --out out/showreel --beats none \
     --video out/showreel.mp4                                         # H.264 if ffmpeg has libx264, else VP8/VP9 .webm
node html/render/render.js page.html --out out/x --frames --from 2 --to 3     # PNG sequence of one second
node html/render/render.js page.html --out out/x --beats 0.5,1.2,3.0          # explicit times
```

- Chrome: `CHROME_PATH` env, else the Playwright cache, else common install paths.
  ffmpeg: `FFMPEG_PATH`, PATH, or the Playwright cache (its minimal build encodes VP8/VP9 only —
  `--video x.mp4` then falls back to `.webm` and says so).
- Video is streamed as JPEG frames into ffmpeg over a pipe, so no frame folder is needed;
  `--frames` writes PNGs as well. `--scale 0.5` halves the output size (fine for review).
- Each frame is `__motion.seek(t)` + `Page.captureScreenshot`; a 1080p frame costs roughly
  0.3–0.8 s in a container, so render review stills first and video last.
- The beat sheet is composed **in the browser** (no ffmpeg): thumbnails with `t · frame` labels.

Review protocol: open the sheet, then the individual stills; apply the checklist in
`brand/cloudru-motion-brand.md` §9 and the frame-judging protocol in
`reference/motion-vocabulary.md` §D. Fix, re-render only the affected `?scene=`, repeat.

## 5. Delivery formats

- **Video** (`--video`): the same page renders 1080p/4K/story/square via `?format=` or your
  own `Brand.canvas(…, key)` — type and travel scale with `format.scale`.
- **Web asset**: ship `engine/*.js|css`, the fonts and your page; call `Motion.mount(tl,
  { controls: false })` and drive `tl.play()` / `tl.seek()` from the host page (scroll-driven:
  `tl.seek(progress * tl.duration)` inside your scroll handler — deterministic seeking makes
  scrollytelling trivial).
- **Slides / GIF**: `--frames` + the pptx/gif tooling of your choice; keep 25 fps and whole-frame timings.

## 6. Porting to After Effects

The beat sheet is the bridge. Every `fromTo` maps 1:1 to `M.tween(prop, ms0, ms1, v0, v1, ease)`
with the same ease token (exact bezier mapping in `motion-design-principles.md` §2b), and every
`Brand.*` primitive has an `M.*` twin (`Brand.portal` ↔ `M.portal`, `Brand.lines` + `y` reveal ↔
`M.lineReveal`, `Brand.dots` + row stagger ↔ `M.dots` + `M.patternBuild`, `Brand.counter` ↔
`M.counter`, `Brand.drawOn` ↔ `M.drawOn`). Prototype in HTML (seconds per iteration), port to AE
once the sheet is approved.

## 7. Known limits

- `Brand.lines` splits on measured word positions; a heading that must break at a specific
  word should be given as two `Brand.text` elements.
- Fonts: if SB Sans Display is missing the page silently falls back to Verdana — check
  `document.fonts.check('600 20px "SB Sans Display"')` in the console before judging type.
- Custom setters run on every seek; keep them cheap (no layout reads).
- Chrome's `Page.captureScreenshot` in a container is the bottleneck for long videos; for a
  30 s 4K master, render on the local machine or use `--scale 0.5` for review.
