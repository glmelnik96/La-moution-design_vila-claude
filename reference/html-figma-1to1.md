# A Figma storyboard as a pixel-exact HTML animation (SKILL.md §5f)

When the input is a Figma storyboard (a row of frames = the states of one animation) and the bar is
**layout fidelity** — every rest frame of the animation equals its Figma frame — and the deliverable is
video or a web page, not an AE project. Free-mode product motion (§5b) rebuilds boxes; this rebuilds
Figma. First used 2026-09-28 on a 9:16 DOOH ad (two concepts, four looping variants, 10–13 s each).

Tools: `html/figma/` (copy `fig.js`, `fig.css` → `<project>/lib/` next to `html/engine/motion.js`;
the scripts → `<project>/tools/`; the fonts' OTFs → `<project>/fonts/`).

## 1. Read the storyboard

- Sections are variants, frames are states. Ask which section is which variant and what differs in
  motion only (two sections can be pixel-identical and differ in animation — confirm, don't guess).
  Notes on the canvas («паттерн постоянно движется вверх», «добавляется как одна из опций») are specs.
- Renders: `get_screenshot(section, maxDimension = section width)` gives 1:1 with a 40 px margin → crop
  each frame. Delivery-scale references: `download_assets(frame, defaultScale = outW / FW)` (RGBA).
  get_screenshot never upscales.
- Layers: `use_figma` read-only dumps, **ASCII only, one frame per call** — the MCP transport breaks on
  replies over ~20 KB and Cyrillic is escaped 6–12× (quirk #189). Transliterate names/texts; print per node
  `id type name x,y wxh` (frame coordinates from `absoluteTransform`), fills, strokes (+weight, align),
  text: font/size/lineHeight/letterSpacing/fills per styled segment, `textAlign*`, `textAutoResize`,
  `leadingTrim`, `paragraphSpacing`. Skip repeated chrome after the first frame.
- Measure the render before trusting a number: `inkrows.py`-style row profiles, ink bboxes.

## 2. Build components (`fig.js`)

- `window.FIG_FRAME = { w, h }` = the Figma frame in its own units (a 1080×1920 frame scaled in Figma is
  791.0024 × 1406.2266 — build in those units; the render supplies the scale).
- One component per layer (or rigid group): root `translate(x, y)` = the Figma box; props via
  `comp.apply` (motion.js custom setter) → any prop can be keyframed (`w h len d open cT/cB/cL/cR a ry …`).
- **Geometry in SVG** (fractional edges anti-aliased like Figma): `rect` (INSIDE stroke, selection
  handles `ht/hb`), `hline` (a Figma LINE: stroke over [y − sw, y], quirk #190), `crossBox`, `logo`,
  `dots` (pattern fill: tile, scale, spacing → pitch; union clip for stepped regions).
- **Text in HTML on Figma's baseline**: Figma = `(L − (asc+desc)·S)/2 + asc·S` below the line top (exact
  metrics); CAP-trimmed boxes start at the cap top; vertical-centre boxes centre the line. Chrome does
  not land there (rounds ascent/descent, floors the half-leading) — `text()` measures Chrome's own first
  baseline with a zero-height inline-block and offsets the glyphs so the two coincide; layout stays on
  whole px, fractions live in transforms (quirk #191). C/R aligned text: shift by ls/2 or ls (Chrome adds
  tracking after the last glyph).
- **Light-on-dark text → Figma's outlines** (`extract_outlines.py`, `outline:` option): browser text is
  ~10 % heavier there, no Chrome switch fixes it (quirk #192).
- Draw a thin separator **under** its neighbours when they share a fractional edge (quirk #196).
- A frame whose body starts at x 0.53/1 shows the section colour in column 0 — a Figma artefact: fill the
  stage, skip column 0 when diffing (quirk #195).

## 3. States and verification

- A table of states per frame straight from the dumps (`S.F8 = { box0: {x,y,w,h}, word0: {x,y}, … }`);
  `?frame=F8` applies one state and mounts a still timeline. **Reproduce designer drift** (text 34–49 px
  from its panel rule in different frames, 50 % in one frame and 30 % in the next, a LINE in F5 that is a
  VECTOR in F6): keyframes absorb it on the moves. **Fix typos by default** with `?typos=keep` for the
  verbatim check, keep the Figma left edge; list every such case in the report.
- `shoot.js --jobs` (one Chrome, `--disable-lcd-text`, `--font-render-hinting=none`) → `verify.py`
  (mean |diff|/255, share > 24 and > 64, worst clusters, Figma|HTML|diff strips) → `inkshift.py`
  (centroid dx/dy, ink-mass ratio of one element) → `zoomcmp.py` (magnified trio).
- Bars reached: mean 0.1–0.9, > 64 under 0.13 %, text centroids ±0.3 px, ink mass 0.98–1.02, dot grid
  ±0.05 px. A centroid offset with identical glyph column runs is anti-aliasing, not position.

## 4. Choreography

- Every element is keyframed **exactly at the Figma rest states**; transitions interpolate with shared
  eases so rigid groups read as one (motion.js applies elements in first-tween order — a controller
  created later overrides the parts it drives while its `on` prop is 1).
- One progress prop per compound move (a push row: ink box grows from the right, old box shrinks with a
  constant gap, old word squeezed out at 0.55× the edge speed and cropped by its box, new word trails).
- Always-moving layers (a scrolling pattern) keep their style exact, not their phase: flood (eased boost)
  + constant crawl, rows wrapping, lower edge riding the top panel's rule.
- Tempo the user approved: holds 0.25–0.65 s, brand box 1.9 s, the next element starting while the
  chrome is still landing, the end card opening while the page is still leaving; loops 10.4–13.4 s.
  A first cut with 0.8–1.2 s holds and a 3 s end card was sent back: «сократи пустые экраны, паузы».
- «More technological» = micro UI from the design's own vocabulary, only inside transitions (rest frames
  stay Figma): selection handles popping pairwise, a Figma-style size readout counting the height, a
  caret blinking after the headline, a ⊠ drawing itself (square, then diagonals), rules drawing on, a
  caret leading the strike-through.
- `verify_anim.py page.html "figma/frames/sN_f%02d.png" --mask …` after every timing change: shoots each
  `window.__MARKS` hold and diffs it — it caught a later state silently switching a mask back off.

## 5. Render

- `film.js page.html --video out.mp4 --hd | --2k | --outw N` — the design frame rasterised at DPR N/FW
  (not a CSS scale, quirk #193); frames 0..N−1 so the loop point is not doubled; H.264 CRF 16, yuv420p.
- `--every 0.16` + `sheet.py` for the contact sheet; check first/last frame of each loop (seam).
- Delivery-scale check: `diffexport.py export.png still.png` (A F10 0.58, B F6 0.89 at 1080; text within
  1.3 device px — Chrome rounds glyph baselines to device pixels, Figma does not).
- 2K for vertical DOOH = 1440×2560 (say so; 1152×2048 is the other reading).
