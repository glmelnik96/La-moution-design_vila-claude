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
- **The linked nodes may not be where the edits are.** «The design changed» with links whose renders come back byte for
  byte identical and whose dump is unchanged: list the page's top-level nodes — designers duplicate a section per
  iteration and edit the copy (here 729 → 733 → 736, the old links stayed in the chat). Take the newest ids, diff their
  crops against the last round, and say which sections you built.

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
  chrome is still landing, the end card opening while the page is still leaving; loops 10.4–13.4 s. The one
  exception is the payoff state (the answers on ink boxes): the client asked for +1 s there — 1.7 s, nothing moving.
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

**Not every storyboard frame is a rest.** A frame that shows a move in progress — the stack one slot higher,
right before it leaves — is a pass-through. Held for 0.36 s between an eased step and an eased exit it read as a
freeze («не нужен фриз, когда три карточки поднимаются вверх»). One move instead: F6 → off the top with
`[0.35, 0.05, 0.7, 0.4]` over 1.32 s (starts at once, ~35 px/frame through the F7 slot, 90 px/frame at the end);
the header slips out (−94 px, 0.3 s, ease-in) just before the top rule reaches it, timed numerically so nothing
passes under it or re-emerges from behind it. Hold only the frames that carry a message.

## 4b. One story, several ad formats

When the vertical is approved and the client adds formats (16:9, a 728x90 banner…), each format is its own Figma
section with its own geometry — and usually only the key frames (5 instead of 12). Retell the approved story, do not
re-invent it:

- Same beats, same eases, same micro UI; only the directions follow the layout: stacked options push in the vertical's
  order (the storyboard's in-between sketch), side-by-side ones left to right; a banner's cropped word row is a
  horizontal fly-through (the vertical fly ease turned sideways, blur threshold above the middle speed so the key
  frame stays sharp).
- Code: one data file per format (`layout-*.js`: every rect, text, handle offset, dot region straight from the dumps)
  and one shared build + choreography (`concept-wide.js`, `timeline-wide.js`) — the 9:16 page stays on its own
  concept file with a flag for the approved changes.
- The designer's per-frame drift carries over into each format (a word 15 units higher in one box, font sizes 195 vs
  196.2, a headline 10 up between two frames, handle offsets per box): reproduce it, it is what verification compares.
- Dot-pattern tile origins jump between frames (the body frame moved): write each origin as its equivalent within one
  pitch and tween it through the transition — the grid glides a few units instead of jumping.
- Anything that slides inside a box needs clipping at both box edges once the box no longer touches the frame edge
  (a squeezed-out word slid over the headline).
- Light-on-dark words that the Figma file misspells: scale the same word's outline from another format of the same
  font (vector glyphs scale exactly) and place it with the line model; the size class closest to the target is best
  (the 75-unit source landed 0.5 units high at 196).
- 2K for other shapes: 16:9 = 2560 x 1440 (`--outw 2560`); a 728x90 banner at 2560 is 316.5 tall — film.js crops to
  even sizes for yuv420p.

## 5. Render

