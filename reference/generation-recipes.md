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

## Review generated motion

Inspect the output for changes in silhouette, subject identity, apparent speed and loop phase.
Use a low-cost draft to validate the motion before rendering a final. Check the first and last
frames against the placement and the action that precedes or follows them.

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
- **Upscaling.** Compare against a standard resample. Use modest upscaling for screenshots
  and inspect small text and thin dashed lines. If an upscaler returns opaque RGB, process
  alpha separately and check the recomposite against the intended background.
- **Speech.** Read the current `elevenlabs-tts` schema for voice, model, seed and continuity
  controls. Write product names as they should be spoken. Listen to the output and compare a
  transcript with the script. Add longer scene pauses in the edit at verified quiet gaps.

## Higgsfield CLI

- Setup: `npm i -g @higgsfield/cli`, then `higgsfield auth login` (OAuth in the browser; the user approves), then
  `higgsfield workspace list` and `higgsfield workspace set <id>`. Every other command fails with «No workspace
  selected» until a workspace is set.
- `higgsfield account status` shows the plan and the credits. `higgsfield model list --video|--image` lists models;
  `higgsfield model get <job_type>` lists the parameters.
- Run `higgsfield generate cost <model> --prompt x [--param v]` with the intended settings before spending.
- Create: `higgsfield generate create kling3_0 --prompt "…" --start-image ./a.png --end-image ./b.png --duration 10
  --mode pro --sound off --aspect_ratio 16:9 --json` prints the job id. Local paths are uploaded automatically.
  `--image-references` (repeatable) gives Nano Banana Pro up to 14 references.
- `higgsfield generate wait <job_id> --json` blocks until done; `result_url` is the original file (PNG / MP4) on a
  CDN, downloadable with urllib.
- Windows: the CLI is an npm shim `higgsfield.CMD`. Python's `subprocess.run(['higgsfield', …])` fails with
  WinError 2; resolve it with `shutil.which('higgsfield')`.
- A small batch runner over a JSON spec list pays off at once: parallel jobs, job ids kept in `<spec>.log.json` (a rerun
  waits on a submitted job instead of paying again) and downloads into the spec's `out`.

## Kling browser workflow: submission, downloads and tool contact (LIVE-VERIFIED, 2026-11-10)

Applies when the user explicitly chooses the logged-in Kling browser workflow. This is
not authorization to switch providers, upload unrelated files or spend unapproved credits.

| Symptom / wrong assumption | Verified handling |
|---|---|
| The visible Generate price immediately after filling a prompt means the prompt is ready. | Prompt analysis may still be running. A click can yield “Analyzing prompt…” without submitting. Check for new job cards matching the prompt or a submission confirmation before navigating away. If a wait times out, inspect the job list before retrying a paid action. |
| Every click on Generate is a paid job. | Record accepted job cards, output count and the quoted price. In the verified run, two analysis-only clicks created no jobs and were excluded from the ledger. Keep local spending distinct from account-wide balance. |
| Downloading a generated image URL preserves a usable Windows filename. | Some text-to-image asset names exceed Windows filename limits. Kling’s native Download control produced short filenames and completed successfully. Wait for the download event, retain its handle, continue independent work, then resolve its local path. Avoid blocking on every large download immediately. |
| “2K / 16:9” guarantees 2560×1440 or a clean export. | Native Image 3.0 PNG exports in this run were 2720×1536 and had a small Kling mark. Inspect actual dimensions and export content. Label approval material accurately; do not assume final delivery suitability. |
| Describing a hammer and punch in more detail fixes mechanical contact. | Several text-only generations placed the tools incorrectly. A pose reference showing hand → punch → metal and hammer → exposed punch head produced a usable candidate. Inspect both contact points and the grip before animating impacts. |
| Any metalworking image is a suitable reference for all craft scenes. | An engraving reference biased a chasing scene back to engraving. Separate material/style references from mechanical pose references. |
| Repeating “no base” reliably creates a floating open ribbon. | Generations still added pedestals, a floor or forked ends. Composing the middle of a continuous band with both ends outside the frame produced one usable floating variant; review its paired alternative because the other still had a floor. |

For image approval, save selected original exports, their creation URLs, a timed contact
sheet and the accepted-job ledger. Keep motion generation at the user’s requested approval
checkpoint. A still frame proves the image choice, not fluid deformation, topology stability,
sound synchronisation or a seamless transition; those need a short video test.

