# Architecture and working assumptions

These working assumptions include the October 7 presentation discussion and implemented October 9 project-library mechanics. Preserve source documents and assets while evolving the runtime.

## Project mechanics and extensions

Project v2 (`kind: "nest-project"`) is the active authoring format. A project owns a Library, variables and chapters; nodes place shared definitions and own their connections. Narrative, Action and Item are explicit card kinds. Linear, Fork, Container and Random are graph behaviors. Null targets end the chapter; automatic chapter destinations and combat are deferred.

- `project/cards.js` owns card-kind descriptors, shared defaults, mechanical summaries and placement resolution. Definitions store name, optional heading, description and artwork. Placements store added conditions/effects and optional action mechanics overrides. Item placement effects append after the definition’s `onCollect` effects during resolution; collection prediction, authorization and completion consume the same resolved list. Overrides replace the corresponding shared mechanics; placement conditions/effects then append. Artwork/content stay shared unless the author creates a variant.
- `project/model.js` preserves the public project API as a re-export facade. Internal responsibilities live in `model-data.js` (factories, traversal and variants), `graph.js` (outputs, labels and cycle detection), `normalization.js`, `compilation.js`, `migration.js`, `packages.js` (parse/import/export) and `validation.js`. These modules import their owners directly and form an acyclic dependency graph; existing callers can continue importing from `model.js`. Compilation resolves placements and chapter initial variable overrides into a detached runtime chapter. Exported `nest-chapter` packages include referenced definitions and their dependency closure plus project variables. Imported packages use collision-safe IDs and rewrite references together.
- `project/nodeTypes.js` centralizes node labels, native slot kinds, default card kinds, creation defaults and outputs. Creation, validation, graph labels, preview labels and native inspector card controls consume these descriptors. Add a descriptor and implement the new gameplay semantics explicitly in the controller; this registry does not infer routing or animation behavior. Legacy outputs and labels remain supported.
- `project/dependencies.js` analyzes placement and gameplay references, including inventory aliases, conditions, costs and effects. Portable export, Library usage reporting and deletion protection share this analysis. Library's **Clean unused local cards** action removes only local definitions unreachable from any chapter or retained shared definition, preserving transitive dependencies. Cleanup is explicit and undoable; unused shared definitions are kept. `definitionUsers` remains the placement-only API for compatibility and occurrence selection.
- `project/state.js` owns pure condition evaluation and atomic transactions for bounded variables, costs, effects and single-item ownership inventory. Inventory matches definition IDs and preserved legacy aliases; ownership is unique by definition.
- `project/ProjectController.js` owns graph execution, session state, action checks and item/use timing. New Random nodes select one eligible weighted node destination and then follow its normal connections, with a fallback when no route is eligible. Checks belong to Actions, with Success/Failure outputs; the controller interprets dice results, never the dice physics service.
- `project/storage.js` autosaves drafts under `nest.project.v2`. If absent, it reads and migrates `nest.chapter.v1` without removing the old key. A malformed v2 save is reported rather than silently replaced by a legacy save. Exact damaged text is backed up and the backup verified before autosave can replace the primary key; failed backup prevents replacement. The studio retains a recovery warning and offers a raw recovery download until a full project import explicitly adopts a replacement. Save failures remain visible across other status messages until saving succeeds. Full project exports/imports accept authoring drafts; chapter exports/imports and player validation remain strict.
- `studio/editor.js`, `GraphView.js`, `inspectors.js`, `forms.js` and `commands.js` separate Library/Chapter UI, graph interactions, structured authoring controls and edits. Library user links expose shared-edit scope; variant creation copies content while node duplication retains shared definition references. `studio/document-commands.js` receives a detached project, explicit selection IDs and command data; it performs form/inspector/graph/document mutations and returns explicit navigation changes. `studio/document-session.js` finalizes each history transaction in order: placement normalization, connection synchronization, then refresh of cached local-definition dependencies against the previous Library. Failed transactions reset the cache and publish neither a replacement document nor navigation changes. The UI owns DOM reads, graph cancellation, rendering, clipboard/download effects, save-status handling and history navigation; it never temporarily rebinds the rendered project to a mutable history draft.
- `editor/DocumentHistory.js` remains the transaction/undo boundary. Failed edits leave the history unchanged; no-op edits preserve redo. Graph gestures edit detached copies and commit movement at completion; canceled gestures roll back. Selection and viewport remain UI concerns.
- `studio/ProjectPreview.js` owns live deck/controller/dice lifetimes and result overlay. It validates and snapshots a project before compiling its selected chapter. Stop releases playback; destroy additionally removes host listeners and inventory UI. `studio/InventoryView.js` renders owned items, inspection and Use, delegating all state mutation to the controller.
- Preview generations prevent synchronous host callbacks and stale dice/result completions from reviving or disturbing replaced playback. Destroy is terminal and idempotent. V1 and v2 previews share dock-style ownership through `editor/dockOwnership.js`, preserving other previews and preexisting host styling.

