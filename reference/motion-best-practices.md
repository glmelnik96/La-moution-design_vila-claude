# Market best practice — what the strongest motion skills agree on

Distilled from the public agent skills and design-engineering references that currently define
"good motion" for AI-generated work, then mapped to this repo's two engines. Read this when a
piece looks *correct but cheap*; the fixes are almost always here. Brand adaptation (what
Cloud.ru keeps, relaxes, or refuses) is in §9 and in `brand/cloudru-motion-brand.md`.

Sources (fetched 2026-09-03): Emil Kowalski's animation standards ([review-animations/STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md), [7 practical tips](https://emilkowal.ski/ui/7-practical-animation-tips)); iart-ai `motion-design-skills` ([animation-principles](https://github.com/iart-ai/motion-design-skills), easing-curves, easing-graph-editor, twelve-principles, motion-art-direction, logo-animation, motion-background, beat-sync-editing); haidrrrry `claude-remotion-skill` ([motion-patterns / design-rules](https://github.com/haidrrrry/claude-remotion-skill)); GreenSock [gsap-skills](https://github.com/greensock/gsap-skills) (core, timeline, plugins); Material 3 motion tokens ([androidx MotionScheme](https://github.com/androidx/androidx)); LobzyJay [motion-design-with-claude](https://github.com/LobzyJay/motion-design-with-claude); [Claude-Code-Video-Toolkit](https://github.com/wilwaldon/Claude-Code-Video-Toolkit) / digitalsamba transitions; IBM Carbon (already in `motion-design-principles.md`).

---

## 1. The ten rules every serious skill enforces

1. **Never linear** for anything the eye reads as an event. Linear only for loops (tickers,
   spinners, marquees). Enter = ease-out, exit = ease-in, on-screen move = ease-in-out.
2. **Entrances animate 2–3 properties together.** opacity + translateY(30–40 px) + scale(0.94→1)
   is the "premium entrance"; a solo opacity fade is forbidden for anything that matters.
3. **Stagger everything that is a group.** Words 3 frames, cards 4–5, big blocks 6 (at 30 fps);
   lists 40–80 ms, dense grids 20–40 ms; cap a group at ~600–800 ms total, else shrink the offset
   or stagger by distance from a focal point. Direction follows the eye or radiates from the hero.
4. **Exits exist and are faster** — ~10 frames vs ~20 for entrances, ease-in, 2 properties
   (opacity + a short move away). A scene that ends without an exit is a cut you did not design.
5. **Holds are a design tool.** HIT → hold 15–20 still frames → build → HIT. Constant motion
   reads amateur; fast move → complete stillness → next move reads expensive. Something must
   move in the first 15 frames; never more than ~90 frames without a new visual element.
6. **Three motion layers per frame.** Primary/hero (the one slowest, most-eased move that lands
   on the beat), secondary/support (smaller, faster, gets out of the way, settles 40–80 ms after
   the hero — follow-through), ambient/texture (subliminal background life: slow drift, low
   contrast, never a hard cut). Same idea in Remotion's "5-layer stack": background → assets →
   graphics → grade → grain/vignette.
7. **The 1/3 rules.** No element travels more than ~1/3 of the frame without an intermediate
   key or a scale/opacity change; with 3+ elements, no more than ~1/3 move at once.
8. **Distance and size scale duration.** `duration ≈ base × (distance / base_distance)^0.5`
   (300 ms at 200 px → ~600 ms at 800 px). Micro 100–200 ms, UI 200–400, hero/full-screen
   400–800, cinematic camera 800–2000. UI stays under 300 ms; marketing may go longer.
9. **Timing derives from fps and a base unit.** One base duration (e.g. 400 ms) and all others as
   multiples; one easing family for ~90 % of moves; one transition family; one stagger rhythm;
   one hold discipline (≥ 0.3 s of stillness after each beat). That table *is* the motion language.
10. **Verify loop is mandatory.** Render → extract frames (Remotion: `still --frame 15 45 90 150`;
    here: `render.js --beats`) → look → fix → re-render. Check at 0.25× speed: easing flaws
    invisible at 1× are obvious at quarter speed.

## 2. Easing library (exact curves)

