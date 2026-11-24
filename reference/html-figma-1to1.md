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

## 8e. Outlined SVG text in moving reveal windows

Validated 2026-11-03 on three portrait storyboard loops.
- `exportAsync({format:'SVG_STRING', svgOutlineText:true})` can return a text SVG
  trimmed to its ink bounds. Place it at `absoluteRenderBounds`, not the text node's
  layout box. Preserve fractional origins even when the exported root dimensions round up.
- To reveal separate lines from one outlined multi-line SVG, crop each source line
  in a moving inner container, then move that container inside a stationary reveal mask.
  A single outer mask is insufficient: adjacent source lines leak into it during movement,
  even though the assembled static frame is exact. Check entrance and exit contact sheets.
- Apply static component transforms immediately. A component whose base coordinates
  have never passed through its setter may remain at the DOM origin until the first tween.
- A packaged-page check must open the extracted ZIP, load every local asset, compare
  samples to the source, and test actual autoplay and click wiring. A good source-page
  screenshot does not validate minification or packaging. For an HTML character limit,
  count the actual index file; local JS/SVG files need separate archive-size checks.
- Keep explicit layout differences and repaired source mistakes separate in the report.
  An exact-state debug mode may reproduce a designer's duplicate solely for the reference
  diff; production must be checked separately with the intentional fix and enlarged marking.

### Continuous frame movement requested after review

Validated 2026-11-03. When the brief overrides full-frame holds, preserve a readable
text hold and put continuous motion in frame steps and the texture. Use periodic
functions of absolute timeline time, applied after scene controllers; position and
velocity must agree at the loop seam. Never accumulate offsets from the previous frame.

For clean card transitions, keep panels opaque, expand before revealing the answer,
and clear all ink before collapsing the plate. Keep
caption ink hidden until an opening CTA plate has enough height to show the entire label.
If a long line reveal reads as sliced words, a short translation of the complete line
inside its pre-cropped source, with a fast opacity entrance, avoids prolonged fragments.

Verify actual rendered differences, not merely a changing clock property: adjacent
screenshots at 0.1 s, then FFmpeg framemd5 on the final encoded movies. This catches
an ambient controller that ticks while no visible element changes.

### Persistent panels, UI strikes and a reference pattern crawl

Validated 2026-11-03. A tiny periodic drift passes a no-freeze check but does not
match a reference's steady pattern crawl. Match direction and total travel as well:
an integer number of the rendered SVG pattern pitches per loop keeps the seam aligned.

For an anchored scaleX reveal, grow the backing width from the fixed left edge;
do not scale glyphs. For a vertical text reveal, keep the text window at final width
and begin its movement after the backing opens. A persistent right-edge icon stays
independent of text opacity, strike progress and selected asset swaps.

For text swaps, retain one backing rectangle and move only its content beyond a
transparent mask. Change the message and panel height while the text is fully outside
the window, then reveal the new message. Assert the hidden swap. Use a separate
progress property for a 0.25–0.35 s UI strike, then expand the panel; keep its target
still while the line draws. Reveal the answer after there is enough space.

### A curtain transition need not introduce a painted cover

Validated 2026-11-03. When a reviewer asks for text to change with a curtain, use
transparent clipping unless the design explicitly includes a visible covering shape.
Do not invent a grey rectangle. Retain the panel, slide outgoing text beyond the
upper edge of its window, change the message only when fully clipped, then slide
the new text up from below. Keep icons outside text masks.

For a vertical reveal inside a horizontally growing panel, keep text windows at
their final width and delay text motion until the panel has opened. Otherwise the
panel clip still reveals letters left-to-right despite the vertical translation.
Crop each row of a multiline SVG before translating that row through a second,
fixed window. Put its strike in the same moving text group. A geometry change
can happen while text is outside its window; no painted cover is necessary.
Verify both rendered transition frames and swaps at the clipping boundaries.

### Bound corner icons to the panel and finish the response beat first

Validated 2026-11-03. For a panel that closes by reducing width, an icon attached
at max(0, width - inset) becomes detached near zero width. Keep its actual right-edge
position, let it become negative, and clip the entire panel including the icon to
current width and height. Test late exit frames: hiding the already clipped icon
must produce the exact same pixels. This catches the orphan-icon defect that a
simple parent-opacity check misses.

For strike-to-answer choreography, compare the full answer completion against
START of the next panel, not its completion. Give the answer a clearly shorter
reveal than the panel entry and a small reading beat before the next panel starts.
Sample the timeline to confirm ordering and duration rather than just listing
keyframe intentions. Preserve the reading position and common exit/final timing.

