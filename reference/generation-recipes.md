# Generation recipes (sidecar)

> **Since 2026-10-19, Phygital+ goes through its official MCP server only** (section «Phygital+ MCP server» below),
> and Higgsfield goes through its CLI. The sidecar sections are kept as a record. Do not use them for new work: the
> sidecar drives the web backend with a browser session, which is the kind of automated access the Terms forbid.

End-to-end flow for generating media through the Phygital-Adobe-Studio sidecar
and importing the result into After Effects. The sidecar is a local FastAPI
service (`127.0.0.1:8765`) that bridges the backend generation API; the skill
wraps it with `scripts/gen.js` (generation) and `scripts/ae.js` (AE import).

> **Auth note:** the sidecar must be running and authenticated. On this Windows
> machine it is launched by the **user**, not the agent (MSIX sandbox
> virtualizes `%LOCALAPPDATA%` so agent-spawned processes and the CEP panel can't
> see each other). See SKILL.md §Auth for the one-time browser login.

---

## Preflight

Always confirm the sidecar is up and authenticated before anything else:

```bash
node scripts/gen.js start      # bring up / attach the sidecar
node scripts/gen.js health     # GET /health
```

`health` returns `{ok, session_age_sec, jwt_ttl_sec, active_jobs}`.

- If `session_age_sec` is **missing / null** → there is no valid backend session.
  Tell the user to run the **one-time browser login** (SKILL.md §Auth →
  `POST /auth/recon`, which opens a browser). Do NOT try to generate until
  `session_age_sec` is a real number.
- If `jwt_ttl_sec` is low, the session may expire mid-job — flag it.

---

## Node families

Neutral family labels; the engine version is a *parameter* (`model_name` on 74,
`model` on 100/121/124), shown as the Version dropdown in the panel. Required
**slots vary by scenario** — never assume, always discover (next section).

| Family | node_id | Notes |
|---|---|---|
| Image | 94 (Nano Banana), 98 (GPT Image, ≤16 ref images) | image-edit / text-to-image; 94 also used as image-edit upstream for video |
| Video | 74 (Kling), 100 (Seedance), 121 (Kling Omni), 124 (Kling Motion) | scenarios vary per node — see table below |
| Upscale | Topaz | see `GET /nodes/upscale` for options |
| Voice | ElevenLabs TTS | see `GET /nodes` |

**Video scenarios (from sidecar README, confirm live via `GET /nodes/video`):**

| node_id | Model | Scenarios |
|---|---|---|
| 74  | Kling        | `t2v`, `start_prompt`, `start_end_prompt`, `elements_prompt`, `elements_prompt_video` |
| 100 | Seedance     | `t2v`, `start_prompt`, `start_end_prompt`, `ref_prompt`, `ref_prompt_video` |
| 121 | Kling Omni   | `t2v`, `start_prompt`, `start_end_prompt`, `elements_prompt`, `elements_prompt_video` |
| 124 | Kling Motion | `char_video_prompt` (with `character_orientation ∈ {video, image}`) |

---

## Discover exact params

Scenario slots differ per node and per scenario. **Always** confirm required
slots/params before submitting. The sidecar auth header is
`X-Phygital-Sidecar-Token` (per-install shared secret from
`%LOCALAPPDATA%\PhygitalStudio\sidecar.token`).

```bash
# all nodes (id, name, workflow_class)
curl -s http://127.0.0.1:8765/nodes \
  -H "X-Phygital-Sidecar-Token: $SIDECAR_TOKEN"

# video nodes with scenarios + slots + scenario_slots + default_params
curl -s http://127.0.0.1:8765/nodes/video \
  -H "X-Phygital-Sidecar-Token: $SIDECAR_TOKEN"

# upscale (Topaz) nodes and their options
curl -s http://127.0.0.1:8765/nodes/upscale \
  -H "X-Phygital-Sidecar-Token: $SIDECAR_TOKEN"
```

`GET /nodes/video` returns per node:
`{node_id, model, scenarios, slots, scenario_slots, default_params}`. Read
`scenario_slots` for the chosen scenario to know which `init_files` slots are
required (e.g. `start_img`, `end_frame`).

---

## Cost gate (confirm BEFORE generating)

Never call `generate` without showing the user the credit cost and getting
confirmation first.

```bash
node scripts/gen.js cost --node 94 --params '{"prompt":"neon city, cinematic"}'
# → {"price": <n>, "details": {"base_price": <n>, "params": [ ... ]}}
#   (via POST /jobs/preview-cost — the cost is the top-level `price` field,
#    NOT `credits`. LIVE-VERIFIED: a node-94 image returned {"price":80,...}.)
```

Show the returned `price` to the user and wait for a go-ahead.

---

## Generate + import recipe (image example)

```bash
node scripts/gen.js generate --node 94 --params '{"prompt":"neon city, cinematic"}'
# → {"job_id":"...","result_paths":["C:/Users/<you>/AppData/Local/PhygitalStudio/downloads/<id>/0001.png"]}
```

**MSIX handoff (mandatory — LIVE-VERIFIED gotcha).** The sidecar writes results
under the *real* `%LOCALAPPDATA%\PhygitalStudio\downloads\`, but After Effects is
MSIX-packaged and sees a **virtualized** `%LOCALAPPDATA%` — so `new File(PATH)`
on a raw `result_paths[0]` reports *file not found* even though the file exists on
disk. Before importing, **copy the result into a non-virtualized staging folder**
that AE can read (Documents works):

```bash
# Take result_paths[0] from the generate output ABOVE (do NOT run generate
# again — that would spend credits twice). Copy it into a folder AE can read:
mkdir -p "$USERPROFILE/Documents/ae-stage"
cp "<result_paths[0] from the generate output>" \
   "$USERPROFILE/Documents/ae-stage/asset.png"
```

Then import the **staged** copy into the active AE comp:

```bash
node scripts/ae.js '@import.jsx'
```

`import.jsx` uses `app.project.importFile(new File(PATH))` + `comp.layers.add(...)`
(guard the active comp and wrap in an undo group — see
`extendscript-patterns.md` §6). Pass the **staged** path (not the raw
`downloads\` path) as `PATH`.

---

## Video with init frames

For scenarios that need a start (and/or end) frame, pass init files with `--init`
and select the scenario in `--params`. Init files are sha256-deduped through
`/assets` automatically.

```bash
node scripts/gen.js generate --node 100 \
  --init start_img=C:/a.png,end_frame=C:/b.png \
  --params '{"scenario":"start_end_prompt","prompt":"slow camera push-in, cinematic","seed":42}'
