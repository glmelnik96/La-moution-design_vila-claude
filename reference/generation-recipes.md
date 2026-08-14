# Generation recipes (sidecar)

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
