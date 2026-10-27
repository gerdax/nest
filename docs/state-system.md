# Project run state and authoring

In **Project settings**, create global flags or numbers with typed default values. In **Chapter settings → Chapter variables**, create variables available only within that chapter. Numbers in either scope may have optional minimum/maximum bounds. Rule pickers label these as **Global: Name** and **Chapter: Name**. Local cards, placement rules and Random routes can use both scopes; shared Library definitions use global variables only. **Chapter settings → Global variables overrides** overrides global defaults for one chapter. Chapter variables use their own defaults. Names can match across scopes; internal IDs remain distinct. A card using chapter variables, including through item dependencies, must switch those rules to globals before being added to the Library. Chapter exports preserve local definitions, and copying beats across chapters copies and remaps their referenced chapter variables. A playback session compiles these initial values from its snapshot; restart restores the chapter's entry state. Expand **Run state** under the preview to inspect live values.

After completing a chapter, **Next chapter** follows the explicit target in **Chapter settings → Next chapter** (`nextChapterId`). **None · End game** ends the game; the order of chapters in storage or selectors never determines progression. Project variables carry forward, except where the destination chapter explicitly overrides a value. Chapter variables always start from the destination's defaults. Only owned shared Library Items carry forward, preserving their identity and remaining Action triggers; local Items disappear at this boundary even if unused. Requirements in the destination can select the same Library definition to recognize an item acquired earlier. Restart restores that chapter's entry snapshot, including carried inventory; choosing a chapter directly or pressing Play starts a fresh run. Reload does not restore campaign progress. **Project settings → Start chapter** (`startChapterId`) selects the beginning of the game; the full-width **Play from the start** button below it starts a fresh run there, independently of the editor selection. The standalone player also opens at this start chapter. All chapter selectors sort names alphabetically without changing stored order. Older projects without a start selection initially use their first stored chapter; missing Next chapter means the game ends.

Inventory rule pickers (requirements, costs, effects and Inventory trigger) offer **Item: Name** and **local: Name** items owned by the current chapter. Shared Library editing offers only Library items. Existing out-of-scope references remain visible as **(unavailable)** so they can be repaired deliberately.

The player HUD displays Health and Energy when the project defines numeric variables with IDs `health` and `energy`. It uses their authored values and maximum bounds; playback does not add variables or change their definitions. Flags with these IDs remain ordinary flags and have no numeric HUD meter. Agility, Intelligence and Composure are available in the contextual stat-check panel rather than the global HUD.

## Requirements, costs and effects

Rules are structured data; no JavaScript is evaluated. Variable conditions support equals, does not equal, at least and at most; flags support equality/inequality. Inventory conditions check owned/not owned against item definitions or preserved migration aliases. All conditions must pass. Action placements choose whether unmet requirements hide the action or show it disabled. Costs also determine affordability. If no action is available, the author must supply a usable route; the runtime does not invent a destination.

Conditions check state without changing it or spending resources. Effects set/add variables or add/remove item ownership. Numeric values are clamped to their bounds; overflow and invalid item removal fail atomically. Narrative and direct-action effects apply once on accepted progression. Item `onCollect` effects apply once for the completed take and never on discard. Each item definition can be owned once; aliases preserve old v1 checks. Action placements use source rules or one complete customized rule set. Existing additional Action conditions/effects are folded into customized rules for shared cards or into the source for Custom cards on load. Vignettes and Captions also use either source progression effects or one customized progression effect set. Existing additional progression effects are folded into custom rules for shared cards or into local definitions, preserving appearance conditions separately.

An Action can use a **Stat check** (`3d6 + Agility/Intelligence/Composure ≥ 10 + difficulty`) or a **Custom check** (existing dice/modifier/target, default `1d20 + 0 ≥ 10`). Stat checks show the exact success probability to one decimal place and a contextual panel with the stat value and formula. Common effects and Success/Failure effects commit with costs after the completed roll/result and valid routing. Both success and failure spend attempt costs. Escape cannot cancel a committed roll; editor Stop/Restart or interruption/technical error aborts without spending or applying effects. Direct actions spend costs and apply common effects in the same atomic transaction. Dice physics remains independent of this interpretation. See [Stats and card-based checks](stat-checks.md) for progression and presentation details.

