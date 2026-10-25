# Player UI and card context

`studio/PlayerUI.js` owns the player's presentation components: InventoryView, ActionContextPanel, held Item preview, inventory coordinate surface, shared backdrop, resource readouts and status feedback. Existing markup, CSS, sizing, motion and Health/Energy positions remain unchanged. The same owner is used by the standalone player and the studio preview.

`ProjectPreview` translates the current run and deck selection into explicit input, manages playback generations, and hosts the controller/dice services. Gameplay still decides eligibility, costs, Item triggers, inventory ownership and outcomes. PlayerUI never receives the deck or controller themselves.

## Input contract

`PlayerUI.update(input)` accepts:

| Field | Meaning |
|---|---|
| `revision` | Monotonic revision for a gameplay-state notification, not for a card-selection event |
| `run` | Current controller snapshot: variables, collectedItems, idle, checking and completed |
| `card` | Selected resolved Action plus presentation phase and directAdvance flag |
| `interaction` | Current deck busy/dragging flags |
| `feedback` | Final resolved check result and status text/visibility |
| `definitions` | Compiled variables and Item Library used for presentation |

`studio/player-ui-state.js` projects this input into view data. It displays the supplied odds and unavailable reasons; it does not calculate availability, roll dice or transact game state. Concrete trigger selection uses the same pure domain selector as trigger consumption, including tags and legacy aliases.

`ProjectPreview.playerUIInput()` is the single adapter from live playback to that contract. Context refreshes use the same run revision; they cannot cancel a pending pickup/replacement dialog, erase a staged deposit, or rebuild inventory. Controller notifications advance the revision and refresh persistent state. A supplied `getInput` callback lets a hold recheck live interaction readiness between selection notifications without knowing any deck internals.

## Presentation policy

The existing priority is explicit:

1. A completed check result replaces ordinary Action context.
2. An unavailable Action's requirements replace its odds and USING Item.
3. Odds and USING can appear together when both apply.
4. Odds-only and Item-only presentations remain valid.
5. Empty context fades out; Stop clears immediately.

Checking and completion suppress ordinary context. Odds/USING require the exposed choices phase. A disabled directly advancing front can still explain its requirements while closed. The drawer remains an independent persistent/contextual view; it is not made mutually exclusive with Action context. Existing engine exposure and inventory-continuity signals still decide drawer timing. UI visibility never unlocks gameplay input.

## Interaction and lifecycle boundaries

Each `inventoryAdapter` captures one playback generation. Every obsolete callback is ignored, and collection authorization checks the generation before opening UI, after its asynchronous decision, and after domain authorization. All requests delegate to existing controller methods; collection still commits at the matching removal completion.

Stop ends holds and clears context before destroying the old controller/deck, then resets the shared UI. Destroy disposes each owned view/observer once and releases shared dock ownership. Reset permits restart; destroy is terminal. Public `preview.inventory`, `actionContext`, `inventorySurface`, `inventoryCardPreview`, `cardBackdrop`, resource/status references and dock/observer access remain compatibility getters into that single owner.

Dice services, physical-tray mounting, result waits (1100 ms then 200 ms), abort signals and playback generation checks remain in ProjectPreview. PlayerUI only presents the final result until the controller installs its successor.

Run state diagnostics, Go to card and chapter navigation remain host responsibilities in ProjectPreview. PlayerUI mounts their existing footer as an opaque layout slot and measures its height; it does not interpret its controls. The standalone host still moves its Run state control into the diagnostic Controls panel. This preserves the current UI while keeping editor/debug behavior out of the player-presentation component.

## Extending the area

Add persistent player status, selected-card context or feedback through the explicit input and pure projection first. Add a focused view under PlayerUI when existing views are insufficient. Keep rule evaluation and state mutation in the project domain, and send interaction requests through callbacks. Update the priority policy and regression tests when new content shares the same lane. A new visual layout or gameplay mechanic is a separate product change.

## Verification — 25 October 2026

All 2,236 deterministic tests passed with no failures or skips, including the existing lifecycle, presentation, inventory and gameplay suites. New tests exercise context priority, typed resources, non-mutating presentation, preservation of dialogs/deposits on context-only changes, live hold readiness, generation-bound asynchronous authorization, synchronous replacement observers and owner reset/destroy. Astra independently reviewed the code and found no blocking issues; its shell lacked Node, so test execution and acceptance were performed by the lead using the bundled runtime.

Static staging to `/tmp/nest-player-ui-final-pages-20261025` passed local reference verification (260 files / 131,402,668 bytes). The preview shell markup was compared with the committed baseline and is byte-identical; no CSS, game model, controller, engine or source assets were changed. `git diff --check` passed.

Background in-app browser checks used isolated localhost fixtures: combined odds/USING, check-only, Item-only, compact layout, browsing missing-Item and Energy requirements, clearing requirements on an available Action, and embedded keyboard collection followed by narrative handoff. The Run state diagnostic confirmed ownership after collection; closing the preview cleared the UI. The standalone player loaded and progressed, and the actual editor opened its embedded preview with resources and host tools intact. The compact Item-only view was visually inspected. No saved authoring document was edited during these checks.

Physical pointer/touch-device gestures, GPU performance, real dice physics, reduced-motion browser behavior and cross-browser/BFCache restoration were not newly verified. Deterministic coverage of cancellation, result timing, reduced motion and restart does not establish those device/browser checks. Changes remain local and uncommitted; no deployment was performed.