### Paid-video preflight and reference attachment (LIVE-VERIFIED, 2026-11-10)

- Set resolution/duration while the prompt is empty. In the narrow Kling panel, the settings label extended underneath Generate; clicking its DOM centre submitted an extra paid job. The visible settings icon, located from a fresh screenshot, opened the correct panel. Re-check the displayed price after changing parameters.
- Navigation to another creation group reset duration to 5 seconds while retaining 1080p. Do not infer duration from the last job.
- A drag into First frame can silently leave the slot empty. Two accepted jobs had no reference thumbnails and generated a different design. A successful drag from a clearly visible image produced a slot thumbnail plus “replace material”; compare that thumbnail's asset identity with the intended image before submitting. Price alone does not distinguish text-only from image-conditioned video. Occlusion was suspected, not established as the cause of the failed drags.
- Verify the accepted job also shows the reference thumbnail. The corrected jobs passed this check and their first frames matched the selected artwork. Record rejected jobs as spent; never hide retries from the agreed budget.
- On this logged-in account, native Download produced a marked export, whereas the already visible player media offered a clean original through the documented media-download capability. Inspect the actual output; use only assets exposed by the authorised session, without changing URLs, removing marks or assuming other accounts have the same export options.
- A stale browser binding reported browser.user unavailable. Listing tabs in the already selected browser and binding the known tab ID restored access; resetting the runtime or switching browsers was unnecessary.

### Craft mechanics: review stills and motion separately (CLIENT FEEDBACK + STILL TEST, 2026-11-11)

The v05 craft video was technically valid and its text animation was accepted, but the user rejected physical continuity: hammer blur, chip/cloth direction and object placement. Prior still approval was not evidence of believable motion.

- Separate setup, generation and edit failures. Check tool grip, supported workpiece, exposed strike head and both contacts in the still; inspect the raw clip at native speed before blaming or changing the AE retime. Frame-count/decode/audio checks do not establish visual or mechanical quality.
- For hand operations, use one explicit screen-space direction and one small action. A graver, hand and palm handle move as a unit; the chip originates at the cutting face. A compact polishing cloth remains under the same pressing fingers while the workpiece stays fixed. A hammer's rigid face meets the exposed punch head; inspect approach/contact/rebound individually.
- Distinguish style/material references from mechanical pose. In this revision GPT Image supplied seven candidate stills; an initially invented ball on the punch tip was corrected with a targeted edit while preserving the strike axis and hands. These are still candidates, not a validated video recipe. New Kling motion tests were pending when this note was written.
- Avoid forcing unrelated physical materials into a transition (cloth becoming metal). Match a highlight or direction in the edit, then cut into the separate abstract shot. One start image per craft motion test avoids steering toward an incompatible end image.
- User-selected split for this project: built-in GPT Image for stills, logged-in Kling for animation, AE for assembly. This does not authorize changing providers in unrelated projects or exceeding an approved cap.
- Test failure-prone actions individually before finals and preserve rejected outputs/costs. Successful static correction does not justify spending the remainder before raw-motion review.

Browser recovery follow-up: listing/rebinding the known tab still failed with browser.user unavailable. Resetting cua_repl and re-binding the same existing IAB tab restored access without navigation or switching browsers. Use only after ordinary documented re-binding fails; not every stale-tab error requires a reset.


### v06 raw-motion follow-up (LIVE-REVIEWED, 2026-11-11)

- The 5-second macro test initially retained the chip but lost it near the tail. The 10-second final used the same 4 mm travel over twice the duration plus an explicitly persistent attached shaving; sampled final frames retained the chip and correct leftward tool motion. This is a successful shot-specific correction, not a guarantee from prompt wording.
- Compact cloth beneath fingertips, with one leftward pass and a secured plate, gave coherent raw motion in both the 720p test and 1080p final. Avoid a free trailing fabric end when the required action is surface polishing.
- The hammer test retained rigid geometry and correct upper/lower contacts, but had brief fast-stroke blur and some prolonged contact. Tighten the final to brief contact/immediate rebound, modest travel and crisp shutter; inspect the final again. Requested tap count did not reliably match the actual clip; derive musical sync from observed contacts.
- The requested 1080p/16:9 image-conditioned finals exported as 1916x1080 at 24 fps, with 241 frames for 10 seconds and 361 for 15. Fit proportionally into 1920x1080 rather than assuming exact source dimensions or frame rate.
- In a narrow IAB panel after opening/closing media, First frame could have a negative left coordinate and clicks did not open its menu. Read its DOM bounds, leave the empty form safe, and reload the same project to restore the layout. Reload reset duration to 5 seconds; re-check resolution, duration, reference filename and quoted price before any paid submission.
- Maintain accepted-job spend independently of the account-wide credit balance. v06 main jobs and tests accepted at 1325/1500; reserve is not spent until a retry is actually accepted.


