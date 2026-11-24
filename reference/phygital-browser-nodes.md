# Phygital canvas preparation through the browser

Use when the user explicitly asks to assemble a Phygital canvas in an authenticated browser, especially when the required video model is unavailable over the connected MCP. This covers preparation; launching a generation is a separate action. Follow the user's specified launch boundary.

Verified on 2026-11-02 in the actual editor UI. Recheck options after product updates.

## Efficient setup

1. Bind the user-authorized tab. The in-app browser and normal Chrome have separate sessions; logging in to one does not authenticate the other. Do not inspect browser profiles or extract cookies to bridge them.
2. If available, discover page-defined WebMCP tools. No WebMCP tools were exposed in the observed Phygital editor; use its visible UI and documented browser controls.
3. Create and save a separate project before building many nodes. Confirm the new title and `/my_workspaces/...` URL. An immediate snapshot can still show the naming dialog while saving; do not repeat Save merely because the first snapshot is transitional.
4. Configure one video template and verify it, then test a connected image/video pair before scaling up.

## Seedance v2.5 template

The observed node exposes Start Frame, End Frame, Reference Images, Character Images/Video, Reference Videos/Audio; settings include model, aspect ratio, resolution, duration, seed lock, Camera Fixed, Generate Audio, Video Mode and Draft Mode.

- Draft Mode changed resolution to 480p; check the displayed value rather than assuming the prior resolution remains selected.
- Generate Audio is a separate checkbox. For SFX-only work, enable it and explicitly prohibit music and speech in the prompt. Do not connect the film soundtrack to Reference Audio.
- Seed lock is separate from the seed number. The copied node records a locked seed as `params.seed.isFixedSeed: true`; having a numeric seed alone is insufficient.
- Observed Video Mode choices were Reference to video, Video editing and Video extension. Do not invent a separate Start–End menu item: inspect actual available inputs and controls.
- The visible duration input had min 3, max 30. These are UI bounds, not a guarantee every combination is accepted by the model. Keep clip duration separate from edit duration.
- During template preparation, never click Generate or a frame's batch-run control to test whether setup is correct.

## Canvas scale and selectors

- At 120% an expanded video node extended below the viewport. A hidden/below-viewport Draft checkbox failed even with `force: true`. Use the actual Zoom controls menu, then Zoom out. At 60% the full template was accessible.
- Direct editing of the Canvas zoom percentage did not persist in the observed interaction. The menu's Zoom out item did work. Verify displayed scale after a change.
- Accessibility indices changed even while a node menu remained open. Reobserve after state changes. For repetitive work use inspected `data-test` / `data-test-name` attributes, not stale numeric indices.
- Observed setting selectors included `data-test-name="nodeParamdraft"`, `nodeParamgenerate_audio`, `nodeParamcamerafixed`, `nodeParamduration`, `nodeParamseed`, `nodeParamaspect_ratio` and `nodeParamprompt`. Treat them as observed-version details, not permanent APIs.

## Copy, paste and connections

