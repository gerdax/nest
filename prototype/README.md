# Nest card motion playground

A standalone card interaction demo using native JavaScript modules and the existing Nest artwork. No package installation or build step is required.

From the repository root, run:

```sh
python3 prototype/serve.py
```

Open <http://127.0.0.1:8937/prototype/>. Serve over HTTP; opening the HTML directly will not load modules reliably.

The bundled development server serves the repository on localhost and disables caching, so a refresh picks up the complete current engine. This milestone versions its module URLs together to avoid older cached modules mixing with new exports. Use `--port 8938` for an alternative port.

Drag the situation upward off the deck to expose the actions underneath. Browse sideways in either direction; the carousel loops endlessly. Drag upward again to carry the entire action stack away, exposing the next situation beneath it. Ordinary choices stay open once revealed; downward closing is disabled by default. Focus the card to use the arrow keys, Enter, and Escape. The playground offers two-, three-, and four-action fixtures, a chest with three collectible items, motion tuning, a deck reset, and settings export. In the chest fixture, choose Open to lift the choices away and uncover the item cards already underneath. Collect each item separately, or drag down to close the container and bring the Open / Go on choices back down from above, with Open selected. Reopening shows the remaining items. Go on advances to the next visual study. Collected items stay removed for this session until reset or fixture switching; after the last item, the single Go on choice returns from above. If clipboard access is unavailable, settings appear in a selectable text field.

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
- `setReturnContent(content, { selectedId })` prepares the choices to show when a container closes, including after its last item leaves. The engine brings these cards down from above, then expands their fan and selects the supplied action ID. Refresh this content when an item is accepted, before its collection animation finishes.
- `content.allowClose` controls downward and keyboard closing. It defaults to `false` for `choice` and `true` for `container`; hosts can opt ordinary choices into closing.
- `updateSettings(partial)` changes motion settings without rebuilding the deck.
- `reset()` returns the current deck to its initial interaction state.
- `destroy()` releases listeners and engine resources when the host removes the deck.

Listen on the deck instance with `addEventListener`:

- `reveal`: uncovering is accepted. Choices remain compressed until the cover clears their projected area, then expand.
- `selection`: the selected action changes; use `detail.action` and `detail.index` to reflect the choice.
- `close`: closing is accepted. A container with return content compresses its items in place and brings the open return choices down over them from above. The items stay underneath until covered. Content without a prepared return uses its cover.
- `commit`: a choice is accepted, with `{ contentId, action, index }`. Supply next content from the host.
- `collect`: a container item is accepted, with `{ contentId, action, index }`. Record removal immediately; the engine removes that item and reflows its remaining cards without advancing host content. The final item automatically closes the container.
- `transitioncomplete`: settling has finished; `detail.transition` identifies `reveal`, `close`, `browse`, `cancel`, `settle`, `collect`, or `commit`. Container `collect` includes `remainingIds` and completes after removal and reflow; final collection then completes `close` after the prepared return choices settle. The close completion reports the return content ID, `open: true`, and `phase: 'choices'`. Reveal completes only when the fan is ready. With open presentation, commit completion follows direct fan expansion and settling. Input is blocked throughout collection, automatic opening, and awaiting host content.

The tuning panel exposes `stiffness`, `damping`, `mass`, `maxTilt`, `axisThreshold`, `distanceThreshold`, `flickVelocity`, `flickDistance`, `commitDuration`, `perspective`, `stackDepth`, `liftHeight`, `angularStiffness`, `angularDamping`, `gravity`, `revealStartScale`, `revealFullScaleAt`, `choiceStaggerMs`, `flipLeadMs`, and `flipAxisTilt`. Copy settings to reuse the resulting object in another host.

The choice fixtures cycle through visual studies and two-, three-, and four-action layouts on every commit. `demo/ScenarioController.js` keeps chest scenario logic separate from the playground controls. It remembers remaining item IDs in memory, preloads them with `setActionPreview`, then opens the container with `replaceContent(container, { presentation: 'open' })`. When the container is ready, it supplies `setReturnContent(entry, { selectedId: remainingIds.size ? 'open' : 'leave' })`, and refreshes that return content immediately after every accepted collection. On close completion, the controller updates its mode and preview; the engine has already restored the open choices. Closing never shows The chest cover. The cover appears only on the initial entry or reset. This demo has no inventory, storage, or chapter editor.

Actions may set `disabled: true` and `faceDown: true` to make an unavailable action a browsable reverse that cannot commit. The chest fixture removes Open entirely when empty, leaving only Go on. Supply `accessibleLabel` for a descriptive accessible name.

