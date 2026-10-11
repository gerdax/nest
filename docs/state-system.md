# Project run state and authoring

Project v2 defines variables once for all chapters. In **Project variables and chapter settings**, create named flags or numbers with typed default values. Numbers may have optional minimum/maximum bounds. **Chapter initial values** overrides those defaults for one chapter without redefining variables. A playback session compiles these initial values from its snapshot; restart resets variables and inventory. Expand **Run state** under the preview to inspect live values.

## Requirements, costs and effects

Rules are structured data; no JavaScript is evaluated. Variable conditions support equals, does not equal, at least and at most; flags support equality/inequality. Inventory conditions check owned/not owned against item definitions or preserved migration aliases. All conditions must pass. Action placements choose whether unmet requirements hide the action or show it disabled. Costs also determine affordability. If no action is available, the author must supply a usable route; the runtime does not invent a destination.

Effects set/add variables or add/remove positive integer item quantities. Numeric values are clamped to their bounds; overflow and invalid item removal fail atomically. Narrative and direct-action effects apply once on accepted progression. Item `onCollect` effects apply once for the completed take, not once per copy and never on discard. Inventory is stacked by definition; aliases preserve old v1 checks. Placement conditions/effects append to shared rules, while local action overrides replace the corresponding shared mechanics before those additions.

A check action defaults to `1d20 + 0 ≥ 10`. It sums the dice, fixed modifier and optional numeric variable modifier. Common effects and Success/Failure effects commit with costs after the completed roll/result and valid routing. Both success and failure spend attempt costs. Cancel, interruption or error spends nothing and applies no effects. Direct actions spend costs and apply common effects in the same atomic transaction. Dice physics remains independent of this interpretation.

New Random routes filter their weighted destinations using conditions. Narrative cards whose placement conditions fail are skipped; ineligible container items are omitted. Empty eligible containers continue. This does not enable graph loops: cycles still block validation.

## Items and consumables

An Item definition has `onCollect` effects. A collectible/key item has no `use` field. A consumable adds `use.conditions` and `use.effects`; **Use one** atomically removes one copy and applies those effects. Conditions or transaction failure leave ownership and values unchanged. At a variable maximum, use still consumes a copy and clamps the effect. There is no automatic refusal because the resource is full. Inventory use is unavailable during card transitions, checks or after completion.

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
