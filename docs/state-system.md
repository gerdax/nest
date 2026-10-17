# Project run state and authoring

Project v2 defines variables once for all chapters. In **Project settings** (open it with the **Project settings** button in the header), create named flags or numbers with typed default values. Numbers may have optional minimum/maximum bounds. **Chapter settings → Chapter initial values** overrides those defaults for one chapter without redefining variables. A playback session compiles these initial values from its snapshot; restart resets variables and inventory. Expand **Run state** under the preview to inspect live values.

The player HUD displays Health and Energy when the project defines numeric variables with IDs `health` and `energy`. It uses their authored values and maximum bounds; playback does not add variables or change their definitions. Flags with these IDs remain ordinary flags and have no numeric HUD meter. Agility, Intelligence and Composure are available in the contextual stat-check panel rather than the global HUD.

## Requirements, costs and effects

Rules are structured data; no JavaScript is evaluated. Variable conditions support equals, does not equal, at least and at most; flags support equality/inequality. Inventory conditions check owned/not owned against item definitions or preserved migration aliases. All conditions must pass. Action placements choose whether unmet requirements hide the action or show it disabled. Costs also determine affordability. If no action is available, the author must supply a usable route; the runtime does not invent a destination.

Conditions check state without changing it or spending resources. Effects set/add variables or add/remove item ownership. Numeric values are clamped to their bounds; overflow and invalid item removal fail atomically. Narrative and direct-action effects apply once on accepted progression. Item `onCollect` effects apply once for the completed take and never on discard. Each item definition can be owned once; aliases preserve old v1 checks. Action placements use source rules or one complete customized rule set. Existing additional Action conditions/effects are folded into customized rules for shared cards or into the source for Custom cards on load. Other card types retain placement conditions/effects appended to shared rules.

An Action can use a **Stat check** (`3d6 + Agility/Intelligence/Composure ≥ 10 + difficulty`) or a **Custom check** (existing dice/modifier/target, default `1d20 + 0 ≥ 10`). Stat checks show the exact success probability to one decimal place and a contextual panel with the stat value and formula. Common effects and Success/Failure effects commit with costs after the completed roll/result and valid routing. Both success and failure spend attempt costs. Escape cannot cancel a committed roll; editor Stop/Restart or interruption/technical error aborts without spending or applying effects. Direct actions spend costs and apply common effects in the same atomic transaction. Dice physics remains independent of this interpretation. See [Stats and card-based checks](stat-checks.md) for progression and presentation details.

New Random routes filter their weighted destinations using conditions. Narrative cards whose placement conditions fail are skipped; ineligible container items are omitted. Empty eligible containers continue. **Project settings → Allow beat cycles** enables revisits across all chapters and is checked by default. A runtime traversal guard blocks automatic routing-only loops with an **Automatic routing cycle** error; internal card cycles in legacy sequences are rejected by validation.

## Items and consumables

The item inspector separates rules by when they apply:

- **Appearance conditions** belong to a placement (the item instance in a story beat). All must pass for the item to appear at that location. They do not restrict inventory use after collection.
- **On collect effects** belong to the source definition (`onCollect`). Taking the item grants ownership automatically and applies these additional effects; discarding it applies none.
- **Use requirements** belong to a consumable's source definition (`use.conditions`). All must pass to use the owned item from inventory.
- **On use effects** belong to a consumable's source definition (`use.effects`). Using it removes ownership and applies these effects atomically.

For example, two placements can reference the same potion source. One appears only when a chest is opened; another appears only when a merchant is met. Both share the potion's collection effects, use requirements and use effects. Editing the shared source changes all its placements; editing appearance conditions changes only that placement.

A collectible/key item has no `use` field. A consumable adds `use.conditions` and `use.effects`. Unmet use requirements or transaction failure leave ownership and values unchanged. At a variable maximum, use still consumes the item and clamps the effect. There is no automatic refusal because the resource is full. Inventory use is unavailable during card transitions, checks or after completion.

```json
{
  "id": "tonic",
  "kind": "item",
  "name": "Tonic",
  "heading": "",
  "text": "Restores energy.",
  "image": "./assets/img/pack.png",
  "onCollect": [],
  "use": {"conditions": [], "effects": [{"op": "add", "key": "energy", "value": 2}]}
}
```

This is a Library definition; a container placement might be `{"id":"tonic-loot","definitionId":"tonic"}`. Project variables must define `energy` as a number. `project/state.js` owns pure condition/transaction operations; `ProjectController` owns live state and timing; `studio/InventoryView.js` presents inspection/use without mutating state itself.

## Validation and compatibility

Unknown variables/items, wrong types, out-of-bound initial values and invalid quantities block playback/import/export. Draft autosave retains incomplete references for repair. Removing definitions does not silently rewrite mechanics. Project variable names are display labels; stable IDs identify references.

V1 chapters load through migration with prefixed variable IDs and stable inventory aliases. The retained `chapter/state.js` and chapter controller still support v1 integrations. V1 saves lack the new item-use interface until migrated. Equip slots, combat, arbitrary scripts and persistent cross-run state are deferred. Deterministic tests cover rule calculations and timing contracts; they do not establish editor/browser/device behavior.

Item quantities are currently disabled: each collected card grants one owned item, repeated collection does not stack, and item effects/costs add or remove that ownership. Existing quantity fields are discarded on load/export; former inventory quantity comparisons become Owned/Missing requirements. Numeric resource amounts remain configurable.
