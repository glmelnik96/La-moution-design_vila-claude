# LED-wall event films — one wall comp, generated beds, procedural systems

How the ODK-Saturn 110 anniversary show (2026-09) was built in the live AE from two client briefs:
a multi-screen wall (backdrop + diagonals + media wings), 4:30 narrated intro, five numbers to
music, splash / stinger / bumper / awards, with 5-second generated clips (MiniMax H3, `M:/Minimax h3`)
as beds and AE doing everything that must match the screens' geometry. Project: `C:/dev/saturn110`
(`tools/`, `ae/ODK110.aep`, `gen_brief/`). Lessons: quirks #120–#125.

## 1. Read the brief into a timeline first

`tools/timeline_data.py` is the single source: numbers (length, known/estimated), segments
(tc_in, tc_out, what's on screen, source = AE / GEN id / EXISTING id) and the map from shot id to
generated file. The generation brief (`tools/brief.py` → `gen_brief/ODK110_gen_brief.md`,
`shots3.py`, `timeline.csv`, `img/`) and the AE layout (`tools/numbers_jsx.py`) are both derived
from it, so a timing change propagates to both. Song lengths without the audio are estimates and
are marked so.

## 2. Split animation vs generation by what has to be exact

- **AE**: anything with geometry across screens (waves from the centre, the portal ring, blade
  outlines), anything typographic (names, awards, lyrics, chapter words), the archive parallax
  (real photographs are the record — never invent them), procedural loops.
- **Generation**: atmosphere beds (sky, clouds, stars, rails, chainmail), events that cannot be
  built (birds hardening into aircraft, a propeller becoming a turbine, a shop morphing into a
  modern plant), walk-throughs from graded archive stills (`--first` holds the composition).
- The brief lists which existing takes stay (loop passes) and which are re-shot because the
  look was wrong (cold rails vs the director's "закатное, ретро"), with the anchor frames that
  chain them (quirk #125).

## 3. The wall (quirk #124)

`ae/_build/01_skeleton.jsx`: folders, `WALL guides` (screen rectangles + labels as guide layers),
`SLOT` (the whole wall), five `OUT …` delivery comps, one comp per number, imports of logo /
drawings / refs / anchors / archive (upscaled, ASCII names) / generated clips / audio. Assets are
staged under ASCII paths (`ae_assets/`) because payloads must be ASCII; Cyrillic text reaches AE
as `\uXXXX` escapes produced by a Python emitter (`tools/*_jsx.py` → `ae/_build/*.jsx`).

## 4. Systems, then scenes

- `SYS splash background` (light centre → graphite edges, two Fractal-Noise "air" layers screen +
  multiply, three blade-outline rings, a rotating wedge-matted glint ring, a breathing glow) —
  used by the splash, the eight award comps and the intro finale.
- `SYS waves` (dark core with a turning blade shadow, 14 scalloped rings breathing on a travelling
  phase, glow field) — the bumper is 15 s of it; the stinger is 5 s of it pushed 3× into the core,
  then the generated G1/G2 clips (placeholders = the anchor stills until they exist).
- `SYS portal` (ring + generated interior + blade shadow, scale 10 → 100 → 900 %, white-out) —
  placed four times in the intro.
- Intro rig: a camera walking +z at 60 px/s for 270 s; each chapter's photos spawn 2600 px ahead
  at their time, alternate left/centre/right, feather-masked, graded per era, gone after 14 s;
  drawings as Add half-shadows; chapter words typed on (text animator, Percent Start 0 → 100 with
  Opacity 0 after it) in the mono face; generated-bed placeholders as graded stills with a slow push.
- Numbers: `numbers_jsx.py` lays every segment out — comp markers with the segment text, existing
  beds time-remapped `(time - inPoint) % d`, wide clips as a sharp main copy + a blurred 305 %
  "spill" under the whole wall, square clips on both wings, green guide plates where a GEN clip
  is pending.

## 5. Verify every build with captures

`M.capture([...frames], prefix, dir)` per comp, wait for the asynchronous PNGs (`review_sheet.py`
polls file sizes), assemble a wall strip + main-screen crops + the OUT comps, and look. Fixes that
came only from looking: the flattened emblem alpha, text landing right-aligned, the air layer
invisible at 38 % soft-light, seven drawings in Add turning the preshow into blue mush, chapter
words typed over the portal's white tail, duotone book scans staying pink under a mild desaturate.

## 6. "Flat is generic" — the material pass (2026-09-20, evening)

The first wall build (grey gradients, thin outline rings, a white hub light) was called generic by
the user; a second pass with flat two-tone shape blades was "the right direction, but the
execution must be better"; the third was still "flat graphics, not fashionable". What finally
read as material: the blades built as one extruded, bevelled shape layer under the **Cinema 4D
renderer** (`comp.renderer = "ADBE Calder"` — the only renderer where extrusion is
script-writable, quirk #129), lit by three point lights + ambient, a camera with DOF drifting,
a dark iris in front of the roots and a white core + bloom behind/over them, a second fan far
back for depth, seven albedo facets per blade, the emblem on a real shadow. Render cost stayed
in seconds per wall frame. Advanced 3D looked flat (no extrusion from script, env light source
not settable) and the fake-thickness copy read as paper. Lesson: when a client brief says
«градиент, тень, подсветка, трёхмерность», go to real 3D geometry and lights first — every 2D
shading trick (stepped fills, matted ramps, polar-brushed textures) costs a review round and
still reads as vector.

Timing came from the real tracks (`src/music/`): the intro WAV's speech-band envelope
(`ffmpeg` → numpy, 100 ms frames, 300–3400 Hz) gives narration pauses and the music-only gap;
chapter portals were re-timed to those landmarks (40 / 82 / 140 / 184 s; propeller→turbine in
the 1:59–2:20 gap) before a single word was placed by ear.

## 7. After the material pass: ripples, dark clips, stale crops (2026-09-20, night)

- Thin strokes over lit 3D blades read as wires / a mesh on the wall (13 crest rings at 1.4–2.8 px
  did). A ripple is a *band*, not a line: 10–26 px stroke, Gaussian blur 26 on the light crest and
  44 on a dark trough offset 10 px below it, opacity 5–36 % falling with radius, glow radius 140
  at 0.7. Judge such systems on a full-resolution centre crop, never on the 1/3-scale sheet.
- Generated clips arrive at whatever exposure the model chose (the G1 "turbine eye" came at a mean
  of 37/255). Grade at the layer (Levels: Input White 0.62, Gamma 1.4 — quirk #130) instead of
  re-generating; a dark passage right after the push into the dark core is coherent as drama.
- Review tooling must follow the wall geometry: `review_sheet.py --main` still cropped 2048×1024
  from the first 1024-high wall and squeezed it to 512, so every circle became an ellipse and a
  black band appeared under the main screen. Two rounds went into doubting the render before the
  crop was checked. When the wall changes size, grep every tool for the old numbers first.

## 8. The ceiling of procedural material (2026-09-20, ~23:00)

Four passes on the same splash — gradients, two-tone shapes, faceted-and-brushed shapes, real
extrusion with lights under Cinema 4D — and the verdict stayed «дженерик»; the user's own words:
the question is not flat vs 3D. The director's references for the scene were photographs (macro
brushed titanium, anisotropic highlights, warm/cool reflections, shallow focus, off-centre framing);
a procedural fan, however shaded, is a *diagram* of that and reads as stock. Rule: read the scene's
references before building its bed. Photographic references → brief a generated loop (or a real
PBR render) for the bed first, and let AE own only what must be exact — type, emblem, cross-screen
geometry, timing, award mechanics. Brief from the references' qualities, never their pixels (stock,
© marks). Wall mapping for generated beds: 21:9 canvas 1536×672 → the middle 384 px band → ×1.333
= MAIN 2048×512, key content and the white core inside that band; 1:1 canvas → wings 768 and the
512×768 diagonals by centre crop; loops as first = last stills, AE cross-fade as the seam fallback.
The procedural system stays as the placeholder and is presented as such.

## 9. The swap point, and what a generated bed still needs from AE

Build one precomp — `SYS splash bed` — that every scene using that background references (splash, the
eight awards, the intro finale). Inside it: the procedural system at the bottom as the fallback, and
above it the generated clips, picked up by prefix (`odk_S1loop_` → `odk_S1_`) with `importNewClips()`
scanning the generation folder on every build. Nothing else changes when the clips land: one build
and the whole show is on photography, and a missing clip degrades to the placeholder instead of a
hole. Loop clips time-remap `time % d`; a non-loop take ping-pongs `u = time % 2d; u < d ? u : 2d - u`.

What photography then needs from AE, none of which the generation can supply:
- **A light pool under every type block.** Black type on a photographed fan is unreadable wherever
  the frame is dark. A white solid with a wide elliptical mask (feather ≈ the radius) at ~78 % under
  the main lockup and ~88 % on the wings restores the brief's "white centre, graphite edges" and
  keeps the metal visible through it.
- **Vignette calibrated to the wall, not the frame.** A radial multiply of radius 2150 on a 4608-wide
  wall reaches the wings and kills them; 3400 with a 0.26 floor darkens only the outer edges.
- **The narrow diagonals** fall into a dark band between the bright main screen and the wings —
  give them their own low light fields (~46 %) or the wall reads as a hole.
- **Mirror repeated square clips** on the wings/diagonals (`scale.x = -75`) so the same photograph
  does not sit twice side by side.
- **Vector overlays die on photography.** A 5 px red circle over a photographed core reads as a
  sticker; the same accent as a 16 px stroke blurred 34 px at ~34 % reads as light on metal.

## 10. Archive stills on a wall: one frame at a time, two speeds, no frames

The brief said "анимируем архивные фотографии в формате параллакса… эффект бесконечного движения"
and, explicitly, "не эффект фотоальбома". The first build read both words as decoration and produced
the album: dozens of rectangles with drop shadows, several on screen at once, cropped by the wall's
edges, with type sitting on the fragments. The client's note was immediate.

What "параллакс" means for a still on a 4608×768 wall:
- **One photograph at a time**, butted end to end with a 1.3–1.6 s cross-dissolve, 4–6 s of dwell
  each. Fewer photographs, each actually seen, beats a flicker of everything the client sent —
  compute how many fit at the target dwell and sample the era's list evenly for that many.
- **Two layers of the same file at different speeds.** A blurred copy scaled to cover the whole wall
  drifts slowly (no visible edge anywhere), and a sharp copy scaled to cover the main screen edge to
  edge drifts three to four times faster, feathered ~7 % of its width so it melts into its own blur.
  That reads as depth without a depth map and without distortion ("без сильных искажений").
- **No borders, no drop shadows, no scattered placement.** The shadow is what makes a photograph
  read as a print on a table rather than a memory.
- Vertical crop: covering a 4:1 screen with a 4:3 original keeps a quarter of the frame, so offset
  the hero up by ~35 % of the overflow (capped) — heads sit above centre in archive photographs.
- Give each scene its own motion: a push-in with lateral drift for one number, a pure lateral travel
  for the next, or the two numbers read as the same footage ("но другие, не такие же").
- **"Full frame" on a multi-screen wall means every screen, not the main one.** The first correction
  was "sequential, not an album"; the second, immediately after, was "во весь кадр, включая боковые
  экраны" — a sharp centre with a blurred bleed on the wings still reads as a fragment. Cover the
  whole wall (`scale = max(W/w, H/h)`) and accept the crop: a 6:1 wall keeps about a fifth of a 4:3
  original, so offset the frame up by ~18 % of the vertical overflow and say plainly which
  photographs lose too much, offering a detail crop on the wings as the alternative. The blurred
  copy underneath stops being scenery and becomes the cross-dissolve bed.
- Interleave with the generated walk-throughs rather than stacking: shop clip, then stills, then the
  portal. Each chapter becomes "we entered a shop, remembered, walked out".

## 11. The corridor, not the slideshow — and how an endless walk is actually built

Two rejected passes on the same intro taught the structural lesson. The brief's through-line was a
**walk**: a performer on a treadmill in front of the wall, the image moving behind them, the shop
shown in strict central perspective ("как будто человек стоит на входе в цех, не сверху, не боком").
Archive photographs were named an **overlay** in the same paragraph, not the picture. Reading them
as the hero produced first an album, then a brutal 6:1 crop, then a mirrored fill — three rounds
spent because the *structure* was wrong, not the treatment. "Parallax" in such a brief means layers
moving at different rates inside a space, not a Ken Burns push on a flat scan.

The build that fits:
- **Base = generated walk-throughs**, one per shop/era, in two canvases: 21:9 masked exactly to the
  backdrop, and 1:1 on the wings and (band-masked) the diagonals, mirrored on the right half so the
  wall reads as one room. The generated camera supplies the real multi-plane parallax for free.
- **Endless motion from a 5 s clip without generating a loop pass**: two copies of the same clip,
  time-remapped `((t - inPoint) + phase) % d` with `phase = 0` and `d/2`, each with a triangular
  opacity `100 * clamp((0.5 - |p - 0.5|) / 0.18)` on its own phase. One copy is always mid-clip; the
  wrap is hidden inside a dissolve, and the forward travel never stops. Transitions (a propeller
  becoming a turbine, an old hall becoming a modern one) play `once`, time-remapped to the window.
- **Archive as overlays**: one fragment at a time, 52–74 % opacity, feather ≈ 16 % of the width, three
  size/blur classes so some read as underlay and some as accent, placed off-centre and high — the
  lower centre belongs to the performer. They drift faster than the corridor: that difference is the
  parallax the brief asked for.
- Ask before inventing pixels on historical material: extending archive photographs by outpainting
  is a client decision, not a production shortcut.


## 12. One image across the wall beats five sharp panels

Two separate corrections landed on the same point and it is worth stating plainly: on a segmented
LED wall the audience reads **one picture**, not five screens. Both of the arrangements that seemed
reasonable were rejected on sight — a sharp centre with blurred spill on the wings ("кусками и с
блюром — ужасно"), and five sharp panels each carrying a different take of the same room. What was
accepted: the clip scaled to cover the entire canvas (`scale = max(W/w, H/h)`), no mask, no spill,
no per-screen composition, with the overlays full height and sharp on top of it.

The cost is an upscale: a 1536-wide generation on a 4608-wide wall is 3×, against 1.33× when the
backdrop is masked to its own screen. That trade is usually right — LED pitch and viewing distance
swallow the upscale, while a visible seam or a blurred wing is noticed from anywhere in the hall.
Say the number out loud when proposing it, and generate at the widest canvas the pipeline offers so
the factor stays as low as possible. Corollary: square "wing" takes are only worth generating if the
design really is per-screen; check that before spending hours of GPU on them.

## 13. Two numbers to check before a source goes full-wall

Filling a 4608×768 wall with one image turns every source's own resolution and aspect into a visible
quality decision.

- **Upscale factor.** `4608 / source_width` must stay under about 3.2. Generated clips at 1536 give
  3.0 and hold; an archive scan at 1960 gives 2.35 and holds; a 510-px scan gives 9 and is mush on a
  wall. Measure the whole set before building, not after: in one number four files out of
  thirty-nine were below the line, and swapping them for equally suitable wide frames from the
  unused pool cost minutes, while noticing it from a capture cost a review round.
- **Crop bias by aspect.** A 6:1 window keeps roughly a fifth of a 4:3 frame and a seventh of a
  portrait, so a fixed "shift up 18 %" decapitates tall scans. Bias the crop centre by aspect
  instead: ~0.46 of the height for landscape, ~0.42 for near-square, ~0.34 for portrait. Heads,
  machine tops and building rooflines all sit above centre in archive photography.

Both checks are three lines of Pillow over the file list and belong in the emitter, next to the
layout, rather than in a reviewer's eye.

A fixed bias still fails the common documentary frame where faces sit at a fifth of the height and
the rest is bodies: any single band is wrong. Animate the band instead — start it at ~0.30 of the
height and crane down to ~0.52 across the shot's dwell, smoothstepped. The audience sees faces
first and the room after, the whole photograph gets used, and the move reads as an intended camera
rather than as a crop. It also gives a still the "picture itself is moving" quality a wall needs,
without any zoom.

## 14. A scene that uses only part of the wall

A segmented wall gives you the option of leaving panels dark, and a layout borrowed from print
often wants exactly that: on the ODK-Saturn splash only the two diagonals and the backdrop carry
the image, and the two side panels stay off. Three things follow.

**Cut on the seam, not near it.** The boundary of the active band should be the physical join
between panels — there it is invisible, and no feather is needed. A soft edge of even 26 px
straddles the seam and puts a grey sliver on a panel that is supposed to be black. Measure the
dark bands per captured frame rather than trusting the thumbnail: `crop(band).getextrema()[1]`
over a handful of frames. A value that is the same on every frame is a static leak; one that
moves is an element drifting in. Zero on one side and 104 on the other is a bug, not a look.

**Anything that drifts needs a hard boundary.** Particles, sweeps and light fields authored in
comp coordinates will wander off the band. Clamp the coordinate inside the expression
(`Math.max(800, Math.min(3820, px))`) rather than relying on a generous starting position.

**Dark speckle is not dust, it is broken hardware.** Small dark dots on a light field read as
dead pixels at wall scale. Build atmosphere out of bright motes on ADD instead: over a white
field ADD changes nothing, so they appear only where the picture is dark and need no mask at all.
For real depth, give the motes a comp camera — 3D layers plus depth of field produce genuine
parallax and bokeh, which no 2D overlay imitates; without a camera, breathe their scale with
their opacity and the eye reads it as depth anyway.

## 15. Growing a number onto more screens

When a number built for the backdrop has to spread onto the neighbouring panels, the answer depends
on what the picture is made of. Flat sources (photos, plates, footage) have a fixed width: covering
more panels means scaling them up, and the backdrop then shows a tighter crop — re-frame faces per
panel. A 3D scene (a camera over a photo wall, a set) just gets a bigger frame: the camera stays, the
backdrop keeps its picture, the new panels see more of the world — but check the widest shot for the
end of the world. Details in quirk #177.

## 16. Lifting a logo row off a busy picture — and checking every screen before delivery

**Change the picture under the logos, don't box them.** On the ODK-Saturn splash the logo row sat on a
generated turbine and "disappeared". A crisp white rounded plate with a shadow fixed legibility and was
rejected at once as generic. What worked: the logos larger (~690–820 px of row on a 2048 px screen) and at
100 %, over a *frosted-glass pool* — an adjustment layer (box blur ~26, Levels output black ~0.42, saturation
−35) with a pill mask feathered ~130 px, so the picture itself turns soft and light behind the row and no edge
is ever visible. It speaks the same material language as the glass transitions. Converting the existing,
already-timed glow layers into that adjustment layer kept the fade-ins and the transition stop-frames for free.

**Audit before the encoder does.** A wall with many numbers drifts: a screen that gained picture without a
render comp, a render comp for a dark screen, a crop offset left over from the old geometry. Check it in two
passes — structure (every listed screen has its comp with the right size, duration, fps, bin and crop offset;
every previz holds exactly those comps at their rects, the guides overlay, sound on one screen only) and
content (sample every master at half resolution, 8 frames: which screens carry picture, and whether any screen
with picture has black bands at its edges). The ODK tools are `audit_wall_jsx.py` + `audit_wall_check.py`.

**A narrated film gets a third pass: words, voice and picture.** Transcribe the delivered track (word
timestamps; check it is byte-identical to the file in the comp), then (1) put every on-screen word next to
the moment it is spoken — anything more than ~0.4 s early reads as a spoiler, and a wording that shifts the
meaning ("опыт поколений" for "опыт одного поколения") or contradicts it (a "1960" label over "в конце 50-х")
is a bug even when the timing is right; (2) grab one clean mid-frame per shot and lay it out with the words
spoken in that shot's window and the titles on screen. On ODK-Saturn that sheet caught what no metric would:
an English "FACTORY" poster in a Soviet wartime shop, a facade signed with a 2001 company name under the years
1945-1955, a black-and-white shot inside the colour chapter, and a "modern facade" clip that was in fact
sepia-toned — so moving it to the colour chapter would have broken the turn into colour.

