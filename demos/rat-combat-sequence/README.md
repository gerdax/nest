# Rat combat sequence — isolated mockup

Run from this worktree root:

```sh
python3 serve.py --host 127.0.0.1 --port 8953
```

Open `http://127.0.0.1:8953/demos/rat-combat-sequence/`.
The folder also works standalone:

```sh
python3 -m http.server 8954 --bind 127.0.0.1 --directory demos/rat-combat-sequence
```

No install or build is required. The main application and both earlier combat demos are preserved. This mockup does not read or write project data or application storage. A future Combat beat is a design proposal; no editor node or project schema is added here.

## Sequence

The intro is a caption with the actual face-up rat attack already staged beneath it. A swipe uncovers that attack without a turn. Rat dice roll automatically: black, physically thrown from the top. SUCCESS/FAIL applies HP once and remains readable for 1200 ms.

AUTO enemy actions resolve on their face-up card. After a nonlethal hit, the enemy front automatically slides upward, uncovering the first LINEAR effect face. After a miss, the front turns directly into the hero FORK, without an intermediate reverse or effect cards.

A hero choice swipes away to expose the actual check reverse. Light dice roll automatically from below; SUCCESS/FAIL appears below the card. After the 1200 ms result hold, a successful attack automatically slides that actual reverse upward and uncovers the first LINEAR effect. A miss instead flips directly from the reverse into the next enemy action.

Each LINEAR effect requires its own upward swipe. Interior cards uncover the next face without rotation. The last card uncovers the next phase's reverse; that reverse turns in the main engine's direction and tilted axis, revealing either the hero FORK or enemy action. INTRO is the explicit exception: it uncovers the enemy face without rotation. Successors are staged before the first pointerdown, including reverse previews for the last LINEAR card.

The additional-status toggle adds a second description card to each successful attack (hero poisoned / rat wounded). These cards have no persistent state, damage-over-time or other mechanical effect. HP changes once when the roll resolves, not again on viewing or swiping effects.

Lethal results replace ordinary effects with a separate death LINEAR. The rat has a default enemy-death card. `restart({heroDeathCards:[...], enemyDeathCards:[...]})` can supply distinct narrative sequences; their final cards stop combat. Both front and check-reverse automatic slides use the copied deck's departure duration/trajectory; front-to-front turns are reserved for enemy misses.

Use swipe up, ArrowUp or Enter to continue/play; left/right arrows browse. Buttons provide equivalent controls. Scenario toggles restart combat. Restart cancels active dice and presentation work. Presentation delays and front-turn animations pause when hidden; a completed physical roll waits for visibility before updating HP. An unresolved failed roll exposes retry, without changing HP or inventing a fallback result. Reduced motion retains readable result holds.

Defaults: hero 10 HP, rat 4 HP, weapon enabled, intro enabled, additional status descriptions disabled. Independent 1d6 tests succeed on 4–6; rat deals 1, ordinary hero attack 2, weapon attack 3. No energy, rerolls or other effects. Values are exploratory. Pure model `initial`, `resolveAttack`, `terminal` lives in `combat-model.js`; presentation uses explicit phases in `combat-demo.js`.

## Implementation direction — agreed 2026-10-26

The user accepted this direction for future integration into the main game. This records an architectural decision; it does not start integration or change the current isolated scope.

- Implement combat on the main card engine, maximizing reuse of its layout, animation and UX behavior. Reuse card geometry, responsive composition, HUD, renderer, materials, typography, gestures and cancellation thresholds, keyboard controls, reduced motion and lifecycle handling.
- Compose combat as a controller coordinating AUTO enemy actions, LINEAR effects, FORK hero actions and LINEAR effects. Reuse the existing Fork selection, USING entrances, player check reverse/dice presentation, and Linear successor previews and progression. Keep combat rules separate from presentation and resolve each action exactly once.
- Reuse the main game's existing SUCCESS/FAIL result layout and presentation below the cards for both enemy and hero rolls. Match its placement, spacing, typography, colors and appearance/disappearance behavior through the existing result UI and styles; do not create a separate combat-specific result treatment. Preserve the native check reverse for the hero roll while keeping the result copy in the established below-card lane.
- Extend the shared engine with general-purpose automatic upward departures for visible fronts and check reverses, and direct front-to-front turns. Use the main engine's trajectories, timing settings, tilt, layering, completion events and cancellation lifecycle. These capabilities should be reusable outside combat.
- Extend the existing dice service for enemy rolls: black dice physically thrown from above; hero dice remain light and physically thrown from below. Preserve independent raw dice results, cancellation and explicit error handling.
- Treat this mockup as the behavioral reference for the agreed flow. Its copied engine and DOM-clone/Web Animations transitions are prototype implementations; replace these presentation workarounds with native shared-engine transitions during integration. Do not carry a separate combat layout or animation system into the main game.
- Preserve the agreed flow: intro uncovers the enemy face; successes slide into effects, misses bypass effects; Linear interiors uncover fronts and its final swipe uncovers a reverse that flips into the next phase; lethal hits enter separate hero/enemy death sequences. Statuses remain descriptive until new mechanics are explicitly agreed.

A Combat beat is the proposed authoring concept. The exact node schema and editor integration remain to be designed; acceptance of this direction does not finalize those interfaces. Preserve originals and prior prototypes while implementing, and verify native transitions in a browser alongside deterministic rule and lifecycle tests. Mockup tests alone do not establish main-engine, editor or device compatibility.

## Copied sources

All runtime modules, CSS, artwork, fonts, dice models, worker code and WASM stay under this folder. `snapshot.json` records copied source paths and hashes. The current CardDeck copy adds the demo-specific `slideToContent` and `turnFrontToContent` methods; its baseline hash is retained. `dice/snapshot.json` records pristine and derived dice files. `dice/COPY-NOTES.md` explains the local appearance API, black texture and physical throw-origin change. Vendor license/provenance files remain present.

## Verification

```sh
node --test demos/rat-combat-sequence/tests/*.test.js demos/rat-combat-sequence/dice/tests/*.test.js
node demos/rat-combat-sequence/tests/browser-check.cjs
```

The browser script uses an already available Playwright package and Chrome. Set `NODE_PATH` to an existing package location when needed. Optional variables: `COMBAT_URL`, `CHROME_EXECUTABLE`, `COMBAT_SCREENSHOTS`. No packages are installed. Production rolls are physical; browser scenario tests additionally inject known roll results to cover endings and cancellation reliably.

Main application regression command: `npm test`, equivalently `node --test tests/*.test.js`. Static staging: `python3 build_pages.py /tmp/nest-pages-rat-sequence` with a new/empty output directory. The application's staging script deliberately remains unchanged and does not publish this independent demo.

See `verification.json` for executed checks and limits. Chrome viewport emulation does not verify a physical phone. Simulated visibility events do not verify OS background throttling. Safari, Firefox, screen readers and legacy project formats were not manually tested.