The controller exports `ScenarioController`, `CHEST_ITEM_IDS`, `createStudyContent(index, count)`, `createChestEntry(remainingIds)`, and `createChestContainer(remainingIds)`. Construct it with `new ScenarioController(deck, { fixture: 'chest', onChange })`; `reset(fixture)` cancels deck motion and restores that fixture's session. `content`, `mode`, `fixture`, and `remainingIds` expose current host state; `destroy()` removes the controller's event listeners. `onChange` receives `{ reason, detail, mode, fixture, remainingIds, content }` for UI updates. The controller requires the deck's event methods, `reset()`, `replaceContent()`, `setActionPreview()`, and `setReturnContent()`, so it can be tested with a fake deck.

Run focused engine checks with `node --test prototype/tests/*.test.js` from the repository root.

Arrow Up reveals or commits; Left/Right browse; Down closes containers or content that opts into `allowClose`. Enter and Escape are aliases. Returning from a nonempty chest selects Open; an empty chest returns to Go on only; ordinary cover closing retains selection. Motion is applied directly during drags and settles immediately when reduced motion is enabled. Reset cancels any pending commit, including queued content. Images resolve relative to the host document.


## Physical motion model

The renderer uses native CSS 3D transforms with a perspective camera, depth separation, card-edge shading, and elevation-dependent shadows. Cards remain fully opaque throughout their movement. The next situation is present below the outgoing cards before they depart; there is no arrival from the bottom or fade-in.

Position and angular states use damped springs. The pointer's grab location determines rotational torque, and release velocity contributes to rotational momentum and the shared upward throw. The carousel follows a continuous periodic orbit, including the two-card case, so neither direction reaches an end or jumps across a wrap seam. The selected choice tracks the pointer directly. Other choices sample its interpolated motion history with an 18 ms delay per physical position behind it (18 / 36 / 54 ms for four cards). The cascade continues through departure; zero `choiceStaggerMs` restores simultaneous movement. Canceling, reversing, and re-grabbing preserve current card poses, including when a former follower becomes selected during settling. Containers lift only the selected item for collection.

The compressed choices receive at most 12% of the situation's gesture rotation, capped at 0.9 degrees per axis. This small friction response fades as the cover leaves and the fan opens. The choices do not translate with the cover or inherit its residual tilt on their first gesture.

Branch `codex/reveal-scale` adds a subtle approach effect: cards under an upward-moving situation or choice stack start at 95% scale and reach full size after the first third of their height is exposed. Smoothstep interpolation follows the actual projected edge of the cover, including tilt and depth, so reversing or canceling the swipe reverses the zoom continuously. `revealStartScale` and `revealFullScaleAt` tune these values live. Individual collection keeps the other items still; returning decisions from above keeps its existing scale. Reduced motion disables the additional zoom.

This is a constrained card UI simulation, not a collision or bending simulation. [Three.js CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html) would add a scene graph around the same DOM transform rendering; [Rapier](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/) would be appropriate for free rigid bodies, collisions, and joints if the playground later needs tabletop behavior. Rendering and motion remain separate modules to allow such an extension.

Current defaults: positional spring 360 / 56 / 1.15 (stiffness / damping / mass), maximum tilt 12°, axis lock 34 px, commit distance 0.14, flick 325 px/s after 26 px, departure 210 ms, perspective 1200 px, depth 22 px, lift 56 px, angular spring 350 / 65, and gravity 800 px/s². Restore motion defaults and JSON export use these same engine values. `scatterDuration` was removed because choices now leave as one stack. Throw gravity is capped for the configured duration so the stack continues upward through its exit.


## Deck presentation and versioning

The closed choice set is centered and compressed behind the situation. There are no protruding choice edges or extra cards in the carousel. An ordinary choice lift prepares the next card's reverse before release; the host supplies its hidden front only after commitment. An action with an open preview instead exposes the actual next action cards underneath. Container item lifts and disabled choices do not prepare another situation.

`deck.state.phase` is `closed`, `revealing`, `choices`, `closing`, `committing`, or `collecting`. Browsing and committing are enabled only in `choices`. Container closing collapses the item fan, returns the preceding choices from above, and expands their fan after arrival. Optional cover closing preserves selection and collapses the fan before returning the cover. Reduced motion settles the same sequence immediately.

