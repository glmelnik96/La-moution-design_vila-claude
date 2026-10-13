# A Figma deck as an animated HTML presentation (SKILL.md §5g)

When the input is a set of Figma slides and the deliverable is a **click-through presentation** — a speaker
advances it on a screen, every slide builds itself on arrival and then rests on exactly the Figma frame — and
the output must work offline as one file. Not a film (that is the AE deck pipeline, §5c) and not a looping ad
(the storyboard pipeline, §5f). First built 2026-10-13 in a cloud session: GoCloud Tech 2026, seven 2304×1280
slides of a supplied design (Figma `wPZx91jtPPRJ7tCdOSEqI2`). Worked example, tools and beat sheet:
`_build/gocloud-tech-2026/` (`BEATS.md` there).

## 0. Before anything: can the session reach Figma?

- The Figma MCP can answer (`get_metadata`, `get_screenshot`, `use_figma`) while every asset URL it returns
  (`https://www.figma.com/api/mcp/asset/…`) is refused by the cloud proxy (`CONNECT tunnel failed, response 403`).
  The fix is the user's: environment settings → Network access → add `www.figma.com` and `figma.com` to Allowed
  domains. It applies to the running session; check with one `curl` of a fresh screenshot URL.
- Until then `get_screenshot(…, enableBase64Response: true)` still works: the PNG is saved under the session's
  `tool-results/` folder — enough for reference renders, not for assets.
- Asset URLs expire (minutes for `download_assets`, ~7 days for `get_design_context`): download at once.

## 1. Read the slides

- Order: the user may paste the links in any order (here reversed). Take the story order from the file (canvas
  position, the narrative), say which order you used, offer to flip it.
- Reviewer comments come as screenshots (MCP cannot read comment pins, quirk 197). Treat each as an acceptance
  criterion and answer it by name in the report.
- Per slide, in parallel:
  - `get_design_context` — reference code (positions, fonts, CSS gradients for gradient text) and asset URLs.
    Its image URLs are ~1024 px previews and it silently drops PATTERN fills (quirks 239, 240).
  - one read-only `use_figma` dump per slide (ASCII-escaped, under 20 KB, quirk 189). For every node it prints
    the box relative to the frame, fills including PATTERN and IMAGE (hash, scaleMode, imageTransform,
    filters), strokes, effects, and the text segments (font, size, lineHeight, letterSpacing, textCase).
    Grids of thousands of identical nodes: summarise them (count, extent, first cell, the cells that differ).
  - `get_screenshot(maxDimension = frame width)` → `ref/sNN.png`, the truth for every rest frame.
- A slide built from a raster screenshot of an older slide (here the funnel of 24 lines) — fit its geometry from
  the pixels and rebuild it as vectors (§3). Report what was wrong in the raster.

## 2. Assets

- Photos and 3D renders: `download_assets(node, png, scale 1)` gives the node **in context** (background baked
  in, filters applied, clipped to the frame); `rawImages` give the real alpha. Cut the layer out:
  `tools/prep_assets.py` (quirk 239), check it over magenta, ship it as WebP (q 92, alpha 100): a 2304×1280 3D
  render came to 0.37 MB, a dark photo to 0.07 MB.
- Vectors (chart areas, step lines, backdrop shapes): the SVGs from `get_design_context` — keep their paths and
  `userSpaceOnUse` gradients verbatim, inline them so they can be animated.
- Glyphs of a font you do not have (SB Sans Text Mono here): `download_assets(cell, svg)` outlines the text —
  the path goes into `Path2D` for canvas. Export a cell inside the frame: one outside its clip returned nothing.
- Fonts: if the design uses Google fonts, an earlier HTML export of the same deck often carries them as base64
  woff2 subsets; extract them rather than downloading.

## 3. Build (`deck.js` = runtime + one builder per slide)

- **Stage** = the Figma frame (2304×1280) scaled to the window with `transform: scale(k)`, letterboxed on black.
  Text stays vector at any k; a canvas resizes its backing store to `W·k·dpr`.
- **One `Motion.timeline` per slide** (`lib/motion.js`): the build plays when the slide opens, its last frame is the
  Figma frame. Every slide starts from an empty #222 frame, so nothing of it may be visible at t = 0 — opaque
  helper plates fade in (quirk 242).
- **Text**: one element per Figma line, inside a mask that cuts only below the line box; rises from under it.
  Gradient text across several lines: each line carries the gradient sized to the whole node and shifted by
  the line's offset. Single-line auto-width nodes: compare glyph positions with the render first — an even drift
  gets letter-spacing fitted to Figma's width, a single bad pair («/с») gets its own correction (quirk 241). Follow
  the render where it disagrees with the dump (textCase UPPER rendered as typed). Figma LINE strokes sit above
  their y (quirk 190).
