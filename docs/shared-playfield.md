# Shared editor and player layout

The interaction preview is the primary composition reference. Both hosts now load
`studio/playfield.css` and use `.nest-playfield` as their sizing container. The
desktop editor window no longer determines card, HUD, drawer or dice-tray sizing.
The engine mount retains its 3:4 ratio, without scaling a wrapper around it.

The current reference is the reset preview at 359 × 745. A single fit scale
controls game dimensions, typography, HUD, action context, drawer and dice.
Equal-aspect viewport changes preserve the composition proportionally; only
aspect changes redistribute space. Card fan offsets, depth and perspective use
the same scale, while authored motion settings remain baseline values.
The verification results below describe earlier layout passes; their compact
height breakpoint and minimum-height scrolling fallback have been replaced by
this proportional model.

Health and energy use 62px numerals and slightly larger icons in both hosts. The
HUD lane and inventory allowance remain reserved when hidden. Run state and Go to
card remain editor chrome; standalone Controls remains browser chrome. Inventory
dialogs center within the visible part of their host, including scroll fallback.

## Verification

- 1,005 Node tests passed, including explicit inventory-host ownership and native
  dialog geometry for embedded and partially scrolled frames.
- Static staging verified HTML, CSS and module references and copied assets.
- In-app browser: editor frame 312.742 × 649.836 compared with a standalone
  313 × 650 viewport. HUD, card and inventory bounds differ by at most 0.344px,
  consistent with frame rounding. See [measurements](benchmarks/shared-playfield-parity.json).
- Short 320 × 568, standard 390 × 844 and tall 430 × 932 player viewports preserve
  card ratio, HUD/card/drawer separation and inventory targets wider than 44px.
  See [portrait measurements](benchmarks/shared-playfield-portrait.json).
- Editor collection worked after moving the preview; minimize/restore preserved
  geometry and inventory; Go to card selected the source card. Missing resource
  definitions retained the HUD lane. Item inspection and dice panels fit inside
  the actual editor frame. Browser fixtures used isolated storage.
- Astra reviewed the shared boundaries and dialog integration without finding a
  consequential issue for the target portrait sizes. This was source review;
  the lead ran the tests and browser checks.

Physical touch devices, Safari, safe-area hardware, zoom/visual-viewport changes,
and landscape-height windows were not verified. The existing 560px minimum frame
uses scrolling below the supported portrait height; landscape is outside this pass.
The earlier [portrait report](portrait-layout-2026-10-16.md) is historical; its
statement that editor styles were unchanged is superseded by this shared layout.
