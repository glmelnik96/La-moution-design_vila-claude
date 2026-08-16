# AGENTS.md — ae-motion-live

Entry point for agents that do **not** auto-load Claude Code skills (Cursor, Codex, plain
API harnesses). Claude Code discovers `SKILL.md` on its own and does not need this file.

**`SKILL.md` in this directory is the real specification. Read it in full before acting.**
This file only tells you how to get there and what breaks if you skip it.

## Working directory

Run everything with the **skill root as cwd** (the directory containing this file). Every
command in `SKILL.md` is written relative to it:

```bash
cd /path/to/ae-motion-live      # e.g. C:\Users\<user>\.claude\skills\ae-motion-live
node scripts/ae.js '...'
```

Opening an editor in a neighbouring project folder is not enough — the scripts, the
reference docs and the jsx scratch dir all live here.

## What this drives

A **live, already-open After Effects session** on the user's machine. Nothing is
simulated; every call mutates the user's real project.

- **AE channel** — `node scripts/ae.js '<jsx>'` or `node scripts/ae.js '@file.jsx'`.
  Executes ExtendScript (ES3) inside the open CEP panel over CDP on **port 8092**.
  The payload's **last expression must be `JSON.stringify(result)`** or nothing comes back.
- **Generation channel** — `node scripts/gen.js <cmd>`. AI image/video/upscale/voice via
  the Phygital sidecar on **port 8765**. Spends the user's credits.

Requires: After Effects running, with **Window → Extensions → LLM Chat** open. If the
preflight reports `AE panel CDP target not found on port 8092`, ask the user to open it
rather than retrying.

## Preflight — run before anything else

```bash
node scripts/ae.js 'JSON.stringify({ok:true, comp: (app.project.activeItem instanceof CompItem)? app.project.activeItem.name : null})'
```

`comp: null` means no composition is selected — ask the user before proceeding.

## Non-negotiables

Full rules are in `SKILL.md` §3 and §6. The ones that cause real damage if missed:

- **Mutate only the active comp.** Never touch other comps or project items unasked.
- **Wrap every mutation** in one `app.beginUndoGroup(label)` / `app.endUndoGroup()` pair,
  so a single Ctrl+Z reverts the whole action.
- **Small, verifiable steps.** Read the comp → mutate → read it back. Never fire one large
  opaque script and hope.
- **Confirm cost before generating.** Show model + settings + estimated credits and wait
  for an explicit yes. Draft cheap first, hero quality only once the composition is proven.
- **No git operations** unless the user explicitly asks.
- **Prefer `@file.jsx` over inline jsx** for anything non-trivial — Windows shell escaping
  will otherwise corrupt the payload.
- **On a CDP timeout, stop calling AE.** A modal dialog is blocking the panel; further
  calls just queue more dialogs. Ask the user to dismiss it.

## Reference docs — read on demand

| File | Read it when |
|---|---|
| `reference/ae-quirks.md` | **Before** debugging any weird ES3 error. Numbered, live-verified traps with WRONG vs RIGHT code. |
| `reference/motion-design-principles.md` | Before designing any animation — bezier→AE influence mapping, easing, stagger, timing. |
| `reference/motion-art-direction.md` | Choosing a visual language, composition, type treatment. |
| `reference/expression-library.md` | Copy-ready proven expressions. |
| `reference/extendscript-patterns.md` | Layer / keyframe / effect scripting recipes. |
| `reference/generation-recipes.md` | Prompt skeletons, parameter shapes, credit discipline. |

## Record what you learn

When you hit an undocumented AE behaviour or land a reusable construction pattern, append
it to `reference/ae-quirks.md` (numbered, marked LIVE-VERIFIED, WRONG vs RIGHT) **in the
same session, before reporting back**. Don't ask permission; state in one line what you
recorded. This channel is full of behaviour that is expensive to rediscover — pay once.

## Scratch space

`_build/` holds generated jsx payloads and Python generators from past sessions. Treat it
as scratch: safe to add to, useful as worked examples, not an API.
