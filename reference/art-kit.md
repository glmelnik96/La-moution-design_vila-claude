# Cloud.ru art kit — backgrounds and glow panels as live AE layers

Built for the 18-slide GCT deck (2026-09-17); meant to be reused in every next film.
Source of truth: `gct-presentation/tools/artkit.py` (geometry + JSX); a copy of the module and the
raw assets live in this repo under `assets/cloudru-art/` (planet.png, orbit18_4042.svg,
orbit18_5784.svg, orbit157.svg). Nothing here is a crop: every layer is the Figma object itself.

## What the artwork is

Read straight out of the Figma file with the plugin API (`use_figma`, read-only), not guessed
from the slide crops. All six artwork slides are the same two objects, placed differently:

| object | what | where it comes from |
|---|---|---|
| **planet** | one bitmap `a28afec3`, 4001×4096 (@2x): a segmented purple ring with an orange rim, transparent hole and outside | `assets/src/s01_img_raw1.png` — identical raw image in all four `image 22` nodes |
| **orbit-18** | vector flower of 18 elliptical loops, 1.14 px white @ 47 %, rotated −116.745° | `s01_vec.svg` (4042 px) / `s09_vec.svg` (5784 px, same shape ×1.431) |
| **orbit-157** | the dense variant, 157 loops, 1.71 px | `s11_vec.svg`, rotation +50.886° |

Seen from the side the loops are "orbit lines" (s01, s09); seen near their centre they read as
**rays** (s02, s13 — the same node at (4962, −1137)). The planet is shown through a rectangle
2–3× its size: rotated −37.8° on s01, unrotated on s09/s11, CROP-transformed on s15.

Every gradient panel/card (s05 panel, s06 card, s07/s08 column, s10 tops, s14 and s18 cards) is
**one radial gradient**: an ellipse **0.9235× the box**, centred, `#7459F9` from alpha 0 at
51.9 % of the radius to 0.7 at 95.2 %, constant beyond. s18's variant starts from an opaque
warm black `(10,6,0)` at the centre (8 stops, linear in RGB and alpha).

## Placement math (verified against Figma's own render: 0.4/255 mean on s01)

Figma node → AE layer:

```
R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]]          # Figma's rotation, screen space
frame_xy = R(θ) · (k·(u − u0), k·(v − v0)) + (node.x, node.y)
k  = node.w / (imageTransform[0][0] · bitmap_w)     # uniform, CROP mode
u0,v0 = imageTransform[0][2]·bitmap_w, [1][2]·bitmap_h
AE: anchor = pivot in bitmap px, position = frame_xy(pivot), scale = 100k, rotation = −θ
```

`node.x/y` is the origin of the **un-rotated** box (the plugin API's `x`,`y`, also what
`get_metadata` prints, whose width/height are the rotated bbox — don't mix them). AE rotation is
the negative of Figma's. The planet's pivot is the ring centre (circle fit to the inner alpha
edge: bitmap (1892.5, 2076.7), inner r 534.5); the orbits' pivot is the centroid of the loops'
start points (where they converge). SVG exports are the node box grown by half the stroke —
subtract `strokeWeight/2` from the SVG coordinates to get node-local px.

### General case: any CROP transform (films 2-4, quirk #101)

The formula above assumes a diagonal `imageTransform`. With rotation/shear inside the crop
(p01: `[[0.6417,0.1793,0.1596],[-0.2133,0.5148,0.4693]]`) use the full affine, now in
`artkit.planet_affine()` / `planet_pose()`:

```
A = R(θ) · diag(W,H) · M_lin⁻¹ · diag(1/BW, 1/BH)       # image px -> frame px, linear part
b = (x, y) − R(θ) · diag(W,H) · M_lin⁻¹ · t
scale = |A[:,0]| (columns agree to 1e-4), AE rotation = atan2(A[1][0], A[0][0])
position = A · pivot + b, anchor = pivot (the ring centre)
```

Verified on p01/h01/b01 by re-rendering in Python against Figma's PNGs: mean 0.8-1.5/255.

### Spec from the plugin dump (films 2-4)

`gct-presentation/tools/figspec.py` turns the per-frame plugin-API dumps into deck.py elements
(text roles, frames, glow panels, pills, QR plates, icons, hairlines, KPI count-ups, list bullets)
and `tools/inkmeasure.py` is the one ink-measurement used by builder and verifier (connected
glyph components around a dense core, quirks #106-#108). Copies live in `assets/cloudru-art/tools/`.

### A mirrored orbit node (film 1, s11 — quirk #115)

The plugin dump gives x/y/w/h/rotation, which cannot express a flip. Rebuild the node's bounding box
from the rotation alone and from rotation·diag(1, −1): the one that reproduces `absoluteBoundingBox`
is the real transform (`figspec.node_flip`). A mirrored orbit is placed with scale [100, −100] set
before the rotation and position R·F·anchor + (x, y) (`orbit_pose(..., flip=True)`); the SVG export
stays in the node's local, unmirrored geometry. Even so the dump's w/h disagree with the box by ~20 px
for that node, so `artkit.refine_pose` fits shift / rotation / scale about the anchor against the
render's ridge map (thin bright lines minus a 4 px blur) — for s11 the fit moved the rings by
(13, 1) px, 0.2° and 0.15 %, taking the ridge overlap from 6.8 to 30.8 (a correctly placed
unmirrored orbit scores ~44).

## How it moves (every curve passes through the Figma pose at the slide's rest time `vt`)

- **planet** — `rotation = pose.rot + ω·(t − vt)` (two linear keys, ω ≈ ±0.8°/s: the arc glides
  along itself, the orange segment travels), scale ×0.97→1 during the dissolve-in and 1→1.04 out,
  opacity + Gaussian blur (radius `24·100/scale` in layer space) dissolves over ±TX at cuts.
- **orbits** — native shape layer (one path per loop, open), stroke 47 %, Trim Paths End 0→100
  over 2.2 s from the centre outward (rays shoot out), counter-rotation ω ≈ ∓0.35°/s.
- **glow panel** — three layers: `name_m` rounded-rect alpha matte, `name_g` the normalized
  field bitmap (`assets/gen/glow_purple.png` / `glow_dark.png`, 2000 px, radius 1 = 666.67 px,
  scale = `0.9235·w/666.67·100 %` per axis), `name` the outline (draw-on). Entrance: field
  1.35×→1× (the rim blooms inward) + opacity over half the duration. Life: expressions with
  **zero phase at `vt`** — scale `1 + 0.03·sin((time−vt)·2π/6.5)`, position `+[16·sin(0.75·Δ),
  10·sin(1.15·Δ)]` — so the verified frame is exactly Figma. A panel that continues on the next
  slide morphs (`glowTravel`: matte + outline rect keys, field scale/position keys).

## Reusing it

1. Read the nodes with `use_figma` (per frame, ≤ ~19 KB per response — bigger replies fail
   to parse), `download_assets` for the raw bitmap and SVGs.
2. Fill `ART[sid]` (planet node, orbit node, ω's) and call `art_js(sid, tIn, tOut, first, TX, vt)`
   in the master; `GLOW(...)` elements in the slide spec.
3. Verify: element ink boxes (`verify_deck.py`) + whole-frame diff vs the Figma render outside
   text (expect ≤ ~1/255 mean; 1-px lines over a bright sky differ in AA, ignore).
