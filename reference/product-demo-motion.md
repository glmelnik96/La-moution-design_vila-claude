# Product-demo motion — a reference decoded

Source: `chddaniel-2094883770164015174-01.mp4` (a Shipper launch spot), 1280×720, 24 fps,
26.6 s, 638 frames. Every number below was **measured off the frames** — per-frame mean
absolute difference ("energy"), ink-bbox tracking, and 5 fps contact sheets — not eyeballed.
This is the target the user set for "this level of motion and variety".

## 1. Why it reads expensive — six things, in order of weight

1. **The UI is the actor.** Nothing is "animated onto" the design; the product is *used*:
   idle caret → typing → pointer arrives → hover glow → click → the box becomes a panel →
   rows tick → the list scrolls → a toggle flips. Motion *is* the story (prompt → build →
   result → settings → publish → claim → logo).
2. **57 % of frames are still.** 365 of 638 frames have energy < 1.2; sixteen holds ≥ 0.25 s,
   the longest 2.8 s (16.0–18.8). The energy timeline is bursts, not a hum. Every hit is
   followed by stillness — the holds are what make the hits land.
3. **Scale contrast.** One input box (macro) → a full app screenshot → a monitor on a desk →
   a single word filling the frame. The camera changes *size class* four times in 26 s.
4. **Blur is the transition aid, never the look.** Letters blur in, screenshots blur on the
   fly-in, a settings panel drops to a blurred skeleton between states, the whip is a
   12-px smear. Blur at rest: zero, everywhere.
5. **3D only on the screenshots.** Fly-in with a perspective tilt that flattens as it lands.
   Ink bbox height 61 → 174 px over 16 frames while x decelerates
   31, 15, 11, 9, 7, 5, 4, 3, 1, 1 px/frame — a textbook ease-out, on tilt and travel together.
6. **A tempo arc.** Establish (a word every ~0.45 s) → develop (UI beats 0.3–0.5 s) →
   climax (a 6-frame whip; kinetic type 0.4–0.7 s per word on hard cuts) → resolve (logo
   held 2.8 s, 0.4 s fade). Cuts accelerate toward the end, then stop.

## 2. Beat sheet (measured)

| t (s) | element | mechanism | measurement |
|---|---|---|---|
| 0.0–1.9 | "Building apps is hard" | word-by-word; **accent moves to the newest word**, last word red | words land ≈ 0.0 / 0.45 / 0.95 / 1.4, each held before the next |
| 1.9–2.6 | "Shipper" | letter blur-in | "S" 1.88 → "Shippe" 2.08 → full 2.3 ≈ 60 ms/letter; sub-line lands 2.58 |
| 2.6–3.3 | sparkles | pop + drift + fade | ~10 particles, 0.7 s, around the title |
| 3.3–3.8 | input card | enter, then an idle caret | the empty box is a beat; caret ≈ 1.2 Hz |
| 3.8–5.0 | prompt | typewriter | 44 chars in 1.2 s ≈ 37 cps |
| 5.0–5.9 | pointer | move → hover glow → click | glow ≈ 200 ms before the click; click at 5.88 |
| 5.9–6.35 | card → Build Queue | expands upward | 0.45 s, two-stage energy 4.4 / 3.9 / 4.4: box first, then contents |
| 6.4–10.6 | queue | rows appear · ticks + strikethrough · pill swap · continuous scroll | one tick every ≈ 0.4 s; scroll linear ≈ 110 px/s; phases 1→5 |
| 10.6–11.2 | "They've built" | enter + spinner | held 0.6 s |
| 11.21–11.88 | app card 1 | **3D fly-in** from right-top | 16 frames; tilt flattens with the travel |
| 11.92–12.13 | app card 1 | **whip out** left | 6 frames; x0 58→136, deltas 5, 8, 12, 22, 31 (ease-in); cut *inside* the whip |
| 12.17–13.4 | app card 2 | fly-in, hold | landed by 12.6, held 0.8 s |
| 13.6–14.4 | Stripe card | dots typed → Save appears → click → blur out | |
| 14.4–16.0 | settings stack | pointer, skeleton state, Publish | |
| 16.0–17.2 | languages | rows appear, ticks one by one | |
| 17.2–18.8 | email toggle | toggle on, then the longest hold | 2.8 s |
| 18.79 | CUT | monitor mockup | slow dolly, 2 s |
| 20.75 | CUT (E = 70) | kinetic type on white | TURN 0.6 · IDEAS 0.4 · INTO 0.6 · PRODUCTS 0.6 s, hard cuts |
| 23.38 | CUT (E = 249) | logo on black | held 2.8 s, fade 0.4 s |