```

The `--init` slot names (`start_img`, `end_frame`, `ref_*`, `elements_*`) must
match the scenario's `scenario_slots` from `GET /nodes/video`. After the job
completes, import `result_paths[0]` into AE exactly as in the image recipe
(`node scripts/ae.js '@import.jsx'`).

Underlying request shape (what `gen.js` builds against `POST /jobs`):

```json
{
  "node_id": 100,
  "params": { "prompt": "...", "scenario": "start_end_prompt", "seed": 42 },
  "init_files": { "start_img": "C:/a.png", "end_frame": "C:/b.png" }
}
```

---

## Credit discipline (spend as little as possible)

Generation is metered. The failure mode to avoid is **silent burn** — spending
credits the user didn't knowingly approve, or re-rolling blindly. Rules:

- **Draft low → final high.** Never spend on final quality first. Prove the
  composition with the cheapest settings (short duration, low resolution, cheap
  node), judge it, *then* re-run once at hero quality. For video this is the
  single biggest saver: a 4s/480p draft costs a fraction of 12s/1080p.
- **One clear confirmation before any paid call.** Show a compact block:
  model + settings · estimated cost · what it produces. Wait for an explicit
  go-ahead. (See `cost` gate above.)
- **Pick the node per shot, not per project.** Cheap default for drafts; only
  escalate to a premium node/scenario where that specific shot needs it.
- **Re-roll guardrails — branch by failure cause, don't blind-retry:**
  - Content-policy trip → reword/reframe the prompt; retrying the *same* input on
    the *same* node just burns credits again.
  - Never silently fall back from a ref/init-frame scenario to plain `t2v` — you
    lose the visual anchor and waste the run. Tell the user instead.
  - Mysterious error on a premium node is often plan/entitlement gating, not the
    prompt — check before re-spending.
- **Preview vs source.** Judge on the cheap preview/thumbnail; only pull the
  full-res source (`result_paths[0]`) for the take you're keeping.
- **Reuse the seed** of a kept result so small prompt tweaks vary controllably
  instead of forcing a full re-roll to recover a good composition.
- **Batch independent jobs.** Fire multiple `submit` calls and poll each with
  `wait` rather than serializing — same spend, faster throughput.
- **Preflight before spending.** Verify the node's supported aspect ratios /
  required slots (`GET /nodes/*`) and keep prompts tight *before* submitting; a
  wrong ratio or missing slot is a deterministic, avoidable failed generation.

---

## Prompt authoring — images

Applies to node **94 (Nano Banana / Gemini)** and **98 (GPT Image)**.

**Skeleton (one natural-language paragraph, never a comma keyword-list):**

```
[Subject, named explicitly] + [Style/medium] + [Composition/shot] +
[Lighting] + [Camera/lens & quality]
```

> "A weathered brass compass lying open on a dark oak desk, macro product
> photograph, centered composition with shallow depth of field, soft diffused
> studio lighting with crisp highlights, shot on 100mm macro lens, ultra-detailed."

Rules:

- **Full sentences, not tags.** Models parse grammar. `woman, Tokyo, dusk, neon`
  → weak; `A woman in a Tokyo alleyway at dusk, neon reflecting off wet pavement`
  → strong.
- **Be specific:** exact colors, materials (`brushed steel`, `frosted glass`),
  lighting setup, spatial relationships. Vague words give unpredictable output.
- **Photographic vocabulary** gives precise control: lens (`50mm f/1.4`,
  `24mm wide-angle`), depth of field, lighting (Rembrandt, rim/backlight, golden
  hour, volumetric), composition (rule of thirds, centered, low/high angle, macro).
- **Text in image:** wrap the literal string in double quotes —
  `...title "BLUE NOTE SESSIONS" in bold condensed sans-serif`. Prefer readable
  fonts; route heavy typography to a text-strong model if available.
- **Match the comp.** Pass the target aspect/resolution so the asset needs no
  cropping. Node 94 has an explicit `aspect_ratio` enum (`1:1 16:9 9:16 4:3 3:4`);
  node 98 takes any width/height in 32px increments — set it to the comp size.
- **Do not name the venue when you want the content.** "Panorama for a three-screen LED stage backdrop"
  made Nano Banana draw a hall with three screens, bezels, ceiling and a glossy floor (4 of 4 variants). Ask
  for the picture itself instead: "an abstract full-frame graphic, edge to edge, not a photo of screens or a
  room". Keep the stage only in your own layout notes.

**Transparent backgrounds / assets to composite (critical for AE layers):**

Text-to-image rarely emits true alpha. Two reliable paths:

1. Generate on a flat, uniform background (`isolated on a plain solid #00FF00
   chroma background` / `seamless white studio backdrop`), then key/matte in AE;
   **or** run a background-removal pass to get a transparent PNG.
2. Ask an editing model directly: `remove the background, make it transparent`.

Prompt for even, shadow-free lighting on the isolated subject, avoid
semi-transparent elements (glass, smoke, motion blur — they matte poorly), and
**generate with margin / slightly larger than needed** so AE can scale and
reposition without hitting the canvas edge.

**Consistency across frames (for animated sequences):**

- Lock a canonical subject description and repeat it **verbatim** every frame
  (`the woman with short black hair and green eyes wearing a navy blazer`).
- Each prompt states what CHANGES (pose, action, setting) and what STAYS THE SAME
  (face, clothing, palette, lighting direction).
- Feed prior frames back as reference images when supported (node 94: up to 14
  inputs; node 98: multi-image reference, ≤16).
- Change one variable at a time — batching changes drifts identity.

**Editing discipline:** always say what to KEEP (`keeping the pose and framing
unchanged`). Prefer scoped verbs (`change her outfit to X, keep her face
unchanged`) over `transform`, which can swap the whole identity.

**Negative prompts:** only FLUX/SD-style models honor a real `negative_prompt`
field. On native Gemini/GPT image models a negative prompt adds noise instead of
removing content — fold exclusions into the positive prompt (`plain empty
background, no text, no people`). Detect the node before emitting one.

---

## Prompt authoring — video

Applies to nodes **74 (Kling)**, **100 (Seedance)**, **121 (Kling Omni)**,
**124 (Kling Motion)**.

**Skeleton — subject + action FIRST.** Models weight the first ~30–40% of tokens
most heavily, so lead with the subject and what it does, then modifiers:

```
[Subject + primary action] , [setting/environment] , [camera movement] ,
[lens/look] , [lighting/mood] , [style]
```

Rules:

- **Describe motion, not just a scene.** Video prompts that read like a still
  produce a near-frozen clip. State the action *and* how the camera moves.
- **Camera-movement vocabulary:** static / slow push-in (dolly in) / pull-out /
  truck left-right / pedestal up-down / pan / tilt / orbit (arc) / crane /
  whip pan / Hitchcock zoom (dolly-zoom). One clear move per clip beats many.
- **Lens language:** `24mm` wide establishing, `35/50mm` natural, `85/100mm`
  compressed portrait, `anamorphic` for cinematic flares/oval bokeh.
- **One primary action per clip.** Multiple simultaneous actions confuse the
  model and waste the generation.
- **Init-frame scenarios** (`start_prompt`, `start_end_prompt`, `ref_*`): the
  prompt should describe the *transition/motion between* the frames, not
  re-describe the frames themselves.

**Negatives — node-specific:**

- **Kling (74/121/124)** supports negatives, but phrase them as the *unwanted
  thing itself*, not a negation: use `blurry, distorted, extra fingers, watermark`
  — NOT `no blur, not distorted` (negation words can backfire).
- **Seedance (100)** has weak/no negative support — invert to positive instead:
  instead of "no camera shake" write `smooth stabilized camera`.

**Worked examples:**

```
# t2v, cinematic push-in
node 100, t2v: "A lone lighthouse on a storm-battered cliff, waves crashing
against the rocks, slow cinematic push-in, 35mm anamorphic, moody blue-hour
lighting, volumetric mist" ; negative(invert): "smooth stable footage, sharp focus"

# start_end_prompt, controlled motion between two frames (74/100/121)
node 74, start_end_prompt: "the character turns their head toward the camera and
smiles, subtle hair movement, gentle rack focus, warm key light"
init: start_img=frame01.png, end_frame=frame02.png
```

> License note: the image-prompt guidance above is written from Apache-2.0
> (replicate/skills) material and paraphrased inference-sh ideas; video-prompt
> guidance is distilled from MIT/permissive prompting guides. Safe to keep.

## Runway web app in the browser pane (Unlimited mode only)

> **Runway detects scripted generation (2026-10-10).** After a night of scripted jobs, about 40 Generates fired by JS
> `click()`, Runway showed a modal: «Are you using an autoclicker?». It said that triggering generations
> automatically is against its Terms of use and leads to suspension. That is bot detection on the user's account.
> - Stop every scripted Generate at once and tell the user. Do not dismiss the modal and carry on.
> - Since then, start a Runway generation from a script only if the user explicitly says how to proceed, knowing
>   about the warning.
> - Preparing stills, prompts and keyframe choices for the user to submit by hand is fine.
> - The notes below record how the UI behaves, not permission to automate it.

LIVE-VERIFIED 2026-10-08. When the user allows only free generations, use Runway's Unlimited mode and never Credits.
- **Check the mode before every Generate:** the `credit-info-button` popover has two toggles; Unlimited must carry
  `aria-checked=true`. The toggles have no labels of their own: the first `[aria-checked]` in the open popover is
  Unlimited, the second Credits (LIVE-VERIFIED 2026-10-10). A JS `click()` on the button toggles the popover. Unlimited models seen: images Nano Banana Pro (Gemini 3 Pro Image), video Seedance 2.5.
- **Two generations at once.** A third is refused with "wait for your last generation to complete, or switch to
  Credits Mode". Four images per run take a few minutes.
- **Controls.** Prompt: `[aria-label="Text Prompt Input"]` (click, Ctrl+A, Delete, type). The first three `<select>`s
  are count (1 | 4), aspect (21:9 … 9:16, Auto) and resolution (1K | 2K | 4K). 21:9 2K = 3168×1344,
  9:16 2K = 1536×2752. Before clicking Generate from page JS, guard on the prompt's first words, the three
  selects and the mode.
- **Originals, without the download dialog.** A result `<img>` is
  `img.runwayml.com/unsafe/xl/<base64 of the original PNG URL with ?_jwt>.jpg`; `atob` the middle part and fetch
  the PNG with urllib into the project folder. The list is virtualised: click "View latest" first.
- **References.** Drag a result onto the Reference slot (it shows "Image 1"); "Remove Image 1" clears it. A master
  used as a reference with "keep the exact composition" yields state variants that line up (2 of 4 held the layout
  to a few px) — see `led-wall-pipeline.md` §18.
- **Video, Keyframe tab:** "First Video Frame" / "Last Video Frame" slots. The same still in both gives a loop
  that closes almost seamlessly (seam 0.8 vs a normal step 0.7 in one test) with a locked camera ("Static locked
  camera, no zoom, no pan"). "Select" opens the asset browser: Sessions → the session → double-click the tile
  (dispatch mousedown/up/click/dblclick on its `<img>`). "Upload" opens the native file dialog: fill it with
  `WM_SETTEXT` + `BM_CLICK` from a script (no coordinate clicks). The aspect follows the uploaded image.
  - Pick a still by name, not by position (LIVE-VERIFIED 2026-10-09). A tile's `src` is
    `…/unsafe/…/<base64 of the original URL>.webp`. Decode it (`-` → `+`, `_` → `/`, then `atob`), match the
    `…_N.png` slug, and fire the events on that `<img>`.
  - Simpler (LIVE-VERIFIED 2026-10-10): every tile in the session folder carries its display name as a leaf text
    node — `Nano Banana Pro - <first ~80 characters of the prompt, «:» and «,» turned into «_»>_N.png`. Find the
    leaf whose text equals the name, walk up at most six parents to the tile's `<img>`, fire the events on it.
    The folder is lazy: scroll its scroll container 500 px at a time until the leaf appears. The same picker
    serves the Image tool's «Add an image reference» button.
  - Once the First slot is filled, its "Select" button is gone. The Last slot's picker is then its folder icon.
    "Remove image" (aria-label) clears a filled slot.
  - The Video tool's prompt box is `[aria-label="Prompt"]`. The Image tool's is "Text Prompt Input".
- **A transition between two different stills lands near the targets, not on them.** Seedance 2.0, glass model →
  real plant at night, 1470×630: grey NCC of the first frame against its still 0.87, of the last frame against its
  still 0.79 (against the other candidates ≤ 0.52). Plan the cut so the last ~0.5 s dissolves into the sharp still.
  NCC against every candidate still also tells you which stills a job used when the notes lost track.
  - Same-composition chains land much closer (LIVE-VERIFIED 2026-10-10). Blue hour «lights off» → night «lights
    on», where both stills came from one master: the last frame against the loop made from the night still had
    NCC 0.999.
  - Seedance front-loads the event. In that clip all the lights were on within the first ~2 s; the rest was the
    sky slowly darkening. A 1 s dissolve into the clip hid the moment.
  - Fix in AE: hold frame 0 through the dissolve, play the event at half speed with frame mix, then run at 1×.
    A piecewise-linear time remap via `linear()` does all three in one expression.
  - **The handoff from a centre-screen clip to the full wall** (LIVE-VERIFIED 2026-10-11). The last keyframe is cut
    from the wall itself: capture the delivered wall comp at the handoff time. Take the rectangle the centre still
    covers on the wall: its size times every scale in the chain (still in the centre comp × centre comp on the wall).
    Reflect-pad the rows that fall outside the wall, then resample to the still's own size. The first keyframe is
    the still the centre shows at that moment.
  - **Upload a local frame to a keyframe slot without coordinate clicks** (LIVE-VERIFIED 2026-10-11). Start
    a small PowerShell helper in the background (it waits for the Open dialog, types an ASCII path, presses Enter),
    then click the slot's «Upload» button by its `ref`. The helper fills the dialog and the slot fills in a second or two. Use it for frames Runway never made, such as
    a clip's last frame cut with ffmpeg. Video cards also carry «Use frame» and «Use frame options».
- **Unlimited limits:** video tops out at 720p (picking 1080p reverts). Seedance 2.0 runs two jobs at a time,
  Seedance 2.5 only one; use 2.0 for simple motion. Durations 4–15 s.
- **Duration: set it, then press Escape — never Enter.** (LIVE-VERIFIED 2026-10-09.) The Duration button opens a
  slider with a number box («Duration in seconds»). Enter in that box can submit the form. Once, two identical
  jobs appeared where one was intended. Close the popover with Escape and read the button's text (`5s`, `10s`)
  before Generate.
  - The number box is 32×18 px. A triple-click that misses it lands in the prompt underneath, and the typed «10»
    replaced the whole prompt once. Typing into the box also failed to stick at least once.
  - Reliable: focus the `[role="slider"]` from page JS, then press ArrowRight with the tool's key action. Its
    `aria-valuenow` is an index: 0 = 4 s, so 5 s → 10 s is five presses. Read `aria-valuenow` and the button text
    back.
- **Truncated file names:** a result's PNG name holds only the first ~80 characters of the prompt slug; match on
  the opening words, not on a term from the middle of the prompt.
- **Which variant is which.** The slug ends in `_N.png`, where N is the result's index in its run of four. N
  matched the downloaded vN every time; the thumbnail-vs-file NCC was 0.9986. The base64 substring of `_N.png`
  depends on alignment, so take it from a real `src`, not from encoding the name.
- **Reference in the Image tool, reliably:** the bottom "References" button opens a panel whose "Recents" holds
  every image used as a reference before; one dispatched click on its `<img>` sets it as Image 1. A real mouse drag
  from the feed also works, but missed three times in a row once the tile's hover toolbar sat under the cursor (it
  then selected page text).
- **The 2-job limit fails silently from script.** With two jobs running, a JS `click()` on an enabled-looking
  Generate does nothing: no error, no new feed item. Counting "Generating" in `innerText` is not enough, because
  the virtualised feed drops off-screen cards. After every Generate, check that a new card appeared at the
  bottom of the feed and the thumbnail rail grew by one.
- **Seedance 2.0 crops a 21:9 still by 2.5–3 %.** A transition and a loop made from the same still carried the same
  zoom and a ~18 px shift at 1470 px. A ±1.5 % scale search missed it: band-pass NCC was 0.26–0.37, against
  0.93–0.97 at ±4 %. Fit once per still; the fit holds for every clip made from it.
- **A 9:16 still (1536×2752) is not cropped by scale.** Seedance 2.0's 720×1280 frame is the still scaled to 720 wide
  and centre-cropped by 5 px top and bottom (plain NCC 0.997). On that black-oil frame the phase-correlation fit
  returned NCC 0.04: dark, low-texture images defeat it. Try the plain width-fit, centre-crop mapping first.
- **The Runway UI reports progress as a percentage, then «In queue».** A count of the word "Generating" misses
  both. The feed also stops at a scrolled position, so click «View latest» before reading the job cards.
- **The newest image can be sent straight to a tool from its card.** Use the card's Actions menu: «Use in image»
  adds it as a reference, and «Use in video» sets it as the first keyframe. The References → Recents list holds only
  images that were already used as references.
- **The session folder in the asset browser loads lazily, newest first.** (LIVE-VERIFIED 2026-10-09.) After a few
  dozen results, an older still is not in the DOM. Scroll the dialog's own scroll container about 600 px at a time
  and search again. Its `<img>` `src` decodes like a feed image. Then dispatch mousedown/up/click/dblclick on it.
- **Do not track jobs by «Generating».** The feed is virtualised, so a queued video card off-screen drops out of
  `innerText`. The status list then looks empty while the job still waits («In queue» / «Explore Mode»). Before
  counting free slots, click «View latest» and scroll to the card.
- **Which `Select` is which.** (LIVE-VERIFIED 2026-10-09.) The Keyframe slots carry `aria-label="Select"` buttons only
  while empty. With the first slot filled, the first `Select` on the page is the LAST frame's, and a pick there
  silently makes a first→last transition. Pick the button by x position. Choosing an asset over a filled slot does
  not replace it: «Remove image» first. Read both slots back by decoding their `background-image`.
- **«Use in video» replaces only the first keyframe.** (LIVE-VERIFIED 2026-10-09.) The aspect switches to the
  image's ratio, but the old last frame stays. If its ratio differs, a «Match the output ratio / crop your image»
  overlay covers that slot. To set a first=last loop:
  1. Dismiss the overlay.
  2. Hover the last slot and click its ✕ («Remove image»).
  3. Click the slot's folder icon. The asset browser opens at the root every time: Sessions → the session.
  4. Double-click the tile whose decoded `src` ends in the wanted `_N.png`. Tiles are newest first.
  5. Read both slots' `background-image` to confirm. They are `<div>`s, not `<img>`s.
- **Upscaling 720p Seedance for a wall (×3.6 blow-up).**
  - SeedVR2 ×2 beat Lanczos and 4x-UltraSharp at 1:1. UltraSharp turned every lamp into a starburst; Lanczos stayed
    mushy.
  - Lanczos had won on clean local-model output at ×1.4. Re-test per source.
  - Keep the clip's tone by taking the low frequencies from a Lanczos ×2.
  - Cost: 70–96 min per 10 s clip at 2952×1252, mostly in the VAE decode. A 49-frame test underestimated it 2–3×.
  - **Shimmer check (LIVE-VERIFIED 2026-10-09).** An upscale changes more from frame to frame than its source: on
    a calm glass drop, 1.5–1.6×. That alone is not flicker, because added detail moves too. Compare per region:
    - Detail = frame − Gaussian σ2. Ratio = mean |Δdetail| between frames / mean |detail|. Measure the upscale
      and a Lanczos ×2 of the source on the same grid.
    - Drop core: 0.50 vs 0.44 and 0.43 vs 0.42 — the change follows the detail.
    - Floor rings: +5–8 %.
    - Dark background: the ratio jumps (0.9 vs 0.2), but the upscale is cleaner there and the absolute step is
      0.3 levels — invisible.
    - Alternating flicker shows as an even/odd step ratio well above 1. Here it was 1.00–1.05.
    - Smooth temporally only when the core ratio clearly exceeds the source's or the even/odd ratio departs from 1.
  - **Static shots boil (LIVE-VERIFIED 2026-10-10).** On a locked-camera time-lapse, SeedVR2 redraws the static
    detail (road, field, plant) a little differently every few frames. Measure the frame-to-frame change of the
    static detail after flow alignment. Values for the static detail:

    | Version | Static change | Sharpness vs Lanczos |
    |---|---|---|
    | Lanczos ×2 | 0.31 | — |
    | Hybrid, 3-frame window | 0.80 | — |
    | 13-frame window + damping of unstable detail | 0.63 | +35 % |
    | Same, SeedVR2 detail weight 0.6 | 0.54 | +12 % |

    - The 13-frame window helps less than its length suggests. SeedVR2 seems to draw detail shared across four
      frames, so the window holds only 3–4 independent samples.
    - On a wall the clip is blown up another ×2.1, and boiling reads worse than softness. For static shots, take
      weight 0.6. If it still boils, plain Lanczos is the honest choice; weight 0.4 gains only ~+8 %.
    - Clips that cut together frame to frame (a time-lapse ending on a loop's frame 0) need the same weight and
      tone. Otherwise the sharpness jumps at the join.
  - **Flat sky: measure each clip and take the calmest source (LIVE-VERIFIED 2026-10-10).** Measure the change
    between frames on the flat sky. With a locked camera, skip the flow alignment there: on textureless sky the
    flow only tracks noise.

    | Clip | Lanczos | Clean SeedVR2 | Hybrid |
    |---|---|---|---|
    | Day, `column_rise_day` | 0.57 | 0.38 | — |
    | Night, `road_dusk_night` | 0.85 | 0.72 | 1.02 |
    | Night, `yar_night_loop` (dark, nearly still sky) | 0.14 | 0.40 | — |

    - By day, SeedVR2 removes the boiling compression grain from the sky.
    - At night, SeedVR2 adds noise to a calm dark sky, and the hybrid is worse than either source.
    - The sky mix therefore takes, per clip, the calmest of SeedVR2, Lanczos and the hybrid. Stars stay in, because
      their twinkle is already part of the measurement.
  - **Pick finished upscales by exact name.** H3's pipeline writes working files next to the result before it
    reports done: `_x2_sv`, `_x2_hyb`, a `_x2_vNN.mp4` that may be a placeholder copy of `_x2_sv`, and
    `_x2_vNN.tavg.mp4` while it is still being written. A glob like `*_x2_v*.mp4` picked the half-written `.tavg`
    once. Match `_x2_v\d+\.mp4$`, and rebuild from a version only after its done message.

## Phygital+ web app and Kling web in the browser pane (LIVE-VERIFIED 2026-10-11)

Used when the user is signed in to app.phygital.plus / kling.ai in the built-in browser. 28 Kling 2.6 transitions were
made this way for an LED show (stills: Nano Banana in Phygital).
- **One project, many nodes.** The user asked not to open a project per job. Put every job in one canvas: two
  Import Files nodes and one Kling node per transition.
- **Adding nodes.** Click a sidebar item (Import Files) and the node appears at the viewport centre. For Kling, type
  «Kling» in the sidebar search and click the first result. Drag a node by its header to move it. The mouse wheel
  pans the canvas vertically, so scroll down to an empty area for the next group.
  - Nodes outside the viewport are not in the DOM. Scroll to them before reading their status.
- **Frames.** «Upload» opens the native file dialog (the dialog helper in the background, then the click). A second
  upload into the same node replaces its file. Wire the Import node's output port (right edge, near the bottom) to
  the Kling node's «Start Frame» / «End Frame» by a drag.
- **Settings.** Dropdowns: click, click «Search options...», type, ArrowDown, Enter. Model v2.6, 10 seconds,
  Professional, sound off costs 1030 credits.
  - Prompt: the native textarea setter plus `input`/`change` events.
  - Run: the node's Generate button.
  - Status text: «Queued...», «Generating N%», «Successful». A job took 5-7 min, and several ran at once.
- **Originals.** The node plays a `blob:` URL. Its «Full Quality» button fetches
  `phygital-plus-prod.s3.amazonaws.com/results/user/<uid>/<obj_id>.mp4`.
  - Wrap `window.fetch` to catch that id.
  - Then GET `app-server.phygital.plus/api/v2/storage-object/download-link?obj_id=<id>` with `credentials: 'include'`.
    The response is `{file_name, download_link}`; download the signed link with urllib.
  - Image previews are `previews/user/<uid>/<obj_id>/<preview_id>.webp`: the folder number is the original's id.
  - The Full Quality viewer closes only with a real Escape key (the tool's key action), not a dispatched
    `KeyboardEvent`. While it is open the canvas does not scroll.
- **Kling web (kling.ai), VIDEO 2.6.** Start and end frames, 1080p, 10 s, no audio cost 50 credits.
  - The feeds API needs a signed `__NS_hxfalcon`, so take results from the resource-timing entries:
    `v15-kling.klingai.com/bs2/upload-ylab-stunt-sgp/<base>-output.mp4?x-kcdn-pid=112372`.
  - Without `_multi_bitrate…` the base downloads the original (1920×1080, 10.08 s, 242 frames at 24 fps).
  - The entries get cleared, so save the URLs as they appear.
  - The player is MediaSource, so tell clips apart by NCC of their first and last frames against the keys.
- **Kling 2.6 holds both keyframes.** First and last frames scored NCC 0.999-1.0 against their keys, so chains join
  frame into frame.
  - Sharpness can still jump at a seam inside Kling's own output: K1→K2 +11 %, K11→K12 -12 %.
  - The fix was a 12-frame ramp of high-frequency detail on each side of the seam, done by the upscaling session.
    Lanczos ×2 adds no jump of its own.
- **Native file chooser in the browser pane.**
  - It opens only from the fronted tab: `tabs_select` first.
  - The first click after switching tabs may only focus the page. Leave the dialog filler waiting and click
    «Upload» again.
- **Runway Unlimited jobs the user starts.** Prepare the tab completely, and the user presses Generate (quirk:
  autoclicker warning):
  - Keyframe tab, both slots filled through the dialog helper;
  - prompt typed;
  - Duration slider at 10 s, 720p, audio off;
  - the Unlimited toggle checked.
  Two such jobs sat «In queue» for over an hour at 04:30-05:30 MSK.

## Kling 3.0 in Runway and Phygital, many jobs at once (LIVE-VERIFIED 2026-10-12)

39 transitions and loops for one build (an LED show, 2026-10-12): Kling 3.0 Pro in Runway, the remainder in Phygital.
- **Runway, Kling 3.0 Pro.** 12 credits per second. Durations 3-15 s: the slider's index 0 is 3 s; from the default,
  7 s is 2 ArrowRight presses and 10 s is 5. Output 1920×1080 or 1080×1920.
  - Unlimited mode offers Kling 3.0 Pro too, free and at 1080p. Its queue is marked «THROTTLED»: about 15-20 min
    per job.
- **The mode can be wrong although it looks right.** Several tabs were prepared in parallel and showed Unlimited.
  Some of them submitted in Credits: 336 credits were spent.
  - Before every Generate, open the credit popover and switch Credits → Unlimited explicitly, even when Unlimited
    looks selected.
  - After submitting, check the job through the API: a free job has `options.exploreMode: true`.
- **The API from page JS** (signed in). Send the header `Authorization: Bearer ` + `localStorage.RW_USER_TOKEN`.
  - `GET https://api.runwayml.com/v1/tasks?limit=30&asTeamId=<team>` gives status, options and artifacts.
  - `GET https://api.runwayml.com/v1/sessions/<session>/assets?asTeamId=<team>` lists every result of a session,
    with cursor paging.
  - Before the user cleans the project, compare that list with the files on disk (377 of 377 here).
- **The browser pane holds at most 9 tabs.** Prepare Runway jobs in rounds of up to 9 tabs, one job per tab.
  - A closed tab's id stops working; reopen the page with `preview_start {url}`.
  - Stop any dialog filler that was waiting for a closed tab.
- **Signed URLs without retyping.** Retyping a 400-character signed URL corrupts it. Print
  `JSON.stringify([[name, url], ...])` from page JS instead.
  - A project script then reads the pairs back from the session transcript (`.jsonl`). It takes the FIRST
    `tool_result` line that contains a marker substring; later lines are the commands that quote it. It unescapes
    `\"` and downloads with urllib.
- **Phygital's Kling node now defaults to model v3.** Settings: Aspect, Duration 3-10 s, Mode
  Standard / Professional / 4K, Sound.
  - v3 Professional costs 1,245 credits for 10 s and 1,105 for 7 s (v2.6 Professional, 10 s: 1,030).
  - Check the user's floor balance before a batch.
  - The zoom menu, bottom right, has Zoom in, Zoom out and Zoom to fit.
  - At «to fit» the node headers are small. Click empty canvas first to deselect, then drag from the exact header
    coordinates; otherwise one drag moves every selected node.
- **Kling 3.0 holds both keys closely.** A chain of two 9:16 clips, emblem → black drop → glass drop:
  - first against last frame at the join: mean absolute difference 2.3 levels of 255;
  - last frame against its key: 3.3 levels.
  - A 0.2 s dissolve at the join and 0.7 s into the loop hid both.

## Phygital+ MCP server — the official way to generate in Phygital (set up 2026-10-19)

Phygital+ publishes an MCP server for agents (docs: https://dev.phygital.plus/mcp). It replaces every scripted route
into Phygital: the browser-pane clicks that got the account banned on 13.10, and the local sidecar at the top of this
file.
- **Server.** `https://dev.phygital.plus/api/mcp`, Streamable HTTP. Added at user scope with
  `claude mcp add --transport http --scope user phygital https://dev.phygital.plus/api/mcp`. LIVE-VERIFIED: it lists as
  «Needs authentication» until the user signs in, then `claude mcp get phygital` shows «✔ Connected».
  - The session that added the server does not get its tools.
  - A headless `claude -p` probe from the npm CLI failed with «OAuth session expired»: the CLI's own Claude login is
    separate from the desktop app's.
  - Test the tools in a new session.
- **Auth.** The user signs in once with OAuth in the browser: `claude mcp login phygital`, or `/mcp` → phygital →
  Authenticate.
  - Scopes: `tasks:read`, `tasks:write` (spends credits), `files:write`, `projects:read`, `frames:run`.
  - `offline_access` is a refresh token. Without it the sign-in expires after about 30 min.
  - Alternative: a personal API key as `Authorization: Bearer <key>`. The user puts it into the config; never type it.
  - A session loads its MCP servers when it starts, so a server added mid-session appears in the next session.
- **Tools.**
  - `list_models(category?)`: the models available to the account.
  - `get_model_schema(model)`: the JSON Schema of the inputs and parameters.
  - `generate(model, input)` → `jobId`. Credits are charged here.
  - `get_job(jobId)`: queued / running / completed, plus links to the results.
  - `cancel_job(jobId)`: refunds; free on a queued job.
  - Uploads:
    - `upload_file(filename, mime_type, data_base64)` → `storage_object_id`;
    - `start_upload` / `upload_chunk` / `finish_upload` for bigger files (2 MB chunks);
    - `get_upload_url` for a plain POST;
    - `request_upload` / `claim_upload` when the person attaches the file in the chat.
- **Flow.** `list_models` → `get_model_schema` → show model, settings and credits, get a yes → `generate` → `get_job`
  → download the result links into the project folder → import into AE.
  - A file input takes a public URL or a `storage_object_id`, e.g. `"init_img": [501]`.
  - No cost-preview tool is listed. On first use, check whether `get_model_schema` carries the price. If it does not,
    quote the Phygital+ price list as an estimate before `generate`.
- **Errors.**
  - 401: no sign-in, or it expired or was revoked; sign in again.
  - 402: not enough credits.
  - 422: the input does not match the schema; re-read `get_model_schema`.
  - 429: back off.
  - «Missing scope»: re-authorise and approve that right.
- **Still forbidden:** clicks or page JS in app.phygital.plus, and scripted calls to the web app's own API. Downloading
  the result links that `get_job` returns is part of the official flow.
- **LIVE-VERIFIED 2026-10-23** (16 UI screenshots for a product promo):
  - The `get_upload_url` ticket is valid for 180 s and takes several files: `curl -F file=@x.jpg -F ticket=… <url>`.
    15 JPEGs went up with one ticket in a shell loop, and none of their bytes passed through the agent's context.
  - Image models: `upscale` (no parameters), `magnific`, `topazlabs-image`, plus generators (gemini-image = Nano
    Banana, flux, gptimage, seedream, recraft, ideogram…). Neither `get_model_schema` nor `get_job` shows a price.
  - For **UI screenshots** use `topazlabs-image` with `model: enhance_text_refine`, `multiplier: multiple_2`,
    `fix_compression 0.6`, `sharpen 0.3`, `denoise 0.3`. 1525×784 JPEG became 3050×1568 PNG. Cyrillic and Latin text came back
    letter-for-letter, JPEG blocks were gone, and strokes came out a little lighter than the source.
  - Jobs finish in 20–60 s; the schema's `averageTimeInSeconds: 600` is a ceiling.
  - Compare crops of the result with a Lanczos ×2 of the source before using it: an upscaler can redraw small text.
  - Stay at ×2 for UI. A `multiple_4` test (6100 px) gave slightly crisper text, but it turned a 1 px dashed border into a
    solid line; ×2 kept the dashes. Above 2× magnification, render the film larger rather than upscaling further.
    An upscale is visible only where the film draws the shot larger than its original pixels (ae-quirks 276).
  - After the upscale, clean the shots in Python. Find stray mouse pointers as black connected blobs of 6–24 px. Repaint each
    by copying the same rows from a few pixels aside (lines stay continuous), or by filling with the median of a ring
    around it on flat areas. A ring fill on a two-tone area leaves a visible patch.

## Higgsfield CLI — the official way to generate from Claude Code (LIVE-VERIFIED 2026-10-13)

Phygital banned the account after a night of browser-scripted generations (its Terms 6.2(h) forbid automated access),
and Runway warns about «autoclickers». Higgsfield ships an official CLI for agents, so generation runs from the shell
with no browser automation at all.
- Setup: `npm i -g @higgsfield/cli`, then `higgsfield auth login` (OAuth in the browser; the user approves), then
  `higgsfield workspace list` and `higgsfield workspace set <id>`. Every other command fails with «No workspace
  selected» until a workspace is set.
- `higgsfield account status` shows the plan and the credits. `higgsfield model list --video|--image` lists models;
  `higgsfield model get <job_type>` lists the parameters.
- Cost before spending: `higgsfield generate cost <model> --prompt x [--param v]`. Measured on Plus:
  - `kling3_0` pro, 10 s, sound off: 15 credits (5 s: 7.5; std 10 s: 12.5; 4k 10 s: 60);
  - `kling3_0_turbo` 1080p 10 s: 20; `seedance_2_5` 1080p 10 s: 120;
  - `nano_banana_pro` 2k: 2 credits, 4k: 4.
  - 2026-10-18, same plan: `kling3_0` pro 15 s: 22.5; `minimax_h3` (2K) 5 s: 10, 10 s: 20; `seedance_2_0` 10 s: 45;
    `seedance_2_0_mini` 720p 10 s: 10; `wan3_0` 1080p 10 s: 35; `veo3_1_lite` 8 s: 12;
  - images: `nano_banana_pro` 1k costs the same as 2k (2); `nano_banana_2_1` 2k: 2, 4k: 3; `gpt_image_2_5` 2k high: 2.75;
    `seedream_v5_pro` 2k: 2.5;
  - `higgsfield account transactions` lists spends and refunds only, no subscription grants: the CLI does not show
    when the plan refills.
- Create: `higgsfield generate create kling3_0 --prompt "…" --start-image ./a.png --end-image ./b.png --duration 10
  --mode pro --sound off --aspect_ratio 16:9 --json` prints the job id. Local paths are uploaded automatically.
  `--image-references` (repeatable) gives Nano Banana Pro up to 14 references.
- `higgsfield generate wait <job_id> --json` blocks until done; `result_url` is the original file (PNG / MP4) on a
  CDN, downloadable with urllib.
- Plus runs up to 6 videos and 8 images in parallel. 39 Kling clips (10 s) took ~15 min wall time in one batch.
- Windows: the CLI is an npm shim `higgsfield.CMD`. Python's `subprocess.run(['higgsfield', …])` fails with
  WinError 2; resolve it with `shutil.which('higgsfield')`.
- A small batch runner over a JSON spec list pays off at once: parallel jobs, job ids kept in `<spec>.log.json` (a rerun
  waits on a submitted job instead of paying again) and downloads into the spec's `out`.

**Nano Banana Pro and superhero archetypes** (2026-10-18).
- «A lone caped hero seen from behind on a rooftop at night», even with «no pointed mask ears, does not resemble any
  existing superhero», drew Batman: a cowl with ears and a utility belt. It also drew the Empire State Building.
- Negations do not override an archetype that the scene itself calls for. Describe a different costume in positive
  terms: its colours, armour plates, a bare head with hair, a narrow eye mask. The next roll gave an original hero.
- Real landmarks (Empire State, Chrysler, rooftop water tanks) came back despite «no real landmarks». Give a generated
  city as an image reference for every later panel.
- The city reference is not enough by itself. In a batch of 12 panels with the generated city as reference 2:
  - the Empire State, the Chrysler and water tanks still appeared behind a close-up hero;
  - «a tall skyscraper with a needle spire» became One World Trade Center.
  For a close-up, name the background («only storm clouds and lightning behind»). Do not ask for an archetypal tower.
- «One full-bleed panel, no border, no gutters» still produced a two-panel strip once in 12. A paper margin with a frame
  line appeared three times. Plan a crop in the edit and do not reroll for a frame.
- A «redraw reference 2 in the style of reference 1, keep the exact composition» state held the layout of a 21:9 master
  closely enough to dissolve into it. Its look sat between a comic and a posterised photo.

**Video for a 3:1 wall** (five screens flush, 9×3 m).
- Kling 3.0 only takes 16:9, 9:16 or 1:1.
- 21:9 options:
  - MiniMax H3 at 2K: 20 credits for 10 s;
  - FLUX 3 Video: 80–130;
  - Seedance 2.0: 45 (720p by default).
- Nano Banana Pro output sizes:
  - 21:9 at 4K returns 6336×2688; a 3:1 crop keeps rows 288–2400;
  - 16:9 at 2K returns 2752×1536.

## Generated motion that the client reads as «boomerang» / «telescope» / «slop» (LED show, 2026-10-13)

- **A clip generated as a transition between two different stills tends to reverse.** The model has to land in a
  composition it was not heading to, so the camera, the liquid or the pipes turn back halfway. The client called it
  «бумеранг» and «нефть течёт обратно». Generate one shot = one camera move from a single start frame; give an end
  frame only when it is the same composition (a 2D blueprint growing into its 3D model, the same plant in other light).
- Join shots with short dissolves on music phrases, not with forced end frames.
- **Screen every clip before the edit:** Farneback optical flow on a small grey copy, 1 s means of (dx, dy) and of
  the radial component. Flag a reversal when two 1 s means point against each other (dot < −0.5·|a||b|) inside one
  shot, «telescope» when the radial expansion stays high for 4+ s, «stop» when the motion dies at the end.
  A script that prints the flags next to a 5-frame strip per clip is enough.
- Keep lateral moves in one screen direction across a sequence; mirror a clip (`Scale −x`) when it runs the other way.
- **Two consecutive shots of the same object must move the same way.** A 2D→3D growth that drifts right, followed by
  an orbit of the same model that drifts left, reads as one shot bouncing back, even with a dissolve between them;
  so does a dissolve from the orbit's turned view back to the straight still it started from. Measure the mean
  horizontal flow of the last 2 s of one clip and the first 2 s of the next before editing. Mirroring cannot fix it
  when the join is a matched frame (the plant would flip); generate the next shot in the right direction instead.
  In Kling, «the camera orbits to the right» made the content drift left; «orbits to the left, so the model glides
  from left to right» drifted right (2 of 2 tries in the direction asked, one with an odd foreground shape).
- **A stage photo as a reference makes the model draw a stage.** Asked for «an engineering stage environment like the
  reference» (a photo of a set with an LED wall and light arches), Nano Banana drew a rectangular screen with the plant on
  it inside the scene; the client saw it at once («это же прям экран»). For screen content say «full-bleed background
  artwork for LED screens, not a photo of a stage: no screens, no panels, no frames, no rectangles in the picture».
- **Kling, a living loop inside a still object** (light swirling inside a drop, 2026-10-13):
  - start = end = the same frame: the motion lasted ~4 s and the rest of the 10 s clip was frozen;
  - start frame only, «flows continuously from the first to the last second»: it moved all 10 s, but the swirl grew
    out of nothing over the first ~4 s. Loop the later part only: clip time S0..end, the tail crossfaded 1 s into its
    head (two layers, time remap `S0 + (time % L) * f` and `S0 + Lc + (time % L) * f` with a fading opacity), slowed
    with Frame Mix to the loop length;
  - check the object does not drift: compare the outline's x on one row in the first and last frame (here 0–4 px).
- Land a camera move instead of dissolving away from it: an ease-out time remap to the clip's last frame, then hold
  that frame (a slow push on Scale keeps it alive), e.g. Time Remap
  `var u = Math.min(1, Math.max(0, (time - t0) / T)); last * (1 - (1 - u) * (1 - u));`
  It starts at 2·last/T clip-seconds per second; pick T to match the speed of the clip before it.
- Two clips from one still read as a repeat even when the moves differ. The client counts that as «повтор кадров».
- Generated night views of a real plant: start from the client's own photos (or Nano Banana night versions of their
  day photos) — the generator then keeps the real plant instead of inventing spherical tanks.
- **But the real plant has red obstruction lights** (a row up every tall stack, one on each column top), and Kling
  makes some of them blink. A note «убрать красные маячки» is not done by switching to the client's photos: scan every
  clip for small, saturated red spots before the edit (R > 140, R > 2.2 G and > 2.2 B,
  per sampled frame, with a strip of the reddest frames).
- **Removing them without blotches** — Change Color / a hue key over the frame also caught the steam and the lamp
  halos. Per pixel in Python works (a Python pass, ProRes out, swapped in with `replaceSource`):
  - red means OpenCV hue <= 4 or >= 172 (<= 8° / >= 344°); sodium lamps and the steam they light sit at 12–40° and
    stay out;
  - keep small connected spots only (<= 2500 px at 1080p), so painted red — the stripes of a stack, red steelwork —
    stays; a big glow counts only when it touches a light's pinkish-white core (V >= 230), within ~110 px
    (~300 px and a lower V floor for a long red-lit steam plume);
  - the glow and halo must be redder than the surroundings (red chroma minus its 60 px blur > 18), or a pink evening
    sky round a stack turns into an olive disc;
  - recolour, do not erase: hue to the lamps' amber (~34°), saturation ×0.85, value kept. The beacon becomes one more
    plant lamp, and nothing has to be inpainted.
  - Check with a difference map (changed pixels in green over the dimmed frame) at 3–4 times per clip.
- Kling 3.0 clips are not always 1920×1080: from some start frames they come out 1928×1076. Read the size with
  ffprobe before cropping or tiling them.
