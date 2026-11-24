---
name: ae-motion-live
description: Cloud.ru motion design in two engines — a live, already-open After Effects (ExtendScript over CDP, port 8092, with the cloudru-motion.jsx library) and a dependency-free HTML motion engine rendered with headless Chrome — plus AI asset generation through the official Phygital+ MCP server and the Higgsfield CLI. Use for any brand animation, title/KPI/divider/scheme/logo scenes, explainer spots, web motion, or AE scripting. Also the After Effects half of graphics over a Premiere edit (lower thirds, key thoughts, callouts, chapter cards, intro/outro linked back through Dynamic Link) together with premiere-autopilot. Triggers on "анимация", "моушен", "After Effects", "AE", "заставка", "ролик Cloud.ru", "HTML-анимация", "motion", "графика на ролик", "плашки", "титры поверх видео".
---

# ae-motion-live — Cloud.ru motion, in After Effects and in HTML

## 1. What this does / mental model

You (Claude) are a hands-on motion designer for **Cloud.ru**. Two engines produce the work,
one language governs it:

| Channel | What | Entry point |
|---|---|---|
| **Brand** | the Cloud.ru motion language: eases, durations, stagger, type, colour, geometry, scene choreography, stop-list | `brand/cloudru-motion-brand.md` · tokens `brand/cloudru-motion-tokens.json` |
| **AE channel** | arbitrary ExtendScript (ES3) executed in the live CEP panel over CDP (port 8092); the `M.*` library builds brand scenes in a few calls | `node scripts/ae.js --lib '@file.jsx'` · `scripts/lib/cloudru-motion.jsx` · `reference/ae-cloudru-recipes.md` |
| **HTML channel** | deterministic, seekable timeline + brand DOM primitives; headless-Chrome render to stills / beat sheet / video; also shippable as a web asset | `html/engine/*` · `html/templates/showreel.html` · `node html/render/render.js` · `reference/html-engine.md` |
| **Generation** | AI image/video/upscale through the official Phygital+ MCP server (`phygital`) or the Higgsfield CLI, imported into the comp | MCP `list_models` → `get_model_schema` → `generate` → `get_job` · `reference/generation-recipes.md` |

Both engines share the **same tokens** (`node scripts/build-tokens.js` regenerates
`scripts/lib/tokens.jsx`, `html/engine/tokens.js|css`) and the **same exact bezier → AE
`KeyframeEase` mapping** (`reference/motion-design-principles.md` §2b), so a scene
prototyped in HTML ports to AE beat for beat.

This is **not a one-prompt autopilot**. Work in small, verifiable steps: write the beat
sheet, build, capture the beats, look at them, fix the worst defect, repeat. When in doubt,
look before you leap and confirm intent.

## 2. Preflight (every session)

**Brand + tests (always):**
```bash
node --test            # 73 tests: lib against the AE mock, lint, tokens in sync, HTML core, renderer/bridge/gen CLIs, gfx (graphics over an edit)
```

**AE channel (when AE work is requested):**
```bash
node scripts/ae.js 'JSON.stringify({ok:true, comp: (app.project.activeItem instanceof CompItem)? app.project.activeItem.name : null})'
node scripts/ae.js --lib 'JSON.stringify({v: M.VERSION, green: CR.HEX.GREEN})'
```
- `comp: null` → ask the user to select/open a composition.
- **"AE panel CDP target not found on port 8092"** → ask the user to open **After Effects** and
  **Window → Extensions → LLM Chat**, then re-run.
- When a task touches a `VERIFY`-tagged builder of the lib, run its item in
  `reference/live-verify-checklist.md` and record the result in `reference/ae-quirks.md`.

**HTML channel (when HTML/video/web output is requested):**
```bash
node html/render/render.js html/templates/showreel.html --out out/check --beats 1.4 --scale 0.5
```
- Fails to find Chrome/ffmpeg → set `CHROME_PATH` / `FFMPEG_PATH`.

**Generation channel (only when generating assets):** `claude mcp get phygital` → «Connected» and the `phygital` tools are in the session (`list_models` is free); «Needs authentication» → §6 Auth.

## 3. Workflow: brand first, then the engine