- Node menu Copy writes the public clipboard as `text/html`: `<div data-phygc>{...}</div>`, with `type: application/phygc`, `version: 2`, `data` and `commentFrames`. Plain text only says how many nodes were copied.
- A connected pair can be selected through the canvas and copied with Ctrl+A / Ctrl+C. Clipboard writes can finish after the key action returns; an immediate read once returned the prior single-node copy. Check the copied payload contains the expected number of nodes and connections.
- A tested manual drag from the Import Files output socket to Seedance Start Frame produced a visible line and a copied connection. The public clipboard represented it as `from {name,type,nodeUuid}` and `to {name,type,nodeUuid,order}` on the source node.
- Work only through the app's public clipboard/UI import. Do not mutate framework internals, invent backend requests or extract authentication data as a shortcut.
- A reconstructed Import Files card worked when its complete copied output entries and matching `meta.prevOutputs` were preserved. Earlier incomplete attempts showed labels and then empty placeholders; that does not prove old storage IDs themselves were invalid. Verify an actual thumbnail, not just a filename.
- Successful native paste required clicking a genuinely blank canvas point and using `tab.pressKey(null, 'Control_L+v')` after `tab.clipboard.write`. Locator-focused `press('Control+v')` and formatted `paste()` did not reliably trigger the editor import. Resolve focus and dialogs before retrying; never duplicate an import blindly.
- Preserve matching socket names across `outputSocketGroup`, `meta.prevOutputs` and connection `from.name`. A Start Frame link has `to.name: start_img`, `to.type: image`; a Reference Images link has `to.name: ref_img`, `to.type: array`, with ordered inputs. These were checked by manual socket drag and public Copy, not inferred from internal state.
- Paste may allocate new media file IDs. Read back the final public Copy payload for the saved registry instead of treating planned IDs as verification.
- For this user's shot workflow, use one dedicated Import Files card feeding exactly one video node, with a Comment Frame showing the shot ID. A card may hold several inputs for that one shot. Avoid shared fan-out libraries when the user wants independent pairs. Comment Frames are annotations; runnable Frames are different.
- Pasting more than 100 nodes triggered a performance warning. After confirming a 140-node paste, the editor stopped responding to browser commands. Do not assume a large graph is safe merely because the payload validates. Start with a small batch, verify responsiveness, and split the work by act/project if necessary. A timeout is not proof the paste failed; inspect before retrying.
- Four act projects with 28–44 nodes each were verified successfully. The `Pasting nodes... N of N` toast can persist after all node DOM elements appear; Comment Frames finish later. Wait for the toast to disappear and check copied `commentFrames` before treating the import as complete. A disabled Save button/spinner can also be transitional.
- New project initially cleared the canvas while the old title/URL remained briefly. Wait for the new `/my_workspaces/...` URL before pasting. Existing auto-named projects can be renamed by clicking the visible title, filling `editable input` and pressing Enter, then Save.
- Whole-project verification through public Copy checked one source per video, ordered link targets, Draft/audio/locked seed and visible output/run state without launching generation. Reopening a saved act confirmed labels and images persisted. Do not launch generation as a validation test.
- Changing the serialized `name` did not change the Import Files header. Put shot IDs in prompts, filenames or a verified visible annotation instead of relying on untested node renaming fields.

## Uploads

- Read the active browser's file-upload guidance. Await `Promise.all([waitForEvent('filechooser', ...), uploadLocator.click()])`, then use the chooser's `setFiles` with absolute paths. An unhandled chooser rejection reset the persistent browser runtime; attach both promises together and handle failures.
- Import Files exposed a multiple-file chooser. Its hidden input is associated with the visible Upload control. Use the chooser flow rather than injecting file data into the page.
- Keep local project paths separate from browser-visible file records. Upload permission does not imply permission to run the attached model.
- JPEG delivery copies can reduce transfer size while preserving source dimensions and framing; retain original PNGs. Do not silently downscale the inputs meant for final-quality generation.

Record further batch-upload, paste and save findings only after the visible result is verified. Project-specific prompts, node UUIDs, file IDs and the workspace URL belong in the project registry, not this skill.

## Reading generation prices

The Generate button's animated digits were exposed correctly in the accessibility tree, while ordinary DOM textContent included a hidden stale "Calculating price…" status and omitted the digits. Wait for the node's visible calculation status to become hidden, then read the current AX button label. After changing duration/resolution, an immediate label could still show the prior quote. For a price comparison, preserve and restore the original duration, resolution, Draft and audio settings; do not launch a generation. Store dated quotes in the project rather than hardcoding them into this skill.

## Episodic reference generation and character inputs

Verified UI wiring on 2026-11-03; video output quality was not tested because the user reserved generation launches.