| Family | Curve | Feel |
|---|---|---|
| easeOutQuad | `0.5, 1, 0.89, 1` | gentle |
| easeOutCubic | `0.33, 1, 0.68, 1` | balanced default (iOS-ish) |
| easeOutQuart | `0.25, 1, 0.5, 1` | snappy |
| easeOutQuint | `0.22, 1, 0.36, 1` | decisive; iart-ai's "premium tech" signature |
| easeOutExpo | `0.16, 1, 0.3, 1` | dramatic, "premium" arrival (our `enter`) |
| easeOutCirc | `0, 0.55, 0.45, 1` | strong late deceleration |
| easeInQuart / Expo | `0.5, 0, 0.75, 0` / `0.7, 0, 0.84, 0` | exits (our `exit` = expo) |
| easeInOutCubic / Quart / Expo | `0.65, 0, 0.35, 1` / `0.76, 0, 0.24, 1` / `0.87, 0, 0.13, 1` | on-screen moves; expo = long mid hold (our `move`, `wipe`) |
| Emil's UI ease-out | `0.23, 1, 0.32, 1` | strong ease-out for UI |
| Emil's UI in-out | `0.77, 0, 0.175, 1` | strong in-out for on-screen movement |
| iOS drawer | `0.32, 0.72, 0, 1` | sheets / drawers |
| Material standard / decelerate / accelerate | `0.2, 0, 0, 1` / `0, 0, 0, 1` / `0.3, 0, 1, 1` | system UI |
| easeOutBack | `0.34, 1.56, 0.64, 1` | branded pop, 10–20 % overshoot (playful only) |

Four motion personalities (iart-ai): **Playful** 150–300 ms, back-out, 10–20 % overshoot ·
**Premium** 350–600 ms, `0.4, 0, 0.2, 1`, 0 % · **Corporate** 200–400 ms, `0.2, 0, 0, 1`,
0–3 % · **Energetic** 100–250 ms, expo-out, 15–30 %. Cloud.ru sits between Premium and
Corporate: "calm-sharp / premium tech".

**After Effects hand-shaping** (iart-ai graph-editor reference): Easy Ease (F9) is a 33 %
symmetric starting point, never finished. Snappy UI = outgoing influence 15–25 %, incoming
80–90 %, both velocities 0. Overshoot = a third key 6–10 frames before the end at 112 % of the
target, settle keys at 85–95 % incoming influence. Our `M.bezierEase` produces the exact
equivalent from a cubic-bezier, so the two worlds share one number.

## 3. Springs (physics that self-determines duration)

| Preset | Params | Source / use |
|---|---|---|
| Snappy | stiffness 300, damping 30, mass 1 | Framer default; interactive UI |
| Gentle | 120 / 20 / 1 | soft arrivals |
| Bouncy | 400 / 17 / 1 | playful only |
| Stiff, no bounce | 500 / 50 / 1 | heavy panels |
| Apple-style | `duration 0.5, bounce 0.2` (keep bounce 0.1–0.3) | Emil's recommended UI spring |
| Counter | stiffness 60, damping 30 | haidrrrry number count-up |
| **Material 3 Expressive** spatial | damping ratio 0.8 / stiffness 380 (default), 0.6 / 800 (fast), 0.8 / 200 (slow) | hero moments, "spirited" |
| **Material 3 Standard** spatial | 0.9 / 700 (default), 0.9 / 1400 (fast), 0.9 / 300 (slow) | product UI |
| Material 3 Effects (colour/opacity) | 1.0 / 1600 (default), 1.0 / 3800 (fast), 1.0 / 800 (slow) | never bounce non-spatial props |

Rules: springs for *interruptible / interactive* motion (they keep velocity when retargeted);
duration + easing for *choreographed, timeline-locked* work. Overshoot on serious / financial
content reads toy-like — damping ratio ≥ 0.8 (≤ ~2–3 % overshoot) or none. Never spring
opacity/colour (M3 "effects" springs are critically damped for that reason).

Both engines here implement the same closed-form damped spring (`Motion.spring(cfg)` and
`M.springBake(...)`), so a spring tuned in the browser lands identically in AE.

## 4. Text

- Split into **words** (3-frame stagger, spring `snappy`, translateY 30 px + opacity) for
  headlines; **lines** (mask + rise) for editorial; **chars** only for code/scramble effects.
  Split after fonts load; kill kerning shifts with `font-kerning: none` when splitting chars.