## 3. Mechanism inventory vs. this skill

| mechanism | in the reference | skill before | now (`html/engine/demo.js`) |
|---|---|---|---|
| word-by-word with a moving accent | ✓ | `Brand.words` (accent fixed) | `Demo.wordsAccent` |
| letter blur-in | ✓ | `Brand.chars`, no timing | `Demo.letters` |
| particles | ✓ | ❌ brand stop-list | `Demo.sparkles` (free mode only) |
| idle caret + typewriter | ✓ | ❌ | `Demo.type` |
| pointer move · hover glow · click ripple | ✓ | B18 as prose | `Demo.cursor` `Demo.glow` `Demo.ripple` |
| panel expand | ✓ | width/height props | `Demo.expand` |
| checklist tick + strikethrough + status pill swap | ✓ | ❌ | `Demo.checklist` `Demo.pill` `Demo.swap` |
| continuous scroll | ✓ | y tween | `Demo.scroll` |
| 3D card fly-in | ✓ | rotateX/Y/z props | `Demo.card3d` (measured curve) |
| whip pan | ✓ | `mblur` | `Demo.whip` (6 frames, cut mid-whip) |
| skeleton / blur state | ✓ | blur prop | `Demo.skeleton` |
| toggle | ✓ | ❌ | `Demo.toggle` |
| device mockup + dolly | ✓ | ❌ | `Demo.device` `Demo.dolly` |
| kinetic type on hard cuts | ✓ | `tl.scene` | `Demo.kinetic` (rhythm array) |
| logo hold + fade | ✓ | ✓ | — |

`html/templates/demo-shipper.html` rebuilds the whole 25 s structure from plain DOM with these
primitives. It is the proof that the level is reachable, and the pattern to copy for a supplied
frame.

## 4. Rules extracted — add these to the beat-sheet discipline

- **Accent follows the newest element**; the previous accent cools to body colour within 250 ms.
- **Pointer duration by distance**: 450 ms at 400 px, √-scaled (`Demo.durByDistance`).
  Glow 200 ms *before* the click; ripple 420 ms *after*; the pointer leaves ≥ 300 ms later.
- **Typewriter 36 cps.** The caret idles ≥ 0.4 s before typing starts — the empty box is a beat.
- **One row per ~0.4 s** for any list state change. Never tick two rows on one frame.
- **Fly-in 16 frames**, tilt and travel on the same ease; **whip-out 6 frames** on ease-in with
  the cut *inside* the whip and the next card already flying.
- **Kinetic type**: words on hard cuts, *unequal* durations (0.4–0.7 s), the longest on the
  payoff word. Equal durations read as a slideshow.
- **Holds**: ≥ 0.3 s after every UI hit; ≥ 0.6 s before a cut; the final logo ≥ 2.5 s.
- **Scale class changes** at least twice per 30 s: macro element → full screen → environment.

## 5. Brand-lock vs. free mode

The Cloud.ru stop-list (no glow, particles, rounded corners, gradients, per-character effects on
headings) is a *visual* brand rule. When the input is a supplied frame — PNG or Figma — the
visuals belong to that design: animate what is there. The **motion** craft rules still apply
in full: decisive ease-out entrances, faster ease-in exits, holds, one moving subject, exits
designed rather than cut. `Demo.*` is free-mode; on Cloud.ru work use only the mechanics the
brand doc allows (pointer, expand, checklist, skeleton, toggle, kinetic, device — yes;
sparkles, glow — no).

## 6. A voiceover product promo built from UI screenshots (2026-10-23)

