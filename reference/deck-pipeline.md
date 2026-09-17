# Deck pipeline — a Figma presentation as a 1:1 animated film in After Effects

How the five Cloud.ru GCT films (2026-09) were built: every slide of a Figma deck becomes a
native AE slide (SB Sans Display text, shapes, icons, the art-kit background) whose rest frame
matches the Figma render per element within 2 px, with the approved motion palette on top.
Copies of every tool live in `assets/cloudru-art/` (project: `gct-presentation/tools/`).

## Inputs

- **Figma**: file `aZQYa8ye6EQj5WzjXAdQvC`, SECTION "final" (`4206:321`) holds all films as
  1920×1080 frames, one row per film. Dump nodes with the `use_figma` plugin API (read-only):
  per node `{i,t,n,b,r,o,fl,sk,cr,geo,s,al,ps,seg}`; `seg` from `getStyledTextSegments`
  (start, end, rgb, size, style, lineHeight, letterSpacing, listType, indent). Sanitise
  U+2028/U+000B in texts AND names (quirks #100, #109), 2–3 frames per call (20 KB cap).
- **Renders**: `assets/<sid>_full.png` — the frame at 1:1, the reference for every measurement.
- **Raw exports**: `assets/f/<sid>_raw*.png|_svg*.svg` via `download_assets` (URLs expire in
  minutes; download at once with a UA header). Matched to nodes by silhouette (quirk #116).
- **Art**: one planet bitmap + one orbit vector per slide (`reference/art-kit.md`).

## Tools (run from the project root)

| Step | Command | Output |
|---|---|---|
| spec + JSX | `python tools/deck.py <film>` | `_build/deck_F<n>.jsx` (slides), `deck_M_<n>.jsx` (master `PRESENTATION_<n>`), `deck_verify_<n>.json`; FIT_LOG lines marked `<-- CHECK` = a line-width mismatch > 12 px, read them |
| build + verify | `python tools/build_film.py <film>` | cleanup → deck_F → deck_M → `cap_verify` (one rest frame per slide) → `verify_deck.py check` → `bgdiff.py` → `qa_sheet.py` |
| per-element check | `python tools/verify_deck.py check <film>` | ink bbox + per-line extents vs Figma, ≤ 2 px |
| background check | `python tools/bgdiff.py <film>` | whole-frame diff outside element rects (≤ 1/255 mean is normal) |
| eyes | `python tools/qa_sheet.py <film>` | `C:/dev/gct-pres/pv/_qa<film>_<k>.png`: Figma \| AE \| diff, three slides per sheet — READ EVERY SHEET |
| full capture | `python tools/capture_film.py <film> [--resume]` | `_build/cap_full<n>_<k>.jsx` chunks of 600 frames → `pv<n>/pv_NNNN.png` → `tools/preview.py` → `out/film<n>.mp4` + contact strips |

`figspec.py` turns the dumps into elements (texts with per-run colour ranges, frames, hairlines,
badges, pills, chips, svg icons, QR/screenshot units, glow panels, KPIs) and the art poses;
`deck.py` is the engine (timeline, JSX emission, fitter, verify points); `inkmeasure.py` is the
shared component-based ink measurement; `artkit.py` the background kit.

## Rules that cost a day each

1. **One AE call at a time; stop on the first answer that is not `ok:true`.** A CDP timeout means
   a modal dialog — a human must click it; retries stack dialogs. `saveFrameToPng` is
   asynchronous: poll for the chunk's last frame before the next call.
2. **The render is the truth, the dump is a hint.** Boxes lie both ways (quirk #119), the
   rotation cannot express a flip (#115), exports come in the wrong order (#116), soft breaks
   travel as `<2028>` (#100). Everything is measured against `<sid>_full.png`.
3. **Read every QA sheet of every film before sending anything.** The numeric check cannot see
   a colour range one character late (#114), a wrong logo in a chip, or an icon that never made
   it into the element list. The user compares slide by slide himself.
4. **Text by words, never scaled or tracked** (user rule). Range selectors index rendered
   characters (#114); `characterRange()` stays string-based.
5. **Composite objects are one layer** (#113): QR on its square, screenshot on its card, logo
   lockups cut from the render on their stroked pill (#112).
6. **Never commit build outputs** (`out/`, mp4, stills, probes).

## Motion palette (the "Apple pass", 2026-09-17)

- Elements settle in (scale 0.94–0.96 + blur + opacity) and settle out reading their scale at
  the exit time (`valueAtTime`, not `value` at t = 0 — or everything shrinks after landing).
- Slides alternate flavours by index: outlines draw on / cards settle; exits alternate drift up /
  drift left; heads of the next slide pre-roll 420 ms into the previous one.
- Frames and hairlines named by their content (`f_<md5>`, `hl_<md5>`) persist across
  consecutive slides and morph to the new layout — magic move for free.
- Planet turns about its ring centre with a 2.5 % scale drift, rays draw on and drift 4 %, glow
  panels bloom inward then breathe; every curve passes through the Figma pose at the rest time.
- KPIs count up with a native arrow; texts cascade by words (right-aligned ones from the right).

## Known residues (2026-09-18)

Kerning of 3–5 px on three long lines (p08 ×2, h06) — AE's font rendering, not layout; two
footers flagged by the measurement only (identical on the frame). Orbit rings on s11 within
~2 px after `refine_pose`.
