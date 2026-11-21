# Motion for LED walls

## Map the stage

Get the physical raster sizes, screen positions, gaps, frame rate and media-server codec spec.
Build one master in physical pixels with regions for each output. Use a plain labeled layout
for the first review, including occupied and unused pixels. Reserve safe zones where screens
join or where foreground equipment blocks the view.

## Build reusable systems and scenes

Use one manifest for the cue timing and screen routing. Put recurring treatments in precomps
and assemble scenes in order from that manifest. Animate changes through the full wall when
the panels form one surface. When screen pitches differ, preview the actual physical layout
before deciding whether a continuous visual can span the seam.

Create a beat sheet and a still for each phase before commissioning generated beds. Verify
motion direction, entry and exit holds and a seamless loop at the delivered speed. Build lines,
text and precise counters as editable native layers. Keep the light and dark regions of any
generated bed within the contrast the venue can display.

## Delivering the wall

Save the project and confirm that the render queue targets the intended comps and output files.
Capture representative frames and cuts from the master and from each screen. Check positive
and negative space, repeat phase, type safety and edge alignment at full resolution.
Render with `aerender` in bounded jobs when needed. For independent output regions, crop the
lossless master or render the matching delivery comps from the same timeline. Verify
dimensions, frame count, frame rate, codec and colour tags with `ffprobe`. Use identical
timestamps and clip lengths across outputs that must play in sync.
