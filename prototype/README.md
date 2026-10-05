# Nest card motion playground

A standalone card interaction demo using native JavaScript modules and the existing Nest artwork. No package installation or build step is required.

From the repository root, run:

```sh
python3 -m http.server 8937 --bind 127.0.0.1
```

Open <http://127.0.0.1:8937/prototype/>. Serve over HTTP; opening the HTML directly will not load modules reliably.

Drag the situation upward off the deck to expose the actions underneath. Browse sideways in either direction; the carousel loops endlessly. Drag upward again to carry the entire action stack away, exposing the next situation beneath it. Ordinary choices stay open once revealed; downward closing is disabled by default. Focus the card to use the arrow keys, Enter, and Escape. The playground offers two-, three-, and four-action fixtures, a chest with three collectible items, motion tuning, a deck reset, and settings export. In the chest fixture, choose Open to lift the choices away and uncover the item cards already underneath. Collect each item separately, or drag down to close the container and return directly to the open Open / Go on choices with Go on selected. Reopening shows the remaining items. Go on advances to the next visual study. Collected items stay removed for this session until reset or fixture switching; after the last item, the chest returns directly to the single Go on choice. If clipboard access is unavailable, settings appear in a selectable text field.

## Engine API

```js
import { CardDeck, DEFAULT_SETTINGS } from './engine/CardDeck.js';

const deck = new CardDeck(mount, {
  settings: { ...DEFAULT_SETTINGS },
  content: {
    id: 'card-id',
    interaction: 'choice', // default; use 'container' to collect individual cards
    allowClose: false, // default for choices; containers default to true
    title: 'Card title',
    text: 'Card description',
    image: './image.png',
    actions: [
      { id: 'action-id', label: 'Action label', image: './optional-image.png' },
      { id: 'other-id', label: 'Other action' },
    ],
  },
});

deck.addEventListener('commit', ({ detail }) => {
  // detail: { contentId, action, index }
  deck.replaceContent(nextContent);
});
```

Load `engine/card-deck.css` alongside your host styles. Give the mount a width, a 3:4 aspect ratio, and keyboard focusability (`tabindex="0"`). The engine handles card rendering, gestures, focused keyboard input, and transition choreography. The host owns content and the meaning of actions.

- `replaceContent(content, { presentation: 'open' })` adopts the supplied action cards directly and expands their fan after the outgoing stack clears, without an intermediate cover or flip. Without the option, replacement shows a closed situation and uses the ordinary situation flip during commitment. A host can supply content synchronously in `commit` or asynchronously; it stages below the outgoing stack. Replacing content during collection cancels that collection's animation and completion event.
- `setActionPreview(actionId, content, { presentation: 'open' })` preloads the actual next action cards under a selected choice's upward lift. The host still accepts the action in `commit` and supplies that content through `replaceContent`. Canceling the lift hides the preview again.
- `setReturnContent(content, { selectedId })` prepares the choices to show when a container closes, including after its last item leaves. The engine returns directly to their open fan and selects the supplied action ID. Refresh this content when an item is accepted, before its collection animation finishes.
- `content.allowClose` controls downward and keyboard closing. It defaults to `false` for `choice` and `true` for `container`; hosts can opt ordinary choices into closing.
- `updateSettings(partial)` changes motion settings without rebuilding the deck.
- `reset()` returns the current deck to its initial interaction state.
- `destroy()` releases listeners and engine resources when the host removes the deck.

Listen on the deck instance with `addEventListener`:

- `reveal`: uncovering is accepted. Choices remain compressed until the cover clears their projected area, then expand.
- `selection`: the selected action changes; use `detail.action` and `detail.index` to reflect the choice.
- `close`: closing is accepted. A container with return content compresses its items and returns directly to the open return choices. Content without a prepared return uses its cover.
- `commit`: a choice is accepted, with `{ contentId, action, index }`. Supply next content from the host.
- `collect`: a container item is accepted, with `{ contentId, action, index }`. Record removal immediately; the engine removes that item and reflows its remaining cards without advancing host content. The final item automatically closes the container.
- `transitioncomplete`: settling has finished; `detail.transition` identifies `reveal`, `close`, `browse`, `cancel`, `settle`, `collect`, or `commit`. Container `collect` includes `remainingIds` and completes after removal and reflow; final collection then completes `close` after the prepared return choices settle. The close completion reports the return content ID, `open: true`, and `phase: 'choices'`. Reveal completes only when the fan is ready. With open presentation, commit completion follows direct fan expansion and settling. Input is blocked throughout collection, automatic opening, and awaiting host content.

The tuning panel exposes `stiffness`, `damping`, `mass`, `maxTilt`, `axisThreshold`, `distanceThreshold`, `flickVelocity`, `flickDistance`, `commitDuration`, `perspective`, `stackDepth`, `liftHeight`, `angularStiffness`, `angularDamping`, and `gravity`. Copy settings to reuse the resulting object in another host.

The choice fixtures cycle through visual studies and two-, three-, and four-action layouts on every commit. `demo/ScenarioController.js` keeps chest scenario logic separate from the playground controls. It remembers remaining item IDs in memory, preloads them with `setActionPreview`, then opens the container with `replaceContent(container, { presentation: 'open' })`. When the container is ready, it supplies `setReturnContent(entry, { selectedId: 'leave' })`, and refreshes that return content immediately after every accepted collection. On close completion, the controller updates its mode and preview; the engine has already restored the open choices. Closing never shows The chest cover. The cover appears only on the initial entry or reset. This demo has no inventory, storage, or chapter editor.