The `chapter/` and `editor/` v1 modules remain for compatibility and independent integrations. V1 migration prefixes variables with the chapter ID and assigns stable inventory aliases. Simple linear/container/decision-only nodes become placements; old random pools become `legacyPool` and complex internal forks become `legacySequence`. Legacy behavior is preserved rather than silently rewritten into new Random semantics. Shared definitions remain editable for migrated cards.

## Presentation can change independently

For v1 integrations, `chapter/presentation.js` is an injectable policy. It maps semantic sequence behavior to entry presentation, within-sequence presentation and outgoing transitions. The current visual rule is **after the outgoing content**: Linear reveals face-up within its node and turns when leaving it; Fork turns, and clearing Container turns. This includes chapter completion. Animation settings must never decide graph routing or inventory results.

`engine/CardDeck.js` coordinates gesture routing, phases, item acceptance/removal, content handoff, event timing and the sole animation frame loop. `engine/DeckInteractionMotion.js` owns grab springs, delayed follower history/ranks and reflow offsets. `engine/DeckEntranceSequence.js` owns contextual entrance queues/deadlines and browse-hint clocks. The motion components accept explicit values or narrow spring-stepping callbacks; they never import the deck or renderer, emit events, schedule frames or adopt content. `CardDeck` retains eligibility decisions, pose capture and painter-order reads, exposes compatible field accessors backed by the components' sole state, and preserves its existing methods. `engine/renderer.js` owns poses and physical staging; `engine/geometry.js` owns projection/clearance. They should remain independent of chapter types, dice success thresholds and game-specific stats. Content flags are renderer contracts, not imports from chapter registries.

`engine/motionProfile.js` is the default motion tuning source. `CardDeck({ settings })` and `updateSettings()` override it. The legacy `Preview` accepts `deckSettings` and a `presentation` policy; `ProjectPreview` accepts `deckSettings`, so hosts can try another feel without editing mechanics or chapter JSON. No exaggerated preset is enabled by this cleanup.

`engine/card-deck.css` exposes host-scoped appearance tokens: `--card-radius`, `--card-border`, `--card-background`, `--card-font`, `--card-padding`, `--card-text`, `--card-title-color`, `--card-font-size`, `--card-action-border`, and `--card-back-background`. Override them on a deck or its parent for another visual style. Defaults preserve the current appearance.

The card-stock appearance experiment follows checkpoint `aba4b44`. A masked gradient rim, shallow inset bevel and three layered edge shadows suggest thickness without changing card geometry or input. `--card-edge-highlight`, `--card-edge-shadow` and `--card-edge-strata` control the material. The renderer combines the edge strata with its elevation-dependent shadow on fronts, and retains the strata on reverse faces. This is a visual thickness effect, not extruded 3D geometry.