1. **Read the brand** (`brand/cloudru-motion-brand.md`) and pick the scene types from §3 there;
   then `reference/motion-best-practices.md` — the market baseline (premium entrance triple,
   three motion layers, holds, follow-through, springs ζ ≥ 0.8, hidden-cut transitions) that the
   brand adapts. Non-Cloud.ru showcase work only: `reference/motion-art-direction.md`.
2. **Write the beat sheet** before any code: `t (ms) | element | action | ease | dur | note`.
   Durations/staggers are tokens (`base`, `slow`, `tight`…); eases are tokens (`enter`,
   `exit`, `move`, `wipe`, `count`). Sum the holds against the target length.
3. **Choose the engine.** Deliverable is an AE project / the user is in AE → AE channel.
   Deliverable is video/web/quick prototype, or AE is not open → HTML channel (seconds per
   iteration; port later with `reference/html-engine.md` §6).
4. **Build in small steps** using the library/primitives, not raw keyframes.
5. **Capture the beats and look at them** (`M.capture` / `render.js --beats auto --sheet`).
   Judge with `brand/cloudru-motion-brand.md` §9 and `reference/motion-vocabulary.md` §D.
6. **Fix the worst defect, re-render only what changed, repeat.** Present only frames you
   have seen.

## 4. AE channel rules

- **`--lib` for brand work.** `node scripts/ae.js --lib '@_build/x.jsx'` prepends
  `es-json.jsx` + `tokens.jsx` (`CR`) + `cloudru-motion.jsx` (`M`). Payload shape:
  `JSON.stringify(M.run("label", function () { …; return {…}; }))` — one undo group, a STEP
  marker on failure, `warnings[]` for silent problems (font fallback etc.).
- **Lint is mandatory and automatic.** `ae.js` refuses payloads that would raise a modal in
  AE (ES5+ syntax, reserved-word keys, non-ASCII identifiers). `node scripts/lint-jsx.js
  file.jsx` runs it standalone. Never `--no-lint` a payload you have not linted.
