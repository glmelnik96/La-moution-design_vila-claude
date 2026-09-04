# Live-verify checklist — run this on the local machine with After Effects open

Everything in the cloud session was verified against Node tests and a strict AE mock
(`scripts/ae-mock.js`); the mock encodes the live-verified quirks but cannot prove that AE
accepts every matchName or property. This list is what to run first in the local session,
in order. Record each result in `reference/ae-quirks.md` (LIVE-VERIFIED, WRONG vs RIGHT) the
same way the previous sessions did, and remove the `VERIFY` tags in the lib/docs as items pass.

## 0. Bridge + lint

```bash
node scripts/ae.js 'JSON.stringify({ok:true, comp:(app.project.activeItem instanceof CompItem)?app.project.activeItem.name:null})'
node scripts/lint-jsx.js _build/cloud_v5.jsx          # lint must stay green on the old payloads
node scripts/ae.js --lib 'JSON.stringify({v: M.VERSION, green: CR.HEX.GREEN, fps: (function(){ M.active(); return M.FPS; })()})'
```
Expected: `{"v":"1.0.0","green":"#26D07C","fps":25}` (or the comp's fps). If `--lib` throws a
syntax modal, AE has rejected something in `cloudru-motion.jsx` — note the line (subtract the
prelude offset: es-json 38 lines + tokens.jsx ~90 lines) and fix.

## 1. Fonts

```jsx
JSON.stringify(M.run("fonts", function () {
  var out = {};
  var names = [CR.FONT.REGULAR, CR.FONT.MEDIUM, CR.FONT.SEMIBOLD, CR.FONT.BOLD, "Verdana", "Verdana-Bold"];
  for (var i = 0; i < names.length; i++) { var L = M.text("probe", "Ab", { font: names[i] }); out[names[i]] = L.__font; L.remove(); }
  return out;
}))
```
- [ ] SB Sans Display PostScript names resolve (no `font fallback` warnings). If not, read the
      real names from a manually created text layer and update `type.ae_postscript` in
      `brand/cloudru-motion-tokens.json`, then `node scripts/build-tokens.js`.
- [ ] `live.leading` / `live.justification` settable (no warnings) on this AE version.

## 2. Easing math (the core claim)

```jsx
JSON.stringify(M.run("ease", function () {
  var L = M.solid("s", CR.COLOR.WHITE); var op = M.opacity(L);
  M.tween(op, 0, 400, 0, 100, "enter");
  var o = op.keyOutTemporalEase(1)[0], i = op.keyInTemporalEase(2)[0];
  return { outInf: o.influence, outSpeed: o.speed, inInf: i.influence, inSpeed: i.speed, mid: op.valueAtTime(0.1, false) };
}))
```
- [ ] Read-back: outInf 16, outSpeed ≈ 1562.5, inInf 70, inSpeed 0 (AE may round influence).
- [ ] `mid` (value at 25 % of the time) ≈ 74–78 — the HTML engine gives `enter(0.25) ≈ 0.76`.
      If AE's value differs by more than ~3 points, the formula in `M.bezierEase` needs the
      AE-side correction; compare with a hand-made Graph Editor curve.
- [ ] Position tween: `keyOutTemporalEase(1).length === 1`, tangents `[0,0,0]`, exact landing.
- [ ] Text-layer Scale tween succeeds (3-D arity) and shape Scale (2-D) — quirk #18 path.

## 3. Builders (matchNames)

Run `reference/ae-cloudru-recipes.md` §1 (Title) as-is, then capture beats.
- [ ] `M.portal` + `M.portalWipe`: group transform `ADBE Vector Position` keys per step.
- [ ] `M.dots` / `M.grid` / `M.llll`: repeaters render; `M.patternBuild` (Copies HOLD keys) builds row by row.
- [ ] `M.stroke`: `ADBE Vector Stroke Line Cap` = 3 gives SQUARE caps (else try 1/2/3 and record the enum).
- [ ] `M.rule` + `M.growRule`: grows from the left edge (anchor logic).
- [ ] `M.wipe`: mask-shape keys interpolate; ease by influence applied without error.
- [ ] `M.blockWipe`: plate crosses the frame; motion blur on; shutter angle ≤ 90° in comp settings.
- [ ] `M.counter`: expression has no `expressionError`; U+202F separator shows in the render;
      `effect("Progress")(1)` resolves (else switch to `("Slider")`).
- [ ] `M.colorCut`: `ADBE Fill-0002` is the colour property (else `("Color")`).

## 4. Line reveal (two modes)

- [ ] `M.lineReveal(L, t)` (animator mode): `ADBE Text Animator` + `ADBE Text Selector` +
      `ADBE Text Position 3D` create via `addProperty`; the mask stays put while glyphs rise.
      If the animator is created without a selector and the property has no effect, set
      Range Selector Start 0 / End 100 explicitly (`ADBE Text Percent Start/End`).
- [ ] `M.lineReveal(L, t, { mode: "matte" })`: `setTrackMatte` exists (AE 23+) or the fallback
      `trackMatteType` path works with the matte directly above.
- [ ] Record which mode is the reliable default and flip the default in the lib if needed.

## 5. Verification helpers

- [ ] `M.exprErrors()` walks every layer without throwing (property groups that reject
      `.propertyType` reads should be swallowed by the try/catch).
- [ ] `M.capture([...])` writes full-res PNGs and restores `resolutionFactor`.
- [ ] `M.visibleWindow(L)` agrees with the intended `M.window` for a windowed layer.
- [ ] `M.bounds(L, t)` matches `sourceRectAtTime` shifted by position for a 2-D layer.

## 6. HTML engine on the local machine

```bash
node --test
node html/render/serve.js . 8093          # open http://localhost:8093/html/templates/showreel.html
node html/render/render.js html/templates/showreel.html --out out/showreel --scale 0.5 --beats auto --sheet out/showreel/sheet.png
node html/render/render.js html/templates/showreel.html --out out/showreel --beats none --video out/showreel.mp4
```
- [ ] Chrome found automatically (else set `CHROME_PATH`); ffmpeg found (else `FFMPEG_PATH`).
- [ ] `--video x.mp4` produces H.264 with a full ffmpeg; the Playwright ffmpeg falls back to `.webm`.
- [ ] SB Sans Display renders in Chrome (compare the sheet with the slide template).

## 7. Then

Port the approved HTML showreel scene by scene into AE with the recipes; compare the AE
capture of each beat with the HTML still of the same time. Differences in ease feel → §2;
differences in layout → font metrics (AE ink box vs browser line box); record both.
