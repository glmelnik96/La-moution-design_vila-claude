# Graphics over a Premiere edit — the AE half

The edit lives in Premiere (skill premiere-autopilot, Workflow I). This skill builds the edit's
graphics: one comp per slot of the plan, built from a built-in or registered template and returned to the edit
through Dynamic Link. Other docs you will need:
- the plan format and the placement rules: premiere-autopilot `references/gfx-plan.md`;
- the Premiere-side traps: premiere-autopilot `references/after-effects-link.md`;
- the AE-side traps: quirks 185–188.

## Commands

    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json --preview  # inspect mappings offline
    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json            # build or rebuild (in place), save, QA
    node scripts/gfx-build.js --plan … --only LT_01,Q_02 --no-capture    # a few slots
    node scripts/gfx-build.js --plan … --refresh-plate --no-capture      # after gfxresync: new plate, new offsets
    node scripts/gfx-build.js check-kit --aep <scratch.aep> --out <dir>  # the kit alone, on grey
    add --rebuild-kit to regenerate TEMPLATES after changing lib/gfx-kit-cloudru.jsx

- Run these commands from the root of ae-motion-live. With `--preview` the CLI reads the plan and
  its local registry. An actual build can launch AE if no AE window exists.
- If a different project has unsaved changes, the run stops. That project is the user's work: never
  discard it.
- After a re-edit the plan may name `plate.b.mov`. AE holds `plate.mov` open, so Premiere cannot
  render over it (quirk 188). The plate step switches the `PLATE` item to the named file and
  reports `switchedFrom`. After the switch AE holds only the new file.

## Project layout (in `<film>_gfx.aep`)

| Folder / item | What |
|---|---|
| `TEMPLATES/<template name>` | the kit. Cloud.ru uses `TPL_<type>`. A local registry names its prepared client comps. |
| `PLATE/plate.mov` (or `plate.b.mov`) | the edit without graphics, used as a silent guide in each slot. The client build names its own footage item `WORKFLOW_I_PLATE`. |
| `GFX/<slot id>` | one comp per slot, at the sequence's size and fps, as long as the slot. **Premiere links to these.** |
| `GFX/_tpl/<slot id>__tpl` | the slot's own copy of its template, with the slot's texts |
| `GFX/PREVIEW_<sequence>` | the plate plus every slot at its time: what you watch, and what QA captures |

A slot comp is rebuilt IN PLACE: its layers are cleared, and the comp object is kept. Live-verified:
the comp id of `LT_01` stayed the same across a text change. This matters because Premiere links to
the comp object; a comp deleted and re-created under the same name would be a different item.

## The template contract

| Element | Rule |
|---|---|
| comp | 1920×1080, square pixels. Cloud.ru uses `TPL_<type>`. A registered comp uses its exact project-item name. On a 3840×2160 sequence it is scaled 200 % with continuous rasterization. |
| `TXT_<FIELD>` | a top-level text layer for each writable template field, from the registry or Cloud.ru's `K.FIELDS` |
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

The logo is built as native shapes from `assets/cloudru-logo.svg` (`lib/svgpath.js`).

Keep upper and lower padding consistent on lower thirds. Give a quote its own hierarchy
with a larger type size or different width, and keep callouts clear of the logo and faces.

## A client's kit

Keep the client AEP, project fonts, footage and registry with the production. Set `plan.aep` to
the separate **working** AEP linked by Premiere. Import the approved AEP with dependencies into
that working project, duplicate the approved template, and prepare that duplicate directly under
the root `TEMPLATES` folder. Give it the exact name used in the registry.

The v1 edit is 16:9. The prepared template needs the dimensions, markers, silence and guide boxes
listed above. For each registered field it needs one unlocked, directly editable, static
`TXT_<TARGET>` Source Text property and a matching `BOX_<TARGET>` guide shape. Keep transform
keys, ornaments, precomps and expressions that reference the text. A nested, keyframed or
expression-driven Source Text control needs a separate conversion on a duplicate. The same
applies to media replacement in an archive window. This version binds text fields.
The ink check samples the entrance marker using position, anchor and scale. Check parented,
rotated or 3D text and guides on rendered frames.

For example, a product clip can use `"style": "product", "kit": "kits/product.json"` in its
plan. Relative paths resolve from the plan's directory. The local registry could contain

```json
{
  "version": 1,
  "style": "product",
  "roles": {
    "metricBadge": {
      "layer": "overlay",
      "template": "Product metric",
      "fields": {
        "metric": { "target": "figure", "required": true },
        "units": { "target": "unit", "required": false }
      }
    }
  }
}
```

The corresponding slot is

```json
{ "id": "METRIC_01", "type": "callout", "visualRole": "metricBadge", "layer": "overlay",
  "in": 25, "out": 150, "text": { "metric": "45", "units": "ms" } }
```

This maps `metric` to `TXT_FIGURE` and `units` to `TXT_UNIT`. A blank optional field clears
that field in the slot copy. Unregistered template layers keep their authored content. Editorial
type, visual role and layer are separate. An editorial chapter can use an overlay nameplate
while another chapter uses a full-screen insert. The Premiere reference includes a worked plan.

Both offline previews show each active slot, template and field value. Add `--only METRIC_01`
to inspect a subset. Previewing requires only the JSON files. AE checks actual comps, markers,
text layers, guide boxes and duration during the build. The local build duplicates the template
for each slot and updates its own linkable slot comp on repeat runs. A collision with an authored
output comp must be resolved in the working project. `check-kit` and `--rebuild-kit` generate
the built-in Cloud.ru kit.

Use `TEMPLATES` for approved design revisions. `GFX/_tpl` holds generated slot copies that are
replaced on rebuild. With `--only`, previously built active slots stay in the preview.
The preview report lists unbuilt, unselected slots in `omitted`.

    # premiere-autopilot root
    node scripts/gfxplan.mjs preview --plan <film>_gfx/gfx-plan.json
    # ae-motion-live root
    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json --preview
    node scripts/gfx-build.js --plan <film>_gfx/gfx-plan.json

## QA before anything goes to Premiere

1. Read `qa/sheet.png` as an art director. Each slot gets three frames: after the entrance, the
   middle, and past the template's length when the slot is longer. Check:
   - fonts are real;
   - the plate fits the text, and no text overflows (gfx-build reports overflow);
   - no face is covered;
   - colours, ornaments and logos match the approved kit (one green accent for Cloud.ru);
   - the burnt-in plate time is the slot's time. For example, a slot at frame 10 over a clip that
     starts at 2 s shows 3.28 s on its first QA frame, 10 + 20 + 2 frames in.
2. Fix the worst defect and run again. Only then run premiere-autopilot's `gfxplace.mjs`.