New Random routes filter their weighted destinations using conditions. Narrative cards whose placement conditions fail are skipped; ineligible container items are omitted. Empty eligible containers continue. **Project settings → Allow beat cycles** enables revisits across all chapters and is checked by default. A runtime traversal guard blocks automatic routing-only loops with an **Automatic routing cycle** error; internal card cycles in legacy sequences are rejected by validation.

## Items and Action triggers

The item inspector separates collection rules from the owned item's lifetime. Shared Items in the chapter panel default to their Library rules. Enable **Use custom rules** to replace **On collect effects** and **Permability** for that placement only; disable it to return to the source values. Custom collection effects may use the current chapter's variables. Appearance conditions remain separate placement rules. Local Items edit these rules directly, without a custom-rules toggle:

- **Appearance conditions** belong to a placement. All must pass for the item to appear at that location. They do not limit Action triggers after collection.
- **On collect effects** belong to the source definition (`onCollect`). Taking the item grants ownership automatically and applies these additional effects; discarding it applies none.
- **Permability** defaults to the source definition (`permability`) and can be overridden per shared Item placement and is a nonnegative integer. The default `0` means permanent. Positive values limit how many accepted Action triggers the owned item can perform: `1` permits one trigger, `2` permits two, and so on.

Actions select an **Inventory trigger** (`contextItemId`) to refer to an owned item. All such Actions share that item's remaining count. Each committed Action attempt consumes one trigger, whether a check succeeds or fails. Blocked, canceled or interrupted attempts do not consume triggers. The final trigger removes the item from inventory. Permanent items remain owned until another rule removes them. Item effects are authored on Actions; inventory inspection has no direct Use action.

For example, two placements can reference the same tonic source. One appears only when a chest is opened; another appears only when a merchant is met. Both share the tonic's collection effects and Permability. Editing the shared source changes all its placements; editing appearance conditions changes only that placement.

```json
{
  "id": "tonic",
  "kind": "item",
  "name": "Tonic",
  "heading": "",
  "text": "Triggers a restorative Action once.",
  "image": "./assets/img/pack.png",
  "onCollect": [],
  "permability": 1
}
```

This is a Library definition; a container placement might be `{"id":"tonic-loot","definitionId":"tonic"}`. An Action placement can reference `"contextItemId":"tonic"` and apply its own effects. `project/state.js` owns pure condition/transaction operations; `ProjectController` owns live state and timing; `studio/InventoryView.js` presents inspection and remaining triggers without mutating state itself.

## Validation and compatibility

Unknown variables/items, wrong types, out-of-bound initial values and invalid quantities block playback/import/export. Draft autosave retains incomplete references for repair. Removing definitions does not silently rewrite mechanics. Project variable names are display labels; stable IDs identify references.

V1 chapters load through migration with prefixed variable IDs and stable inventory aliases. The retained `chapter/state.js` and chapter controller still support v1 integrations. Equip slots, arbitrary scripts and persistent cross-run state are deferred. Combat and committed-health Death routing are documented in [combat](combat.md). Deterministic tests cover rule calculations and timing contracts; they do not establish editor/browser/device behavior.

Item quantities are currently disabled: each collected card grants one owned item, repeated collection does not stack, and item effects/costs add or remove that ownership. Existing quantity fields are discarded on load/export; former inventory quantity comparisons become Owned/Missing requirements. Numeric resource amounts remain configurable.

Full project JSON preserves chapter start and next links. Standalone chapter packages omit external chapter targets; self-links remain valid and are remapped on import. Deleting a chapter clears incoming next links and assigns a new start if the deleted chapter was the configured start.
