# Chapter mechanics decisions

The October 9, 2026 decisions below are implemented in project v2. The retained v1 runtime remains available; imported chapters preserve legacy behavior through migration. See [Project studio](chapter-editor.md), [Architecture](architecture.md) and [Run state](state-system.md).

## Random routes to chapter nodes — implemented

A new Random node selects one eligible destination from a weighted list of nodes on the chapter canvas. Route conditions filter eligibility; a fallback handles no eligible route. After the jump, playback follows that node's ordinary connections. Branches converge only where the author connects them. Random does not regain control or count encounters.

Imported v1 random pools become `legacyPool`: weighted selection without repetition, the old selection count and sequence return behavior are preserved. Deliberately replace that node to adopt the new route behavior. Authored, player-driven revisits are supported when chapter beat cycles are enabled. Automatic Director encounter-count/retry orchestration remains deferred; automatic routing-only loops are blocked by the runtime traversal guard, and legacy internal card cycles remain rejected by validation.

## Checks belong to action cards — implemented

Actions are Library definitions placed in Fork nodes. Direct resolution follows one connector. Check resolution follows Success or Failure. Requirements decide availability, costs decide affordability and the check decides the completed attempt's outcome. Choosing an available action starts resolution without an extra attempt card or confirmation.

Custom checks default to `1d20`, fixed modifier `0`, target `10`; configurable dice are summed with the fixed and optional numeric variable modifier. Stat checks use `3d6 + selected stat ≥ 10 + difficulty` and show the exact success probability to one decimal place with a smaller contextual stat-and-formula panel. The global HUD remains Health and Energy only. A total at least the target succeeds. The existing independent 3D dice service supplies the result; the underlying card back shows feedback. A completed attempt spends costs on success and failure, applies common/outcome effects and follows the corresponding connector atomically. Escape cannot cancel a committed check; editor Stop/Restart or technical abort restores the choice without spending. Inventory interaction is blocked during resolution.

A cabinet can therefore offer Use key (Direct), Pick lock (Check with Success/Failure), and Leave (Direct). Each placement owns its destinations. Local action settings can override shared requirements, costs, effects and check configuration; Create variant separates content as well.

## Shared cards, quantities and consumables — implemented

The project Library contains explicit Narrative, Action and Item definitions shared across chapters. Placements own added rules, chapter wiring. Project variables provide defaults and bounds; chapters may override their initial values. Inventory tracks ownership by item definition and supports inspection. Collecting applies `onCollect` effects after take completion; consumable use removes the owned item and applies use effects atomically. At full resource bounds the copy is still consumed and the result is clamped.

Combat, equipment, persistent cross-run inventory, automatic chapter destinations and 4d6 advantage remain deferred. These features are not implied by Random routing, checks or consumables.
