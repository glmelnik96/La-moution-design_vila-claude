# HTML5 banners for Russian ad platforms: packaging and moderation (as of 2026-10)

What each platform takes, how its click is wired, its limits, and the rules that change the animation. Found while
delivering one campaign to Yandex, SberSeller, VC, Ведомости, Habr and TG (`html-figma-1to1.md` §7). Specs change:
**read each platform's own document before packaging** — the client's media-plan sheet links them. A WebFetch
summary once invented limits («15 s, 3 loops») that the PDF does not contain; a rule about «replay on click» turned
out to concern video inside the banner, not animation (quirk 216).

## The page every platform accepts

One `index.html`, everything inline: the scene data, the minified runtime (`esbuild --minify --target=es2017`), the
text as glyph outlines (no font files), SVG geometry (no images). No external requests, no relative paths (Ведомости
forbids them in the HTML, Yandex wants every link inside the archive). The zip holds just `index.html`; file names
use Latin letters, digits and `_` only (AdFox is the strictest). Keep the page itself pure ASCII (text as outlines,
no Cyrillic in the markup): then characters = bytes, whichever an upload form counts. Two 100%×250 layouts in one
page came to 56 300 characters of AdFox's 65 500.

```html
<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><!-- platform meta -->
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Brand</title>
<style>html,body{margin:0;padding:0;overflow:hidden;background:<page colour>}
html,body,#click_area,#r9{width:<W>px;height:<H>px}        /* fluid: width:100%;height:100% */
#click_area{display:block;cursor:pointer;text-decoration:none}</style></head><body>
<a id="click_area" href="<click>" target="<target>"><div id="r9"></div></a>
<script>/* data */</script><script>/* runtime */</script></body></html>
```

The whole area is one link (VC and Sber require it), it opens a new window, and autoplay runs at once.

| Platform | Click | Extra | Limits |
|---|---|---|---|
| Yandex (РСЯ, HTML5) | `href="#"`, then `<script>if (window.yandexHTML5BannerApi) document.getElementById("click_area").href = yandexHTML5BannerApi.getClickURLNum(1);</script>` after the link | `<meta name="ad.size" content="width=300,height=250">`; sizes 160×600, 240×400, 240×600, 300×250, 300×300, 300×500, 300×600, 320×50, 320×100, 320×480, 336×280, 480×320, 728×90, 970×250, 1000×120 — exactly the slot | index.html < 150 KB, zip ≤ 512 KB, ≤ 20 files; CPU ≤ 50 % sustained, ≤ 70 % peak |
| AdFox (VC, Ведомости, Habr …) | `href="%banner.reference_mrc_user1%" target="%banner.target%"` | every `<script nonce="%request.eid1%">` | HTML ≤ 65 000 bytes (characters at VC); the upload itself refuses > 65 500 characters («Превышение количества символов в HTML файле»); each file ≤ 300 KB; zip ≤ 300 KB (VC); ≤ 50 files |
| SberSeller | `href="[clickurl_1]" target="_blank"` | top 25 px carry the ad label and the menu dots | index.html ≤ 64 KB, UTF-8; all resources 150 KB (300×250) / 500 KB (970×250) |
| TG Ads (premium) | — | video: MP4 16:9, 640×360…1280×720, ≤ 20 MB (≤ 10 MB recommended); static: PNG/JPG ≤ 5 MB, **no button on the image** | the marking text must be on the banner |

A Yandex page opened outside Yandex has no `yandexHTML5BannerApi`: guard the call, keep its exact text.

## Rules that change the animation