### A self-contained HTML within a character limit

Validated 2026-11-03: three independent offline files remained below a 65,000-character
budget, with exact rendered parity against their approved multifile versions.
- Minify the deterministic runtime. Bundle the original SVG strings, CSS and JS in
  one JSON payload, gzip it with a fixed timestamp, and embed its base64 in the HTML.
- A small bootstrap uses `DecompressionStream('gzip')`, then creates local SVG Blob
  URLs and injects the bundled style/runtime. Keep editable click configuration outside
  the compressed payload. No remote assets, font loading, CDN or fetch fallback.
- Preserve SVG bytes and placement; replace only the asset resolver. Do not redraw
  outlined typography to make the bundle smaller.
- Write ASCII bytes explicitly with LF line endings. Count the final file on disk,
  not the pre-write string: Windows newline translation changes the actual length.
- Test a copy in a fresh directory containing only that HTML, with browser networking
  disabled. Assert decoded embedded images, no external script/style URLs, actual
  autoplay/click wiring and identical screenshots at multiple timeline positions.
- Confirm the target browser supports the decompressor and the placement permits
  its bootstrap/Blob URLs. Passing offline and size checks is not evidence of ad-server
  acceptance; retain the multifile package when a specific template requires it.
- Copy accepted video outputs without re-encoding. Verify delivered files by hash.


### Transfer a push transition without transferring stale layout or content

Validated 2026-11-06. Keep the reference choreography separate from the new Figma
geometry and typography. A right-to-left plate replacement can use one progress u:
newWidth = finalWidth*u, newX = rightEdge-newWidth; oldWidth ends before newX.
Clip each text run to its current plate; do not horizontally scale the glyphs.
A delayed new label and a modest leftward displacement of the old label reproduce
the reference's motion while retaining the new design's exact final text origins.
Taper the inter-plate gap near u=0 and u=1 to avoid a discontinuous width jump.
Fade corner handles with a collapsing plate and make them vanish at zero geometry.

Audit semantic pairs across the entire storyboard before implementing timing.
Premature duplicates and reversed source/answer pairs need an explicit user decision,
kept in project notes. Export the original glyph geometry; an approved colour-role
correction can recolour that asset without substituting a different font.
Do not carry a strike line from the reference into a new design that omits it.

An exact-state verifier must pass every changed component property explicitly.
The component apply() helper merges with BASE state, not its previous state: a second
apply({op:1,u:1}) may silently reset grow to zero even if the preceding call set grow=1.
Verify exact-state and actual timeline pages independently; then compare the final
standalone page offline against the source at several non-rest transition times.


### Fewer animation events: labelled blocks are the unit of appearance

Validated 2026-11-09. If the reviewer asks for plates to appear immediately with text,
start with a fully laid-out plate, caption and handles under one parent. Animate that
parent's opacity and short axial offset. Keep inner text shifts at zero and plate width
and height at their final values throughout entrance and exit. Remove the separate
caption reveal and empty-plate collapse, rather than merely shortening their delays.
Keep a requested semantic push transition, but remove an independent incoming-label
lag if it reads as another separate entrance. Arrow shafts and heads can likewise share
one group visibility track. A CTA should enter with its caption already visible.
Verify every nonzero-opacity entry/exit frame: the selected label is fully inside its
window and has full local opacity. Compare static layout separately; then verify the
standalone HTML offline and decode the delivered video before reporting completion.


Scope correction verified 2026-11-09: simplify the requested plate/text transitions
without automatically simplifying an already approved arrow illustration. Keep the
adjacent animation when the user did not request changing it. For a selective restore,
compare its curves against the approved version and assert the untouched components
match the current version at every frame. Align only the restored exit if needed to
avoid overlap with the current headline; record that timing adjustment explicitly.


### Adaptive SVG-backed banners and script-free image animation

Validated 2026-11-11. Extend a full-width rectangle in its own coordinate system:
include its existing translate/scale when testing coverage of the viewBox. Resetting
an exported width before accounting for translate can expose a blank edge strip.
Use approved compact/wide compositions at a content-safe breakpoint instead of
shrinking complete desktop art into a fixed-height slot. Preserve the time on switch;
dispose the old RAF and resize listener. Verify both sides of the breakpoint.

SVG visibility is inherited but overridable: hiding an arrow group does not hide
descendant heads explicitly carrying visibility=visible. Set the terminal hidden
state on those descendants too; extended viewBoxes reveal bugs invisible at native size.
Keep the CTA backing separate from the actual button when only the latter is pressed.