- `film.js page.html --video out.mp4 --hd | --2k | --outw N` — the design frame rasterised at DPR N/FW
  (not a CSS scale, quirk #193); frames 0..N−1 so the loop point is not doubled; H.264 CRF 16, yuv420p.
- `--every 0.16` + `sheet.py` for the contact sheet; check first/last frame of each loop (seam).
- Delivery-scale check: `diffexport.py export.png still.png` (A F10 0.58, B F6 0.89 at 1080; text within
  1.3 device px — Chrome rounds glyph baselines to device pixels, Figma does not).
- 2K for vertical DOOH = 1440×2560 (say so; 1152×2048 is the other reading). About 30 s per 12 s loop at 2K
  (one headless Chrome, CRF 16) — re-render everything after each round rather than patching videos.

## 6. Adobe Animate sources (FLA)

When the client wants the banners as FLA (HTML5 Canvas is what ad networks take from Animate), convert the finished
HTML version — do not rebuild it by hand. Animate must be installed (Creative Cloud): the tools write an uncompressed
XFL, Animate opens it, saves the .fla, publishes and exports stills. Tools in `html/figma/fla/` (copy to `tools/`,
`fla/hook.js` next to an extraction page that loads it after fig.js / the project's composites file).

1. `fla_extract.js page.html model.json` — the hook records every primitive (`Fig.rect/text/logo/dots` with its
   options) and every tween (start, duration, ease); the script seeks each frame and stores each component's applied
   props (`comp.cur`). Everything downstream comes from what the HTML actually rendered.
2. `fla_build.py model.json OUT W H name` — stage px = Figma units × W/FW (real banner size, not the Figma scale).
   One layer folder per component, one symbol instance per part (a box = fill + 4 stroke edges + 4 handles; a word =
   static text + a mask layer for its clip; a dot grid = rows of a one-row symbol inside a mask of its region; a
   brand box = halves revealed by masks). Per-frame states (scale, position, alpha) become keyframes + classic tweens:
   each span's custom ease is the exact normalised sub-curve of one of the recorded cubic-bezier eases, or a cubic
   polynomial (x-controls 1/3, 2/3), checked on every frame (0.015 px, 0.0004 scale, 0.002 alpha); a span nothing fits
   is split at a recorded tween boundary or the worst frame. Result here: 10–20 keys per layer, ~95 layers, 200–290
   tweens per banner, Figma states as frame labels on their own layer. Project composites (here the brand box) need a
   converter of their own; layer names are a per-project map.
3. `fla_finish.py BUILD name OUT frames` — runs the JSFL (open XFL → save FLA → publish → PNG stills).
4. `fla_verify.py page.html OUT W` — Animate's own stills vs the HTML at stage size, every 4th frame of the loop
   (got ≤ 1 % of pixels off by > 48/255 for 450x800 and 800x450, ≤ 2.5 % for 728x90 = small-text antialiasing);
   `fla_canvas_shoot.js` shoots the published canvas at any DPR for the same check; reopen the saved .fla once.
- Text stays live (static text) and lands on Figma's line via the calibration in quirks 200–201; tell the client the
  fonts and that kerning lives in per-letter tracking. Filters do not publish (quirk 203): motion blur stays out.

## 6b. Checking Animate's output

- JSFL from the shell: `Animate.exe file.jsfl` (starts Animate or hands the script to the running one); a script
  reports through `FLfile.write` into a log the shell polls; wrap every step in try/catch (no alerts, no modal).
- Never let Python `zipfile` judge an FLA: Animate's zip has a central directory it rejects (quirk 204).
- Compare at stage size or 2×: published static text and complex shapes are 2× bitmaps (quirk 205), so a 1:1-Figma
  shot of a 728x90 (11×) is blurry by design, not misplaced. Got (canvas 2× vs HTML 2×, every 8th frame): median
  0.71 % / 0.73 % / 1.75 % of pixels off by > 48 for 450x800 / 800x450 / 728x90.
- One headless Chrome hung after ~20 canvas screenshots of the 728x90 (each frame alone was fine):
  `fla_canvas_shoot.js` relaunches Chrome every 8 stills.

## 7. A family of resizes: the states as data, one runtime

When an approved story has to run on many ad sizes (2026-10-08: 23 formats × 5 states for Yandex, SberSeller, VC,
Ведомости, Habr and TG), building each format by hand (§4b) does not scale. Extract every state as data, classify it
into roles, and let one runtime rebuild every state exactly and play the story on any of them.

1. **Extraction, one read-only `use_figma` script.** Walk each state frame in paint order and flatten it into
   primitives in frame coordinates, each with the intersection of its clipping ancestors: rectangles (SOLID and
   PATTERN fills, stroke with weight and align, corner radius, ellipse flag), texts (characters, font, size,
   lineHeight and letterSpacing with their units, alignment, autoResize, leadingTrim, fill), logo instances, frames of
   repeated bars, booleans (the operand tree → rectangle cell algebra), vectors and lines. Solid red shapes are the
   designer's safe-zone marks: keep them apart as annotations. Cull what a later opaque rectangle covers; a logo that
   is ≥ 70 % under one is a leftover copy, not a covered logo — drop it whole (its exposed 7-px sliver read as a glitch
   beside the real logo, and the client caught it). Add the
   frame's **own fill** as the bottom layer (quirk 213) and any annotation lying on the section over the frame
   (quirk 214).
2. **Getting it out.** The MCP reply breaks past ~20 KB (quirk 189): JSON → UTF-8 → LZW → base64 with an FNV-1a sum,
   20 400-character slices. Do not retype the slices: they are in the session transcript (quirk 212). 246 KB of JSON
   for 115 frames came back in four calls and was joined and checked by a script.
3. **Roles.** A classifier names every primitive by colour, name and geometry: the header band (ink rectangles from
   the top, grown by plates that start inside it), option boxes and their handles (small near-square ink rectangles →
   nearest box corner), the words of a box (the box its left edge and vertical centre fall in — text frames are often
   wider than the box), the phrase, the button band and button, the brand box, the legal line, the age mark, the
   background. Print the role summary of every state and every unclassified item; refine until nothing is left over.
4. **Text as glyph outlines** (fontTools: GPOS pair kerning, Figma's line model of §2), one shared glyph table per
   page — no fonts to ship, the same pixels everywhere, ~10 KB per layout.
5. **Scene and runtime.** Per role, one instance per distinct content with a per-state offset. The runtime rebuilds any
   state (`?frame=Fn`) and plays the approved story keyed to them, exposing its rest points (`__MARKS`). Where the
   designer drifted between states (a header 1.7 px taller in two of them, a second copy of the button 0.15 px off),
   reproduce each state and swap instances while something else moves.
6. **Verify twice.** States against the Figma crops, the annotations drawn (`?ann=1`) and cut by the opaque layers
   painted after them. Got mean 0.4–4.2 / 255, the high end on 5-px text. Then the story at its marks against the
   states: 0.00–0.01 in all 23. Filmstrips every 0.4 s with marks and presses framed are the art-direction pass. Read
   every format's strip: the generic story broke where data differed (a button present in F5 as its own instance never
   appeared until handled).
7. **Story details that held across sizes**: copies of a word on one line enter together; stacked options push in the
   storyboard's order, side-by-side ones left to right; a «press» at the end scales the button about its centre
   (never up — it must stay in frame) by max(0.95, 1 − 0.24·short/long side) and darkens it, once: in the last state
   if the button is there, else after a beat at the end of the state that shows it.
8. **Fluid sizes and delivery**: `reference/banner-platforms.md` (100%×250 with two layouts, a 2:1 contained box,
   click macros, limits, CPU, moderation rules that change timing).
9. **A brief change the mockups carry only partly.** «We enlarge the age mark» — measure it against its reference
   (the legal line) in every format before building: the designer had enlarged it in 11 of 23 (1.28–1.61×, median
   1.44) and left the old 1.0 in the rest, and the client noticed those. Bring the stragglers to the median (keep the
   edge it is aligned to and its vertical centre) and list them in the README as a change against the mockup.

### 7b. A motion copied from the client's own banner

When the client points at a finished banner («возьми анимацию как тут») — an Adobe Animate / CreateJS export:
- The timeline is plain JS: custom eases are baked per frame as `.wait(1).to({x:…, y:…}, 0)` keys on the symbol. Read
  the x of every frame, normalise it to progress 0..1 and play that table as the ease (linear interpolation, plus an
  inverse to find when a given progress is reached). Keep its geometry relative to the frame (here the line switched on
  with its leading edge at 86 % of the width and off with its tail at 10 %), so every width gets the same pass.
- To watch it: load it in headless Chrome, `createjs.Ticker.paused = true`, then per frame `exportRoot.gotoAndStop(n);
  stage.update()` and read `canvas.toDataURL()` — `Page.captureScreenshot` hung on that canvas page (quirk 215).
- The copied move still has to cross the storyboard state exactly: solve where the curve reaches the progress that puts
  the line at its Figma position and shift the start so that moment is on a frame; the state becomes a pass-through.
- Here: a wide banner's line of the intro word, cropped at both edges in Figma, did not read when it faded in place; the
  reference's fly-through (65 px/frame in, 7.4 at the slowest just past halfway, 54 out, 1.73 s at 60 fps) read and was
  applied to all seven wide formats; stacked word columns kept their in-place entrance.

## 8. A single slide as a short clip that lands on the slide (keynote videos)

One Figma frame (a presentation slide), a one-line brief per clip («objects appear one after another», «the lines
merge into one, then a white square appears», «from grey, through light, the silhouette appears»), MP4 out. The
clip goes into the deck in front of the static slide, so its LAST FRAME must be the slide. First used 2026-10-13: three
2304×1280 slides, 4–4.6 s each at 50 fps, built and rendered in about an hour.
- **Layers from Figma, not rebuilt:** `use_figma` dump for ids and render bounds, then one
  `get_screenshot(child, contentsOnly)` per animated object (quirk 239); solid-colour texts unmixed from the slide render
  (quirk 240). A project-side script crops each to its ink, writes `layers.json` (+ a `layers.js` table for file://
  pages) and recomposes the stack against the render: 0.02–0.39/255 here. Rasters (an image fill, a photo) come with
  `download_assets` rawImages when their pixels must be split (rim light, a sign's squares).
- **Page:** a 2304×1280 stage, `<img>` layers at their x/y, `motion.js` tweens (`opacity`, `y`, `blur`, custom setters
  for CSS masks, SVG paths, SVG filter parameters); `window.Fig = {FW, FH}` so `film.js` sizes the viewport.
- **The landing:** after everything has settled, the full slide render fades in on top (0.3 s, nothing moving), so
  the last frame equals Figma exactly (diff 0) whatever the layers did. Check the frame BEFORE that dissolve against the
  render too: anything that differs there shows as a dissolve (a vector fan beside its raster did, quirk 243).
- What read well: cards with a fast 0.28 s fade and a long 0.9 s rise. A slow fade showed the background grid through
  a large green card. Chart areas need a feathered mask reveal (16 % edge): a hard clip showed the area under the curve
  as a sliding box. A signal square leaves the merge point small and lands at its spot with a short halo. A silhouette
  comes out of flat grey through a colour fog (quirk 242), with a backlight that swells and settles into the slide's
  own gradient, a rim-light sweep with a glint at its head, and a sign that flickers on at the end.
- Verify: `film.js --beats` sheets, the first frame is the flat background (no 1–2 level ghost), the last frame and the
  pre-dissolve frame diffed against the render, then the decoded MP4's last frame (H.264 yuv420p: 0.9–1.5/255 mean).
- Eases, after the review «чуть плавнее и более нелинейными»: start every move from zero speed. v1's expo-out entrance
  (0.16, 1, 0.3, 1) began at 6.25× the average speed and read as a pop. Use (0.6, 0, 0.12, 1) for rises: peak 4× at 38 %,
  90 % reached at 62 % of the time. Use (0.75, 0, 0.2, 1) for wipes, light sweeps and travels, (0.45, 0, 0.25, 1) for
  opacity, and make durations about 1.3× longer. Exception: big solid cards still fade in 0.3 s with an early ramp
  (0.2, 0, 0.3, 1); a slow fade shows the background grid through them.

## 8b. A run of slides as one continuous film (accordion, curtain into the last slide)

First used 2026-10-13:
- **Input.** Eight 1920×1080 slides from one Figma section.
- **Brief.** Effective, non-linear and sequential motion. Enough time to read every slide, but not so much that the
  film gets boring. A curtain transition into the final promo slide, which holds noticeably longer.
- **Output.** One 54 s film at 50 fps.

Layers and eases are as in §8. Verify layer by layer, not only by the frame mean (quirk 248).
- **Story first: what carries over between slides.** The title slide's box grew into slide 2's five-column frame. Slides
  3–7 play that frame as an accordion: one column opens into a card, the others close to narrow strips with a grey
  title and icon. Nothing that persists exits and re-enters.
- **Accordion.** One SVG rect per column for all states: tweened x, y, w, h, stroke colour and fill opacity, read
  from each state's Figma rects. When a column changes width, its title and icon crossfade between two bitmaps (the
  36 px white and the 28 px grey title; the green and the grey icon):
  - the old bitmap scales toward the new size about its centre and fades;
  - the new one arrives from the old scale.

  Translations at rest are whole pixels.
- **A card in.** All on the moves ease:
  - the green title bar grows from its left edge (scaleX, 0.8 s);
  - the dark title in it is revealed from the left by a clip;
  - the corner arrow slides in from (−28, +28);
  - the bullet rows follow 0.16 s apart (icon scale 0.45→1, text x −26→0);
  - a sheen crosses the bar after the rows settle.
- **A card out.** Rows fade out in reverse order, 0.025 s apart, and the bar folds. The columns start resizing 0.15 s
  later (1.1 s, (0.7, 0, 0.15, 1)). The next card starts building 0.9 s after the out.
- **Timing that read well.**
  - title slide 4.4 s;
  - the frame and slide 2 5 s;
  - each four-bullet card 6.2–7.0 s, holding 3.8–4.6 s after its last row lands, the longer holds for longer text;
  - the final slide 11.4 s, its build and a 7 s hold included.
- **Curtain into the last slide.**
  - Two green panels sweep in from the right, the dark one first and the brand-green one 0.1 s later, 0.62 s each, and
    cover the accordion, which is hidden underneath.
  - The dark panel lifts off. The green one rises and shrinks into the final slide's brand bar (1.0 s) while the slide
    builds under it.
  - The panel stays as the bar's ground, and the bar's content scans in over it with one front (quirk 252).
  - The film ends with the dissolve into the slide render from §8.
- **The second round of the same film** (the client's notes on v1):
  - a gradient bug on the final slide (quirks 250, 252);
  - columns that overlapped or gapped (quirk 253);
  - «no collisions» (quirk 253);
  - 4K;
  - a variant that ends on the title slide.
- **4K.**
  - Layers come from `download_assets` at scale 2, with alpha unmixed (quirk 250). The slides come
    from the same tool at scale 2.
  - The layout goes into one generated JS table that the page reads.
  - The page places the layers at half size on the 0.5 px grid (`GC.img2`) and renders with
    `film.js --outw 3840`, which sets DPR 2.
  - The decoded rest frames matched the 2× renders at 0.5–0.9/255 on the untouched slides.
- **Ending variants from one page:** `?end=title`.
  - The panel shrinks into the title slide's box. Its fill fades and leaves the box line, the title rebuilds inside,
    and the film ends on the title slide's render.
  - Whatever a variant does not use gets `display: none` (quirk 254).
- **The third round: the designer corrected the deck** (9 slides; icons became square bullets; a new slide 8; a new promo).
  - **Diff first.** Render every frame again and diff it against the previous renders. That narrowed the work to the
    bullet column of slides 3–7, the new slide and the new promo.
  - **Measure what the client calls sloppy.** «Bullets may be placed carelessly, with wrong indents»: the measurements
    found
    - indents of 60–81 px;
    - bullet-to-text gaps of 38–57 px;
    - bullets 6–12 px off the line;
    - paragraph gaps of 35–55 px.

    One rule replaced them:
    - the bullet at card + 72;
    - the text 40 px after it;
    - the bullet centre 9.5 px above the first baseline (the designer's median);
    - the first and last baselines fixed;
    - equal gaps within a card.
  - **The new slide was rebuilt the same way.**
    - The diagram is centred in its frame.
    - Connectors start at the box centres; the designer's were 5–6 px off.
    - The arrows sit on one axis; the designer's differed by 2.75 px.
    - The list rows are on one pitch, with the numbers on the text baseline.
    - The boxes, lines and arrowheads are vectors, drawn on in the order the work flows.
  - **Carry over what the slides share.** The closed columns fold up into the list's first rule. The open card's frame
    becomes the diagram's frame, and its green title bar becomes the green «Agents» node of the diagram. The header's
    dot field stays; its mask widens for the two-line title.
  - **The film's last frames come from the render.** The promo text was unmixed from the slide render, and the brand
    bar was cut from it as one layer. The pre-dissolve frame then matched at 0.01/255. Every box is on whole px
    (quirk 255).

## 8c. A whole deck rebuilt from Figma's SVG export, every element its own unit

First used 2026-10-23: a security deck of 13 dense slides (an architecture diagram, an 18-service grid, flows, a
dashboard) as one 163 s film, 4K 50 fps, in the motion language of §8b.
- **When.** Every element must move on its own, every rest frame must equal Figma, and screenshotting children one by one
  (§8) would take hundreds of calls.
- **Exports.** `download_assets` with `defaultFormat: "svg"` per slide: layer names as ids, outlined text, absolute
  coordinates, image fills as pattern defs. Scale-2 PNGs of the same nodes are the reference. `use_figma` cannot dump a
  slide (quirk 286).
- **Inventory.** Open the SVG in headless Chrome: document order is the z order, `getBoundingClientRect` gives each box.
  The slide is the `g` whose first child is the 1920×1080 rect.
- **Units.** Classify and cut one SVG per unit (integer viewBox, only the defs it references, ancestor opacity, clip and
  mask wrapped in):
  - plate, line, bullet: rects become divs, so they grow and morph; a plate's rect includes its stroke, drawn as an
    inset box-shadow;
  - text: a group of unnamed fill-only paths, or a named path with two or more subpaths; split into lines by clustering
    the subpaths' y, one SVG per line, each in its own window (masked rises);
  - icon: a group with a clip-path, or of `Vector` paths only up to 150 px, or small with strokes;
  - shape (masked groups), pattern and image (pattern-filled rects), dash (a dashed rect's outline), conn (a compound
    connector path split into its connected components, so each draws on in the order the flow runs).
  - images are baked to 2x PNGs before any motion: a pattern-filled rect bleeds its next tile under a CSS scale
    (quirk 291).

  Keys are the layer names transliterated; repeats get `_2`, `_3`.
- **Prove the units before any motion.** A page shows one slide at rest from its units. Its 2x still must match Chrome's
  render of the whole export (≤ 0.02/255 here).
- **The kit.**
  - A writer that chains each property from its last written value.
  - Setters for plate edges (l t r b), plate paint (fill alpha, stroke alpha, colour mix), the feathered wipe and the
    conic sweep (donuts).
  - Entrances by kind with a default, exits by style, a slide exit (images and dot fields first, then latest entrance
    first, chrome never: quirk 289).
  - Carry-over: morph to the next slide's unit rect, then hand over to that unit; the two-tone curtain (quirk 290).
  - Holds: clamp(0.28 s × text lines, 4.5, 8.5); the last slide 10 s.
- **Carry-overs that read.** What persists becomes the next slide's structure:
  - panels fold into rules, colour-mixed to the rule's grey;
  - a rule rises into a panel's top edge, and the panel unfolds;
  - a rule unfolds into a zone, its grey kept as the outline while the fill darkens;
  - three panels fold into three dividers; a stage becomes a band.

  The growing plate goes under the outgoing content, and lines crossing its path leave first (quirk 290).
- **Checks.**
  - A probe lists the units that never entered (a choreography gap; must be 0).
  - Rest frames are diffed against Figma's current PNG, not the export. The export misses image adjustments (quirk 287)
    and Figma's dash layout (quirk 288). Here 12 slides landed at ≤ 0.28/255 mean, anti-aliasing only.
  - Sheets of every carry-over and of the builds.
- **A designer editing the file live.** Keep the slide node ids in the project notes. A re-sync is: re-export, rebuild the
  units, probe (`no unit …` names every vanished key), redesign the carry-overs that used removed elements, diff the rest
  frames against fresh PNGs. Slides whose keys survive keep their choreography.
- **A slide progress bar** (a film that runs unattended or behind a speaker: a long hold must not read as a frozen
  video, and the next slide's moment should be visible):
  - one fill per slide, linear from the start of the transition into it to the start of the next; the last one is
    full on the last frame. Take that frame after the scene windows are set, since a window can lengthen the film;
  - two fills take turns: at the cut the full one runs off to the right (0.6 s sweep) while the next starts at the left;
  - full-bleed on the bottom edge, 4 px at 1080 from an even row (with 4:2:0 an odd top row shares chroma with the
    ground above it at 1080p), brand green over an 8 % white track that fades in so the first frame stays clean. A
    player's bilinear chroma upsampling still gives the row above a quarter of the bar's chroma at the ground's luma
    ((4, 47, 22) on #222222): a 1-px isoluminant fringe that reads as a soft edge, inherent to 4:2:0;
  - over the slides and the chrome, under the curtains: on the bright panel a green fill vanishes and the track draws
    a line across the wipe;
  - a `?bar=0` switch keeps a clean master. The Figma diff leaves the bar's rows out, and every still checks the fill
    against the timing (pixel-exact here).
- **Render.** Parallel segments, one headless Chrome and one libx264 each (4 jobs, `--outw 3840` = DPR 2, preset slow,
  CRF 16, BT.709), joined with the concat demuxer: about 0.2 s a 4K frame per job.
