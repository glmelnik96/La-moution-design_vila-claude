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
