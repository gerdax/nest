# nest

[Repository](https://github.com/gerdax/nest) · [Published site](https://gerdax.github.io/nest/)

Three tools share native JavaScript modules and the existing Nest artwork: the project player, project studio, and independent 3D dice tray. No package installation or application build is required. Local changes do not update the published site until explicitly deployed.

## Local development

```sh
python3 serve.py
```

Open `http://127.0.0.1:8937/`; use `--port 8938` for an alternative port. Serve over HTTP so native modules load correctly. The server disables caching, and engine module URLs are versioned together.

- `/` redirects to `/player.html`, which plays a chapter from the saved project or an imported project/chapter JSON file.
- `/editor.html` opens the project studio with Library and Chapter views.
- `/dice.html` opens the independent 3D dice tray.

The player includes an expandable Motion tuning panel with its Copy settings action inside. Tuning applies to the chapter being played and stays available across Play, Restart, and JSON imports. There is no fixture selector; author scenarios in the studio and play their project or chapter JSON. Stat checks show their exact success probability to one decimal place by or below the card, with the stat value and formula in a smaller contextual panel. The global HUD displays Health and Energy.

Run verification with `npm test` or `node --test tests/*.test.js`.

## Card interactions

Ordinary situation cards reveal choices with an upward swipe. Browse actions left or right, then swipe up to choose. The outgoing action stack exposes the next situation's reverse, which flips to its front. Ordinary choices stay open after reveal unless a host explicitly allows closing.

A container starts with its description covering the items. One swipe up reveals the item carousel directly. Browse left or right and drag the selected item down into the four-slot inventory drawer to take it; the remaining cards rearrange smoothly. Swipe up to leave the container and discard all remaining items, with the selected card leading the departing stack. Items already taken stay in inventory. While browsing items, the bottom drawer stays visible over a black-to-transparent gradient. The large card keeps its original size and tilt during the drag. Crossing the upper drawer boundary switches to a separate mini that follows the pointer. Dragging farther down snaps it into the row; only an occupied hovered slot shifts its queue toward the nearest free slot. Hovering an empty slot leaves stored items still; when full, only the hovered replacement target moves down. Reversing above the drawer restores the full card before release. Releasing the floating mini before insertion cancels the pickup. Minis can be inspected or used, but cannot be dragged. A full drawer highlights replacement targets and asks for confirmation before discarding the old item. Keyboard collection uses the next empty slot or offers a replacement picker. Automatic story-effect grants retain their existing behavior for now; overflow remains inspectable and blocks further manual pickups until space is available. Item cards in Linear sequences retain individual upward discard.

Only taken items enter the run inventory. Each Item definition can be owned once; select an item to inspect it. Consumables offer Use, which removes ownership and applies effects atomically. Use remains allowed at a resource maximum: the effect is clamped and ownership is consumed. Key items remain collectible without a Use action. Inventory resets on restart or reload; equipment and combat are deferred.

Taking an item removes that placement from later visits during the run. Discarding a Linear item or leaving a Container skips its uncollected items for the current visit; they remain available on return. Fully collected Containers and item-only Linear nodes skip to their next connection. Narrative and caption cards remain replayable. Restart restores all placements.

The last item exposes the next card's reverse underneath its departure. Discarding upward reveals it from below; taking downward reveals it from above. The reverse flips only after the outgoing item clears the turning area. There is no empty-container screen or extra Continue action.

Keyboard controls on the focused deck:

- Up reveals, chooses an ordinary action, or leaves an open container and discards its remaining items.
- Down and Enter take a container item. Enter chooses an ordinary action elsewhere.
- Left / Right browse.
- Escape cancels an active gesture and does not close an opened container. It cannot cancel a committed check.

Short and canceled gestures restore the card without changing game state. Input stays blocked during accepted removal and the final flip. Reduced motion and tab suspension finish active presentations immediately. Physical touch-device behavior requires separate device verification.

## Engine API

Load `engine/card-deck.css`, give the mount a width and a 3:4 aspect ratio, and set `tabindex="0"`. The host owns narrative progression and inventory; the engine owns rendering and gestures.

```js
import { CardDeck, DEFAULT_SETTINGS } from './engine/CardDeck.js';

const deck = new CardDeck(mount, {
  settings: { ...DEFAULT_SETTINGS },
  content: {
    id: 'crate', interaction: 'container', discardAll: true, allowClose: false,
    title: 'Abandoned crate', text: 'Equipment lies inside.',
    image: './assets/img/box.png',
    actions: [
      { id: 'torch', label: 'Flashlight', image: './assets/img/flashlight.png' },
      { id: 'pack', label: 'Pack', image: './assets/img/pack.png' },
    ],
  },
});

for (const type of ['collect', 'discard']) {
  deck.addEventListener(type, ({ detail }) => {
    // Accepted item gesture. Do not add to inventory until completion.
    if (detail.final) deck.replaceContent(nextSituation);
  });
}
```

- `replaceContent(content)` supplies the next situation during an ordinary commit or accepted final-item departure; it stages the hidden front under the outgoing card for the reverse flip. Replacing during a nonfinal resolution cancels that animation. The host should reset first when abandoning a pending final transition.
- `replaceContent(content, { presentation: 'open' })` retains direct open presentation for authored ordinary action sequences.
- `setActionPreview(actionId, content, { presentation: 'open' })` retains previews for ordinary choices.
- `updateSettings(partial)` changes motion settings without rebuilding the deck.
- `reset()` restores current content interaction; host reset also restores its run and inventory.
- `destroy()` releases listeners and animation resources.

Events:

- `reveal`: the situation uncover is accepted; items or choices expand after the cover clears.
- `selection`: selected action or item changes.
- `commit`: ordinary action accepted, with `{ contentId, action, index }`.
- `collect` / `discard`: item gesture accepted, with `{ contentId, action, index, final }`. With `discardAll: true`, leaving emits `discard` with `final: true`, `all: true` and `discardedIds`; its removal completion has `all: true` and empty `remainingIds`. Omit `discardAll` for individual upward discard in a standalone deck.
- `transitioncomplete`: `collect` / `discard` confirms removal and supplies `remainingIds`. Record inventory only for completed `collect`. On the final item, a later `commit` completion confirms that the next situation's flip and adoption have settled.

Hosts supply final continuation synchronously on accepted `collect` or `discard`. During a held last-item gesture the physical reverse is already underneath, but no host state changes or flip occur before acceptance. Async content can remain staged while the engine waits.

`project/ProjectController.js` runs compiled project v2 chapters, including action checks and single-item ownership inventory. `chapter/ChapterController.js` remains available for legacy JSON v1 integrations. The original playground and `demo/ScenarioController.js` remain as source references; they are excluded from the active staged runtime. `demo/InventoryStrip.js` renders the shared temporary inventory; include `demo/inventory.css` in hosts using it.

## Motion model

Cards use native CSS 3D transforms, perspective, depth separation, edge shading, opaque front/reverse faces, and elevation shadows. Each complete card has its own flattened painter layer so neighboring card planes cannot cut through each other.

Position and angular motion use damped springs. The pointer grab location controls torque; release velocity contributes to the throw. The carousel loops in both directions, with a widened handoff orbit to preserve an 8 px projected gap. Ordinary action followers sample movement history at 30 ms per physical rank. Items move individually and preserve survivor DOM identity and order.

Reveal zoom starts at 91.5% and reaches full size after approximately 16.7% of the card height is exposed. Projected geometry drives exposure and flip clearance in both item-departure directions. The next reverse turns around an axis tilted -1 degree from vertical; the full turning envelope must clear the outgoing card by 8 px before flipping. Reset, destroy, resize, reduced motion, and tab suspension clear or finish pending work safely.

An early pointer press remains captured while the presentation is busy. If still held when ready, the engine begins a fresh gesture from the latest pointer position without replaying earlier movement. Releasing before readiness does not queue an action.

## Vertical grab camera experiment

Checkpoint `60e2db4` preserves direct container take/discard and inventory before this experiment. Once a pointer gesture is confirmed as vertical, the grabbed card approaches the camera slightly. Pointer down, movement below axis recognition, and horizontal carousel gestures do not trigger it. A situation lifts only its cover; containers lift only the selected item; ordinary action stacks spread their vertical travel from 100% for the selected card to `choiceFollowerRatio` for the deepest card, evenly interpolated by painter rank. The default deepest travel is 70% and `choiceStaggerMs` is 0; the player exposes **Deepest choice travel** and **Choice stagger** independently. Accepted throws still carry every card fully out of view.

`grabLift` defaults to 24 pixels, capped at two percent of the current perspective distance. Set it to zero in the player’s Motion tuning panel to compare without the effect. Canceling releases the pickup smoothly; an accepted departure keeps it until the incoming content takes over. Reduced motion omits this added animation. Keyboard commands retain their normal presentation.

## GitHub Pages

```sh
python3 build_pages.py /tmp/nest-pages
```

Use a new or empty staging directory outside the source assets. The output contains the root redirect, project player with motion tuning, `.nojekyll`, project/studio, retained chapter/editor and engine modules, shared preview/storage and inventory UI, all usable supplied image assets, and runtime fonts. Copy it into a separate `gh-pages` checkout preserving `.git`, then commit and push normally. Do not force-push. The beat editor and dice tray are included, so navigation between all three tools works.

`/editor.html` and its authoring modules, and `/dice.html` with its licensed engine assets, are included by default. `--include-editor` and `--include-dice` remain accepted compatibility flags. Layered PSD source files and the original playground runtime are kept out of the staged site. Projects saved in one browser do not transfer to another device: export a project or chapter JSON from the studio and use Open JSON in the player.

## Previous checkpoints and assets

The current prototype owns its artwork in `assets/img` and fonts in `assets/fonts`. Preserve source assets and original design documents. Previous versions remain recoverable from Git history.

- `e52dacd`: first chapter editor/player.
- `d157745` and `7f25921`: lid motion and soft resistance experiments.
- `f9387f8`: asymmetric lid twist, published before the new item flow.

The lid experiment and its controls have been removed from the active prototype.

The studio Library stores shared Event, Caption, Action and Item definitions across chapters. Chapter beats place those definitions and own their connections. Direct actions have one output; check actions have Success and Failure outputs. Linear cards advance with one swipe; visible narrative headings are optional. See [studio authoring](docs/chapter-editor.md) for reuse, local settings and v1 migration.

## Architecture and reusable capabilities

See [architecture assumptions](docs/architecture.md) for node/sequence registries, independent presentation policy, motion tuning, appearance tokens and the run inventory boundaries. Try the isolated [3D dice tray](dice.html); [dice service documentation](docs/dice-service.md) describes its context-independent API and Onejournal provenance. It is included in default static staging; `python3 build_pages.py /tmp/nest-pages-with-dice --include-dice` remains supported. The dice service returns results independently; action cards interpret them as checks without a separate Check beat.

Library usage counts and deletion checks include gameplay references as well as placed cards. **Clean unused local cards** removes only unused local definitions and can be undone; shared definitions and transitive dependencies are preserved.

Run variables and conditional choices can be authored in the beat panel. See [state authoring](docs/state-system.md) for available checks, effects and miniature artwork previews.

For browser verification of the drawer, serve locally and open `tests/fixtures/inventory-drawer.html`. The fixture contains six items and custom card typography for checking targeting, reversal, full-inventory confirmation and style continuity.

Inventory drawers use an explicit overlay surface: viewport docking in the player, or a bounded element passed as `inventoryHost` to `ProjectPreview`. The editor hosts its drawer and dragged minis in the preview display, independently of scrolling content. That display uses the supplied image’s 796:1654 portrait aspect ratio with the movable toolbar outside it. Add `?embedded=1` to the inventory drawer browser fixture to verify window movement, clipping, minimizing and local drop coordinates.

The inventory surface pins Run state and Go to card below the drawer. Its backdrop reaches opaque black at the mini row, with a 30px fade above. The drawer opens once per uninterrupted item run using one shared items-exposed milestone for Linear and Container presentations, before any stack hint starts moving. Visual readiness checks both remaining motion and speed, independently of input locks and full spring settlement. The view animates entrance and exit over 250ms using opacity and 50px of vertical travel; slot placeholders use 85% opacity. It stays hidden throughout container introductions. When collection leaves the item run, normal-motion playback retains the existing 450ms collection feedback, then advances independently while the drawer exits. Consecutive open item presentations preserve the drawer and slots across collection or discard, skipping the exit and repeated entrance; a narrative, closed introduction, or ending breaks the run. Upward item/container discards start the drawer exit when the context ends; card turns never wait for it. Reduced-motion, background completion, stop, and destroy settle visibility immediately. Slot shells allow queue travel while each card retains its own rounded artwork clip. Busy item buttons stay opaque; only the drawer’s entrance and exit animate opacity.

`ProjectPreview` and `CardDeck` accept a `presentationPolicy` option for exposure and visual tolerances. Exposure requires fan progress at least .35 and the face within 45° of front-facing, after the outgoing cover clears; it does not wait for the hint or low spring velocity. Defaults live in `engine/presentationReadiness.js`: position 2px / speed 20px/s, angle 4° / speed 40°/s, and fan residual .05 / speed .5 per second. Signals latch per presentation revision; explicit inventory continuation carries established exposure and visual milestones. New presentations reset it. Full settlement also waits for any planned or active stack hint. These signals never unlock card or inventory interaction.

Inventory continuity is classified by `engine/inventoryContext.js` from the resolved successor content and presentation. `ProjectController` evaluates it after predicted effects and conditions, without resolving routes a second time. `?embedded&linear-run&trace` on the drawer fixture provides two consecutive Linear items followed by a narrative for browser checks.

`studio/drawer-motion.js` owns cancellable Web Animations independently of engine progression. Exiting drawers become inert immediately and retain painted slots until the exit finishes; ownership updates continue in memory. Reopening captures the current painted pose and reverses smoothly. Engine transitions never await or drive these animations.
