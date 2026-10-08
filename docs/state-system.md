# Run state and authoring

State is optional JSON v1 data, independent of animation and dice. Existing chapters without state rules behave as before.

Open **Run variables** at the top of the inspector to define named flags (True/False) and numbers with initial values. Names use letters, numbers and underscores and must be unique. Values reset on restart; playback uses the chapter snapshot taken when Play was pressed. Editing a definition does not alter an already-running preview. Expand **Run state** under the playable preview to inspect current values.

Fork choice cards have a collapsed **Conditions & effects** section. Add variable comparisons (equals, does not equal, at least, at most) or inventory checks (owned/not owned). All conditions must be met. Choose whether unmet requirements hide the choice or show it unavailable. Flags support equality/inequality only. Inventory checks use actual collected item IDs, never duplicated `hasKey` flags. If no choices can be used, the deck displays unavailable choices or a disabled “No available choices” card; the author must provide a usable route. This version does not implicitly skip a blocked node.

Effects set a flag/number or add/subtract a number. Add them to a Linear situation card, a Fork choice, or a Container item. Linear/choice effects apply once when the upward gesture is accepted. Item effects apply only after a **take** departure completes; discard applies none. Final-item destinations are prepared using predicted post-collection state so incoming choices match the collected inventory and effects. A canceled gesture changes nothing. Conditions on entire nodes, sequence eligibility, effect-driven item removal, resource caps, instant-consumable types and arbitrary expressions are deferred.

Variable rules are structured data; no JavaScript is evaluated. Unknown variables/items and wrong value types block playback/import with errors. Incomplete references can still be autosaved as drafts. Removing or renaming a definition leaves references visible as missing so they can be repaired; no hidden rewriting of game rules occurs.

```json
{
  "variables": [{"id":"doorUnlocked","type":"flag","initial":false}],
  "choiceExample": {
    "conditions": [{"source":"inventory","key":"brass-key","op":"has"}],
    "unavailable":"disabled",
    "effects": [{"op":"set","key":"doorUnlocked","value":true}]
  }
}
```

`choiceExample` illustrates fields attached to a real choice; it is not a chapter root field. State helpers live in `chapter/state.js`; chapter execution interprets effects, while the card engine only receives available/disabled cards. Inventory remains run-scoped and its richer use interface is separate future work.

Artwork controls now include a miniature image-and-copy card beside the editable path and existing-artwork picker. It updates when fields change. It previews composition, not gestures or conditional playback; use Play selected for those.

When no variables exist, the Effects panel offers **Create variable & effect**. This creates a flag and its Set effect in one undoable edit, then opens Run variables so it can be named and configured.

Run variable definitions are edited in Chapter settings → Run variables, separate from the selected node. Card, choice and item effects and conditions remain in the node inspector. Creating the first variable from an effect opens Chapter settings for naming it.