When a placement accepts animated SVG as an image, export native SMIL without JS:
sample a deterministic timeline, omit unchanged attributes and reduce numeric tracks
by same-time interpolation error, not perpendicular RDP distance. Use discrete keys
for visibility, refine boundaries and retain both loop endpoints. Split a fixed pivot
into translate / animated scale / translate groups. For a pattern, preserve the static
matrix and add the animated translation with additive=sum. Check standalone SVG using
setCurrentTime at off-grid times and later cycles, then verify an external img while JS
is disabled. Inline success alone does not prove image-context animation.

For a hard HTML byte limit, optimize vector paths with a measured small precision,
then minify/compress data and runtime. Keep reference SVGs unmodified and raster-compare
the result. A bundled small gzip decoder avoids dependence on DecompressionStream;
carry its licence. Copy the nonce to dynamically inserted scripts and test under a CSP
without unsafe-eval. Count ASCII bytes on disk and verify the unzipped HTML offline.
Technical playback verification does not establish historical-browser/ad-server acceptance.

Video parity requires a reference rendered at the SAME output DPR and the same even
crop as the encoder. Downsampling 2K back to native CSS size changes tiny dot/text
antialiasing and may falsely fail a strict RGB threshold. Use ffprobe for the actual
encoded dimensions before naming files; rounded screenshot height can differ by 2 px.


### Bulk resize refresh: source integrity, transport, and placement contracts

Validated 2026-11-12. Export and compare a new storyboard section against the previous
release before reusing assets. Ignore generated SVG ids only for visual fingerprinting;
retain original ids and references in stored SVGs. Intern repeated path d strings before
gzip transport through bounded MCP replies; reconstruct exactly and verify each frame's
canonical hash. Store the source specification snapshot and compare source documents by
hash, separately from extracted text (different PDF extractors can change whitespace).

Annotation reservations can use multiple red shades and opacity. Remove them based on
their known annotation colour family, not one hex value. Review the actual rendered
delivery for remaining marks. When a correction lands during video rendering, track the
affected formats and regenerate their video AND reference frames; stale references can
make a correct new video fail or an old marked video pass.

Figma cards may be individually grouped, share one group across multiple cards, have no
corner handles, or have a label with a missing backing. Match each label to its geometric
backing; never assume five rectangles per parent. Correct approved semantic sequences
without swapping an already-correct new source.

Full-width clip rectangles require the same local-transform accounting as painted
rectangles. Never shrink an exported oversized clip to the viewport: translated clips
can expose a large blank strip. Responsive QA must enter the fluid mode at page load;
changing a URL after a runtime has cached URLSearchParams is not a reliable mode switch.

Keep placement timing and geometry explicit: retina design dimensions are not CSS slot
dimensions, and a minimum scene interval can require longer holds while preserving the
transition ease/duration. Compare videos at the same DPR and exact frame timestamp.
For platforms forbidding obfuscated code, leave executable JS inspectable; compress
only vector data if needed. A small purpose-specific deterministic engine plus outlined
SVG data can fit a single HTML well below strict byte/character limits without packed JS.
Legacy fallback visuals are not evidence that all historical browser versions passed.


### Exact rest-state geometry across revised exports

Validated 2026-11-13. A copied storyboard can change subpixel positions between states,
even when the visual design appears unchanged. Preserve those positions with continuous
state geometry rather than baking the first background forever. Compare ALL storyboard
states; first/final comparisons miss accidental footer loss in an intermediate frame.
For repeated outlined text, fit and validate an affine map of all recorded control points;
interpolate the map, backing bounds and text origin together. Keep full paths as the source.

Anonymous SVG rectangles are not identified by their ordinal: exports may omit covered
rectangles in one state. Match paint and nearby geometry, failing closed when no plausible
match exists. Covered logo copies may precede the visible logo and change Vector suffixes;
use geometric/shape correspondence and raster parity instead of the first name match.
Arrow M-subpaths may serialize heads first; identify the shaft by length, preserving all arms.

Native SVG animateTransform has no matrix type. For diagonal affine tracks, decompose
into separate translate and scale wrapper groups; weight scale errors by geometry extent
when simplifying samples. One source track then produces two animation elements: the
structural verifier must count this explicitly. Verify original paths, off-grid raster parity,
loop boundaries and external img playback without scripts.

Separate strict design fidelity from explicitly authorized critical corrections/marking.
Do not silently carry old stylistic offsets into a new source revision. List intentional
exceptions. A late correction requires updating affected video references and rechecking
the final encoded files; a cached success for an earlier render is insufficient.


### Continuous frame surfaces, orphan corner handles, and shared tempo

Validated 2026-11-13 in standalone HTML, native animated SVG and encoded video.

