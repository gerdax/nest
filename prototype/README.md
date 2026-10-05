# Nest card motion playground

A standalone card interaction demo using native JavaScript modules and the existing Nest artwork. No package installation or build step is required.

From the repository root, run:

```sh
python3 -m http.server 8937 --bind 127.0.0.1
```

Open <http://127.0.0.1:8937/prototype/>. Serve over HTTP; opening the HTML directly will not load modules reliably.

Drag the situation upward off the deck to expose the actions underneath. Browse sideways in either direction; the carousel loops endlessly. Drag upward again to carry the entire action stack away, exposing the next situation beneath it. Drag downward to return the situation. Focus the card to use the arrow keys, Enter, and Escape. The playground offers two-, three-, and four-action fixtures, motion tuning, a deck reset, and settings export. If clipboard access is unavailable, settings appear in a selectable text field.

## Engine API

```js
import { CardDeck, DEFAULT_SETTINGS } from './engine/CardDeck.js';

const deck = new CardDeck(mount, {
  settings: { ...DEFAULT_SETTINGS },
  content: {
    id: 'card-id',
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

- `replaceContent(content)` supplies the next card. A host can call it synchronously in `commit` or after asynchronously retrieving content; the engine stages that situation below the outgoing action stack, then settles its depth when the stack leaves.
- `updateSettings(partial)` changes motion settings without rebuilding the deck.
- `reset()` returns the current deck to its initial interaction state.
- `destroy()` releases listeners and engine resources when the host removes the deck.

Listen on the deck instance with `addEventListener`:

- `reveal`: uncovering is accepted. Choices remain compressed until the cover clears their projected area, then expand.
- `selection`: the selected action changes; use `detail.action` and `detail.index` to reflect the choice.
- `close`: closing is accepted. Choices compress before the cover returns.
- `commit`: a choice is accepted, with `{ contentId, action, index }`. Supply next content from the host.
- `transitioncomplete`: settling has finished; `detail.transition` identifies `reveal`, `close`, `browse`, `cancel`, `settle`, or `commit`. Reveal completes only when the fan is ready for browsing and commitment. Commit completes after the outgoing stack leaves and the exposed deck settles. Input is blocked while awaiting host content.

The tuning panel exposes `stiffness`, `damping`, `mass`, `maxTilt`, `axisThreshold`, `distanceThreshold`, `flickVelocity`, `flickDistance`, `commitDuration`, `perspective`, `stackDepth`, `liftHeight`, `angularStiffness`, `angularDamping`, and `gravity`. Copy settings to reuse the resulting object in another host.

The fixture host cycles through visual studies and two-, three-, and four-action layouts on every commit. It implements no inventory, branching narrative, persistence, or other game logic.

Run focused engine checks with `node --test prototype/tests/*.test.js` from the repository root.

Arrow Up reveals or commits; Left/Right browse; Down closes. Enter and Escape are aliases. The engine retains action selection on close/reopen. Motion is applied directly during drags and settles immediately when reduced motion is enabled. Reset cancels any pending commit, including queued content. Images resolve relative to the host document.


## Physical motion model

The renderer uses native CSS 3D transforms with a perspective camera, depth separation, card-edge shading, and elevation-dependent shadows. Cards remain fully opaque throughout their movement. The next situation is present below the outgoing cards before they depart; there is no arrival from the bottom or fade-in.

Position and angular states use damped springs. The pointer's grab location determines rotational torque, and release velocity contributes to rotational momentum and the shared upward throw. The carousel follows a continuous periodic orbit, including the two-card case, so neither direction reaches an end or jumps across a wrap seam. All action cards share the same upward displacement during dragging and commitment.

This is a constrained card UI simulation, not a collision or bending simulation. [Three.js CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html) would add a scene graph around the same DOM transform rendering; [Rapier](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/) would be appropriate for free rigid bodies, collisions, and joints if the playground later needs tabletop behavior. Rendering and motion remain separate modules to allow such an extension.

Defaults added for physical tuning: perspective 1000 px, stack depth 10 px, lift height 28 px, angular stiffness 180, angular damping 22, gravity 2200 px/s². `scatterDuration` was removed because choices now leave as one stack. Throw gravity is capped for the configured duration so the stack continues upward through its exit.


## Deck presentation and versioning

The closed choice set is centered and compressed behind the situation. There are no protruding choice edges and no generic backing/placeholder card. The renderer creates a next-situation background only when the host supplies actual content during commitment.

`deck.state.phase` is `closed`, `revealing`, `choices`, `closing`, or `committing`. Browsing and committing are enabled only in `choices`. Closing preserves selection and collapses the fan before returning the cover. Reduced motion settles the same sequence immediately.

Cards use independent flattened 3D containers, with explicit whole-card painter ordering, so tilted planes cannot cut through their neighbors. At carousel foreground handoffs, the orbit widens to maintain at least an 8 px projected gap before the foreground order changes. The compact fan at rest is unchanged.

Regression preset from the reported screenshot: axisThreshold 27, distanceThreshold .21, flickVelocity 375, commitDuration 190, perspective 1100. This is used in verification, not as new defaults.

The branch `codex/deck-reveal-fixes` preserves the existing repository history. Commit `4a48051` checkpoints the project before these fixes, including the original prototype archive. The following fix commit records the presentation changes independently.


## Card-back reveal experiment

Branch `codex/card-back-reveal` starts from the committed two-card idle fan (`af8f8ca`). After an action is committed, the real next situation is staged face down underneath the outgoing choice stack. Once the stack clears, the next card rotates around its vertical axis to reveal its artwork and text.

The front and reverse are two opaque faces in one physical card layer, with `backface-visibility` controlling which face is painted. The reverse uses a Nest pattern and emblem. It is never an extra choice or a placeholder in the browsing carousel. Newly supplied choices remain compressed and hidden during the turn, preventing their artwork from leaking through at the edge-on midpoint.

The turn uses the existing rotational stiffness/damping and mass controls. Input remains blocked until the turn and depth settling finish; then the existing `transitioncomplete` commit event fires once. Reset restores a face-up situation; reduced motion and tab suspension immediately finish the reveal. The initial situation starts face up.
