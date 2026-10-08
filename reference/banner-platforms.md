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
use Latin letters, digits and `_` only (AdFox is the strictest).

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
| AdFox (VC, Ведомости, Habr …) | `href="%banner.reference_mrc_user1%" target="%banner.target%"` | every `<script nonce="%request.eid1%">` | HTML ≤ 65 000 bytes (characters at VC); each file ≤ 300 KB; zip ≤ 300 KB (VC); ≤ 50 files |
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
- **Habr перетяжка**: 1156×200 (30 px margins on desktop). The banner's left and right edges must be transparent or
  match the page; no colour mismatch or cut elements at the joins. A mockup drawn full-bleed in brand colour is a risk
  to raise, not to fix silently. Habr and Yandex overlay a menu icon and an «Реклама» tag in the top corners.
- **Sber**: the «play once, replay on click» rule is for **video inside** an HTML creative; animation may loop.

## Fluid formats

- **100%×250** (VC, Ведомости): the container is `width:100%; height:250px`, the platform pads the sides with flat
  colour; the content sits in the central zone. Designers send two layouts («240–849» and «850+»): ship both in one
  page, pick by host width, rebuild on resize across the breakpoint, share one glyph table (both together stayed at
  54 KB of AdFox's 65 000).
- **VC mobile 1200×600**: 2:1, height 200 CSS px with fields when the screen is wider than 400 px, shrinking below
  that — contain the content box, centre it, fill the fields with the background.
- Extending a layout past its Figma frame: whatever touches a frame edge goes on (keep a dot pattern's tile origin),
  rows of a repeated word repeat by their spacing, the frame's own fill extends too. Test at 320, 600, 849, 850, 1280,
  1920 and 2560 px.
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