The input: a 2:02 film with a synthesized voiceover, 11 scenes timed by the voice, 16 real UI screenshots. The first
version was one `<canvas>` with a macOS window, glows and lower-thirds; the client called it «слоповый». The rebuild that
replaced it keeps one pure `render(T)` and these parts:
- **Grid.** A text column on the left (x 87–647: title row, a white plate with the headline in caps, a green 8 px
  bar, dark blocks for the sub-line and a checklist). Screens on the right, clipped at x 687.
- **The screen is a sheet, not a window.** It has no browser chrome. A camera key `{t, cx, cy, z, d}` puts a screenshot
  point on the anchor; key edges follow quirk 275.
  - A focus frame (4 px green, 8 px outset) moves from field to field over 0.6 s.
  - The rest of the sheet is veiled: dark theme `#222` at 62 %, light theme white at 58 %.
- **Every beat sits on a word.** Phrase times come from pauses in the voice track (quirk 273). The checklist ticks and
  the focus frame steps on the same words: «образ, несколько дисков, флейвор, сеть…» move the frame down the form while
  the list fills.
- **Screen changes.**
  - Same page in a new state (a dropdown opens, a menu appears): a hard cut, like a real UI responding.
  - Another page: a top-to-bottom wipe inside the sheet, with an 8 px green edge.
  - Between scenes: a cover (a curtain or a wave of grid cells, quirk 274), or a shared element that grows into the next
    box (a white card → the screenshot sheet).
- **Shots.** Upscale the screenshots ×2 first (generation-recipes, «Phygital+ MCP server»), so a 1.3–2× zoom stays sharp.
  Remove stray pointers and capture leftovers.
  - The upscale shows only where the sheet is drawn larger than the original screenshot. In a 1080p film whose sheet sits
    at 0.75–1× of the original, the client saw no difference at all (quirk 276).
  - So render the master in 4K (a DPR 2 canvas: the ×2 source then lands 1:1 at z = 1), and frame reading holds at z ≥ 1.
  - Review copies: 1080p at CRF ≤ 20, plus 100 % crops of the screens. A 720p proxy hides exactly what is being judged.
- **Texts stay in a data file.** Choreography lives in the page, and the transcript tool rebuilds the
  voice timings from the audio.

### 6b. Round 2 of the same film: the client's corrections, and what they turned into

The client's notes:
- «drop the 3D visual, take the title from the event slide»;
- «the numbered list is off-brand»;
- «dots, not a grid, as in our previous event film»;
- «SB Sans Display, not Manrope»;
- a new voiceover;
- «the screenshots are still blurry»;
- a 4K master.

