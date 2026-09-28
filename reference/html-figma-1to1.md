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
- Multi-paragraph TEXT nodes (a whole panel stack typed as one node): the top of line k in paragraph p is
  `y + k·L + p·paragraphSpacing`; U+2028 breaks a line inside a paragraph without the spacing.

### Review rounds

- **Figma comment pins cannot be read** (quirk #197): ask for screenshots or the text, then answer with a table
  «comment → what changes» before building. Named changes and prohibitions are acceptance criteria.
- **A designer's edit round is usually partial**: the fix lands in some frames only (new words in F7 but not in F8;
  a solid dim colour in one frame, alpha in the next — even inside one text node, word alpha and strike solid);
  a whole section under a dark overlay = parked. Re-render the sections, crop and diff against the previous crops
  (`figma_changes.py sections.json`), dump only the changed frames again, build the intended state, verify each
  frame in the look it actually has (a `?look=figma` switch) and list the leftovers for the designer.

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
- Colour changes as props: `text({ color, color2 })` + prop `k` mixes the two (a struck word dims to a solid
  colour — «не через прозрачность, будет чище» — where alpha would show the background through); `dots({ da })`
  scales the grid's opacity («паттерн чуть менее заметным») with the Figma value kept behind `?look=figma`.
- An accent on one line inside a group (a tagline swelling 20 %): give the line its own layer with
  `transform-origin` at its visual centre in the group's coordinates (cap-trimmed: top + cap/2) and scale it.
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
  stay Figma): selection handles popping pairwise, a caret blinking after the headline. Tried and sent back
  in review (table below): a Figma-style size readout counting the height, a ⊠ drawing itself, rules drawing
  on, a caret leading the strike-through — tool imitations and draw-ons read as noise, not as technology.
- `verify_anim.py page.html "figma/frames/sN_f%02d.png" --mask …` after every timing change: shoots each
  `window.__MARKS` hold and diffs it — it caught a later state silently switching a mask back off.

### What the first client review changed (2026-09-28, round 3)

| Comment | Answer |
|---|---|
| a size readout «735 × N» «какая-то техническая штука» | editor-tool imitations read as leftovers: dropped; handles and the caret stay |
| «не нужно рисования отдельных элементов, они просто появляются» | no draw-ons (⊠ drawing itself, rules drawing on, a caret leading the strike): units arrive whole; the strike and the dimmed colour snap on in one frame, the new word still rises |
| «к моменту замедления верхняя строка должна быть выше» (paraphrased) | a flood fills the frame to the header *before* it visibly slows. Check numerically where the top row is when the speed falls to 50 % of its peak: 1600 px / 1.5 s / `[0.35, 0.7, 0.3, 1]` instead of 1180 px / `[0.2, 0.9, 0.3, 1]` (peak 100 instead of 144 px per frame too) |
| «буквы с прозрачности» | rows fade in bottom-up (0.5 s each, 55 ms stagger, 24 px lift) and fade out bottom-up, instead of rising in line masks |
| «версию, чтобы они пролетали снизу вверх» | a fly-through: one function ease per row, `y = F − SPAN·(a·v + (1−a)·v³)`, `v = 2u − 1`, `a = 0.2` — fast in, slowest (never stopped) exactly on the Figma state, fast out; vertical motion blur on the fast ends only (SVG `feGaussianBlur stdDeviation="0 σ"`, `σ = 0.145·(speed − 15 px/frame)`, ≈ a 180° shutter). The next element waits until the wall is under the header |
| «фраза увеличится на 20 % и обратно уменьшится (быстро)» | 1 → 1.2 in 0.2 s, back in 0.32 s, 0.08 s after the box has opened; the rest-frame mark after it |

The solid intro letters then covered the «0+» age mark in two frames (it showed through at 50 %): legal marks go
above decorative layers — flag it to the designer rather than copy it.

## 5. Render

- `film.js page.html --video out.mp4 --hd | --2k | --outw N` — the design frame rasterised at DPR N/FW
  (not a CSS scale, quirk #193); frames 0..N−1 so the loop point is not doubled; H.264 CRF 16, yuv420p.
- `--every 0.16` + `sheet.py` for the contact sheet; check first/last frame of each loop (seam).
- Delivery-scale check: `diffexport.py export.png still.png` (A F10 0.58, B F6 0.89 at 1080; text within
  1.3 device px — Chrome rounds glyph baselines to device pixels, Figma does not).
- 2K for vertical DOOH = 1440×2560 (say so; 1152×2048 is the other reading). About 30 s per 12 s loop at 2K
  (one headless Chrome, CRF 16) — re-render everything after each round rather than patching videos.
