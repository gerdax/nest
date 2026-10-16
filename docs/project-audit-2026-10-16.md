# Nest project audit

Date: 16 October 2026. Architecture and code review by GPT-6 Astra at medium reasoning, integrated and checked by the lead agent. Scope: the local project player, studio, shared card engine, standalone dice service, retained compatibility modules and static staging.

Nest has a coherent foundation for a local narrative authoring tool. Its separation of authored data, gameplay transactions, visual choreography and dice results is worth preserving. The next investment should address specific semantic and persistence defects, then reduce concentrated complexity and measure realistic workloads. A framework migration or broad engine rewrite is not justified by this audit.

## Findings requiring fixes

### Item placement effects can be accepted and silently ignored

Priority: P1 for the data contract; reproduced with Node. `project/cards.js:26` appends placement effects into resolved `effects`, while Item definitions carry an `onCollect` array. Collection prediction, authorization and execution select `onCollect ?? effects`, so even an empty `onCollect` masks the placement effects (`project/ProjectController.js:176`, `:321`, `:338`).

Reproduction: start a default project at Supplies, disable its introduction, retain a valid narrative successor and set its item placement's `effects` to `[{op:'add',key:'energy',value:2}]`. Validation succeeds and compilation retains the effect. Complete collection through the controller's accepted departure and matching completion: inventory gains the item, but energy stays at 3 instead of becoming 5. This affects valid imported/programmatically authored JSON; the current inspector does not expose additional Item placement effects (`studio/inspectors.js:65`).

Choose one contract: append placement effects to collection effects during compilation, or explicitly reject unsupported Item placement effects. Apply the same effective-effects rule to routing prediction, authorization and completion. Add a regression that exercises all three so predicted successors match committed state.

### Editing after a malformed save can overwrite the recoverable data

Priority: P1 for authoring data preservation; established by the source path. `project/storage.js:8` returns a load error for malformed v2 storage without deleting it. The studio substitutes `createProject()` (`studio/editor.js:27`), displays the error, then saves that fallback to the original key on the next edit (`:64`). A normal edit can therefore remove the original stored payload before the author has recovered it.

Preserve the raw failed value in a recovery slot or provide an export before writing to that key again. Keep loading errors visible until the author deliberately adopts a replacement. Verify malformed JSON, structurally invalid JSON and storage failures with a fake storage adapter; complement that with a browser recovery check.

### Undo and redo hide persistence failures

Priority: P2; established by the source path. `studio/editor.js:222` changes the history document and calls `saveProject(project)` without inspecting its result or updating save status. Quota exhaustion or denied storage can leave the visible project different from the saved project while an earlier saved message remains visible.

Use one persistence/status boundary for ordinary edits, undo and redo. Preserve the visible document on failure, mark it unsaved and retain an export route. Test a storage adapter that starts throwing after the first successful save.

### Extreme Random weights can overflow the selection total

Priority: P3; reproduced with Node and independently checked by the lead. Validation accepts individually finite positive weights (`project/model.js:188`), but `ProjectController.weighted()` sums them without protecting against overflow (`project/ProjectController.js:59`). Two routes each weighted `1e308` yield an infinite total. With a random draw of zero, the implementation selects the second route because the ticket becomes NaN and falls through, rather than selecting the first. Scale weights by the maximum before summing, or reject nonfinite totals. Ordinary authored weights are unaffected.

## Browser lifecycle risk

Priority: P2 pending browser reproduction. Both active hosts destroy preview resources on every `pagehide` (`studio/player.js:20`, `studio/editor.js:230`). Destroy is terminal, and neither host reconstructs resources on `pageshow`. A document restored from the browser back/forward cache can retain controls attached to a destroyed preview.

Verify navigation away and Back in browsers that actually report a persisted restoration. Then either suspend and resume for persisted lifecycle events or rebuild the host on restoration. Node lifecycle tests do not establish browser cache behavior.

## Integrity and gameplay logic

The strongest integrity boundaries are detached compilation, atomic state transactions, acceptance versus completion events, collision-safe imports, and shared dependency analysis for export and deletion. These are appropriate for Nest's reusable Library and run-scoped ownership model. Keep inventory mutations in the controller/state layer and gesture handling in the engine. Keep dice interpretation in gameplay callers.

The Item finding shows why validation alone is insufficient: data can be structurally valid yet have different meaning in compilation, preview prediction and completion. Prefer contract tests that carry representative authored data through parse, compile and controller execution. Include shared and local cards, Item placements, legacy aliases, conditions that change successor visibility, and collection cancellation.

The full existing suite passes, including extensive routing, migration, cancellation, identity and lifecycle coverage. This supports the current boundaries; it does not rule out semantic gaps or prove every browser interaction.

## Modularity and refactoring

`project/cards.js`, `project/nodeTypes.js`, `project/dependencies.js`, pure state functions and `editor/DocumentHistory.js` provide useful, focused capabilities. Geometry, input, renderer and motion settings already live outside the deck. Preview lifecycle and inventory rendering also have explicit owners.

Complexity is concentrated in `engine/CardDeck.js` (1,747 lines), `engine/renderer.js` (575), `project/ProjectController.js` (410), and compact orchestration/inspector modules. Raw line count understates the density of one-line model and studio functions. The main cost is understanding coupled transitions and tracing mutation, rather than simply finding a file.

Refactor in small steps:

1. Consolidate effective Item collection mechanics and persistence results around the confirmed defects.
2. Extract DOM-free studio commands from `studio/editor.js`; retain history as the atomic document boundary. Commands should receive a draft and explicit IDs rather than depend on temporarily reassigned module globals.
3. Separate validation, legacy migration and package remapping from `project/model.js` behind its current public exports. Preserve compatibility behavior and round trips.
4. Document and consolidate controller transition prediction and execution so they use the same mechanics. Keep their timing distinct.
5. Extract a deck choreography subsystem only around a demonstrated ownership boundary, such as accepted departures and their teardown. Preserve event timing and renderer contracts. Avoid splitting the file mechanically into helpers with shared mutable internals.

Format touched complex functions for readability. A repository-wide formatting change would obscure the meaningful changes and is unnecessary for this audit.

## Scalability and performance

Editor changes currently clone full documents, compare serialized snapshots, normalize, validate, serialize for storage and rebuild graph/library/inspector UI. `DocumentHistory` bounds history at 80 snapshots, which limits count but makes retained memory proportional to document size times history depth. Graph indexes improve lookups within a render, but graph DOM and edges still rebuild (`studio/GraphView.js:33`).

Placement resolution scans the Library (`project/cards.js:23`), and compilation resolves many placements. Build definition indexes scoped to a compilation or document revision before considering persistent caches. This preserves correctness across undo, import and local-card changes.

Synthetic desktop Node measurements, warm-up followed by five samples and median milliseconds:

| Workload | 100 nodes | 1,000 nodes | 5,000 nodes |
| --- | ---: | ---: | ---: |
| Validate, one shared definition | 0.22 | 1.30 | 3.96 |
| Compile, one shared definition | 0.30 | 1.92 | 8.89 |
| New history plus one edit and document copy | 0.29 | 2.85 | 13.00 |
| Save preparation with no-op storage | 0.31 | 2.08 | 7.94 |
| Validate, one unique definition per node | 0.3 | 3.9 | 30.2 |
| Compile, one unique definition per node | 0.4 | 7.7 | 64.2 |

These simple Linear graphs isolate CPU work. They exclude DOM, actual localStorage writes, varied mechanics, images and mobile hardware. The library-cardinality difference supports targeted indexing; it does not establish a supported project size. Measure end-to-end edits, dragging, undo and preview startup with realistic large projects before introducing incremental DOM rendering or history patches.

The staged site contains 165 files totaling 79,178,946 bytes. Images occupy about 71 MiB and dice about 4.3 MiB. This is deployment size, not initial page transfer. Original PSDs are excluded. Preserve original art; produce separate optimized derivatives if device traces show decode, upload or texture-memory pressure. Loading a subset of images does not incur the entire catalog's payload.

The engine has an activity-driven animation scheduler and explicit reduced-motion/background handling. Pointer paths can also render immediately, so high-frequency events may produce additional work between frames. Profile before coalescing renders: projected clearance, acceptance timing and cancellation must remain correct. The existing effects comparison measures RAF callback intervals, not GPU time or presented frames; disabled CSS effects also do not eliminate all JavaScript pose/shadow work.

`ProjectController.accepted` retains each ordinary accepted presentation ID until restart (`project/ProjectController.js:24`, `:270`). Deliberately looping chapters can grow this bookkeeping indefinitely. Consider retaining only the markers needed to reject duplicate events for current/in-flight presentations, after testing event reentrancy. This is a lower-priority long-session risk; no memory exhaustion was observed.

Preview state notifications also call structural graph rendering (`studio/editor.js:33`, `:67`). Separating active-node highlighting from graph reconstruction is a small candidate optimization before larger rendering changes. Multiple studio tabs can also write the same local-storage key without conflict detection; address that if simultaneous-tab editing becomes a supported workflow.

## Dead code and compatibility

No safe broad deletion list is established. `chapter/` and retained `editor/` modules serve v1 integrations; the playground and `demo/ScenarioController.js` are documented references. `dice/frame.js` is reached through its iframe document. A module absent from the active player/editor import graph can still serve a supported external or legacy entry point.

Separate three categories in documentation and staging: active runtime, retained compatibility API, and preserved prototype/reference. Keep originals. Make compatibility support and its regression tests explicit before removing or excluding modules. Static staging currently includes legacy editor modules by policy, so bundle size alone does not justify deleting them.

The October 7 scalability review contains a historical staging statement that no longer matches current behavior: it says the editor is excluded, while current staging includes and checks it. Label that verification as historical or update it separately to prevent misleading future maintenance.

## Recommended order

First fix collection semantics and preservation/reporting of saved authoring data. Next verify browser back/forward restoration and close any confirmed lifecycle defect. Then improve studio command ownership and model readability with existing behavior held constant. Finally benchmark realistic desktop/mobile projects and optimize the measured bottleneck, beginning with revision-scoped Library lookup indexes where supported by the measurements.

Include the small Random arithmetic fix and bounded acceptance bookkeeping in subsequent hardening. A future runtime manifest could make staged compatibility modules explicit without removing preserved source. Vendor internals and dynamically constructed URLs remain outside the staging reference check; real dice initialization and teardown need a browser check.

Keep native JavaScript modules, the static/local operating model, originals, deterministic geometry and the gameplay/presentation split. Backend collaboration, a framework migration and a general plugin system are outside the current product need.

## Verification and delivery state

- All 920 tests pass, zero skipped, using the bundled Node executable with `--test tests/*.test.js`. `npm` is absent from this shell PATH; the checked package script invokes the same test runner.
- `python3 build_pages.py /tmp/nest-audit-20261016` passes, including local HTML/module/CSS reference verification. Staging is outside source assets.
- No live browser, physical touch device, real dice physics, GPU trace or back/forward-cache check was performed in this audit.
- Runtime code and original assets were not modified by the audit. The existing Random node icon change was staged for the requested checkpoint; commit creation was blocked by missing Git author identity. The user was asked for the name and email. No commit or publication is claimed.
