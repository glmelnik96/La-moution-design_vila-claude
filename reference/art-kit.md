# Artwork placement and glow panels in After Effects

Request the original artwork, its dimensions, the Figma node geometry and the image fill transform.
Keep inputs in the working project's assets directory. Use separate layers for the artwork, mask
and animated decoration so each can be compared independently.

## Place a cropped image

Let `M` be the Figma image transform, with translation `t` and 2×2 linear part `M_lin`.
Let `W,H` be the unrotated node dimensions and `BW,BH` the bitmap dimensions. With the
node rotation matrix `R`, the source-pixel to frame-pixel affine transform is
`A = R diag(W,H) inv(M_lin) diag(1/BW,1/BH)`, and the translation is
`b = node_position - R diag(W,H) inv(M_lin) t`. Put the AE anchor at the intended source pivot
`p` and position it at `A p + b`. Decompose `A` for scale and rotation. Apply a mask matching
the node extent and fit reflected or skewed cases against a reference render.

Build SVG strokes as paths in native shape layers when their trim controls are needed.
An SVG export may include half the outer stroke in its bounding box. Compare the rasterized
result against the source at the target scale.

## Animate the decoration

Key every moving layer through the reference pose at its rest frame. Animate rings or rays with
Trim Paths. For a glow, make a separate field, matte it to the panel, and animate the field and
outline independently. Verify imported alpha, the panel boundary and the rest frame in a
full-resolution capture before checking the transitions.
