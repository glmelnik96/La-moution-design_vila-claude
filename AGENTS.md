# AGENTS.md — ae-motion-live (Cloud.ru motion)

Entry point for agents that do **not** auto-load Claude Code skills (Cursor, Codex, plain
API harnesses). Claude Code discovers `SKILL.md` on its own and does not need this file.

**`SKILL.md` in this directory is the real specification. Read it in full before acting.**
This file only tells you how to get there and what breaks if you skip it.

## Working directory

Run everything with the **skill root as cwd** (the directory containing this file). Every
command in `SKILL.md` is written relative to it:

```bash
cd /path/to/ae-motion-live      # e.g. C:\Users\<user>\.claude\skills\ae-motion-live
node --test                     # must be green before you touch AE or render anything
```

## What this drives

1. **Brand** — `brand/cloudru-motion-brand.md` + `brand/cloudru-motion-tokens.json`. The
   Cloud.ru motion language is the default house style. Read it before designing anything.
2. **AE channel** — a **live, already-open After Effects** on the user's machine. Nothing is
   simulated; every call mutates the user's real project.
   `node scripts/ae.js --lib '@file.jsx'` executes ExtendScript (ES3) in the open CEP panel
   over CDP on **port 8092** with the `M.*` library (`scripts/lib/cloudru-motion.jsx`) and
   tokens (`CR.*`) prepended. The payload's **last expression must be `JSON.stringify(...)`**
   — recommended: `JSON.stringify(M.run("label", function () { ...; return {...}; }))`.
   Requires: After Effects running, with **Window → Extensions → LLM Chat** open.
3. **HTML channel** — `html/engine/*` (deterministic timeline + brand primitives),
   `html/templates/showreel.html`, `node html/render/render.js page.html --out dir --beats auto --sheet sheet.png [--video x.mp4]`
   (headless Chrome over CDP; no npm dependencies). Use when AE is not open or the
   deliverable is video/web.
4. **Generation channel** — `node scripts/gen.js <cmd>`: AI image/video/upscale/voice via the
   Phygital sidecar on **port 8765**. Spends the user's credits.

## Preflight — run before anything else

```bash
node --test
node scripts/ae.js 'JSON.stringify({ok:true, comp: (app.project.activeItem instanceof CompItem)? app.project.activeItem.name : null})'
```

`comp: null` means no composition is selected — ask the user before proceeding. If the
preflight reports `AE panel CDP target not found on port 8092`, ask the user to open the
panel rather than retrying.

## Non-negotiables

Full rules are in `SKILL.md` §3–§7. The ones that cause real damage if missed:

- **Brand first.** Beat sheet with token eases/durations before code; no bounce, no rotation,
  no shadows/gradients/round corners, one green accent per frame, exits 70% of entrances.
- **Mutate only the active comp.** Never touch other comps or project items unasked. The
  lib tags its layers (`comment = "CR_FX"`) and `M.clean()` removes only those.
- **Wrap every mutation** in one undo group (`M.run` does it), so a single Ctrl+Z reverts it.
- **Lint every payload** — `ae.js` does it automatically; a rejected payload is a modal you
  did not have to ask the user to dismiss. Never bypass with `--no-lint` unlinted.
- **Small, verifiable steps.** Read the comp → mutate → read it back → capture beats → look.
- **On a CDP timeout, stop calling AE.** A modal dialog is blocking the panel; further calls
  just queue more dialogs. Ask the user to dismiss it.
- **Confirm cost before generating.** Show model + settings + estimated credits and wait for
  an explicit yes. Draft cheap first, hero quality only once the composition is proven.
- **No git operations** unless the user explicitly asks.
- **Prefer `@file.jsx` over inline jsx** for anything non-trivial — Windows shell escaping
  will otherwise corrupt the payload.

## Reference docs — read on demand

| File | Read it when |
|---|---|
| `brand/cloudru-motion-brand.md` | **Before designing any animation** — the Cloud.ru motion language, scene choreography, stop-list, checklist. |
| `reference/motion-vocabulary.md` | Choosing techniques: what pro motion is made of, catalogue with AE/HTML builds and the brand verdict. |
| `reference/motion-design-principles.md` | Easing theory and the **exact bezier → AE KeyframeEase math** (§2b). |
| `reference/ae-cloudru-recipes.md` | Copy-ready AE payloads for title / divider / KPI / content / scheme / finale. |
| `reference/extendscript-patterns.md` | Layer / keyframe / effect / text-animator / mask / shape / camera / precompose recipes. |
| `reference/ae-quirks.md` | **Before** debugging any weird ES3 error. Numbered, live-verified traps with WRONG vs RIGHT code. |
| `reference/expression-library.md` | Copy-ready proven expressions. |
| `reference/html-engine.md` | Authoring pages, primitives, render/preview commands, porting to AE. |
| `reference/generation-recipes.md` | Prompt skeletons, parameter shapes, credit discipline. |
| `reference/live-verify-checklist.md` | First local session after cloud work: what to verify against the real AE. |
| `reference/motion-art-direction.md` | Non-Cloud.ru showcase style ("GRID & RUPTURE") — only when explicitly asked. |

## Record what you learn

When you hit an undocumented AE behaviour or land a reusable construction pattern, append
it to `reference/ae-quirks.md` (numbered, marked LIVE-VERIFIED, WRONG vs RIGHT) **in the
same session, before reporting back**. Don't ask permission; state in one line what you
recorded. This channel is full of behaviour that is expensive to rediscover — pay once.

## Scratch space

`_build/` holds generated jsx payloads and Python generators from past sessions (the
Slavneft tag-cloud spot and the code-block animation). Treat it as scratch: safe to add to,
useful as worked examples of measuring/auditing, not an API. `out/` is git-ignored render output.
