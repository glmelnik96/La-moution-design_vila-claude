# VJ loops for an LED wall — hours of deterministic generative video from one HTML page

First used 2026-10-15: two films for a DJ backdrop (30 min «loading», 45 min «loop»), 2304×1280 at 30 fps, built in
one evening from a client's element kit (a 3D cube PNG, four Figma frames of HUD vocabulary) and rendered in about
40 minutes. The method, for the next wall.

## 1. The page is a pure function of time

- One `<canvas>` the size of the wall. `render(t)` clears it and draws everything from `t`; nothing is kept between
  frames. `window.__motion = { duration, fps, ready, seek }` is all `film.js` / `render.js` need.
- Randomness is a hash of integers, never a PRNG that is stepped: `hash(i, j, epoch)` gives a cube, a chip, a tick
  its own stable number. Variation over time comes from hashing the epoch `floor(t / period)`.
- Everything periodic is `frac(t / period + phase)`; everything that enters uses `U(t, t0, dur)` → 0..1 and an ease.
  A segment rendered on its own (parallel jobs, a seek in the browser) is then identical to the same frames of a
  continuous run.
- Births: an element appears at `birth = f(hash)`; before its birth it is skipped. Default births to −1e9, not −10:
  a film tail rendered at negative loop time (see §4) made every "−10" element vanish.

## 2. A long film = cycles × chapters, hashed per cycle

- 45 min = 9 cycles × 300 s; a cycle = 7 chapters with fixed starts. The cycle index varies each chapter (symmetry
  of the kaleidoscope, drift direction, tunnel direction, seeds), so nothing repeats exactly, yet the structure is
  one rhythm.
- Chapter boundaries are hard cuts, block wipes, portal wipes or a two-frame flash — never dissolves. A wipe = cover
  the frame during [B − 0.5, B] over the outgoing chapter, uncover during [B, B + 0.5] over the incoming one; the
  chapter switch itself is at B. The same code at the cycle's end makes the loop seamless: the last frames cover,
  the first frames of the file uncover.
- A flash is 2 frames of #eeeeee, once per cycle: «строб можно, но очень мало» = 9 flashes in 45 minutes.
- An «operating system» program for the warm-up film: a progress value p = t / T gates families of elements by
  hashed birth times (chips from 8 s, texture 90–610 s, HUD from 420 s, cubes 540–1540 s, data rows 700–1500 s,
  partial floods, kaleidoscope bursts), the full flood at 100 %, then a wipe into the loop's first chapter.

## 3. Rendering: parallel segments, NVENC, concat

- `tools/render.js`: the parent opens the page once for its duration, splits frames into N jobs, spawns itself N
  times with `--job f0:f1:seg.mp4`; each job runs its own headless Chrome + ffmpeg and seeks `f / fps` exactly; the
  segments join with the concat demuxer, stream copy (same layout, video only: quirk 244).
- Per job at 2304×1280: canvas draw 12–20 ms, PNG capture ~80 ms, JPEG q95 ~50 ms → 9–11 fps per job; 8 jobs on a
  16-core machine ≈ 70 fps aggregate. 135 000 frames (75 min at 30 fps) in ~35 min.
- Encode with `h264_nvenc` (p6, vbr, cq 21, high, L5.1) so the CPUs stay with Chrome; 8 concurrent NVENC sessions
  ran on a GeForce. x264 `slow` in 8 instances would have been the bottleneck. JPEG q95 into H.264 cq 21 costs
  nothing visible at this pitch.
- 30 fps rather than 60: the organisers' own 60 fps loops showed the chain is 60-based, so 30 plays without judder,
  halves the render and the file; 50 fps would judder on it.
- Headless Chrome can use the real GPU here (`--use-angle=d3d11`, drop `--disable-gpu`: `EXTRA_FLAGS` in shoot.js)
  — WebGL reports the RTX; Canvas 2D is faster in software. Keep GPU for shaders only.

- A job whose FIRST frames are the heaviest (a kaleidoscope with a big offscreen source) can flicker for minutes while
  the other Chromes start: warm every job up (seek 0, seek its first frame, then capture), wait a rAF after each seek,
  keep offscreen sources <= 2400 px. Re-render only the bad ranges and splice them with the concat demuxer: `outpoint`
  cuts by DTS (boundary - 3 frames) and every piece gets an explicit `duration`; verify by counting packets (quirk 263).

## 4. Two files that cut into each other

The loading film's last 30 s render the loop's first chapter at negative loop time (`t − 1800` ∈ [−30, 0]): a cut
from the end of file 1 to the start of file 2 continues the drift, the waves and the chips. Everything in the chapter
has to be defined for negative t (modulo, births: §1).

## 5. The element kit as a vocabulary, not a layout

- Read every Figma frame as a set of primitives with exact numbers (chip 35 px with 15 px SB Sans Text Mono digits,
  arrow 1 px with a 43 px chevron, hatch gap 14, light chip 86×34 with 20 px digits, flood cell 40 px) and scale
  them to the wall (×1.2 here; lines 2 px minimum for a 3.9 mm pitch).
- Compose generatively: hashed positions on a 48 px module, hashed sizes, hashed episodes every 20 s that re-roll;
  two interleaved episode streams offset by 10 s so a frame is never empty at a re-roll.
- A PNG hero (the cube): make it a lattice. Measure the designer's tiling by autocorrelation of their pattern image
  (peaks = basis vectors), express the basis in cube widths (here a = (1.1, −0.3) w, b = (0.79, 0.79) w), and draw
  only lattice points inside the frame. Drift must be reduced modulo the lattice (solve the basis for the integer
  part, hash the ABSOLUTE lattice index) or cubes jump and change identity at the wrap.
- Lighting a static PNG: a face mask (alpha = greenness, from the PNG's own colours) tinted with the brand green
  and drawn over the cube with `source-over` at ≤ 0.5 saturates the face; `lighter` blew the faces to white. A dark
  tint of the same mask switches a cube «off». The mask PNG must carry the mask in its ALPHA: an L-mode PNG is
  opaque, so a `source-in` tint fills the whole box with the colour, a square halo behind every cube.
- Kaleidoscope: 2N wedges, each a clip of angle π/N, odd wedges mirrored with `scale(1, −1)` after rotating by the
  wedge angle; the source is an offscreen canvas with the lattice drawn rotating and drifting. Tunnel: K rings, ring
  k at phase `frac(t / T + k / K)`, radius and cube size geometric in the phase, alpha fading at both ends — an
  endless zoom periodic in T / K.

## 6. Checks before sending (`tools/check_video.py`)

Specs (codec, level, size, fps, colour tags), decoded frame count against duration, mean luminance per minute (no
dead minutes, no blinding ones), frame-to-frame luminance jumps > 40/255 listed with their times (the only ones
allowed are the designed flashes), first/last frame of the loop compared. Then contact sheets of every chapter and
transition, viewed, before the files go out.
