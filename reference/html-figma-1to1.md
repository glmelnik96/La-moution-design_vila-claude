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
   designer's safe-zone marks: keep them apart as annotations. Cull what a later opaque rectangle covers. Add the
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