- **VC**: no scene change more often than once in 4 s, no flashes; no ALL-CAPS phrases (an all-caps headline is a
  moderation risk — tell the client, it is the design's call); light-grey backgrounds #FCFCFC–#E9E9E9 and any frame
  around the banner are forbidden. Give the runtime a minimum scene length: every state stays ≥ 4 s from the start of
  one transition to the start of the next (the intro counts the loop tail before it). A 13 s loop became 20 s.
- **Ведомости**: no sharply moving elements, no frequently blinking background, no abrupt frame changes; avoid type
  under 20 pt (legal lines are smaller by law — say so). The HTML may not use relative paths: inline everything.
  Positions come in sets of desktop / tablet / mobile (billboard 100%×250 / 620×200 / 640×200, side 300×600 /
  620×250 / 640×250): the tablet ones take «HTML 100%×200» / «HTML 100%×250» (fluid width at that height), the
  mobile ones **an image only** (GIF/JPG/PNG/SVG ≤ 300 KB, double density advised). The AdFox menu icon sits in the
  top-right corner and the platform may stamp «Реклама» top-left.
- **Habr перетяжка**: 1156×200 (30 px margins on desktop). The banner's left and right edges must be transparent or
  match the page; no colour mismatch or cut elements at the joins. A mockup drawn full-bleed in brand colour is a risk
  to raise, not to fix silently. Habr and Yandex overlay a menu icon and an «Реклама» tag in the top corners.
- **Sber**: the «play once, replay on click» rule is for **video inside** an HTML creative; animation may loop.
- **Marking for the whole animation** (Yandex and VC in the client's sheet: «маркировка указывается на самом баннере в
  течение всей анимации»): the legal line and the age mark stay on screen from the first frame to the loop seam. A
  storyboard whose intro frame has no legal line (and an approved story whose legal bar left before the loop restarted)
  breaks it; keep the next state's legal line and «0+» on through the intro and the seam, and say it differs from the
  mockup because of the brief.

## Fluid formats

- **100%×250** (VC, Ведомости): the container is `width:100%; height:250px`, the platform pads the sides with flat
  colour; the content sits in the central zone. Designers send two layouts («240–849» and «850+»): ship both in one
  page, pick by host width, rebuild on resize across the breakpoint, share one glyph table (both together stayed at
  54 KB of AdFox's 65 000).
- **VC mobile 1200×600**: 2:1, height 200 CSS px with fields when the screen is wider than 400 px, shrinking below
  that — contain the content box, centre it, fill the fields with the background.
- **A slot with a fixed size is a fixed page**, even when its frame was drawn a few px off (a 1156×200 slot drawn
  1152 wide): width and height in px, the frame centred, the background and an edge-to-edge header continued over the
  spare 2 px. As a fluid page it letterboxed in every other box — a preview frame, a browser window — the header plate
  left the edge and the frame's own fill showed as a step; the client read it as a broken layout.
- **Cap every fluid page at its slot's height**: 100%×250 → `max-height:250px` on the stage, 2:1 → `max-height:50vw`.
  Then only side fields can appear, and those are in the mockups. In the preview page show fixed slots and the 2:1 at
  fixed sizes; stretchable frames only for 100%-wide formats.
- **The header goes into the side fields only where the mockup's header runs edge to edge.** Where the designer kept
  it over the working zone (every 100%×250 frame, the 2:1 frame drawn with fields), the fields are background:
  continuing it there broke the match with the mockup, and the delivery check against the Figma state caught it.
- **A slot nobody drew**: play the mockup of the same proportions (within a few %), fitted to the slot height and
  top-aligned (a header band must not float under a strip of background; the spare px go to the bottom), and keep
  each set's family look — a 3.2:1 «word over a row of boxes» for the billboard set, a 2:1 working zone with the
  boxes stacked and fields of background for the side set. Say in the README which mockup each size comes from.
- **Image-only slots**: render them from the same banner page. GIF: frames at 50 fps once, then the best frame rate
  and palette under the cap (one palette for the loop, no dithering, changed rectangles only; a fade still reads at
  half the frame rate of a move; flat brand colours hold at 64 colours). A 12.5-s loop at 640×200 was 627 KB at
  25 fps — 300 KB gave 12.5 fps (fades 6.25) at 96 colours, and 10 fps at 64 for 640×250. PNG: the message state at
  double density. Check the GIF's loop against the banner's and its frames against the banner at the rest marks.
- Extending a layout past its Figma frame: whatever touches a frame edge goes on (keep a dot pattern's tile origin),
  rows of a repeated word repeat by their spacing, the frame's own fill extends too. A background clipped at the frame
  takes its clip along (a frame-clipped intro background stopped at the frame: plain green without dots beyond it); an
  edge patch a few px across is a cover-up, not a surface — it stays. Test at 320, 600, 849, 850, 1280, 1920 and
  2560 px.
- Snap the viewBox origin to whole device pixels. Centring an 849-px column in an even-width container puts the
  origin at x.5 (2000 → −0.5, 1280 → 359.5): every hard edge of the design lands between two pixels and blurs, and the
  check against Figma read mean 2.3–2.9 instead of 0.00.

## Before sending

- Check the files as delivered, not the dev page: unzip every archive, run its index.html without any render flag at
  the slot size (fluid ones at the Figma frame sizes), collect errors, confirm autoplay moves, the click macro and the
  loop length, and compare every rest mark with the state renders already verified against Figma (expect ≤ 0.05/255).
  This caught what the dev page could not: data compaction rounded a 141-bar header's pitch to 2 decimals and the last
  bar drifted 0.5 px — keep 3 decimals, 6 for scales and pitches.
- Size table per banner against its platform (HTML bytes and zip bytes); the build should print it.
- CPU: measure main-thread busy time over 10–12 s of real playback (CDP `Performance.getMetrics`, TaskDuration
  delta / elapsed). Skipping components whose props did not change brought a 23-format runtime to 2–3 %.
- Autoplay: test in headless Chrome or a visible window — a hidden preview pane does not run requestAnimationFrame
  (quirk 214).
- A video for a feed: start the loop where the first frame says something (`film.js --start S`), add a silent AAC
  track if the platform may reject mute files, check the first and last frames meet.
- README in the client's language: what is where, the click macro per platform, loop lengths, fixed typos,
  moderation risks, formats from the brief that had no mockup.
