# Architecture and working assumptions

These working assumptions include the October 7 presentation discussion and implemented October 9 project-library mechanics. Preserve source documents and assets while evolving the runtime.

## Project mechanics and extensions

Project v2 (`kind: "nest-project"`) is the active authoring format. A project owns a Library, variables and chapters; nodes place shared definitions and own their connections. Narrative, Action and Item are explicit card kinds. Linear, Fork, Container and Random are graph behaviors. Null targets end the chapter; automatic chapter destinations and combat are deferred.

- `project/cards.js` owns card-kind descriptors, shared defaults, mechanical summaries and placement resolution. Definitions store name, optional heading, description and artwork. Placements store added conditions/effects and optional action mechanics overrides. Overrides replace the corresponding shared mechanics; placement conditions/effects then append. Artwork/content stay shared unless the author creates a variant.
- `project/model.js` owns project validation, compilation, v1 migration and import/export remapping. Compilation resolves placements and chapter initial variable overrides into a detached runtime chapter. Exported `nest-chapter` packages include referenced definitions and their dependency closure plus project variables. Imported packages use collision-safe IDs and rewrite references together.
- `project/state.js` owns pure condition evaluation and atomic transactions for bounded variables, costs, effects and single-item ownership inventory. Inventory matches definition IDs and preserved legacy aliases; ownership is unique by definition.
- `project/ProjectController.js` owns graph execution, session state, action checks and item/use timing. New Random nodes select one eligible weighted node destination and then follow its normal connections, with a fallback when no route is eligible. Checks belong to Actions, with Success/Failure outputs; the controller interprets dice results, never the dice physics service.
- `project/storage.js` autosaves drafts under `nest.project.v2`. If absent, it reads and migrates `nest.chapter.v1` without removing the old key. A malformed v2 save is reported rather than silently replaced by a legacy save.
- `studio/editor.js`, `GraphView.js`, `inspectors.js`, `forms.js` and `commands.js` separate Library/Chapter UI, graph interactions, structured authoring controls and edits. Library user links expose shared-edit scope; variant creation copies content while node duplication retains shared definition references.
- `editor/DocumentHistory.js` remains the transaction/undo boundary. Failed edits leave the history unchanged; no-op edits preserve redo. Graph gestures edit detached copies and commit movement at completion; canceled gestures roll back. Selection and viewport remain UI concerns.
- `studio/ProjectPreview.js` owns live deck/controller/dice lifetimes and result overlay. It validates and snapshots a project before compiling its selected chapter. Stop releases playback; destroy additionally removes host listeners and inventory UI. `studio/InventoryView.js` renders stacks, inspection and Use one, delegating all state mutation to the controller.

The `chapter/` and `editor/` v1 modules remain for compatibility and independent integrations. V1 migration prefixes variables with the chapter ID and assigns stable inventory aliases. Simple linear/container/decision-only nodes become placements; old random pools become `legacyPool` and complex internal forks become `legacySequence`. Legacy behavior is preserved rather than silently rewritten into new Random semantics. Shared definitions remain editable for migrated cards.

## Presentation can change independently

For v1 integrations, `chapter/presentation.js` is an injectable policy. It maps semantic sequence behavior to entry presentation, within-sequence presentation and outgoing transitions. The current visual rule is **after the outgoing content**: Linear reveals face-up, Fork turns, and clearing Container turns. This includes chapter completion. Animation settings must never decide graph routing or inventory results.

`engine/CardDeck.js` owns gesture/choreography state; `engine/renderer.js` owns poses and physical staging; `engine/geometry.js` owns projection/clearance. They should remain independent of chapter types, dice success thresholds and game-specific stats. Content flags are renderer contracts, not imports from chapter registries.

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

Inventory is run-scoped and stacks quantities by Item definition. Collection and `onCollect` effects commit only after the accepted take departure completes; discard never grants ownership. Use one atomically consumes a copy and applies conditional use effects. Numeric bounds clamp effects, including use at a full resource value; the copy is consumed. Key items have inspection but no use action. Equip slots and combat remain deferred.

Actions default to a `1d20` check with modifier 0 and target 10; a sum plus fixed/variable modifiers at least the target succeeds. The existing dice service runs in a host-owned overlay. Completed success and failure spend attempt costs and apply common/outcome effects. Cancellation, interruption and resolution errors change no state. Inventory use is blocked during the check. Routing, transaction validation and costs must succeed together before state is committed.

## Verification and scope

Registry refactors must retain valid JSON round trips, legacy playback, random selection, direct Linear progression, Fork outputs and Container collection/discard behavior. Test presentation independently from semantic routing. Browser checks complement deterministic geometry tests. Dice browser checks must use the real bundled physics/worker assets, not only mocked roll results.

This work is local until publication is explicitly requested. No backend, collaboration, eligibility system or new gameplay pillar is introduced by this refactor.

## Universal run-state layer

`project/state.js` supplies typed initial values, pure requirements and atomic bounded-variable/inventory transactions. Project variables provide shared definitions; each chapter may override its initial values. Compilation and playback own the live values. `chapter/state.js` remains for v1 integrations. See [state authoring](state-system.md) for supported conditions, costs, effects and timing. Neither layer evaluates scripts or permits graph loops.
