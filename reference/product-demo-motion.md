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