- Hero type: display face, weight 600–800, `letter-spacing −0.03em`, `line-height 1.05`,
  100–160 px at 1920 wide (80–140 at 1080 wide for 9:16).
- **Highlight ONE word** per headline: hero colour, or an animated underline / pill that scales
  in 5 frames *after* the word lands. Numbers: `tabular-nums`, count-up 600–1200 ms.
- Pixel gaps (not em) between large text blocks: em resolves against the parent size.
- Don't loop-animate text the viewer is still reading.

## 5. Composition, layers and texture

- Colour: 60 / 30 / 10 — base / secondary surfaces / hero colour; the hero colour on **at most
  one element per frame**; glow (`0 0 60px hero66, 0 0 120px hero33`) on at most one element.
- Background never a flat solid in the "premium" idiom: a mesh of drifting blurred radials
  (`sin(frame/55)·50 px`), a colour grade at 0.10–0.25, procedural grain at 0.05, a vignette.
  (Cloud.ru: see §9 — texture yes, glow/grain/vignette no.)
- **Ken Burns on every still** (scale 1→1.08–1.1 + 25 px pan, alternate direction per shot);
  **motion blur on anything moving > 30 px/frame** (Remotion `<Trail layers=4>`; AE motion
  blur; HTML: velocity-driven `filter: blur`).
- **Parallax in three layers**: background 0.3×, mid 0.6×, foreground 1× of the camera move.
- **Idle breathing** for anything on screen > 2 s: `scale 1 + sin(f/22)·0.015`,
  `y sin(f/30)·3 px`, slow drift −20 px over 300 frames — ambient tier only.

## 6. Transitions (8–14 frames, one family per piece)

- **Mask wipe**: a brand-coloured shape sweeps across; the cut is hidden behind it.
- **Scale-through**: A scales to 1.3 and fades while B scales 0.8→1 underneath.
- **Whip pan**: background travels 1500 px in 6 frames with `blur(8px)`; cut mid-whip.
- Library set (Remotion / toolkit): slide, fade, wipe, flip, clockWipe, checkerboard (9
  variants), pixelate, zoomBlur, glitch/rgbSplit, lightLeak.
- Default is the **hard cut**; motivate everything else. Never "transition the transition"
  (wipe + spin + fade at once). On music: cuts on phrases (every 2/4/8 beats), not every beat;
  `framesPerBeat = fps·60/BPM`; SFX 2–3 frames *before* the visual hit; the brand's final
  settle frame lands exactly on the sonic accent.

## 7. Scene architecture (30 s reel, haidrrrry)

```
0–1.5 s   HOOK    boldest visual + claim; movement in the first 15 frames
1.5–3 s   CONTEXT one line, one visual, still moving
3–22 s    BODY    3–4 beats: HIT → hold (15–20 frames) → build
22–27 s   PAYOFF  the number / result / demo — the biggest animation of the piece
27–30 s   CTA     one action, calm; the accent on the CTA word
```
Logo sting (5 s): mark in 0–0.8 s → wordmark 0.6–1.8 s → tagline 2–3.5 s → breathe → exit last 0.5 s.
Logo technique: pick ONE — draw-on **or** build-on **or** morph; reveal 0.8–2.5 s; only safe
transforms (scale, fade); `prefers-reduced-motion` shows the final static mark.

Beat-sync arc: Establish (long holds) → Develop (shortening cuts) → Climax (fastest cuts,
drop) → Resolve (hold for breath). Speed ramps land the slowest frame on the downbeat.

## 8. Web/UI-specific (Emil Kowalski)

- Frequency rule: 100+ times/day → no animation; tens/day → minimal; occasional → standard;
  rare → delight. Never animate keyboard-initiated actions.
- UI under 300 ms; button press `scale(0.97)` 160 ms; never `scale(0)` — start at 0.9–0.97 +
  opacity 0; origin-aware popovers (`transform-origin` at the trigger).
- `filter: blur(2px)` during a crossfade masks the two-states-overlapping artefact; keep blur
  < 20 px (Safari cost). `clip-path: inset()` for reveals, comparison sliders, hold-to-delete.
- Only animate `transform` and `opacity`; CSS/WAAPI beat rAF under load; transitions are
  interruptible, keyframes are not; `@starting-style` for entry.
- Gestures: momentum dismissal (velocity > ~0.11 px/ms), damping past boundaries, pointer capture.

## 9. What this means for Cloud.ru (brand adaptation)

