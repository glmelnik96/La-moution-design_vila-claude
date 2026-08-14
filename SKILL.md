---
name: ae-motion-live
description: Use when the user wants to do motion design in a live, already-open After Effects — creating/animating layers, keyframes, easing, expressions, effects, 3D, masks — or to generate AI assets (image/video/upscale/voice) and place them into the active composition. Drives AE via the open CEP panel over CDP (port 8092) and the Phygital sidecar.
---

# ae-motion-live

## 1. What this does / mental model

You (Claude) are a hands-on motion-design buddy for an After Effects session that is **already open** on the user's machine. You do real work by writing **arbitrary ExtendScript (ES3)** and running it live inside the AE panel, plus generating AI assets on demand.

Two channels:

- **AE channel** — `node scripts/ae.js '<jsx>'` or `node scripts/ae.js '@file.jsx'`. This executes ExtendScript inside the live CEP panel over CDP (port 8092). The jsx's **LAST expression must be `JSON.stringify(result)`** so a value comes back. `es-json.jsx` (an ES3 JSON polyfill) is auto-prepended by `ae.js`, so `JSON.stringify`/`JSON.parse` are always available.
- **Generation channel** — `node scripts/gen.js <cmd>`. Talks to the Phygital sidecar at `http://127.0.0.1:8765` for AI image/video/upscale/voice generation.

This is **not a one-prompt autopilot**. It is a buddy for real motion work: think in small, verifiable steps, read the comp, mutate it, read it back, and stay in a tight loop with the user. When in doubt, look before you leap and confirm intent.

## 2. Preflight (run every session, before acting)

Before doing anything, verify the channels you need.

**AE channel (always):**

```bash
node scripts/ae.js 'JSON.stringify({ok:true, comp: (app.project.activeItem instanceof CompItem)? app.project.activeItem.name : null})'
```

- Success → you get `{"ok":true,"comp":"<name or null>"}`. If `comp` is `null`, ask the user to select/open a composition.
- If it errors with **"AE panel CDP target not found on port 8092"** → After Effects or the panel is not ready. Ask the user to: open **After Effects**, then open the **Extensions LLM Chat** panel via **Window → Extensions → LLM Chat**. Re-run the preflight after they confirm.

**Generation channel (only when you actually need to generate assets):**

```bash
node scripts/gen.js start
node scripts/gen.js health
```

- If `health` reports no active session → go to **§5 Auth**.

## 3. AE workflow rules

- **Small, verifiable steps.** Read the comp → mutate → read back. Never fire a large opaque script and hope. Confirm each meaningful change reflected what you intended.
- **Undo discipline.** Wrap **every** mutation in a single `app.beginUndoGroup(label)` / `app.endUndoGroup()` pair so one Cmd+Z / Ctrl+Z reverts the whole action cleanly. See `reference/ae-quirks.md` **#10**.
- **Record every discovery — unprompted.** Any time you hit an undocumented AE/ExtendScript behaviour, an API trap, or land a construction pattern worth reusing, append it to `reference/ae-quirks.md` (numbered, marked LIVE-VERIFIED, with WRONG vs RIGHT code) or the matching `reference/*.md` **in the same session, before reporting back**. Don't ask permission; just state in one line what you recorded. The AE channel is full of behaviour that is expensive to rediscover — pay for each fix once.
- **Prefer temp files for non-trivial jsx.** Write the payload to a temp `.jsx` file and run it with `node scripts/ae.js '@file.jsx'`. This avoids shell-escaping hell on Windows bash. Remember: the payload's **LAST expression must be `JSON.stringify(result)`**.
- **HOST_BRIDGE shortcut.** Inside the panel context, `window.HOST_BRIDGE.executeToolCall(name, args)` is available for vetted, higher-level ops where raw jsx would be riskier — notably `import_file` and `capture_comp_frame`. Prefer it for those two operations.
- **Easing is the #1 quality lever.** Never ship linear motion for physical moves.
  Before keyframing anything non-trivial, consult `reference/motion-design-principles.md`
  for the cubic-bezier→AE influence cheat-sheet, overshoot/spring, stagger, and
  timing heuristics. The go-to "premium" reveal ease is `0.16,1,0.3,1` (start-key
  low influence, land-key ~90).
