# Graphics over a Premiere edit — the AE half

The edit lives in Premiere (skill premiere-autopilot, Workflow I). This skill builds the edit's
graphics: one comp per slot of the plan, built from `TPL_<type>` templates and returned to the edit
through Dynamic Link. Other docs you will need:
- the plan format and the placement rules: premiere-autopilot `references/gfx-plan.md`;
- the Premiere-side traps: premiere-autopilot `references/after-effects-link.md`;
- the AE-side traps: quirks 185–188.

## Commands

    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json            # build or rebuild (in place), save, QA
    node scripts/gfx-build.js --plan … --only LT_01,Q_02 --no-capture    # a few slots
    node scripts/gfx-build.js --plan … --refresh-plate --no-capture      # after gfxresync: new plate, new offsets
    node scripts/gfx-build.js check-kit --aep <scratch.aep> --out <dir>  # the kit alone, on grey
    add --rebuild-kit to regenerate TEMPLATES after changing lib/gfx-kit-cloudru.jsx

- If no AE window exists, `gfx-build.js` launches AE.
- If a different project has unsaved changes, the run stops. That project is the user's work: never
  discard it.
- After a re-edit the plan may name `plate.b.mov`. AE holds `plate.mov` open, so Premiere cannot
  render over it (quirk 188). The plate step switches the `PLATE` item to the named file and
  reports `switchedFrom`. After the switch AE holds only the new file.

## Project layout (in `<film>_gfx.aep`)

| Folder / item | What |
|---|---|
| `TEMPLATES/TPL_<type>` | the kit: generated, or a client kit imported and converted |
| `PLATE/plate.mov` (or `plate.b.mov`) | the edit without graphics; a guide layer in every slot comp |
| `GFX/<slot id>` | one comp per slot, at the sequence's size and fps, as long as the slot. **Premiere links to these.** |
| `GFX/_tpl/<slot id>__tpl` | the slot's own copy of its template, with the slot's texts |
| `GFX/PREVIEW_<sequence>` | the plate plus every slot at its time: what you watch, and what QA captures |

A slot comp is rebuilt IN PLACE: its layers are cleared, and the comp object is kept. Live-verified:
the comp id of `LT_01` stayed the same across a text change. This matters because Premiere links to
the comp object; a comp deleted and re-created under the same name would be a different item.

## The template contract

| Element | Rule |
|---|---|
| comp | `TPL_<type>`, 1920×1080, any fps. On 4K it is scaled 200 % with continuous rasterization. |
| `TXT_<FIELD>` | a text layer on the TOP level of the template, one for every field the type takes (`K.FIELDS`) |
| `BOX_<FIELD>` | a guide shape layer: the area the field's ink must stay inside, measured at the `in` marker |
| markers | comp markers with comment `in` (entrance done) and `out` (exit starts), with `0 < in < out ≤ duration` |
| audio | none: a linked comp's audio doubles the dialogue and never refreshes (quirk 185) |
| fonts | real PostScript names only (`G.fontOk`, quirk 187) |

A field the slot leaves out gets a single space, so its layer stays but has no ink. Plates that follow
the text measure the ink at the template's middle (`K.ink`), so they do not move while the text
slides in. `comp.duplicate()` keeps those expressions: verified live, the plate of a copy fits the
copy's own text.

## Fitting a template to a slot

The template copy sits in the slot comp with time remapping on. It has four linear keys, all in
seconds:

| Key | Slot time | Template time |
|---|---|---|
| start | `0` | `0` |
| entrance done | `in` | `in` |
| exit starts | `D−(T−out)` | `out` |
| end | `D` | `T` |

The entrance and the exit play at their own speed; the hold in the middle is stretched or squeezed.
The slot's minimum length is `in + (T − out) + 1.5 s`.

Set things in this order (quirk 183):
1. turn `timeRemapEnabled` on;
2. set `outPoint`;
3. set the keys (`setValuesAtTimes`; a key exactly at the comp's end is accepted);
4. remove the default keys.

Verified live: an 18 s logo slot over a 3 s template is still visible at frame 80, past the
template's own length.

## The Cloud.ru kit (`lib/gfx-kit-cloudru.jsx`)

| type | length | in / out | fields | where |
|---|---|---|---|---|
| lower_third | 4.0 s | 0.8 / 3.4 | name, role | lower left, plate hugs the text, green bar |
| quote | 5.0 s | 1.2 / 4.4 | quote (≤ 3 lines), author | lower band, plate grows with the lines |
| callout | 3.0 s | 0.6 / 2.4 | value, caption | upper right, below the logo bug |
| logo | 3.0 s | 0.6 / 2.4 | — | top right, 40 px |
| chapter | 3.0 s | 0.8 / 2.48 | number, title (≤ 2 lines), subtitle | full screen, black, fades back to the picture |
| intro | 4.0 s | 1.2 / 3.4 | title (≤ 2 lines), subtitle | full screen, logo top left |
| outro | 4.0 s | 1.2 / 3.4 | title, subtitle | full screen, logo centred, ends on black |

The logo is built as native shapes from `html/templates/cn-assets/logo_color.svg` (`lib/svgpath.js`).

The first art pass (2026-09-25) made three changes:
- lower-third text moved so the plate is even above and below;
- the chapter/intro subtitle got more air under the title;
- the callout moved down, clear of the logo bug.

Open weakness, seen in the first rehearsal: a one-line quote reads as a second lower third. It
has the same band, a similar size (54 against 52 px) and the same dark plate. A key thought needs
its own weight: larger type, a wider band, or the green rule leading it. Fix it in the next kit
pass, or when a client kit replaces this one.

## A client's kit

1. Import their `.aep` into the film's project and move the comps into `TEMPLATES` as `TPL_<type>`.
2. For each comp:
   - rename its text layers to `TXT_<FIELD>`;
   - add a `BOX_<FIELD>` guide rectangle for each field;
   - set the `in` and `out` comp markers;
   - remove any audio.
3. Run `check-kit` until the contract passes, and look at the sheet.

Keep a converted kit and its registry locally, next to the client's project, never in this repo.
v1 builds only `style: "cloudru"`. Loading another kit is the first extension.

## QA before anything goes to Premiere

1. Read `qa/sheet.png` as an art director. Each slot gets three frames: after the entrance, the
   middle, and past the template's length when the slot is longer. Check:
   - fonts are real;
   - the plate fits the text, and no text overflows (gfx-build reports overflow);
   - no face is covered;
   - there is one green accent;
   - the burnt-in plate time is the slot's time. For example, a slot at frame 10 over a clip that
     starts at 2 s shows 3.28 s on its first QA frame, 10 + 20 + 2 frames in.
2. Fix the worst defect and run again. Only then run premiere-autopilot's `gfxplace.mjs`.
