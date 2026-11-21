# Figma decks as pixel-aligned After Effects films

1. Export each authorized frame at 1× for comparison. Export selected layers and their node
   geometry, transforms, text styles, asset references and stacking order. Keep these files
   beside the film. Include the section and frame order in a local manifest.
2. Build one comp per slide using native text and shapes where they can match. Place typography
   by its measured ink bounds. Use `reference/art-kit.md` for image fills, stroked SVGs and glows.
3. Assemble the slide comps on a master timeline with labeled entrances, reference poses, holds
   and transitions. Match the Figma frame at the designated hold. Put cross-slide layers at the
   master level when their movement must remain continuous.
4. Capture each hold at delivery resolution. Compare Figma, AE and a difference image. Inspect
   font substitutions, line breaks, clipping and the edge of each crop by eye. Check entrances
   and exits separately to find errors that a rest frame cannot reveal.
5. Save the authorized project before rendering. Render with `aerender` or capture numbered frames
   in bounded batches. Verify frame sizes, duration, colour metadata and the first and last frame.

See `reference/html-figma-1to1.md` for a deterministic HTML or canvas route.
