# After Effects recipes — Cloud.ru scenes with `cloudru-motion.jsx`

Copy-ready payloads for `node scripts/ae.js --lib '@_build/<name>.jsx'`. The `--lib` flag
prepends `es-json.jsx` + `lib/tokens.jsx` (`CR`) + `lib/cloudru-motion.jsx` (`M`), and the lint
refuses to send anything that would raise a modal in AE. Every payload ends with
`JSON.stringify(M.run("label", function () { ... }))` — one undo group, a STEP marker for
failures, and `warnings[]` for silent problems (font fallback, unsettable properties).

Timings are **milliseconds** (brand tokens), snapped to frames by `M.f()`; sizes are **1080p px**
scaled by `M.px()` for other formats. Beat sheets for these scenes are in
`brand/cloudru-motion-brand.md` §3.

Read `reference/live-verify-checklist.md` before trusting anything marked VERIFY.

---

## 0. Preflight + rebuild pattern

```jsx
JSON.stringify(M.run("preflight", function () {
  M.active();                               // throws if no active comp
  return { summary: M.summary(), errs: M.exprErrors() };
}))
```

Idempotent rebuild: every layer the lib creates carries `comment = "CR_FX"`, so a payload can
start with `M.clean()` and be re-run after every tweak without touching the user's own layers.

```jsx
JSON.stringify(M.run("rebuild", function () {
  M.ensureComp("CR Title", "1080p", 8);     // find-or-create; sets M.FPS/M.W/M.H/M.SCALE
  var removed = M.clean();
  // ... build ...
  return { removed: removed, layers: M.comp.numLayers };
}))
```

## 1. Title — portal wipe, line-reveal heading, green subtitle plate

```jsx
JSON.stringify(M.run("CR title", function () {
  M.ensureComp("CR Title", "1080p", 8);
  M.clean();
  var MG = CR.FORMAT["1080p"].margin;                 // 80
  M.step("ground");
  M.solid("ground", CR.COLOR.WHITE);

  M.step("portal");                                    // brand signature transition
  var Po = M.portal("portal", { x: 1160, y: 200, w: 480, h: 320, steps: 4, dx: 40, dy: 40, color: CR.COLOR.GREEN });
  M.portalWipe(Po, 0, { dir: "right", dur: CR.MS.WIPE, each: CR.STAGGER_MS.TIGHT });

  M.step("logo");
  var logo = M.text("logo", "cloud.ru", { size: M.px(42), font: CR.FONT.SEMIBOLD, x: MG, y: MG + 30 });
  M.slideIn(logo, 300, { dy: -M.px(CR.TRAVEL.SLIDE) });    // from above

  M.step("title");                                     // one layer per line = one line-mask each
  var lines = ["Cloud.ru снижает", "цену прогресса"];
  var T = [];
  for (var i = 0; i < lines.length; i++) {
    T.push(M.text("title " + i, lines[i], { size: CR.TYPE.TITLE, font: CR.FONT.SEMIBOLD, x: MG, y: 460 + i * CR.TYPE.TITLE * CR.LEADING.HEADING }));
  }
  M.stagger(T, 500, CR.STAGGER_MS.BASE, function (L, t) { M.lineReveal(L, t, { dur: CR.MS.SLOW }); });

  M.step("plate");                                     // subtitle in a green plate: wipe, then text
  var plate = M.rect("plate", MG, 760, 900, 96, CR.COLOR.GREEN);
  M.wipe(plate, 900, { dir: "right", dur: CR.MS.BASE });
  var sub = M.text("subtitle", "Устойчивая основа для движения вперёд", { size: CR.TYPE.SUBTITLE, x: MG + 28, y: 760 + 62 });
  M.lineReveal(sub, 1050, { dur: CR.MS.BASE });

  M.step("pattern");
  var D = M.dots("dots", { x: MG, y: 940, cols: 36, rows: 3, size: 4, gap: 12, color: CR.COLOR.GREEN });
  M.patternBuild(D, 1100, { axis: "rows" });

  M.step("exit");                                      // exits are 70% of entrances, exit ease
  var X = 3600;
  M.stagger(T.concat([sub]), X, CR.STAGGER_MS.TIGHT, function (L, t) { M.slideOut(L, t, { dy: M.px(CR.TRAVEL.SLIDE) }); });
  M.wipe(plate, X, { dir: "right", out: true, dur: CR.MS.BASE });
  M.fadeOut(D, X);
  M.fadeOut(logo, X + 100);
  return { errs: M.exprErrors(), layers: M.comp.numLayers };
}))
```