### Deformation-driven ribbon and loop review (LIVE-REVIEWED, 2026-11-11)

- Asking for a travelling wave still produced too much global rotation in the first hero clip. A retry specified a fixed centre/global orientation and a staged outline change (tall oval → broad oval → saddle → return). The resulting clip visibly changed silhouette. Prompt constraints alone do not prove Mobius topology; inspect folds/occlusions separately.
- A numerically similar first/last-frame pair still doubled the bright metallic edge when crossfaded. Check the rendered seam, not only a frame similarity score. For this abstract ribbon, a single source played forward/back with eased zero velocity at turns removed the overlap ghost. This treatment is inappropriate for irreversible craft actions such as cutting.
- Retain the rejected generation and count it as spent. Here the additional 150-credit deformation retry brought accepted v06 spend to 1475/1500; the last 25 were unused.


### Sound-driven shot selection: semantic cues before still generation (2026-11-11)

- Numeric waveform attacks do not identify the operation being heard. In this session audio input was explicitly unsupported; do not claim to have listened based on onset/RMS analysis. Ask for the smallest missing semantic cue while completing independent visual work. The user's answer (drilling, impacts, grinding) supplied the sound categories; measured attacks supplied candidate alignment times, not labels.
- A beautiful static object cannot substitute for the requested audible work. Two silver-plate beauty frames were rejected before Kling; they were retained under rejected_static_plates and consumed no Kling credits. New GPT Image candidates showed a supported/clamped workpiece and a clear tool contact for drilling, abrasive finishing and chasing. Their still mechanics were inspected; animated mechanics remained unverified pending approval.
- Treat image choice, shot chronology and generation cap as distinct approval fields. Carry forward an existing cap but do not infer new spending from account balance or from approval of an earlier storyboard. With 1475/1500 spent, a new 700-credit proposal remained unapproved and no new job was submitted. Live UI quoted 150 for Kling 4.0 Keyframes 1080p/10s/one output.


### v07 manual drilling and strike-cadence limits (LIVE-REVIEWED, 2026-11-11)

- A request for careful manual drilling is a mechanical constraint, not only a slower powered drill. Replace the bench drill still with a hand pin vise before animation. In this run, 5-second test and sampled 10-second final retained a straight planted bit, small finger regrips and the clamped workpiece.
- A 5-second test does not guarantee the cadence of a 10-second final. Chasing C09 requested six controlled taps but produced rapid repeated hammering with excessive lift and native blur. Retain it as rejected, count its full cost and inspect the retry separately. Do not label a new prompt a successful recipe before its output is reviewed.
- For impacts, inspect all source frames around approach/contact/rebound. A hammer template matched incorrectly when the head left the frame; template peaks were not reliable contact evidence. Use a labelled crop grid and derive musical remap keys from observed contacts. Avoid Pixel Motion on hammer contacts; keep that option scoped to slow, stable abstract surfaces when separately checked.
- Source exports in this run were 1284x724 for the 720p tests and 1916x1080 for the 1080p finals, both 24 fps. Do not inherit output dimensions or tap counts from the UI setting or prompt.


v07 retry follow-up: C09R produced slower separated approaches with coherent rigid tools, but held the hammer on the punch too long. The edit selected observed contacts at source frames16,85,145 (24fps), mapped them to37,39,41 seconds, and compressed each near-static contact hold to two output frames before rebound. The unused fourth tap stayed outside the cut. This correction used monotonic AE Time Remap with no Pixel Motion; the final render still required visual contact review. Additional spend ended at700/700 including the rejected150-credit C09 and150-credit retry.