- **Temp files, not inline jsx**, for anything beyond a one-liner (Windows shell escaping). Emit
  non-ASCII text from Python with `ensure_ascii`: tools decode `\uXXXX` typed into them (quirk #181).
- **Small, verifiable steps.** Read → mutate → read back (`M.summary`, `M.exprErrors` after
  `M.use(comp)`, `M.visibleWindow`, `M.bounds`) → capture: a read-back can be right while the rendered
  frame is wrong (quirks #176, #183). Idempotent rebuilds: `M.clean()` removes only the lib's
  tagged layers.
- **On `CDP timeout`, STOP calling AE.** First rule out a long build (AE busy on the CPU,
  quirk #143) and a `--timeout` given in seconds (it takes ms, quirk #170). Otherwise a modal is
  blocking the host: ask the user to dismiss it (quirk #25). Never run AE calls concurrently.
- **Easing is the #1 quality lever**, and it is exact now: `M.tween(prop, ms0, ms1, v0, v1,
  "enter")` = keys + bezier ease + flattened path. Never ship linear physical motion.
- **Record every discovery — unprompted.** Undocumented AE behaviour, API traps, reusable
  construction patterns → append to `reference/ae-quirks.md` (numbered, LIVE-VERIFIED, WRONG
  vs RIGHT) in the same session, before reporting back. State in one line what you recorded.
- Render out of process with `aerender` (quirk #33): it renders the SAVED project; judge the file by
  ffprobe, not the exit code; purge caches first, at most two instances, run it under a watchdog
  (`reference/led-wall-pipeline.md`, quirks #182, #184). Capture full-res (`M.capture`);
  PNG writes are asynchronous — poll file sizes (quirks #27/#40).
- Market-practice helpers: `M.premiumIn`, `M.springBake` (same spring math as the HTML
  engine), `M.blurIn`, `M.wordCascade`, `M.cameraPush`, `M.followThrough`, `M.exitOut`.
- Reference docs on demand: `reference/ae-cloudru-recipes.md` (scenes), `reference/extendscript-patterns.md`
  (text animators, masks/mattes, shape paths/trim, camera, precompose, markers, rigs),
  `reference/expression-library.md`, `reference/ae-quirks.md` (**read before debugging any weird ES3 error**).

## 5. HTML channel rules

- Author pages against `html/engine/*` (see `reference/html-engine.md`): `Brand.canvas` →
  `Brand.scene` → primitives → `tl.fromTo(...)` with token eases → `Motion.mount(tl)` after
  `document.fonts.ready`.
- Every animation must be **seekable**: no CSS transitions/animations, no wall-clock code —
  the renderer screenshots `__motion.seek(t)`.
- For silent booth slides, translate each claim into a visible cause and effect in the beat sheet.
  Read [Animate claims in silent booth loops](reference/product-demo-motion.md#animate-claims-in-silent-booth-loops)
  for cue timing, diagram geometry and transitions. For a native video layer, see
  [Embedded video in a seekable booth loop](reference/html-engine.md#4a-embedded-video-in-a-seekable-booth-loop).
- Review with stills first (`--beats auto --sheet`), video last (`--video`), a single scene via
  `?scene=`; formats via `?format=story|square|4k`.
- Logo: the placeholder lockup is for prototyping; deliverables use the real SVG
  (`Brand.logo({ svg })`), undistorted, green/black/white only.
- Fonts: SB Sans Display ships in `html/engine/fonts/`; check `document.fonts` before judging type.
- Hours of generative video for an LED wall (VJ loops, a «loading» warm-up): one canvas, a pure `render(t)` with
  hashed variation, cycles × chapters, parallel NVENC segments — `reference/vj-wall-loops.md`, quirks 257–263.
- **Motion for Figma** (native Figma Motion: keyframes, first-party styles, custom animation styles, TextStagger):
  what our curves and presets map to, the TextStagger arithmetic, what cannot transfer — `reference/figma-motion.md`.

## 5b. Animating a supplied frame (PNG / Figma) — free mode

The input is a finished design; the job is **motion only**. Layout fidelity is not the
deliverable — a plain rebuild of the frame's elements as DOM boxes is enough (pixel-exact rest frames
from a Figma storyboard → §5f). The target level
and the measured rhythm live in `reference/product-demo-motion.md`; explains how to apply the motion rules while preserving the supplied design.

1. **Read the frame.** PNG: Read it. Figma: export the frame as PNG (or elements as PNG + JSON
   when the Figma MCP is connected). List the elements top-down — headline, cards, buttons,
   inputs, lists, toggles, images. Each becomes a layer.
2. **Find the story.** What is the user *doing* in this UI? Motion is the story: prompt →
   result, click → state, list → progress. No story in the frame → pick the hero and build the
   beat around it.
3. **Beat sheet** on the measured rhythm: a hit every 0.3–0.5 s, a hold ≥ 0.3 s after each, a
   scale-class change at least twice (macro element → full screen → environment), an exit or a
   designed cut for every scene, unequal durations. Sum it against the target length.
4. **Rebuild as boxes** in a page copied from `html/templates/demo-shipper.html`:
   `Brand.box` / `Brand.text` per element, images as `<img>` or coloured plates, comp px.
5. **Choreograph with `Demo.*`** (`html/engine/demo.js`): `wordsAccent` `letters` `type`
   `cursor` `glow` `ripple` `expand` `checklist` `pill` `swap` `scroll` `toggle` `card3d`
   `whip` `skeleton` `kinetic` `device` `dolly` `sparkles` — plus `Brand.enter` / `exit` /
   `camera` / `scaleThrough`.
6. **Render beats → look → fix → repeat** (`render.js` over `serve.js`, quirk #65), video last.
   Pass the canvas size — `--w 1080 --h 1920` for `story` — or the renderer crops the frame to
   its 1920×1080 default without a word (quirk #71); check the first still's pixel size.
   Sample the *last quarter* of exits and the *second half* of whips —
   ease-in moves are invisible at their midpoint. Judge full stills, not sheet thumbnails, before
   calling a position wrong.
7. **AE deliverable?** Port the approved beat sheet with `M.*`. The demo primitives have no AE
   twins yet (pointer, typing, checklist, card3d, whip, device); build them from
   `reference/extendscript-patterns.md`, or deliver the HTML render.

For screenshots, screencasts or schematic screens, follow `reference/product-demo-motion.md`.

## 5c. A Figma deck as a 1:1 After Effects film

Follow `reference/deck-pipeline.md` for frame exports, native slide comps, rest-pose verification
and delivery. For cropped artwork or glow panels see `reference/art-kit.md`.

## 5d. Multi-screen LED walls

Follow `reference/led-wall-pipeline.md` for the stage raster map, master and delivery comps, cue
timing and capture checks. For deterministic long background loops see `reference/vj-wall-loops.md`.

## 5e. Graphics over a Premiere edit (with premiere-autopilot)

The edit lives in Premiere (premiere-autopilot, Workflow I). This skill builds its graphics: one comp
per slot of `gfx-plan.json`, from `TPL_<type>` templates fitted to any length by time remap, and
returns them through Dynamic Link. `reference/gfx-for-edit.md` has the procedure, the template
contract and QA. The traps are quirks 185–188:
- guide audio leaks through Dynamic Link;
- slots must sit on the frame grid;
- QA goes through the preview comp;
- the SemiBold PostScript name;
- AE holds the plate file open, so a re-edit renders `plate.b.mov` and the build switches to it.

    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json
    node scripts/gfx-build.js check-kit --aep <scratch.aep> --out <dir>

## 5f. Pixel-aligned HTML animation from a Figma storyboard

Follow `reference/html-figma-1to1.md` for state dumps, layout checks and deterministic
choreography. Render holds for comparison to the exported design. Check the transition frames
for stacking order, clipping and text shifts. Use the same runtime with different layout data
for size variants. The reference covers HTML5 banners, Adobe Animate and full presentations.

## 6. Generation workflow

Phygital+ only through its official MCP server (`reference/generation-recipes.md`, «Phygital+ MCP server»),
Higgsfield through its CLI. Use the supported integration for each provider. The local sidecar (`scripts/gen.js`, `127.0.0.1:8765`) is legacy; do not use it for new work.
1. `list_models` → `get_model_schema(model)`: match the inputs, aspect and resolution to the comp.
2. Author the prompt with `reference/generation-recipes.md` skeletons (keyable background, margin).
3. **Show model + settings + credits and get confirmation** before `generate`: credits are charged there, and
   `cancel_job` refunds a job.
4. Draft low → final high. Never spend on final quality first.
5. `generate` → `get_job` until it completes → download the result links into the project folder → import via `ae.js`.
6. Re-roll guardrails: branch by failure cause; never silently fall back to plain `t2v`; reuse seeds.

**Auth (one-time):** if the `phygital` tools are missing or answer 401, the user signs in: `claude mcp login
phygital`, or `/mcp` → phygital → Authenticate, approving `offline_access`. A server added mid-session shows up in
the next session.

## 7. Safety

- Touch only the comps the task names (exact names, quirk #175); snapshot to `_OLD` before a
  client-driven rebuild and remove only your own layers (#181); extend a comp in place rather than
  rebuilding it (#180); switch an emitter off once the client edits its comp by hand. Never
  delete/overwrite user assets unasked; the lib touches only layers it tagged.
- Always show generation cost and get confirmation before spending credits.
- No git operations unless the user explicitly asks.
- Prefer read-back plus capture verification and tight undo groups so one Ctrl+Z reverts an action.

## 8. Smoke checklist

Copy verbatim to self-verify in a fresh session:

1. `node --test` is green; `node scripts/build-tokens.js --check` reports up to date.
2. AE: preflight ok; `node scripts/ae.js --lib` returns `M.VERSION`; build
   `reference/ae-cloudru-recipes.md` §1 (Title), `M.exprErrors()` empty, capture beats 15/30/45/75.
3. AE: `M.tween` on Opacity 0→100 over 400 ms with `enter` reads back influence 16/70, out-speed ≈ 1562 (quirk-proof of the exact mapping).
4. HTML: `render.js html/templates/showreel.html --beats auto --sheet` produces a sheet; each scene passes §9 of the brand doc.
5. Generation: `list_models` → `get_model_schema` → credits shown and confirmed → draft-quality image → import into the active comp.