**A decorative frame is a connected surface, not independent rectangles.** A tab
exported inside the green content group can inherit its inner clip: expanding its
rectangle still leaves a gap because the clip cuts it off. Preserve its world geometry
but attach it to the outer frame clipping context. Anchor the external edge to the
viewport; move only the inner contour. Resolve transforms into SVG coordinates before
extending painted surfaces. Full-width candidates can start a fraction of a pixel
outside zero: a strict zero/one-pixel heuristic may miss a shifted header.

Touching same-colour fractional edges can show the underlying green through raster
antialiasing. Provide a deliberate internal overlap (one CSS pixel in the tested
layout), preserving the visible inner contour; test native and scaled previews.
Do not fix a seam by shifting the whole logo/header or inserting a visible patch.
Scale subtle tab motion from usable width with bounded amplitude; height-only scaling
can make the motion effectively invisible in short creatives.

**A backing and label group need not own all its corner handles.** In some exports the
four small corner rectangles are siblings. Keeping them in the static background
leaves dots after the plate exits. Match all four corners geometrically to their plate,
retain their original vectors/colours and put them under the same animated lifetime.
Inspect first, transition and final states; merely hiding them on the last frame misses
the interval after exit. Check related sizes and platform variants sharing the artwork.

**Equal durations alone are not sufficient timing evidence.** Compare semantic phase
progress (entry, replacement, next plate, finale, press) and easing at common timestamps
across the whole resize family. Keep the base story shared. Document placement-specific
holds separately; if a user explicitly requests a faster version that departs from a
platform timing rule, deliver that requested version and identify the exception without
claiming moderation compliance. Preserve the previous accepted release.

**Regression gate:** reproduce failures in the old release, then inspect every animation
frame for attached joins and viewport-edge coverage. Probe actual raster colours at
seams and edges, including reduced preview scales. Verify adaptive narrow/wide states,
absence of orphan rectangles after plate exit, shared timing, standalone package limits,
script-free SVG playback and video/HTML parity. A metadata-only bounds check can pass
while a clipping ancestor still cuts the painted surface.

Apply the latest explicit marking decision to both the animated source and its fallback;
do not silently restore a superseded automatic addition during packaging. When feedback
arrives mid-render, refresh only affected data/packages/references before their queued
jobs start; otherwise rerender those outputs and invalidate their cached verification.


### Decorative arrows must not read as text decoration

Validated 2026-11-13. A horizontal decorative arrow close below a label can read as
an underline even without intersecting its bounding box. Review the assembled text
states optically. When requested, move the complete arrow (shaft and both head arms)
into a separate illustration area, preserving drawing/exit timing and checking the
clearance throughout the loop. Update both its base transform and every source-state
matrix; changing only the base can be overwritten on the next seek.

For a localized correction, verify the delivered release rather than assuming repeated
feedback refers to current files. Hash-check unchanged HTML/video against the previous
release, rerender only the changed format, and deliver one clearly identified full set.


### Occluded strokes and fractional-scale frame clipping

Validated 2026-11-15 in the shipped standalone HTML and encoded video.
A broken-looking arrow may have a continuous path and correct dash animation but
be covered by an old background-colour rectangle in source paint order. Trace the
visible stroke against later painted elements. Audit sibling resizes, remove only
confirmed erroneous occluders and their state tracks, and preserve original paths.
Do not blanket-delete every green rectangle with a matching name.

Extending a black frame backing does not escape an ancestor's content clip. A footer
whose backing reaches past the viewport can still be cut a fraction of a pixel short.
Reparent complete header/footer groups (backing, logo, marking) into the outer frame
context, preserving their world transform. Moving only the backing can cover its text.
Retain the outer viewport clip; remove no masks without a demonstrated need.

A hidden overlap of one design/CSS pixel is insufficient under a scaled parent.
Account for SVG getScreenCTM and devicePixelRatio so the internal overlap covers at
least one real raster pixel. Keep the visible contour unchanged. Apply the test's
parent transform and DPR BEFORE seeking the deterministic frame, so the runtime sees
the same geometry as a live frame after zoom.

Bounds-only QA misses clipped or antialiased paint. Probe actual screenshot pixels
fully inside intended dark frame coverage; a green-channel excess exposes leakage.
Sweep small and large CSS scales with fractional DPR, plus adaptive narrow/wide states.
Use a failing previous-release raster as evidence and repeat on the packed HTML.
Verify same-DPR video references after late fixes, and retain unchanged videos only
when their scene output and file hashes remain verified. Technical QA is not client
approval or advertising-platform moderation.