Keep (already in the brand doc): decisive ease-out entrances, faster ease-in exits, staggers,
holds, one accent per frame, line/word masks, hard-cut + mask-wipe transition family, verify loop.

**Adopt** (were missing or under-used in v1 — this is what made the first showreel look flat):
- The premium entrance triple (opacity + rise + scale 0.96→1) and a **blur-in of ≤ 6 px** as a
  transition aid on text and plates. Blur is a *tool*, not a style: it must be gone at rest.
- **Word-level** headline reveals with 3-frame stagger on top of line masks; ONE highlighted
  word (green) per headline, its underline growing 5 frames after landing.
- **Three layers per frame**: hero move + support follow-through (labels/rules settle 40–80 ms
  later) + an ambient texture (dot field / hairline grid at ≤ 8 % contrast drifting ≤ 2 px/s).
- **Holds** and the 1/3 rules; something moves in the first 15 frames; a new visual every ≤ 90.
- **Springs with damping ratio ≥ 0.8** (M3 Expressive default / Standard) on product-UI and
  support elements — ≤ 2–3 % overshoot, invisible as "bounce", visible as weight. Hero brand
  marks and the logo stay overshoot-free.
- **Motion blur on fast wipes** (> 30 px/frame) and a camera push of 2–4 % per scene with
  three-layer parallax.
- **Transitions with a hidden cut**: green mask wipe, portal wipe, scale-through (1→1.06 out,
  0.96→1 in) — never a dissolve.
- **Idle breathing** allowed on the texture tier only (portal / pattern), never on type.

**Refuse** (brand look & feel): glow, grain, vignette, gradients on brand elements, rounded
corners, elastic/bouncy springs (damping < 0.8), rotation beyond 90° steps, per-character
tumbles on headings, particles.

Result: the same techniques the market calls "premium", executed in flat geometry.

## 10. Timing craft details (LobzyJay `timing-and-spacing`, `defaults-to-avoid`)

- **Timing vs spacing.** Timing = *when* (the start frame, the beat). Spacing = *how values are
  distributed between keys* (easing). Both must be right; a perfect ease-out on a move that
  starts on the same frame as everything else still reads as noise.
- **Duration reads as weight**: < 150 ms instant/system · 150–250 light/UI · 250–500 standard
  brand motion · 500 ms–1 s heavy/editorial · > 1 s cinematic or simply too slow.
- **Stagger bands**: tight 20–50 ms (letters, tightly related) · standard 50–100 (items, cards,
  words) · loose 100–200 (sections). Reverse the stagger for exits.
- **Offset ≠ delay.** Offset = the group starts together but *lands* in sequence (word, then
  the line 80 ms later, then the badge 80 ms after that). That is follow-through.
- **Anticipation** = 20–30 % of the main duration, 10–20 px opposite (a 400 ms move gets an
  80–120 ms, 20 px wind-up). **Follow-through** overshoot = 10–20 % of the distance, settle in
  20–40 % of the main duration; longer and it becomes a bounce.
- **Hierarchy through timing**: mark (50 ms head start) → wordmark (+80) → tagline (+200) →
  ambient texture last and slowest. If anything draws the eye before the hero, it moved too
  early or too fast — fix timing, do not slow everything down uniformly.
- **Rhythm, not metronome**: 0 / 180 / 340 / 550 ms has phrasing; 0 / 200 / 400 / 600 is software.
  Test: can you speak the sequence at a natural cadence?
- **Tells of auto-generated motion**: linear; everything at once; equal durations for every
  element; default `wiggle(5,20)`; no anticipation; no follow-through (every element stops dead
  on one frame = PowerPoint); symmetric bounce; all layers starting at frame 0; 2-second
  default durations; opacity as the only entrance mechanic; glow / lens-flare punctuation
  instead of energy in the timing itself.
- **Logo cookbook timings (iart-ai)**: draw-on 0.6–1.2 s per path (`0.65,0,0.35,1`); mask wipe
  0.5–0.9 s (`0.22,1,0.36,1`); build-on 0.4–0.6 s per piece, stagger 60–100 ms; morph 0.6–1.0 s;
  final settle 120–200 ms (scale 1.04→1.00); hold the settled mark ≥ 0.4 s before any cut;
  clearspace = cap height stays free of wipes and overshoot; never non-uniform scale on the mark.
