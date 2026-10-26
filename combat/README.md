# Combat scenario on the shared game engine

This is a test scenario for the agreed encounter flow, before authoring an Encounter beat. It loads the root `engine/CardDeck.js`, `studio/PlayerUI.js`, `studio/DiceLayer.js` and `dice/DiceService.js` directly. No project schema, editor node, save migration or application-storage access is added.

Start this integration checkout with `python3 serve.py --host 127.0.0.1 --port 8955`, then open `http://127.0.0.1:8955/combat.html`. No package installation or application build is required.

## Saved versions and rollback

Local Git checkpoints were created before integration:

- `checkpoint/pre-combat-engine-20261026` → `a7f6d56`: clean original project/main.
- `checkpoint/rat-combat-reference-20261026` → `6dd6c00`: agreed isolated reference, latest artwork/dice fixes and implementation direction.

The original checkout at `/Users/adam.smereczynski2/Desktop/nest` remains on clean `main`. The reference checkout remains on `codex/rat-combat-sequence`; its HTTP demo uses port 8953. Integration is separate on `codex/combat-engine-integration`. Return to either original checkout without discarding integration changes. For another recoverable checkout, use `git worktree add --detach /tmp/nest-before-combat checkpoint/pre-combat-engine-20261026` with a new path.

These checkpoint commits/tags are local. Automatic approval review rejected pushing the new reference/tags to the Git remote; no subsequent external push was attempted. A remote backup needs explicit approval for the repository destination and payload.

## Flow and defaults

Both actors use **3d6 summed against 11**, exactly 108 successful outcomes out of 216. Hero starts at 10 HP, rat at 4 HP. Rat hits for 1 HP, hero for 2 or 3 using the weapon. Status cards are descriptive only. Lethal results replace ordinary effects with a separate configurable death sequence.

Intro uncovers the rat face without turning. Enemy rolls automatically, black from above; the shared action-context lane displays the native SUCCESS/FAILURE result. Success slides the actual enemy face upward, revealing LINEAR effects; failure turns front-to-front into the hero Fork. Player actions use native Fork input, USING, odds and check-reverse readiness. Light dice are thrown from below onto that actual reverse. Success slides the reverse upward to LINEAR effects; failure flips it into the next enemy action. Effect interiors uncover another front; the last effect uncovers a reverse that flips into the next phase. Results and dice fade use the same shared timing constants as ProjectPreview.

`rules.js` owns pure rules and raw-roll interpretation. `cards.js` defines this scenario's content. `scenario.js` coordinates existing presentation APIs; `PresentationDelay.js` only pauses result delays while hidden. Card movement uses the real deck scheduler, native trajectories/springs and actual face elements. No cloned card overlay or separate card-animation clock is used. Native engine finish/resize/background policy remains in force; scenario generations/aborts protect delayed callbacks and HP resolution.

## Shared additions

`CardDeck.transitionContent(content, {transition:'slide'|'front-turn', surface:'front'|'check', presentation:'closed'|'open', signal})` adds general-purpose native transitions. It returns a promise resolving true on completion, false when unavailable/superseded/canceled; invalid arguments reject. The check surface must be settled and currently supports slide. Requested open presentations fan directly; hosts can use the existing `updateActions` entrance choreography for later USING cards. Front-to-front rotation uses one uninterrupted native angular spring: the visible face changes at the edge-on midpoint without stopping or resetting velocity. Existing `replaceContent`, Linear and Fork behavior is retained.

Dice appearance optionally accepts `color:'black'|'light'` and `throwSide:'top'|'bottom'`. Omitting both preserves existing theme and random throw edges for all current hosts. Physical worker start positions, not canvas rotation, set direction. Vendor changes are confined to the embedded worker's start-position selection; license and source assets remain intact.

## Verification

- `node --test tests/*.test.js` (equivalent to `npm test`) runs application and new native-transition/dice/combat-rule tests.
- `node combat/browser-check.cjs` uses already installed Playwright and Chrome. Optional `COMBAT_URL`, `COMBAT_SCREENSHOTS`, `CHROME_EXECUTABLE`; set `NODE_PATH` to an existing package directory if needed.
- `python3 build_pages.py /tmp/nest-native-combat-pages` stages into a new/empty directory, including `combat.html` and the new shared modules.

Browser acceptance exercises real three-dice outcomes and native result/USING UI, actual face identity during auto slides, miss turns, LINEAR previews, status cards, death, reset, error/retry, narrow layout and reduced motion. It also runs a real existing ProjectPreview check with default dice overrides absent. Scripted scenario outcomes exercise all branches without depending on luck. Simulated visibility events do not prove OS throttling. Physical phones, Safari, Firefox, screen-reader output and legacy project files need separate verification. Recorded outcomes are in `verification.json`.