- **Pattern grids** as exact rectangles in one SVG path (quirk 240); revealed with a soft-edged CSS mask sweep.
- **Big repeated fields** (60×32 cells with a digit each) on one `<canvas>`, redrawn from the timeline's time
  through a custom setter, skipped once settled.
- **Counters**: odometer columns in a clip window that hugs the digits' ink (not the line box), so rolling
  digits never cross the caption above; gradient digits keep the gradient fixed by moving
  `background-position` against the roll.
- **Charts**: line drawn with `stroke-dashoffset`, the area under it follows the pen through a feathered mask
  (a hard clip edge reads as a moving box).
- **Photos**: cut-out layers over their own background layers → brightness / push / rise without the
  background moving; a light sweep = a rim-highlight layer (`plus-lighter`) under a moving gradient mask.
- **Transitions**: the outgoing slide leaves in 0.32 s (opacity + 2 % push, exit ease), the next starts 0.2 s
  later; back (←) jumps to the previous slide's rest frame; no cross-dissolves.
- **Presenter runtime**: → / Space / PgDn / Enter / click next, ← / PgUp / right-click back, R replay, F fullscreen,
  B or «.» black screen (clicker key), 1–9 jump, H help; `#n` deep link; the slide counter shows only on mouse
  move; the cursor hides when idle. No help overlay on load — the audience would see it.
- Test hooks: `?render&slide=N` mounts that slide's timeline for `html/render/render.js` (`__motion`),
  `?slide=N&t=T|end` freezes one state.

## 4. Choreography that worked (beats in `_build/gocloud-tech-2026/BEATS.md`)

| Slide type | Build | Build length |
|---|---|---|
| two KPI cards (growth vs constant) | grid sweep; dark card rises, green card wipes; curve draws while ×1→×5 clicks in step; the flat line draws in the green card while «35» lands still | 3.2 s |
| funnel «1e9 in → 10 out» | odometer 0→1 000 000 000; 24 lines draw into one point, pale pulses accelerate into it; the output line draws and one white bit travels out; «~10 бит/с» lands | 3.7 s |
| photo, no text (taxi) | camera push 1.06→1, backdrop and car brighten out of dark, a light runs along the roofline, the checker lights square by square | 2.9 s |
| unit swap (GPU-час → ТОКЕН) | chart and step line grow; old unit enters bright, gets struck through and dims; the new word rises out of a mask | 3.0 s |
| section title over a 3D object | object scales 1.1→1 out of blur; grid block, then white plates wipe in stepwise; lines reveal | 1.85 s |
| headline + photo | label and two lines reveal; grid sweeps up; the photo rises and brightens | 2.2 s |
| field of bits + the chosen ones | cells fill in a diagonal wave with jitter (squares first, digits after); two centre cells fill green from below, 0 rolls to 1; title plate wipes in last | 3.6 s |

Reviewer asks met here: «show the field filling with zero cells, then the two in the centre lit» and «rebuild
the funnel without bugs» (the raster had two lines missing the vanishing point by ~20 px and the output line
3 px below the square).

## 5. Verify

```bash
sh _build/<deck>/tools/shoot.sh rest                       # every slide's last frame → out/gct/rest/sNN.png
python _build/<deck>/tools/compare.py out/gct/rest _build/<deck>/ref out/gct/cmp   # mean |diff|, worst blocks, strips
python _build/<deck>/tools/zoom.py crop.png sNN x0 y0 x1 y1 2                      # magnified pair + centroid shift
sh _build/<deck>/tools/shoot.sh beats N 0.1,0.3,0.5,… 0.25                         # stills of the build
node _build/<deck>/tools/navtest.js page.html out/dir 1920 1080                    # real-time run as a speaker + console errors
```

- Bars reached: mean |diff| 0.36–2.3 / 255 on the six slides kept as designed (the rebuilt funnel 4.2 by
  intent); glyph-run starts within 1 px of the render on every single-line text checked; ink ratio 0.99–1.02.
- `navtest.js` caught what stills cannot: the next slide's plates covering the outgoing slide mid-transition.
- Look at the beat stills of every slide before sending; judge transitions from the real-time run.

## 6. Deliver

- `tools/build_single.py` → one HTML with CSS, fonts, images (base64 WebP), `motion.js` and the deck inlined:
  0.8 MB for seven slides. Re-check two rest frames and the real-time run on the packed file.
- A preview video for phones: `render.js --video` per slide (`--to` past the build = a short hold, `--scale 0.5`,
  30 fps, system ffmpeg has libx264), then `ffmpeg -f concat -c copy` — 32 s, 2.7 MB.
- Client branding: send the file; offer a private link instead of publishing one unasked.
- Git: `*.png` are ignored in this repo — commit the page, WebP layers, fonts, tools and the beat sheet; the
  reference renders and raw exports are re-downloadable inputs (say so in the beat sheet).