Keep the existing choreography invariants when changing the feel: prepare successors before dragging, avoid ghost cards during incoming turns, use real projected clearance, block input during accepted transitions, cancel without changing game state, and honor reduced motion. Visual effects finish through completion events; gameplay commits once.

### Playback event contract

- `commit` accepts ordinary progression. Chapter rules apply its effects once; the controller supplies the requested successor presentation.
- `collect` / `discard` accept an item gesture. They stage resolution; collected ownership and item effects apply only at the matching `transitioncomplete` event with the accepted content ID.
- A final item completes its removal before the outgoing `commit` completion adopts the staged graph destination. That latter completion may carry the incoming content ID; do not assume every completion identifies the outgoing card.
- `reset()` cancels pending motion and content, `finishMotion()` completes accepted work, and `destroy()` releases input, listeners and animation resources. Hosts release their controllers as well as the deck.

These are integration boundaries, not a reason to add chapter rules inside the deck. See `tests/chapter-engine.test.js`, `tests/item-resolution.test.js` and `tests/state.test.js` before changing event timing.

## Dice are a context-independent capability

Reuse the actual solution from `gerdax/onejournal`, not a new homemade dice simulator. Dice rendering/physics must be callable from any context: cards, encounters, menus, inventory interactions or future mechanics. A roll returns dice results; the caller decides their meaning. Do not bake pass/fail, character stats, combat or a mandatory Dice Test node into the service.

The standalone service and demo are documented in `docs/dice-service.md`. Keep vendor licenses and provenance. The capability must have explicit mount, asynchronous roll, clear/cancel and teardown behavior, including interruption before settling. Multiple contexts must not share hidden UI state.

## Run inventory and checks

Inventory is run-scoped and owns at most one of each Item definition or preserved legacy alias. Collection and `onCollect` effects commit only after the accepted take departure completes; discard never grants ownership. Use atomically removes ownership and applies conditional use effects. Numeric bounds clamp effects, including use at a full resource value; ownership is consumed. Key items have inspection but no use action. Equip slots and combat remain deferred.

Actions default to a `1d20` check with modifier 0 and target 10; a sum plus fixed/variable modifiers at least the target succeeds. The existing dice service runs in a host-owned overlay. Completed success and failure spend attempt costs and apply common/outcome effects. Cancellation, interruption and resolution errors change no state. Inventory use is blocked during the check. Routing, transaction validation and costs must succeed together before state is committed.

## Verification and scope

Registry refactors must retain valid JSON round trips, legacy playback, random selection, direct Linear progression, Fork outputs and Container collection/discard behavior. Test presentation independently from semantic routing. Browser checks complement deterministic geometry tests. Dice browser checks must use the real bundled physics/worker assets, not only mocked roll results.

This work is local until publication is explicitly requested. No backend, collaboration, eligibility system or new gameplay pillar is introduced by this refactor.

## Universal run-state layer

`project/state.js` supplies typed initial values, pure requirements and atomic bounded-variable/inventory transactions. Project variables provide shared definitions; each chapter may override its initial values. Compilation snapshots source data before resolving nested mechanics or normalizing legacy fields, so neither source edits nor runtime edits cross that boundary. `chapter/state.js` remains for v1 integrations. See [state authoring](state-system.md) for supported conditions, costs, effects and timing. Neither layer evaluates scripts. Chapter node loops are opt-in; automatic routing loops remain bounded.

## Scale and remaining measurement

Card rendering shares measured dimensions, presentation slots and hint follower indexes within each render, then rebuilds them for the next frame. Standalone pose queries measure current state independently. Full graph rendering builds node, element, port and Library indexes, avoiding repeated node/DOM/Library scans while drawing edges and dragging. Preview notifications update only the previous/new active-node classes, leaving graph markup, focus, viewport, selection and gestures intact. Document edits and chapter/mode changes still rebuild the graph; route/output lookup costs remain. Document history keeps bounded full snapshots and edits still validate and save the project. Measure representative large projects before introducing incremental rendering or compact history; deterministic tests do not establish large-project performance.