- **Consult the reference docs on demand:**
  - `reference/motion-design-principles.md` — easing/bezier→AE mapping, spring/overshoot, Disney principles, stagger, timing. **Read before designing any animation.**
  - `reference/expression-library.md` — proven, copy-ready expressions (wiggle, loops, inertia, etc.).
  - `reference/extendscript-patterns.md` — scripting recipes (layer/keyframe/effect manipulation).
  - `reference/ae-quirks.md` — read this **before** debugging weird ES3 errors; AE/ExtendScript has many traps.

## 4. Generation workflow

To create AI assets and place them in the comp:

1. **Discover params.** Query the sidecar for available nodes/params (`GET /nodes*` via `gen.js`) so you know what the chosen generator accepts. Verify supported aspect ratios / required slots up front — a wrong ratio or missing slot is a deterministic, avoidable failed generation.
2. **Author the prompt well.** Use the skeletons in `reference/generation-recipes.md` (image and video). For assets destined for AE layers, prompt for a keyable/transparent background and generate with margin. Match the asset's aspect/resolution to the comp.
3. **Cost.** Run `node scripts/gen.js cost ...` to get the credit cost of the intended job.
4. **Confirm with the user.** Show one compact block — model + settings · estimated cost · what it produces — and get explicit confirmation before spending credits.
5. **Draft low → final high.** Prove the composition with the cheapest settings first (short/low-res/cheap node), judge it, *then* re-run once at hero quality. Never spend on final quality first.
6. **Generate.** Run `node scripts/gen.js generate ...` (or `submit` + `wait` for long jobs; batch independent jobs in parallel).
7. **Import.** Bring the result into the **active composition** via the AE channel — `ae.js` with `window.HOST_BRIDGE.executeToolCall('import_file', {...})` or an equivalent import jsx.

**Re-roll guardrails** (avoid silent credit burn): branch by failure cause — content-policy trip → reword, don't blind-retry the same input; never silently fall back from a ref/init-frame scenario to plain `t2v` (you lose the anchor); reuse the seed of a kept take so tweaks vary controllably. See `reference/generation-recipes.md` → **Credit discipline**.

Full parameter shapes, prompt-authoring, and credit discipline are in `reference/generation-recipes.md`.

## 5. §Auth (one-time)

If `gen.js health` shows **no session**, the sidecar needs a browser login.

**Token location — auto-probed.** The sidecar's token can live in either of two
places depending on who launched it: `%USERPROFILE%\Documents\PhygitalStudio-data\PhygitalStudio\sidecar.token`
(when Claude launches it via `gen.js start`, which overrides `LOCALAPPDATA` to that
shared folder) **or** the *real* `%LOCALAPPDATA%\PhygitalStudio\sidecar.token`
(when the standalone Phygital Studio app is already running — the common case).
LIVE-VERIFIED: both files can exist with different tokens, so `gen.js` now **probes
each candidate token against the sidecar and keeps whichever authenticates** — you
no longer need to set `PHYGITAL_DATA_ROOT` by hand. If you ever need to read the
live token yourself, prefer the one at `%LOCALAPPDATA%\PhygitalStudio\sidecar.token`.

Ask the user to trigger the browser login, then call:

```bash
curl -X POST http://127.0.0.1:8765/auth/recon -H "X-Phygital-Sidecar-Token: <token>"
```

A Chromium window opens; the user signs in. After sign-in the session persists, so
this is a one-time step. Re-run `gen.js health` to confirm.

## 6. Safety

- **Mutate only the active comp.** Do not touch other comps or project items unless the user explicitly asks.
- **Never delete or overwrite the user's project assets** without an explicit request.
- **Always show generation cost and get confirmation** before spending credits.
- **Do not commit anything** (no git operations) unless the user explicitly asks.
- When a script could be destructive, prefer a read-back verification and keep the undo group tight so a single undo reverses it.

## 7. Smoke checklist

Copy this verbatim to self-verify the skill end-to-end in a fresh session:

1. Read active comp summary (name, fps, layer count).
2. Create a layer + two Position keyframes + temporal easing (apply the `0.16,1,0.3,1` reveal ease per `motion-design-principles.md`); one Cmd+Z reverts it entirely.
3. **Verify the ae-quirks #5 correction:** on the Position keys, call `setSpatialTangentsAtKey(...)` and read back — confirm spatial tangents ARE settable from ExtendScript (proves the corrected quirk, not the old "impossible" claim).
4. Apply a proven expression from `reference/expression-library.md` (e.g. `wiggle(3,30)`).
5. Generate a draft-quality image (`gen.js cost` → confirm → `gen.js generate`) and import it into the active comp via `ae.js`.