Then capture the beats and look at them (`M.capture` writes at full resolution and restores
the preview factor; the PNGs land asynchronously — poll sizes before reading, quirk #27/#40):

```jsx
JSON.stringify(M.run("beats", function () { M.active(); return { files: M.capture([15, 30, 45, 75, 100], "title") }; }))
```

## 2. Divider — block wipe, section number odometer, bracket frame

```jsx
JSON.stringify(M.run("CR divider", function () {
  M.ensureComp("CR Divider", "1080p", 5);
  M.clean();
  M.step("wipe");
  var plate = M.blockWipe(0, { color: CR.COLOR.GREEN, dir: "up", dur: CR.MS.WIPE, out: false, name: "divider ground" });
  M.step("number");
  var N = M.text("num", "02", { size: CR.TYPE.DIVIDER, font: CR.FONT.SEMIBOLD, x: 80, y: 420 });
  M.lineReveal(N, 400, { dur: CR.MS.BASE });
  M.step("title");
  var H = M.text("h", "Инфраструктура", { size: CR.TYPE.SECTION, x: 80, y: 560 });
  M.lineReveal(H, 600, { dur: CR.MS.SLOW });
  M.step("bracket");
  var B = M.bracket("bracket", { x: 80, y: 80, w: 1760, h: 920, weight: 2, color: CR.COLOR.BLACK, cut: [0.3, 0.42] });
  M.drawOn(B, 800, { dur: CR.MS.SLOW, group: "frame" });
  return { errs: M.exprErrors() };
}))
```

Cross-tone cut to the next scene = simply start the next comp/scene with no transition; do not
add a dissolve.

## 3. KPI — three big numbers counting, one goes green

```jsx
JSON.stringify(M.run("CR kpi", function () {
  M.ensureComp("CR KPI", "1080p", 6);
  M.clean();
  M.solid("ground", CR.COLOR.WHITE);
  var H = M.text("h", "Экономия TCO за 12 месяцев", { size: CR.TYPE.SECTION, x: 80, y: 180 });
  M.lineReveal(H, 0);
  var cols = [80, 680, 1280], vals = [[0, 30, " %"], [0, 99.9, " %"], [0, 152, ""]], K = [], U = [], C = [];
  for (var i = 0; i < 3; i++) {
    K.push(M.text("kpi " + i, "0", { size: CR.TYPE.KPI_HERO, x: cols[i], y: 620, tracking: CR.TRACKING.KPI }));
    C.push(M.text("cap " + i, ["к затратам on-prem", "SLA платформы", "сервисов в каталоге"][i], { size: CR.TYPE.KPI_DESC, x: cols[i], y: 700, color: CR.COLOR.GRAPHITE }));
  }
  M.stagger(K, 300, CR.STAGGER_MS.LOOSE, function (L, t, i) {
    M.slideIn(L, t);
    M.counter(L, t, t + CR.MS.COUNT, vals[i][0], vals[i][1], { decimals: (i === 1 ? 1 : 0), suffix: vals[i][2] });
  });
  M.stagger(C, 1900, CR.STAGGER_MS.BASE, function (L, t) { M.fadeIn(L, t); });
  M.colorCut(K[0], 2200, CR.COLOR.GREEN, { dur: 200 });     // ONE accent number
  return { errs: M.exprErrors() };
}))
```

Tabular figures: SB Sans Display digits are not strictly tabular, so a fast counter can
jitter horizontally. If it does, right-align the number (`justify: "right"`, position at the
right edge) so the jitter lives on the left, or count on a fixed-width digit layer.

## 4. Content 3-col — columns slide in, rules grow, body fades

```jsx
JSON.stringify(M.run("CR content", function () {
  M.ensureComp("CR Content", "1080p", 6);
  M.clean();
  M.solid("ground", CR.COLOR.WHITE);
  var H = M.text("h", "Три уровня платформы", { size: CR.TYPE.SECTION, x: 80, y: 180 });
  M.lineReveal(H, 0);
  var heads = ["Evolution", "Advanced", "ML Space"], x0 = 80, cw = 560, gap = 40, heads_L = [], rules = [], bodies = [];
  for (var i = 0; i < 3; i++) {
    var x = x0 + i * (cw + gap);
    heads_L.push(M.text("col " + i, heads[i], { size: CR.TYPE.COLHEAD, font: CR.FONT.SEMIBOLD, x: x, y: 420 }));
    rules.push(M.rule("rule " + i, x, 440, cw, 2, CR.COLOR.GRAPHITE));
    bodies.push(M.text("body " + i, "Публичное облако для продуктовых\nкоманд, IaaS и PaaS", { size: CR.TYPE.BODY, x: x, y: 500, leading: CR.TYPE.BODY * CR.LEADING.BODY, color: CR.COLOR.GRAPHITE }));
  }
  M.stagger(heads_L, 300, CR.STAGGER_MS.LOOSE, function (L, t) { M.slideIn(L, t); });
  M.stagger(rules, 500, CR.STAGGER_MS.LOOSE, function (L, t) { M.growRule(L, t); });
  M.stagger(bodies, 650, CR.STAGGER_MS.LOOSE, function (L, t) { M.fadeIn(L, t); });
  return { errs: M.exprErrors() };
}))
```

## 5. Scheme — blocks in reading order, grey arrows draw after both ends exist

```jsx
JSON.stringify(M.run("CR scheme", function () {
  M.ensureComp("CR Scheme", "1080p", 6);
  M.clean();
  M.solid("ground", CR.COLOR.GRAY);
  var boxes = [[80, 400], [700, 400], [1320, 400]], B = [], Lb = [];
  for (var i = 0; i < 3; i++) {
    B.push(M.rect("block " + i, boxes[i][0], boxes[i][1], 520, 240, CR.COLOR.WHITE));
    Lb.push(M.text("label " + i, ["Данные", "Обработка", "Инсайты"][i], { size: CR.TYPE.COLHEAD, font: CR.FONT.SEMIBOLD, x: boxes[i][0] + 40, y: boxes[i][1] + 140 }));
  }
  M.stagger(B, 200, 100, function (L, t) { M.slideIn(L, t); });
  M.stagger(Lb, 300, 100, function (L, t) { M.fadeIn(L, t); });
  var arrows = [];
  for (var j = 0; j < 2; j++) {
    var a = M.line("arrow " + j, [boxes[j][0] + 520, 520], [boxes[j + 1][0], 520], 2, CR.COLOR.ARROW);
    M.drawOn(a, 300 + (j + 1) * 100 + CR.MS.BASE, { dur: CR.MS.FAST, group: "line" });
    arrows.push(a);
  }
  // accent: the last block gets a 4px green outline
  var acc = M.shape("accent");
  var g = M.group(acc, "outline");
  M.rectIn(M.inner(g), boxes[2][0], boxes[2][1], 520, 240);
  M.stroke(M.inner(M.groupByName(acc, "outline")), CR.COLOR.GREEN, 4);
  M.drawOn(acc, 1200, { dur: CR.MS.BASE, group: "outline" });
  return { errs: M.exprErrors() };
}))
```

Arrowheads: add a second open path `[[xb-14, y-10],[xb, y],[xb-14, y+10]]` in the same group
before the stroke; the trim path draws both (`_build/code.jsx` has the pattern).

## 6. Logo finale — green ground, portal behind the logo, dots

```jsx
JSON.stringify(M.run("CR finale", function () {
  M.ensureComp("CR Finale", "1080p", 6);
  M.clean();
  M.blockWipe(0, { color: CR.COLOR.GREEN, dir: "up", out: false, name: "ground" });
  var Po = M.portal("portal", { x: 1200, y: 300, w: 400, h: 400, steps: 3, dx: 40, dy: -40, color: CR.COLOR.BLACK });
  M.portalBuild(Po, 400, { each: 80 });
  // Replace this text logo with the real SVG/AI import (brand rule: never a typed lockup in deliverables)
  var logo = M.text("logo", "cloud.ru", { size: M.px(96), font: CR.FONT.SEMIBOLD, x: 80, y: 560 });
  M.slideIn(logo, 500, { dy: M.px(CR.TRAVEL.SLIDE_HERO), dur: CR.MS.SLOW });
  var thanks = M.text("thanks", "Спасибо", { size: CR.TYPE.SECTION, x: 80, y: 700 });
  M.lineReveal(thanks, 900);
  var D = M.dots("dots", { x: 80, y: 940, cols: 40, rows: 2, size: 4, gap: 12, color: CR.COLOR.BLACK });
  M.patternBuild(D, 1400, { axis: "cols", each: 12 });
  return { errs: M.exprErrors() };
}))
```

## 7. Multi-scene spot in ONE comp (windowing)

For a 30 s piece keep scenes in one comp with `M.window(layer, ms0, ms1)` (inPoint first —
quirk #14) and hard cuts between them; a `blockWipe` with `out:true` bridges two scenes. Track
every helper layer (quirk #13) — the lib tags everything, so `M.clean()` + rebuild is the
recovery path when a probe layer leaks.

```jsx
var S1 = 0, S2 = 4000, S3 = 8000;
// scene 1 ... M.window(L, S1, S2) on each of its layers
M.blockWipe(S2 - CR.MS.WIPE, { color: CR.COLOR.GREEN, dir: "right", out: true, hold: 80 });
// scene 2 ... M.window(L, S2, S3)
```

Verify with `M.visibleWindow(L)` per layer (samples opacity AND scale twice per frame, quirk #26)
and compare with the intended windows; then `M.capture` one frame from *each* scene and one
from every boundary.

## 8. Render

Never `renderQueue.render()` over the bridge (quirk #33). Save the project and shell out:

```
aerender.exe -project "C:\...\spot.aep" -comp "CR Title" -RStemplate "Best Settings" \
  -OMtemplate "H.264 - Match Render Settings - 15 Mbps" -output "C:\...\title.mp4"
```

## 9. What to do when something is off

| Symptom | Likely cause | Fix |
|---|---|---|
| `warnings: ["font fallback ..."]` | SB Sans Display not installed / PostScript name differs | install fonts or read the real name back from a probe layer; update `CR.FONT.*` in the tokens |
| text does not rise, mask visible as a hard crop | animator path not created (VERIFY) | `M.lineReveal(L, t, { mode: "matte" })` |
| words arc between positions | Position keys not flattened | `M.flatten(M.pos(L))` (the lib does it inside `tween`) |
| pattern pops all at once | `patternBuild` picked the wrong repeater | pass `axis: "cols"` / check group order |
| `AE returned empty result` | uncaught throw before `M.run` | wrap everything in `M.run`; check `failedAfter` |
| `CDP timeout` | a modal is up | STOP calling AE; ask the user to dismiss; lint the payload (quirk #25) |