## Model and studio refactor verification — 16 October 2026

The refactor retains the model facade’s 16 exports, validation errors/order, detached compilation, migration and collision-safe package behavior. Source comparison found no semantic changes to the extracted model declarations. A separate baseline probe matched 188 old/new operation results, including errors, across valid, draft, malformed, legacy and collision cases.

All 961 deterministic tests pass with none skipped. The suite includes facade/dependency checks, explicit studio draft ownership, transaction rollback, cache-refresh ordering, no-op redo preservation, save-failure retention, import undo and Add-beat placement after canceled canvas panning. Static staging to `/tmp/nest-model-studio-pages-20261016` passes local reference verification. Browser smoke checks with isolated in-memory storage covered chapter creation, field editing/undo/redo, container creation, shared/local Item source switching with cached restoration, and actual draft export; the checked flow had no console warnings/errors. Astra independently reviewed the model boundaries and studio behavior mappings. Physical devices, real dice physics and browser back/forward-cache restoration were not checked in this refactor.


## CardDeck motion ownership

Motion extraction preserves the deck's transaction boundary: accepted item departure and matching removal completion remain separate; synchronous listeners may reset, destroy or replace the deck, so identity/lifecycle guards stay beside event emission. Entrance completion similarly retains its content-identity checks before emitting selection. Reduced motion, background completion, resize, reset and destroy remain coordinated by the deck.

Reflow must clear existing offsets before capturing destination poses, then create the new differences. Contextual entrances retain the 200 ms initial pause and 120 ms start spacing; flip/depth readiness gates starts without restarting that pause. Grab delays and follower ranks are captured when vertical input is recognized. Both motion components run only through the deck's existing scheduler.

Use `tests/fixtures/deck-motion.html` for isolated browser exercises of choices, containers, canceled lifts, reversal, contextual insertion, collection, handoff and reduced motion. Its simulation controls call the real deck APIs and do not establish physical touch behavior. The existing inventory drawer fixture remains the browser check for deposits and replacement confirmation.


### CardDeck extraction verification — 16 October 2026

All 972 deterministic tests pass with none skipped. New component regressions cover instance isolation, precise reset scopes, writable facade references, grab/follower timing, entrance/hint deadlines, DOM-independent execution, idle measurement avoidance, and clearing prior reflow before capturing new destination poses. Existing acceptance/completion, cancellation, reentrancy and lifecycle tests remain unchanged.

A deterministic comparison against the committed deck matched 1,398 event, pose and state snapshots exactly across reveals, follower browsing, canceled lifts, ordinary/open-content handoff, nonfinal/final collection, group discard, contextual insertion, reset, reduced motion and background completion. Astra independently reviewed the ownership and lifecycle boundaries and passed 230 focused tests with no blocking findings. Static staging to `/tmp/nest-deck-final-pages-20261016` included both new engine modules and passed local reference verification.

Real-browser checks used isolated fixtures with no saved project edits: choice reveal/canceled-lift/browse, contextual insertion and completion, ordinary content handoff, simulated downward/upward container reversal, nonfinal item removal, reduced-motion discard handoff, keyboard final deposit during embedded preview resize, and full-inventory replacement cancellation/confirmation. The tested flows reported no console warnings/errors. The simulated gestures do not establish physical pointer/touch behavior, and no physical-device, GPU-performance or browser back/forward-cache validation is claimed.


## Library indexing and preview graph performance — 16 October 2026

`project/library-index.js` provides first-match definition and Item-definition lookups scoped to a normalization, validation, compilation or full graph-render operation. The maps retain live definition references, not resolved-card snapshots, and are rebuilt for new operations/renders. Existing two-argument placement resolution remains available. Validation/dependency maps keep their separate last-match duplicate semantics; contextual Item lookups keep their kind-specific first match. Malformed Library entries fall back to the original scans so early-match/error behavior is preserved. Validation constructs the inventory-effect Item-ID set once rather than once per effect.