- When the user treats the animatic as story/design guidance, prepare episodes with an explicit entry state, observable actions, motivated cuts and exit state. Reference Images constrain identity/material/world; they need not constrain the first composition. Leave Start/End empty for this workflow. Specify the action that changes the scene, not just a camera move over a still. Keep purposeful motion at clip edges for editing handles.
- Keep generated duration separate from intended edit use. Allow time for transformations and performance; do not globally require a frozen final pose or prohibit all cuts. Fixed-camera surveillance is a deliberate exception: camera stays still while subjects change and move.
- A tested drag into Character Images produced `to.name: character_img`, `to.type: array`, ordered inputs. Portraits and environment/object references can come from one dedicated Import Files card, using distinct per-output connections. Do not connect the card's entire file group to both inputs.
- Character Images is an input role, not proof that a particular portrait is accepted. Distinguish successful wiring, provider moderation acceptance and visual continuity. Test these in the user's authorized pilot process; do not assert that moving a face from Start Frame to Character Images resolves rejection.
- [Provider portrait guidance](https://docs.byteplus.com/en/docs/ModelArk/seedance-portrait-asset-guide) distinguishes trusted original outputs under the same account, preset digital characters and authorized portrait assets. Arbitrary AI-generated portraits are not automatically trusted; Phygital's implementation may differ. When rejected, identify the supported character-asset workflow instead of trying to evade moderation by altering the image.

## Upload completion and verification refinements

- A second upload to an existing card replaced its previous files in the observed UI. Inspect the current Keep content behavior before assuming append; keep independent library source records and verify the resulting filenames and connections.
- Copying while media were still uploading produced a large payload with `__phygitalEncodedFile` data and an unusable JSON snapshot. After upload completed, public Copy returned small valid records with server file IDs. Wait for actual uploaded records and recopy; do not repair or fabricate a half-uploaded payload.
- Copy may normalize socket names such as `R_1.05` to `R_1`. Match the complete original filename in the output value to the planned input, and preserve socket names consistently in connections.
- A nonzero `taskID` appeared during node setup/price calculation without a Generate click. It is not sufficient evidence of a launched generation. Record actual actions, visible run state and outputs separately from quoted-price metadata.

## Download original generated video

Verified on 2026-11-03: the visible video element used a blob URL for an optimized 720x404 preview even when the output card reported 854x480. `video.downloadMedia()` downloaded that preview. To retain the generated result, use the output's actual Download button and await the browser download event; ffprobe confirmed the resulting file was 854x480 with audio. Full Quality preview, Final 1080p generation and Download are distinct controls; downloading does not require launching a final-quality run.

The Download control appeared in the output toolbar after opening its small output menu. Scope it to the intended episode node, close the menu with Escape, then click the exact Download button while awaiting `waitForEvent('download')`. Keep episode-to-file mapping and verify local dimensions, duration and audio; a successful download alone does not prove it is the original. Preserve existing files, use new revisions for different results, and distinguish technical previews from editing assets.

## Auditing episodic motion and revising a live board

Observed in a real draft review and a verified R2 board preparation on 2026-11-03:

- Separate node-setup acceptance from motion acceptance. Correct links, prompts and settings do not prove a transformation, hit or outcome is visible. Review generated pixels against entry state, actual action and exit state. A camera move or a cut between complete poses can conceal the missing action.
- Whole-scene references also carry camera height, object count and narrative state, despite a prompt saying “design only”. Use a world reference compatible with the entry state and separate object/character references. Inspect technical crops: include feet, head, major limbs and identity features rather than assuming an automatic crop is suitable.
- When a specifically required transformation must be continuous, give that beat an uninterrupted readable shot and state what physically folds or changes. Scope this to the essential mechanical beat, not the entire film or every transformation. Match-on-action cuts may carry the surrounding scene; they must not replace the missing process with a cut from vehicle to completed robot.
- A coarse one-frame-per-second contact sheet can miss a short action. Before declaring a click or impact absent, inspect the relevant interval densely around the cut. The reviewed mouse click lasted about half a second and was missed by the initial coarse sample.
- Preserve old nodes/results and annotate replacement scope. Screens, alerts and tracked footage often belong in compositing; do not regenerate a good performance merely to change the screen. A wrong camera position, however, is not repaired by replacing screen content.
- Public Copy graph UUIDs changed between exports/reload in the observed project. Verify connections within one exported graph; compare retained outputs across exports by episode label and generated media file ID. Do not describe copied UUIDs as permanent backend IDs.
- The empty Import Files card exposed `data-test="openFileBtn"`; an existing-content upload used `reopenFileBtn`. A broad Upload text locator matched a hidden control. Inspect and scope the visible upload control before retrying.
- A clipboard write with explicit `text/html` plus `text/plain` imported both nodes and Comment Frames in the tested R2 batch. An earlier base64-only attempt imported its node without its annotation. Inspect the resulting frame count; do not treat this observation as a universal clipboard API constraint.

Store prompts, crop provenance, input files, actual Copy verification and a screenshot together in the project. State clearly whether nodes are prepared or videos actually generated; never launch paid generation as a verification shortcut.

## Seedance input-size preflight and safe retry

Observed provider errors on 2026-11-03 required **each image side >= 300 px** and **total area >= 90,000 pixels**. A valid whole-scene reference does not compensate for a smaller object crop in the same node. Validate every final cropped file before uploading, and every linked media dimension from the final public Copy. Treat these as observed constraints; future model versions may differ.

- Keep original crops. When only technical size is wrong, proportionally resample a delivery copy without changing its framing, then reload the exact file set into the affected dedicated Import Files card. Verify full uploaded dimensions and ordered links afterward. This does not add authentic detail to a small source.
- Reuploading the same filename set replaced file IDs and normalized socket names, but preserved ordered connections in the verified R2 repair. Do not assume preservation without a read-back.
- A past generation error remained visible after inputs were corrected. Distinguish stale error text, validated input state, accepted run (Stop/Generating) and successful result. Only an authorized run can prove provider acceptance.
- Hand mode intercepted upload clicks. Switch Navigation modes to Move before using node controls; H toggled the modes in the tested session. A click timeout sometimes occurred after the action had taken effect. Observe status before retrying, especially Generate: never submit twice merely because the browser call timed out.
- Following a one-off user authorization, launch only the specified missing/failed jobs; preserve completed outputs. Record per-node acceptance and total quoted credits, then restore the standing user-launch-only rule for future work.

## Downloading original Draft results through the viewer

Observed on 2026-11-03: the embedded video and the initially opened Full Quality viewer could show a **720×404 preview**, then asynchronously replace it with the **854×480 original Draft**. Full Quality here opened a viewer; it did not launch Final 1080p or upscale. Wait for the rendered video's actual dimensions before downloading.

- Read the visible viewer video from the live rendered DOM. Multiple hidden/stale gallery videos existed, so a broad locator or `.first()` returned an earlier clip. Use the exact source URL observed on the currently displayed video with the browser's `downloadMedia`, and immediately record episode → returned local path.
- In this session the ordinary Download button showed a downloading toast without a completed download event. The viewer-media method succeeded for originals. Do not infer the cause from the toast or download an optimized preview as a substitute.
- Verify the local original with ffprobe (dimensions, duration, audio), full FFmpeg decoding, and hashes after copying to the project. Keep originals and earlier revisions; use stable episode filenames in a distinct revision folder. A successful download proves file integrity, not story or motion quality.

## Motion acceptance after the R2 review

User review on 2026-11-03 rejected both episodic batches for weak action and staging despite successful generation. The R2 prompts repeatedly imposed continuous takes, gentle camera movement and static holds; sampled outputs also contained cuts, so “no cuts at all” would be inaccurate. Cuts alone did not create escalating action.

- Frame episodic scenes as cause → action → response → consequence. A camera move over an idle subject, a finished transformation pose or a sustained energy beam does not constitute a complete action scene.
- Preserve identity and world anchors without freezing composition or demanding the whole cast in every shot. Give a shot a clear main interaction; use wider orientation shots between closer interactions. CCTV can remain fixed while substantial action occurs within it.
- Check source references for visual defects as well as technical dimensions. Resampling a malformed crop does not repair proportions; an environment reference containing an intact vehicle can compete with its separate transformed identity. Treat this as a hypothesis to test, not a guaranteed explanation of every duplicate.
- Distinguish user restrictions from assistant inventions. Avoiding panic/injury of people does not require all fictional machines to remain passive or undamaged. Make the team's action visibly cause the victory instead of ending an attack arbitrarily.
- Separate technical download verification from creative acceptance. When a global review rejects both batches, do not continue treating earlier clips as approved automatically. Use authorized representative motion tests before another full paid batch.

## R3 card preparation — verified UI findings (2026-11-03)

- **Never click the Seedance `.header` container to select/drag a node.** It includes the paid Generate/Re-generate button; a center click on this broad container accidentally launched a 1080-credit job. Use a verified noninteractive label/drag handle or blank-canvas selection, inspect hit target, and keep execution controls out of selection actions. Do not use Ctrl+F as browser Find here: the editor creates a native node frame.
- A public paste can show all nodes before its Comment Frames appear. In the observed 38-node R3 paste, annotations appeared after asynchronous media copying completed. Wait for the paste state and check both node and comment counts before repairing or reimporting; do not infer failure from an early count.
- `reopenFileBtn` in Import Files **replaced** the source's file set in the observed upload; it did not append. Only use it on an intentionally replaceable, unconnected source or with the complete intended set. Per-generation copies retain their media; verify old output IDs independently.
- Video `downloadMedia()` returned a 720×404 compressed blob preview while the result UI showed 854×480. Probe downloads and label previews explicitly; a downloaded playable blob is not proof of the original generated resolution.
- Review anatomical left/right separately from screen direction. With an enemy facing west and the camera/approach south, its near-side limb is anatomically LEFT. Seed the vulnerable component before the payoff; keep its side, weapon and state consistent through every episode.
- Validate episode edit budgets against their necessary causal beats. Source handles can be longer, but a short editorial allocation cannot silently discard contact, recovery, repositioning or the cause of victory. Shift time toward the decisive interaction within the film budget.

## R3 batch launch and download precision (2026-11-03)

- At an overview zoom near 5%, the tiny Full Quality controls were unreliable: several opens retained a 720×404 preview for minutes. The successful recovery was **viewer → To node → reopen Full Quality on the enlarged card (about 32–40%)**, then re-observe until the visible viewer reports 854×480. This worked for the remaining originals after reload/waiting alone had not. Pixel targeting is a possible cause, not proven; do not describe an unverified network/CDN cause. Prefer selecting/centering a card before its precise action controls.
- Scope media download to the **visible large viewer container plus its exact observed source**, not just `video[src=...]`: a gallery thumbnail sometimes shared the same blob source and made that selector ambiguous. Re-read source/dimensions each time and retain episode→path mapping.
- For a launch timeout, read the actual button/status before retrying. Stop/Generating/Queued means accepted; do not click again. Submit an authorized batch only once per missing episode and keep at most 10 in flight. A quoted task ID alone is not acceptance evidence.
- Persist compact public-Copy verification: episode, task, output file IDs, params, normalized prompt hash and retained earlier output IDs. Dumping all old and new prompts in one tool output was truncated; a compact record remained usable.
- Separate current originals, references, plan, QA and previews. Preserve historical HTML asset paths. A local player can use relative media paths, but must be sent together with its media folder; do not call it a single-file self-contained video artifact.

## R4 browser and motion findings (2026-11-10)

- For native public paste, `text/html` with `<div data-phygc>{JSON}</div>` plus `text/plain` containing the **same full JSON** worked in this session. A short plain-text placeholder initially pasted a cached previous graph or did nothing. Verify imported episode labels, counts and retained outputs before another paste; treat this as observed behavior, not a stable API contract.
- Native Flow arranged nodes but left distant Comment Frames unmoved. Zoom to fit then framed both and hid useful nodes at minimum zoom. Group/arrange the intended selection and inspect annotation positions; do not repeatedly zoom all or delete user annotations to recover the view.
- Short clips with one readable main interaction produced visible contact more reliably here than overloaded group combat. Separate arrival, transformation, impact, assistance, disarm and counterstrike. Gray-background identity references avoid inheriting a hangar pose; use one compatible street master. These are observations, not guarantees of motion quality.
- Numeric timing in a prompt is not enforcement: a requested 0.2-second discharge still became a multi-second beam; cyan/red identity and terminal body pose also drifted. Inspect actual action and exits, mark remaining defects, and do not equate technical completion with creative approval.
- Preserve the exact launched prompt, ordered refs, params, task/output IDs and native `draftData` after any UI revisions. A planning JSON may no longer match the launched node. Make the verified snapshot the source for subsequent Draft-to-Final work.

## Native Draft promotion preparation (2026-11-10)

- Read the live edited sequence and deduplicate by original output/file identity. Several timeline fragments can reuse one generated source, and an older archived result can replace the newer revision. Quote the complete original node durations; shortening them changes the accepted Draft rather than merely saving unused edit handles.
- On 21 existing v2.5 nodes, disabling Draft and selecting 1080p preserved task/output IDs and native `meta.draftData`. Verify each retained draft record, seed lock, prompt, inputs and duration after the change. This proves preparation, not that an unrendered final will be visually identical.
- The public Copy snapshot initially stayed stale when Copy was invoked outside canvas focus. Saving, clicking verified blank canvas, then native Ctrl+A/C produced the current params and price metadata. Check the serialized `taskPrice.details.params` describe the requested resolution/Draft state before using the quote; retain dated prices in the project, not this skill.
- Large graph DOM snapshots can omit offscreen nodes. Read current UI prices when visible, and validate all selected nodes through a fresh public Copy snapshot. Audit that unselected node settings and all prior outputs stayed unchanged. Never use Generate to verify a quote.


## Completed native Final promotion (2026-11-10)

- Same node, locked seed, unchanged prompt/inputs/params and a preserved pre-launch native Draft record did not guarantee identical shots: B01 changed angles and action timing in Final. Compare pixels before conforming an existing edit. In this job the user accepted differences and requested full-source story assembly; do not generalize that permission to other projects.
- After successful Final rendering all 21 nodes had `meta.draftData` absent. Retain the pre-launch public Copy snapshot as historical evidence; do not claim the live record survives or restore it by unsupported edits. Store Draft and Final task/output IDs separately.
- On an infinite canvas, locator clicks may scroll the page or time out after an action was already accepted. Inspect Stop/Queued/Generating before any retry of a paid button. A native click at a freshly observed button rectangle avoided the scroll issue. Use broad visible bounds for panning, not exact-pixel convergence; toolbar zoom can move the canvas anchor substantially.
- For offscreen status, DOM `textContent` worked where `innerText` was empty. For a full-quality viewer, page-level DOM inspection of visible video dimensions and `currentSrc` distinguished the 1920×1080 original from a 720px preview and hidden stale video elements. Download the exact visible original and probe the saved file; do not infer quality from the node label alone.
