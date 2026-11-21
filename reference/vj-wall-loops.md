# Deterministic loops for long LED-wall playback

Use one canvas and define `render(t)` as a pure function. Hash element indices and epochs to
get repeatable variation. Use positive modulo to wrap cycles, and keep state independent of
browser playback. For a warm-up that transitions into a loop file, render the warm-up tail
using negative loop time. Compare both sides of the boundary at the delivery rate.

Put the cue and scene boundaries in one manifest. To tile a moving sprite lattice, reduce
offsets modulo the two basis vectors and hash absolute indices so sprite identities survive
the wrap. Tint PNG cutouts through alpha, not opaque grayscale. Warm each canvas at its first
assigned frame before capturing a segment.

Render numbered segments with identical dimensions, FPS and codec settings. Combine video-only
segments using the concat demuxer after checking stream layouts. For rerenders, retain complete
segments and replace the failed frame interval only. Check frame count and duration, inspect
the heaviest transitions, and compare seam frames in the encoded master.
