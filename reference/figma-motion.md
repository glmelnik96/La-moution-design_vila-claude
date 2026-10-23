# Figma Motion — what our motion maps to (probed and cross-checked 2026-10-16)

Figma's native motion lives on the timeline of a top-level frame; only its descendants animate, and every frame's
timeline starts at 0 (an effect that spans a cut — a background dissolve — works only when both sides are layers of
one frame). Plugin API via the Figma MCP `use_figma` (skills `figma-use` + `figma-use-motion`); verify with
`export_video` + ffmpeg frames (`get_screenshot` shows only the rest state). Units: px of the frame, seconds.

## 1. Availability check (read-only, any file)

```js
return { defs: figma.motion.figmaAnimationStyles().map(s => s.styleId),
         custom: (await figma.getLocalCustomAnimationStylesAsync()).length,
         create: typeof figma.createCustomAnimationStyle };
```
`"… is not a supported API"` → motion is off for this account: stop, describe the motion instead. On the user's org
account (2026-10-16) everything below was available, custom styles included.

## 2. First-party definitions (styleId → props, from the probe)

| styleId | Props that matter | Notes |
|---|---|---|
| `Position` | `type` slide_in / slide_out / custom, `direction` (8 sides), `distance` px, `startX/Y`, `endX/Y`, `delay`, `duration`, `easing` | slide_in `bottom` = starts below, rises. Custom start/end are OFFSETS from rest (startX = x_A − x_B), measured from the layer's anchor in Motion mode. Diagonal distance: per axis or along the diagonal is unverified — use custom |
| `Opacity` | `type` fadeIn / fadeOut / custom, `amount` %, `startFrame/endFrame` % | |
| `Scale` | `type` scaleIn / scaleOut / custom, `axis` w / h / whCombined, `amount` % | pivots on the layer's anchor (transformOrigin), the centre by default; scaleIn amount 82 = from 82 % to rest |
| `Size` | `type` resize_in / resize_out / custom, `amount` px, `startWidth/endWidth…` offsets | resize_out GROWS back to rest; offsets relative — unverified, prefer WIDTH keyframes |
| `Path` | `type` draw / erase / travel / custom, `direction`, `segment` % | connectors, rules |
| `Rotation` | rotateIn / rotateOut / custom, `amount` ° | 2D only |
| `TextStagger` | `textDelayGrouping` CHARACTER / WORD / LINE / PARAGRAPH, `textDelayOrder`, `presetStaggerOverlap` %, `duration` (TOTAL span), position / opacity / scale / blur / rotation each `*Enabled` + amount, `clipContent`, `elementTransformOrigin*` | text stays editable; whether clipContent masks per line is unverified |

Defaults to override every time: Position distance 200, Scale amount 120 %, TextStagger direction `top`, distance 40,
blur 20 px, grouping CHARACTER, easing OUT_CUBIC.

**Keyframes.** WIDTH / HEIGHT are absolute px and must be > 0: start a grow at 0.01 (a 1 px first key shows a sliver
from t = 0, because the first key holds back to the start). WIDTH grows from the left edge (x stays): a right-edge grow
needs X keyed with it, or a Position slide-in under a clip. Not valid on groups or vectors (rules drawn as vectors →
Path). WIDTH on a text layer re-wraps it — change type size with Scale. Layer blur animates as an effect keyframe;
After Effects blur values are not Figma radius, tune by eye.

**Custom animation styles** = a named, ordered list of first-party definitions with FIXED props, foldered by slash
(`Cloud.ru/Вход/…`). On a layer only `timelineOffset` can change — so one style per variant (per line count, per text
role), and anything built on keyframes (WIDTH, X, blur) cannot be a style at all.

**Smart Animate between frames** interpolates only layers matched by name and dissolves everything else over the whole
transition. Use it for shared elements only; the rest exits on the old frame's timeline and enters on the new one's.

## 3. Easing: always our bezier

`{ type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1, y1, x2, y2 } }` — the same four numbers as CSS / the
html engine / AE via `bezierEase()`. Figma's named eases (EASE_OUT, GENTLE, QUICK, BOUNCY…) are not ours; springs only
`CUSTOM_SPRING` with `bounce: 0`. `HOLD` = a step: instant switches (a slide cut under a curtain, a state snapping on).
Approved film / deck set: glide `0.6,0,0.12,1`, fade `0.45,0,0.25,1`, sweep `0.7,0,0.22,1`, sweep long
`0.75,0,0.2,1`, morph `0.7,0,0.15,1`, exit `0.55,0,0.85,0.35`.

## 4. TextStagger timing

`duration` T is the whole cascade; each group animates for `overlap·T`, starts spread over the rest. For N groups,
per-group time d and step s: **T = d + s·(N−1), overlap = d / T** (not 1 − s/d). Masked headline lines d 1.1, s 0.14:
2 lines T 1.24 / 89 %; 3 lines with d 1.15: T 1.43 / 80 %. Word cascades rebuilt from AE range selectors (ramp 60 %,
offset −60 → 100 %) keep the total fixed by text role, not by word count, and overlap ≈ 35 % (each word ~0.375 of the
sweep). Words, never characters, on headings; LINE + `clipContent` for a line reveal (distance = line height + 30 px).

## 5. Not transferable — keep in AE / HTML

3D rotation (cube flip), fractal-noise looks (block reveal, flicker grid), Z fly-throughs, repeater offsets, number
count-ups, expressions (`loopOut`, `time*k`). A soft-edged wipe has no preset: slide a ground-coloured layer with a
gradient edge off the content instead of a hard WIDTH clip.