`GraphView.setActive()` updates its active ID and at most two existing node classes; a repeated same-node notification performs no DOM writes. `studio/preview-highlight.js` scopes IDs by chapter to avoid highlighting a same-ID node in a different chapter. Full graph rendering remains on document edits/navigation and rebuilds its Library index. `ProjectPreview` has a separate optional `onStop` notification after playback clears; it does not add stop events to `onChange`. Generation and destruction guards protect synchronous observers that stop, replace or destroy playback.

Synthetic desktop Node medians in milliseconds (two warm-ups; seven samples with before/after order alternating; same valid Linear fixtures, one placement per beat):

| 5,000-beat workload | Validation before | Validation after | Compilation before | Compilation after |
| --- | ---: | ---: | ---: | ---: |
| One shared definition | 3.52 | 3.59 | 8.26 | 8.03 |
| One distinct definition per beat, plus seed definition | 29.28 | 4.86 | 55.53 | 12.93 |
| Distinct definition plus Item grant per beat (10,001 definitions) | 1,659.80 | 6.73 | 112.56 | 20.47 |

These isolate CPU work; they exclude browser DOM/layout, localStorage writes, image decode and mobile hardware. They demonstrate removal of repeated Library/effect-set scans, not a supported project-size limit. Benchmark artifacts: `/tmp/nest-library-benchmark.mjs` and `/tmp/nest-library-benchmark-results.json`.

Verification: 993 tests pass, none skipped; 220 baseline/model operation comparisons match including errors and invalid inputs; static staging to `/tmp/nest-performance-pages-20261016` passes local reference checks. Astra independently reviewed indexes, graph updates and stop reentrancy, with no remaining blockers. Regression coverage includes first/last duplicate handling, contextual kinds, live mutations, replacements, shared/local overrides, malformed inputs and bulk lookup counts; highlight tests cover DOM identity, zero same-node writes, active node/pan/connect gestures, pending links, chapter-scoped IDs and lifecycle observers.

Instrumented real-browser verification used an isolated in-memory save store. Preview start, narrative progression, reveal, collection, automatic routing and Stop caused zero graph child-node changes and eight active-class changes, preserving the editor selection. A document edit and undo/redo still rebuilt the graph and refreshed displayed content. The tested browser flow reported no console warnings/errors. Physical touch, mobile/GPU performance and browser back/forward-cache behavior remain unverified.

## Browser history and large-project validation — 16 October 2026

Studio/player and dice cleanup now preserve live resources on persisted `pagehide` departures; terminal departures still clean up. Idle `GraphView.cancel()` clears interaction tracking without rebuilding nodes, while active cancellation retains rollback. The browser benchmark measured 43→22 graph rebuilds over seven edit/undo/redo cycles, with persistence and recovery checks unchanged.

The [browser validation report](browser-validation-2026-10-16.md) records actual Chrome Back/Forward restoration, a representative 480-beat workload, matched timing summaries, reproduction commands and unverified platforms. All 1,001 deterministic tests and static staging pass. This later pass verifies Chrome BFCache behavior that the preceding checks explicitly left unverified; mobile/touch and active GPU dice restoration remain unverified.

## Portrait standalone player — 16 October 2026

The standalone player now follows the interaction preview's resources/card/inventory composition. A stable viewport budget preserves the 3:4 engine mount and reserves drawer space while hidden; auxiliary controls and Run state live in a collapsible Controls panel. Shorter-than-target viewports can scroll rather than forcing smaller typography. Shared engine, editor and preview styles are unchanged.

The [portrait layout report](portrait-layout-2026-10-16.md) records the 13-case viewport matrix, collection/replacement/use/dice checks, sample-copy fit, independent Astra review and remaining physical-device limitations.
