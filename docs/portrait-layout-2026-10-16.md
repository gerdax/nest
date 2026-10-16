# Portrait player layout — 16 October 2026

The standalone player now uses the interaction preview's composition: resources, a proportionate card, and the bottom inventory. The previous permanent header, introduction, import/play controls and testing panels are available in a collapsible **Controls** panel. Run state moved there too. Successful play/import closes the panel and focuses the deck; errors reveal the panel. Escape closes it and returns focus to its summary.

## Layout boundaries

All sizing is scoped to `body.standalone-player` in `player/player.css`. No engine, shared preview styles, studio layout, artwork, gameplay rules, typography, motion settings or acceptance/completion timing changed.

The player uses a stable small-viewport (`svh`) height budget, with `vh` fallback. It reserves room for four inventory minis and the Controls lane even when inventory is hidden. The HUD, spacing and padding use the same stable height units, avoiding height-media-query switches as browser toolbars change. Cards use their real engine mount dimensions, a 3:4 aspect ratio and a 276px cap. There is no outer scale transform. The short-screen result is approximately the embedded preview's established 240px card size.

The standalone inventory surface is anchored to the same positioned playfield. Its existing client-rectangle measurement and hit-testing APIs remain in use. Safe-area insets are included in the playfield, drawer, Controls and item-dialog layout; actual phone insets still need device verification. The viewport meta tag opts into `viewport-fit=cover`.

Below 560 CSS pixels of usable height, the playfield allows vertical scrolling rather than continuing to shrink the card. That fallback is intentionally outside the primary 320×568-and-up matrix. Scrolling uses the area outside the card's gesture surface.

## Browser results

Checks ran against the real local player in the Codex in-app browser with explicit CSS viewport dimensions. No user project was saved or changed. Imported fixtures exist only in that player's run; source exports and original assets were preserved.

| Portrait case | CSS viewport | Resting card mount | Result |
| --- | ---: | ---: | --- |
| Short | 320×568 | 239.49×319.32 | Fits, no page overflow |
| Compact | 360×640 | 276×368 | Fits, no page overflow |
| Standard small | 375×667 | 276×368 | Fits, no page overflow |
| Standard | 390×844 | 276×368 | Fits, no page overflow |
| Tall | 412×915 | 276×368 | Fits, no page overflow |
| Tall wide | 430×932 | 276×368 | Fits, no page overflow |
| Existing width breakpoints | 399/400/401 and 419/420/421 ×844 | 276×368 | No discontinuity or page overflow |
| Wider portrait, secondary case | 540×720 | 276×368 | Fits, no page overflow |

For all 13 cases, DOM measurements verified the 3:4 ratio, HUD/card separation, card/drawer separation, four inventory slots at least 44px wide, and a fully visible inventory row. The narrowest slots were 56px. The old 320×568 layout placed the card bottom at approximately 876px; the new layout places it at approximately 391px, above the drawer.

[Measured geometry](benchmarks/portrait-layout-2026-10-16.json) records the matrix. Measurements concern the resting mount; projected faces intentionally change shape and may extend outside it during perspective motion.

Additional observed flows:

- Narrative progression, item reveal and collection kept the resource/card composition stable as inventory appeared.
- A five-item fixture filled four slots. Fifth-item replacement cancellation preserved the current item; confirmation replaced the selected slot through the ordinary collection transaction.
- At 320×480, the document used its 560px scrolling fallback. Scrolling 80px exposed the complete inventory. Collection and replacement still worked. The replacement dialog fit within the viewport at 288×266px.
- Item inspection fit at 320×568 (288×428px). Use consumed the item and changed Energy from 3 to 4.
- A real 2d6 check initialized the dice frame and completed. Its active panel fit at 280×416px, approximately y=76–492 on the 568px screen.
- Native pointer input exercised a small sideways drag without progression and an accepted upward drag that completed the chapter. These were browser pointer checks, not physical touch tests.
- The longest caption found in the preserved sample exports (85 characters) fit at 320×568 using its authored 17px typography with fonts loaded. Its text bounds stayed within the card. Item title, summary and description also fit in the inspected fixture. This is not a promise that arbitrary imported text or oversized authored fonts fit every card; existing excessive-content clipping remains a content constraint. Typography was not silently reduced.
- The existing `?perf=1#performance-mode` shortcut opened both Controls and the performance panel at 320×568; the panel fit at 296×504px.
- Controls remained scrollable on the short screen, import errors remained readable, successful imports returned focus to the deck, and Escape restored focus to Controls.
- The studio interaction preview still used its independent styles and a 3:4 mount. The standalone stylesheet was absent from the studio page.
- No application warnings or errors were captured during these checks. Temporary viewport overrides were reset afterward.

## Repeat the checks

Run `python3 serve.py` and open `http://127.0.0.1:8937/player.html`. Use browser viewport emulation for the dimensions above. Reveal the default Supplies container to check all four empty inventory targets, then collect its item. Verify that revealing the drawer does not change the card mount dimensions.

For replacement and item-use coverage, generate the dedicated fixture and import it using Controls → Open JSON:

```sh
node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {createPortraitProject} from "./tests/fixtures/portrait-project.js"; writeFileSync("/tmp/nest-portrait.json", JSON.stringify(createPortraitProject()));'
```

The fixture accepts `{startNode:"supplies"}` or `{startNode:"route"}` for direct collection/check scenarios, and `{longCopy:true}` for the preserved sample caption. Let reveal/deposit feedback finish between actions. Carousel selection after removal need not follow numeric item order.

## Acceptance and remaining device checks

All 1,001 Node tests pass; static staging verifies all local HTML/module/CSS references across 179 staged files. Fixture variants were separately validated with the production project validator. Astra reviewed the layout boundaries and final diff and found no blocking architecture, lifecycle or geometry issues; browser execution and integration acceptance were performed by the lead.

Viewport emulation does not verify physical touch, Safari/mobile browser toolbar transitions, actual notch/home-indicator insets, text enlargement, fold/unfold behavior, hinge geometry or mobile GPU performance. Wider portrait dimensions are secondary coverage, not a foldable-device certification. Landscape is outside this vertical-game acceptance scope.