The rebuild (v3):
- **Language.** The event deck's slides, measured off their 2× Figma renders:
  - caps Semibold 40 headers with a grey dot field 94×8 (pitch 19.3, 4 px, #919191), knocked out under the header text;
  - frames: 2 px #757575, or #1D9C5D for the active one;
  - a green #26D07C plate with Regular ink text;
  - lists with 12 px square bullets, or green numbers 01–04 over 2 px #595959 rules;
  - thin #9A9A9A connectors, a dashed group outline, #2D2D2D blocks with the newest one turning green.
- **Title.** The event deck's title verbatim:
  - logo, a 1 px #D3D3D3 frame that opens from the left, the title rising by words with the voice;
  - the stars (that film's 4K layers), three line arrows, and the green dot field 62×7.
  - The final reuses it, with a green CTA plate where the dot field was.
  - The intro frame grows into three value columns with line icons; that replaced the off-brand numbered list.
- **One window for everything on the right.** The left card holds the plate, sub-line and list. The right window holds,
  one after another: a typed sign-in card, the screenshots, the KeyVRM and LCM diagrams.
  - Each item enters with a wipe that has a 6 px green edge.
  - During a wipe, the outgoing screenshot is drawn with its camera frozen at its last key, so a camera jump at the
    switch never shows.
- **Carry-over transitions.** The scheme block «Портал администратора» grows into the window, the scheme frame shrinks
  into the card, and the window and card become the two certification cards. A two-tone green curtain before the
  final shrinks into the CTA plate.
- **Sharpness.**
  - The canvas has a DPR (`?dpr=2` → 3840×2160).
  - Reading holds sit at z ≥ 1. (Round 4 changed the full-sheet view to fit the window's width: fitting the height
    cropped the logo, quirk 282.)
  - The focus veil is 0.36.
  - See quirk 276: the ×2 upscales were in v2 too, but never drawn larger than the original.
- **Voice.** A word table (`WD`) built from Whisper phrase by phrase (quirk 278); every beat is `V(WD.word) ± lead`.
- **Music.** Shifted by exactly one bar, so the groove stops under the final title.
- **Round 3 (v3.2).** The client found the screen changes «non-obvious and fast», the failover block «chaotic», and the
  focus frames «broken».
  - Page changes became pushes, and state changes became cursor clicks with short crossfades (quirk 281).
  - Word onsets right after inserted pauses were taken from energy (quirk 280); these were what had broken the frames.
  - The failover diagram became four hosts under one core. Its stages run as a numbered list in the card, one moving VM
    at a time, and it ends on a notification the cursor acts on.
  - 19 pauses (+10.9 s) were cut into the voice in its real gaps.
- **Round 4 (v3.3).** The client found a «strange splice» at 1:09 and screenshots «badly cropped»: the logo and the
  interface were cut, and a frame missed its block. The failover block was «jerky», and the security part did not read
  against the card text and the voice.
  - The overview now fits the window's width, and the bands above and below continue the page edges (quirk 282).
  - Only one zoom is left, where every crop line falls in a gutter. Focus frames follow the panel and row boxes (quirk 283).
  - Diagrams arrive complete. Every hold is checked by a timing dump, and a 1-second screen got a longer pause in front of
    the next section (quirk 284).
  - The security claims became a small diagram that lights word by word with the card's list (quirk 285).
  - Failover: 1.5 s moves on an ease-in-out, one at a time, with host states crossfading and the stages not overlapping.
  - The voice has 20 pauses (+14.6 s). The music repeats 8 bars and ends its groove on the last word of the final title.

### 6c. A partner's screencast film rebuilt in the same language (silent, for a booth)

The input: a partner's 101 s silent demo film in its own look, with the raw screencasts behind it. The film covers
building an AI agent in the console, then checking its security in the partner's service, with the report at the end.
The brief: same story, our brand, both logos, for our booth.
- **Kept:** the partner's story, steps and copy. The step counter «NN / 08 · STEP» became the caps header, with a green
  number; each step's headline and sub-line became the card's plate and sub-line.
- **Rebuilt:**
  - the title: both logos, the arrows, a frame with the first claim, the stars;
  - under the frame, a green plate with the second claim and its arrow. That plate travels into the card as the first
    step's plate, and travels back for the finale;
  - a two-logo footer during the steps.
- **Screens are video.** Clips of `{src, in, out, speed}` are cut to frames at the film's fps (quirk 293). The browser
  chrome is cut off, and the window takes the sheet's aspect (quirk 294).
  - Waiting time is cut out and joined with 0.3 s crossfades (an agent's status going «creating → starting → running»).
  - Long progress runs play at 8–12×.
  - Report pages hold as stills while the focus frame walks over the conclusion, the totals and the findings.
- **What the screen cannot carry at booth distance goes into the card:**
  - a status list whose squares light up with the badge on screen;
  - a numbered list of the check's stages, one item per stage.
- **Focus frames** only on still stretches (quirk 295). **Camera:** one zoom, on the centred wizard; the rest is overview.
- **Loop** (quirk 296): the finale rebuilds the opening title, and the loop renders from the intro's rest time.
- **Typography:** two-line sub-lines are wrapped balanced. Binary-search the narrowest width that keeps the line count,
  so no single word hangs on the second line.

- **Round 2: notes on the first cut.** The client asked for three changes:
  - an animated deck in front of the film (a Figma storyboard of builds);
  - «the screencasts are jerky and cut at the important moments»;
  - three versions: combined, deck only, demo only.

  What was done:
  - Interactions now play at 1×, each result holds as a freeze frame with its focus frame, and scrolls became measured
    smooth slides or camera pans over pages stitched from the pauses (quirk 297).
  - The deck is drawn from Figma's SVG export as Path2D units on the same canvas, with transitions computed from the
    layer diff of consecutive frames (quirk 298; html-figma-1to1 §8d).
  - One page renders all three versions, each looping without a seam (quirk 299).

### 6d. The same product line without screenshots: schematic screens in the film's language

The input: an animatic (17 scenes, 2:00) whose screens were drawn in code «after» the product's portal, and no real
screenshots. The user: «перерисовываем в нашем стиле, что было нарисовано. Рисуем схематично». The voice was regenerated
with the sibling film's settings (generation-recipes, «Voiceover»). The film reused the sibling film's page: header,
card with plate and lists, window, focus frames, cursor, curtain, final.
- **One evolving scheme for the opening claims.** Three claims (a zoo of platforms, migration off foreign ones, fault
  tolerance with backup) became one diagram in the big frame. The header changes with each claim; the diagram goes on:
  - six platform blocks, each with its own console label and VM chips. They wait at the frame's centre and rise when the
    platform band arrives;
  - the proprietary blocks get a white tag, the others dim. Their chips ride into a green platform band with four hosts,
    green while moving, with a green «running» square on landing;
  - a host fails (white fill, «СБОЙ»), and its chips restart on neighbours;
  - a backup block fills its copy slots one by one.
  Then the band shrinks into the plate under the product name. That plate becomes the claim «professional
  virtualisation platform»; the product's 3D visual rises beside it.
- **Capabilities** as nine tiles. The ones the voice names light green in turn and cool to a green outline; on
  «available right after installation» every tile gets a check.
- **Schematic console pages** for the window:
  - a top bar with the product name and the user;
  - a left nav whose active item marks the page;
  - tables with mono identifiers, green squares for state and thin bars for load.
  Pages arrive complete on the push; the voice drives only states. Examples: a tree «datacentre → cluster → host → VM»
  with the focus on each word; a template dialog where two clicks create a machine that then appears in the table; the
  same machine dragged into a folder that passes its rights down; networks drawn on with the words, then a security group
  and locks.
- **Diagrams for what a table cannot show:** import and live migration (with a LIVE tag and local disks syncing),
  host failure and maintenance, a week of full and incremental copies with a two-click restore, a chat with an action
  card and a «within the user's rights» tag, dashboards exporting to the customer's monitoring.
- **A raster visual** in a vector film: keep it at ≤ 1.3× its pixels in the 4K master. A 760 px render was drawn at
  370 px in the title column and 480 px in the platform scene.
- Traps: quirk 301 (a hyphenated word in a plate), quirk 302 (moving chips crossing occupied rows).
- **Round 2 of the same film.** The client's notes:
  - the visual should look like the event slides;
  - the capability tiles needed «what activates and what stays the same» in different places;
  - motion that was too fast, too linear or sloppy;
  - focus frames that broke.

  What was done:
  - **Hero visual,** after the reference slides:
    - the title frame narrows to the left half and becomes an opaque panel;
    - the 3D visual is drawn about 1400 px, bleeding off the right and bottom edges, with its left corner passing
      behind the panel;
    - the same composition repeats inside the frame for the platform scene (clipped by the frame) and in the final.
    - A first pass at 1000 px added thin #CFF500 arcs and crosses, as on one reference slide. The client asked for a
      larger visual and no lines.
    - The 760 px source went through Topaz ×4, with the transparency kept (generation-recipes, «A 3D render with
      transparency»).
  - **Capabilities in two zones:**
    - on top, the five the voice names: each rises on its word, fills green from the bottom, cools to a green outline
      when the next is named, and all five get a check on «available after installation»;
    - below, under «also in the product», four that never change.
  - **Motion:**
    - VM chips travel on cubic S-curves through the gap, lower chips first, into lower slots first;
    - a restart dims and boots instead of moving;
    - cascades are at least 0.14 s apart;
    - typing is at most about 25 characters per second;
    - progress advances by eased steps, and packets ease per trip.
  - **Focus:** quirks 303–304.