Cards use independent flattened 3D containers, with explicit whole-card painter ordering, so tilted planes cannot cut through their neighbors. At carousel foreground handoffs, the orbit widens to maintain at least an 8 px projected gap before the foreground order changes. The compact fan at rest is unchanged.

Container removal preserves the remaining card elements, layers, transforms, and ordering at the removal boundary. Spring offsets lead directly to the smaller fan. The existing top survivor becomes selected; other survivors keep their physical order, with no separation or shuffling. Array positions can change to fit the smaller carousel, so hosts should identify items by ID. Item numbering updates to the remaining count. One item renders as a single card; the last item's departure automatically starts closure. Engine `reset()` resets motion for its current content; the demo controller's `reset()` also restores the complete chest contents.

Branch `codex/container-interactions` starts at `78cfce9`. Verification covers deterministic engine and scenario checks plus mouse/keyboard inspection in Chrome and the in-app browser at desktop and narrow widths. Physical touch-device behavior remains unverified.

Regression preset from the reported screenshot: axisThreshold 27, distanceThreshold .21, flickVelocity 375, commitDuration 190, perspective 1100. This is used in verification, not as new defaults.

The branch `codex/deck-reveal-fixes` preserves the existing repository history. Commit `4a48051` checkpoints the project before these fixes, including the original prototype archive. The following fix commit records the presentation changes independently.


## Card-back reveal experiment

Branch `codex/card-back-reveal` starts from the committed two-card idle fan (`af8f8ca`). For ordinary choice advancement, the real next situation is staged face down underneath the outgoing choice stack. With actual host content available, the next card aims to begin turning 30 ms before the leading card’s 210 ms departure ends. The complete outgoing stack must first clear the next card’s full swept turning area by 8 px; clearance takes precedence over the timing target. The staged turn runs while trailing choices finish departing, and adoption carries its current rotation and velocity into the new deck.

The front and reverse are two opaque faces in one physical card layer, with `backface-visibility` controlling which face is painted. The reverse uses a Nest pattern and emblem. It is never an extra choice or a placeholder in the browsing carousel. Newly supplied choices remain compressed and hidden during the turn, preventing their artwork from leaking through at the edge-on midpoint.

The turn uses the existing rotational stiffness/damping and mass controls. Input remains blocked until the turn and depth settling finish; then the existing `transitioncomplete` commit event fires once. Reset restores a face-up situation; reduced motion and tab suspension immediately finish the reveal. The initial situation starts face up.

For ordinary choice advancement, the next card’s reverse is prepared on the first upward movement of the ready choice stack, before pointer release. Open previews use actual action cards and bypass this turn. This preview does not request future content, emit a commit, or begin the flip. Canceling or reversing the lift covers it again; commitment fills the same hidden front without replacing the visible reverse.


## Motion-polish checkpoint

Local tag `nest-reveal-scale-v1` preserves `82f5001`; branch `codex/motion-polish` begins there. Changes remain local.

The actual front and reverse card planes share a physical turn around an axis tilted −3° from vertical, with its upper end leaning left. `flipAxisTilt` tunes that angle from −10° to 10°. Projected bounds and the conservative full-turn clearance envelope use the same transform as the renderer. Both faces have 1 px olive borders, a 45% inset highlight, and a 2 px bottom edge; their surfaces remain opaque.

New live settings: `choiceStaggerMs` defaults to 18 (0–60 ms), `flipLeadMs` to 30 (0–100 ms), and `flipAxisTilt` to −3 (−10°–10°). The next host content can still arrive asynchronously; no turn starts without it, and the waiting status remains active. Input stays blocked until every departing choice leaves and the incoming presentation settles. The 95% reveal zoom still reaches full size at one-third exposure.

The final container item completes collection as soon as its projected card clears the viewport by 8 px. With no survivors, there is no fan-compression or reflow wait: completion and close acceptance occur immediately, and prepared return cards descend on the next animation frame. Individual item collection keeps all other items stationary during lift and flight.

Resizing during choreography finishes the transition safely at the new dimensions. Live camera, axis, tilt, depth, or lift edits during an already-started overlapping flip likewise settle that presentation, avoiding invalidation of its clearance envelope. Reduced motion and tab suspension finish active sequences immediately; reset and destroy clear movement history and pending animation work.

Verification includes deterministic history interpolation, rank delays, cancel/re-grab ownership, early-flip clearance and adoption, immediate empty-container return, geometry, and existing engine/container regressions. Mouse and keyboard were inspected in Chrome and the in-app browser at desktop and narrow sizes. Physical touch-device behavior remains unverified.
