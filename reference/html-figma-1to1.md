# A Figma storyboard as a pixel-aligned HTML animation

## 1. Read the storyboard

Map variants and states from the provided sections. Export a reference image for every state at
the delivery scale. Collect frame-local transforms, fills, borders, asset extents and text style
runs. Split large dumps by frame. Confirm which frames are holds and which are pass-through
poses. Compare revised sections to the last used source before changing the animation.

## 2. Build components (`fig.js`)

Copy `html/figma/fig.js` and `fig.css` next to the motion engine. Set `window.FIG_FRAME = {w, h}`
in the source frame's own units. Build one component for every moving layer or rigid group.
Use SVG for fractional geometry and inside strokes. Put transforms on the wrapper when there
is also local motion inside it. Check font load, measure Chrome's rendered baseline, then apply
the fractional offset. Use `extract_outlines.py` for glyph geometry when exact outlines matter.

## 3. States and verification

Render individual poses through `?frame=F1` or at the matching timeline marks. Use `shoot.js`
and `verify.py` for render, colour difference and contact sheets. Use `inkshift.py` to compare
glyph placement, and `zoomcmp.py` to inspect a crop. Distinguish layout drift from normal
antialiasing differences. `figma_changes.py` compares revised frame exports.

## 4. Choreography

Set one progress property for compound moves. Keep persistent layers out of scene-local exits.
Key the pose of every moving layer at each intended hold. Carry a consistent curve through
pass-through frames. A curtain that changes text can clip it under the surface as the reveal
advances. Inspect the stacking order around the first and last visible pixels. For growing
frames, extend the edge on the side that moves and keep related handles on the same boundary.
Run `verify_anim.py` after timing changes to detect holds that have drifted.

## 4b. One storyboard in several sizes

Share choreography and define positions per source format. Regenerate all states from the
latest export before changing a class of formats. For packaged banners read the platform
rules for click handling, mark visibility and asset-size limits in `banner-platforms.md`.
Review responsive variants at fractional scale. A clipped border can be isolated in a separate
inside-stroke overlay with sufficient pixel padding.

## 5. Render

Serve over HTTP when extracting images or running variants. Use `film.js` with the intended
device scale for video. At device scale two, align image bounds to whole CSS pixels, including
any necessary transparent padding. Such padding preserves sampling without shifting the
authored content. Seek by frame; check the first and last frame before encoding the whole film.

## 6. Adobe Animate sources

The helpers in `html/figma/fla/` convert geometry and timeline state into XFL for a running Adobe
Animate. `fla_extract.js` samples the HTML. `fla_build.py` builds XFL. Open the result in Animate
and publish with `fla_publish.xml`. Use `fla_verify.py` to compare output frames. Keep masks on
separate layers, test CFF font spacing and inspect the published bitmaps for unexpectedly soft
text. Verify the file in the actual Animate version used for delivery.

## 7. A family of ads

Express each state in data consumed by one runtime. Reuse the motion logic across sizes, and
derive per-format text wrapping, stacking and constraints from the supplied frames. When the
packager requires a standalone HTML file, inline scripts, SVG and only the fonts used by that
page. Test with networking disabled and inspect the packed size and iteration boundaries.

## 8. One slide or a whole presentation

For a single slide, match the final still precisely and hold it before the cut. For many slides,
export each SVG layer or its source bitmap. Compare the recomposed rest frame before animation.
Rebuild inside strokes, image adjustments or text layout when the SVG export loses them.

Use a deterministic canvas timeline when the content is already structured as Path2D units.
Keep shared layers in a parent scene; move only the changed units between builds. Compose
across multiple slides, cover transitions with intentional masks, and give any progress display
its own measured area. After dropping slides or replacing a link, recompute marks and verify
duration, chapter order, transitions and the final decoded QR in the compressed output.