Actions may set `disabled: true` and `faceDown: true` to make an unavailable action a browsable reverse that cannot commit. The chest fixture removes Open entirely when empty, leaving only Go on. Supply `accessibleLabel` for a descriptive accessible name.

The controller exports `ScenarioController`, `CHEST_ITEM_IDS`, `createStudyContent(index, count)`, `createChestEntry(remainingIds)`, and `createChestContainer(remainingIds)`. Construct it with `new ScenarioController(deck, { fixture: 'chest', onChange })`; `reset(fixture)` cancels deck motion and restores that fixture's session. `content`, `mode`, `fixture`, and `remainingIds` expose current host state; `destroy()` removes the controller's event listeners. `onChange` receives `{ reason, detail, mode, fixture, remainingIds, content }` for UI updates. The controller requires the deck's event methods, `reset()`, `replaceContent()`, `setActionPreview()`, and `setReturnContent()`, so it can be tested with a fake deck.

Run focused engine checks with `node --test prototype/tests/*.test.js` from the repository root.

Arrow Up reveals or commits; Left/Right browse; Down closes containers or content that opts into `allowClose`. Enter and Escape are aliases. Returning from the chest selects Go on; ordinary cover closing retains selection. Motion is applied directly during drags and settles immediately when reduced motion is enabled. Reset cancels any pending commit, including queued content. Images resolve relative to the host document.


## Physical motion model

The renderer uses native CSS 3D transforms with a perspective camera, depth separation, card-edge shading, and elevation-dependent shadows. Cards remain fully opaque throughout their movement. The next situation is present below the outgoing cards before they depart; there is no arrival from the bottom or fade-in.

Position and angular states use damped springs. The pointer's grab location determines rotational torque, and release velocity contributes to rotational momentum and the shared upward throw. The carousel follows a continuous periodic orbit, including the two-card case, so neither direction reaches an end or jumps across a wrap seam. Choice cards share the same upward displacement during dragging and commitment. Containers lift only the selected item for collection.

This is a constrained card UI simulation, not a collision or bending simulation. [Three.js CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html) would add a scene graph around the same DOM transform rendering; [Rapier](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/) would be appropriate for free rigid bodies, collisions, and joints if the playground later needs tabletop behavior. Rendering and motion remain separate modules to allow such an extension.

Defaults added for physical tuning: perspective 1000 px, stack depth 10 px, lift height 28 px, angular stiffness 180, angular damping 22, gravity 2200 px/s². `scatterDuration` was removed because choices now leave as one stack. Throw gravity is capped for the configured duration so the stack continues upward through its exit.


## Deck presentation and versioning

The closed choice set is centered and compressed behind the situation. There are no protruding choice edges or extra cards in the carousel. An ordinary choice lift prepares the next card's reverse before release; the host supplies its hidden front only after commitment. An action with an open preview instead exposes the actual next action cards underneath. Container item lifts and disabled choices do not prepare another situation.

`deck.state.phase` is `closed`, `revealing`, `choices`, `closing`, `committing`, or `collecting`. Browsing and committing are enabled only in `choices`. Container closing collapses the item fan and directly expands the prepared return choices. Optional cover closing preserves selection and collapses the fan before returning the cover. Reduced motion settles the same sequence immediately.

Cards use independent flattened 3D containers, with explicit whole-card painter ordering, so tilted planes cannot cut through their neighbors. At carousel foreground handoffs, the orbit widens to maintain at least an 8 px projected gap before the foreground order changes. The compact fan at rest is unchanged.

Container removal preserves the remaining card elements, layers, transforms, and ordering at the removal boundary. Spring offsets lead directly to the smaller fan. The existing top survivor becomes selected; other survivors keep their physical order, with no separation or shuffling. Array positions can change to fit the smaller carousel, so hosts should identify items by ID. Item numbering updates to the remaining count. One item renders as a single card; the last item's departure automatically starts closure. Engine `reset()` resets motion for its current content; the demo controller's `reset()` also restores the complete chest contents.

Branch `codex/container-interactions` starts at `78cfce9`. Verification covers deterministic engine and scenario checks plus mouse/keyboard inspection in Chrome and the in-app browser at desktop and narrow widths. Physical touch-device behavior remains unverified.

Regression preset from the reported screenshot: axisThreshold 27, distanceThreshold .21, flickVelocity 375, commitDuration 190, perspective 1100. This is used in verification, not as new defaults.

The branch `codex/deck-reveal-fixes` preserves the existing repository history. Commit `4a48051` checkpoints the project before these fixes, including the original prototype archive. The following fix commit records the presentation changes independently.


## Card-back reveal experiment

Branch `codex/card-back-reveal` starts from the committed two-card idle fan (`af8f8ca`). For ordinary choice advancement, the real next situation is staged face down underneath the outgoing choice stack. Once the stack clears, the next card rotates around its vertical axis to reveal its artwork and text.

The front and reverse are two opaque faces in one physical card layer, with `backface-visibility` controlling which face is painted. The reverse uses a Nest pattern and emblem. It is never an extra choice or a placeholder in the browsing carousel. Newly supplied choices remain compressed and hidden during the turn, preventing their artwork from leaking through at the edge-on midpoint.

The turn uses the existing rotational stiffness/damping and mass controls. Input remains blocked until the turn and depth settling finish; then the existing `transitioncomplete` commit event fires once. Reset restores a face-up situation; reduced motion and tab suspension immediately finish the reveal. The initial situation starts face up.

For ordinary choice advancement, the next card’s reverse is prepared on the first upward movement of the ready choice stack, before pointer release. Open previews use actual action cards and bypass this turn. This preview does not request future content, emit a commit, or begin the flip. Canceling or reversing the lift covers it again; commitment fills the same hidden front without replacing the visible reverse.
