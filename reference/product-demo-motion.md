# Motion for interfaces and product demos

## Choreograph actions and results

Identify a single user action and the result it should reveal. Give each beat a distinct source
of attention: an initiating input, a local state change or a larger cut between surfaces. Keep
the persistent UI still during local state changes, and move complete screens together during
page transitions. Hold the result long enough to read. Cue entrances to narration when present.

## Work from supplied designs or footage

- For supplied designs, export the current frame and rebuild the parts that will move. Preserve
  product copy and final idle geometry. Use `reference/html-figma-1to1.md` for pixel-aligned work.
- For screenshots, separate the page, state overlays and pointer. Anchor pointer tips to their
  targets. Compare with the true product states at the start and end of every transition.
- For screencasts, crop browser chrome consistently. Use a still for a stationary result when it
  reads better than accelerated scrolling. Keep the loop boundary in a stable composition.
- For simplified diagrams, preserve the relationships and actual interaction order. Agree on
  which UI details matter before replacing screenshots with boxes and labels.

## Animate claims in silent booth loops

Start from the approved copy and rest frames. For each claim, write the initiating action, the visible
change that follows, and the reading hold. Tie highlights, labels and result states to the same event
times as their signals. At normal speed and from booth distance, the order should explain the claim
without a voiceover. Use entrances and pulses where they help the viewer follow that order.

| Claim | Visible sequence from DeepDive |
| --- | --- |
| One API, choice of model | Establish the API first. Route one request to one model at a time and highlight its card on arrival. |
| Scales under load | Fill the first node's meters. Add nodes in response to demand. Show the first node's meters falling as the new nodes take their share. |
| Filters requests and responses | Stop an unmasked request at the filter, show the scan, then deliver the masked result. Send the response back through a separate, readable check. |
| GigaCode is part of the subscription | Place both roles inside the plan frame. Send the request from GigaCode, return the response, then reveal the code in GigaCode. |
| A time-bound offer | Draw the 22:00–07:00 interval with a midnight tick, reveal the QR after establishing the offer window, and hold it steady long enough to scan. |

- **Make the route and the signal agree.** Derive ports from card bounds. Use the same waypoints and
  corner geometry for the wire and the moving signal. Keep junction endpoints coincident and use
  consistent widths within each role. Verify the direction, endpoint and timing of the receiving highlight.
- **Use easing to express the action.** Draw a route with acceleration and deceleration, travel with a
  readable sense of direction, and settle the receiving state before the next beat. If a heading looks
  squashed in motion, compare its middle frame with its hold. A moving mask can cut across the glyphs.
  An eased translation and opacity reveal keeps whole glyphs visible and preserves their proportions.
- **Hand off two layers at different times.** Keep a meaningful diagram, image or CTA visible while the
  headline changes. Let the incoming headline establish the scene before the outgoing diagram finishes
  leaving. Where a QR and its holder form one object, keep them together. Check the weakest frame of
  each transition and the timing of the next slide's first readable beat. Count actual content such as a
  diagram, headline, video or QR when checking continuity.

DeepDive 2026 v13 is the worked example. Its project QA includes sampled cause-and-effect states,
every frame of each handoff, a live loop seam and the decoded QR compared with the original link.

## Verify

Review the rest poses and capture the final quarter of ease-in exits. Scrub cuts at the delivery
frame rate. Keep text crisp, click feedback locally timed and the cut aligned with the intended
state. Apply brand motion curves; retain the supplied visual design when the task is motion only.
