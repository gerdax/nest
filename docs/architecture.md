# Architecture and working assumptions

These decisions record the October 7, 2026 discussion. Preserve current game behavior while allowing its presentation and independent capabilities to evolve.

## Chapter mechanics and extensions

JSON v1 remains the authoring format. Node instances own chapter connections; reusable sequences own their content. Static and Random are graph runners. Linear, Fork and Container are sequence behaviors.

- `chapter/nodeTypes.js` owns graph-runner selection, validation and outputs. Random sampling is pure in `chapter/random.js` and receives an injected random source.
- `chapter/sequenceTypes.js` owns reusable sequence defaults, validation, action data, progression, and inspector mode. Add a sequence descriptor here instead of adding type conditionals throughout the controller and validator.
- `chapter/model.js` owns shared JSON structure checks, reference integrity, cycle checks and legacy conversion. It dispatches type-specific validation through the registries.
- `chapter/ChapterController.js` runs the graph, tracks container resolution and inventory, and translates semantic progression into presentation requests. It does not own dice physics, typography or spring tuning.
- `editor/sequenceInspector.js` and `editor/fields.js` render editor controls independently of canvas/persistence code. A new behavior with new authoring fields still needs an inspector mode and its edit commands; the registry does not magically generate arbitrary custom UI.
- `editor/DocumentHistory.js` owns isolated document transactions and bounded undo/redo. Edit callbacks mutate a private draft or return a replacement; failed edits leave history unchanged and no-op edits preserve redo. Intermediate drafts remain editable. Editor gestures work on detached documents and commit node moves through this same boundary; Escape, pointer cancellation and lost capture roll back. Selection, pending wires and viewport state remain UI concerns.
- `editor/preview.js` owns each playback session. `stop()` releases the live deck/controller while allowing replay; `destroy()` also removes restart callbacks, releases shared dock styling and ends the preview's lifetime. Initial host callbacks may synchronously stop or destroy playback without retaining a controller.

Legacy forks in random pools remain compatible with their old v1 semantics. New forks are immediate two/three-card decisions; each choice maps to a node output. Story descriptions belong in Linear nodes. Titles are retained as legacy JSON metadata but omitted from gameplay and normal authoring; Action/Item numbering is not displayed; legacy numbering flags remain inert in saved JSON. The editor exposes one node name, descriptions/artwork and behavior labels. Reusable sequences remain internal content records; reuse controls are collapsed, shared uses are labeled, and duplication copies static content and random pool content independently.

## Presentation can change independently

`chapter/presentation.js` is an injectable policy. It maps semantic sequence behavior to entry presentation, within-sequence presentation and outgoing transitions. The current visual rule is **after the outgoing content**: Linear reveals face-up, Fork turns, and clearing Container turns. This includes chapter completion. Animation settings must never decide graph routing or inventory results.

`engine/CardDeck.js` owns gesture/choreography state; `engine/renderer.js` owns poses and physical staging; `engine/geometry.js` owns projection/clearance. They should remain independent of chapter types, dice success thresholds and game-specific stats. Content flags are renderer contracts, not imports from chapter registries.

`engine/motionProfile.js` is the default motion tuning source. `CardDeck({ settings })` and `updateSettings()` override it. `Preview` accepts `deckSettings` and a `presentation` policy, so hosts can try another feel without editing mechanics or chapter JSON. No exaggerated preset is enabled by this cleanup.

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

## Inventory: discussion pending

Inventory cards should be considered as another standalone capability usable from different contexts. The user requested discussion **after** this cleanup. Do not infer use-item rules, targets, consumption, persistence, equip slots or a redesigned inventory UI yet. The current collected-card strip and session behavior remain in place.

## Verification and scope

Registry refactors must retain valid JSON round trips, legacy playback, random selection, direct Linear progression, Fork outputs and Container collection/discard behavior. Test presentation independently from semantic routing. Browser checks complement deterministic geometry tests. Dice browser checks must use the real bundled physics/worker assets, not only mocked roll results.

This work is local until publication is explicitly requested. No backend, collaboration, eligibility system or new gameplay pillar is introduced by this refactor.

## Universal run-state layer

`chapter/state.js` supplies initial values, pure condition evaluation, effects and state validation. Chapter execution owns the live values. The editor exposes flags, numbers and direct inventory checks through collapsible structured rules. See `docs/state-system.md` for timing and authoring scope. This is not a scripting language or a navigation/loop system.
