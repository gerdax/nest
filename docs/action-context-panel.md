# Shared action context panel

`studio/ActionContextPanel.js` owns the stationary details below the selected action.
Its single caption and content container switch between item-trigger details
(`USING` and an artwork mini) and stat checks (stat/value, percentage and chance
label). Checks take precedence when both are present, preserving current behavior.

`ProjectPreview.syncActionContext()` supplies content and busy state. It does not
measure cards or calculate panel coordinates. `TriggerItemMini` only renders
artwork and handles hold-to-inspect input. The inventory drawer remains a separate
surface because it owns collection, drag previews and dialogs.

The stage in `studio/playfield.css` has three rows: HUD, flexible card area, and a
reserved context lane. Both modes and the empty state use the same lane, so
selection changes do not resize or reposition the cards. The context panel stays
outside the moving inventory inspection camera and above the card stack; the
drawer and footer remain above it.

## Layout controls

Change these CSS custom properties on the stage to tune both modes together:

| Property | Default | Purpose |
| --- | --- | --- |
| `--action-context-height` | `190px` | Reserved context row height |
| `--action-context-inset` | `24px` | Space above the common caption |
| `--action-context-content-gap` | `14px` | Caption/body and odds/label spacing |
| `--action-context-mini-height` | `110px` | Artwork mini height; width follows 3:4 ratio |
| `--action-context-chance-size` | `144px` | Display font size for the percentage |
| `--action-context-label-size` | `20px` | Success-chance label size |
| `--action-context-odds-lift` | `15px` | Move percentage and odds label up together without moving the caption |

The existing `--playfield-gap` controls space between stage rows. A named container
query supplies compact values for frames at most 700px tall. Project card colors
and small typography also apply to the panel.

The panel owns one 140ms opacity transition, including its backdrop. Empty context
retains the last painted contents during fade-out while immediately disabling
interaction and hiding the panel from accessibility APIs. Stop/restart clears it
immediately. Reduced motion disables the transition. The shared caption is part
of a polite, atomic live region with the rest of the panel.

## Verification fixture

`tests/fixtures/trigger-item.html` provides compact/tall frames, 80% studio zoom,
stat checks and a container-to-action handoff. Arrow keys browse the item-trigger,
plain and checked actions without restarting playback. Unit tests cover mode
selection, fade state, interaction cancellation and playback teardown. Browser
layout and input checks remain distinct from those deterministic tests; physical
touch and screen-reader output need device verification.
