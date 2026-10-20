# Shared action context panel

`studio/ActionContextPanel.js` owns the stationary details below the selected action.
Its single caption and content container switch between item-trigger details
(`USING` and an artwork mini), stat checks (stat/value, percentage and chance
label), and roll results (`TARGET / CHECK` and `SUCCESS` or `FAILURE`).
The result caption is the very same node and keeps the same typography and
position. Outcome text uses NestVitals; failure uses the darker small-text color. Checks take precedence when both are present, preserving current behavior.

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
| `--action-content-offset-y` | `15px` | Move the large cards and context panel down together |
| `--action-context-height` | `190px` | Reserved context row height |
| `--action-context-inset` | `24px` | Space above the common caption |
| `--action-context-content-gap` | `14px` | Caption/body and odds/label spacing |
| `--action-context-mini-height` | `110px` | Artwork mini height; width follows 3:4 ratio |
| `--action-context-chance-size` | `105.6px` | Display font size for the percentage |
| `--action-context-label-size` | `20px` | Success-chance label size |
| `--action-context-odds-lift` | `15px` | Move percentage and odds label up together without moving the caption |

The existing `--playfield-gap` controls space between stage rows. A named container
query supplies compact values for frames at most 700px tall. Project card colors
and small typography also apply to the panel.

Percentage and odds labels use five color steps at the 20%, 40%, 60% and 80%
chance thresholds. The dark endpoint uses 65% of the small-style color mixed
with black; the midpoint uses 80% of the medium-style color mixed with black.
Low and high interpolate halfway between these anchors and the unchanged
big-style color used for very high chances. The stat caption keeps its own color.

The panel owns one 140ms opacity transition. A separate shared `CardBackdrop`
uses the same fade duration and stays visible across drawer/USING/odds handoffs.
Its transparent edge starts 24px below the stationary card area (including fan
clearance), then reaches solid black over the original 30px ramp. It observes
card-area and surface resizing and converts viewport coordinates into the
surface coordinate space, including studio zoom. The backdrop sits above the
stack and below context content; it never moves with the inventory camera. Empty context
retains the last painted contents during fade-out while immediately disabling
interaction and hiding the panel from accessibility APIs. Stop/restart clears it
immediately. Reduced motion disables the transition. The shared caption is part
of a polite, atomic live region with the rest of the panel.

A committed card swipe starts fading the entire caption and content. Partial
and cancelled swipes keep the panel visible. The target caption appears in this
lane only together with the completed check total and success/failure outcome; the legacy
target label on the card reverse has been removed from the renderer.

Direct changes between selected actions update live content immediately. A
non-interactive, accessibility-hidden copy of the outgoing content crossfades
with the incoming view over 140ms using the Web Animations API. There is no
queued content swap or animation timer. During rapid selection, already painted
outgoing copies are retimed together with the new view. The transparent content
group is isolated and uses additive (`plus-lighter`) blending so its opacity
weights sum to one, avoiding the midpoint dimming of a source-over crossfade. Empty
context fades the whole panel; teardown cancels and removes all visual copies.
Reduced motion skips the crossfade.

Drawer and context minis use a 2px border (`--mini-border-width` on a shared host
can override it). Pressed/held minis and moving drag previews use the project's
HIGH odds color step (a blend of dimmed medium text and big text), one step below
the brightest text, for their stroke. The drawer surface receives the
same project palette as the context panel so custom themes stay consistent.

## Verification fixture

`tests/fixtures/trigger-item.html` provides compact/tall frames, 80% studio zoom,
stat checks and a container-to-action handoff. Arrow keys browse the item-trigger,
plain and checked actions without restarting playback. Unit tests cover mode
selection, fade state, interaction cancellation and playback teardown. Browser
layout and input checks remain distinct from those deterministic tests; physical
touch and screen-reader output need device verification.
