# Combat scenario on the shared game engine

This is a test scenario for the agreed encounter flow, before authoring an Encounter beat. It loads the root `engine/CardDeck.js`, `studio/PlayerUI.js`, `studio/DiceLayer.js` and `dice/DiceService.js` directly. No project schema, editor node, save migration or application-storage access is added.

Start this integration checkout with `python3 serve.py --host 127.0.0.1 --port 8955`, then open `http://127.0.0.1:8955/combat.html`. No package installation or application build is required.

## Saved versions and rollback

Local Git checkpoints were created before integration:

- `checkpoint/pre-combat-engine-20261026` → `a7f6d56`: clean original project/main.
- `checkpoint/rat-combat-reference-20261026` → `6dd6c00`: agreed isolated reference, latest artwork/dice fixes and implementation direction.

The original checkout at `/Users/adam.smereczynski2/Desktop/nest` remains on `main`. The reference checkout remains on `codex/rat-combat-sequence`; its HTTP demo uses port 8953. Integration is separate on `codex/combat-engine-integration`. Return to either original checkout without discarding integration changes. For another recoverable checkout, use `git worktree add --detach /tmp/nest-before-combat checkpoint/pre-combat-engine-20261026` with a new path.

These checkpoint commits/tags are local. Automatic approval review rejected pushing the new reference/tags to the Git remote; no subsequent external push was attempted. A remote backup needs explicit approval for the repository destination and payload.

## Flow and defaults

Shoot and rat attacks use **3d6 summed against 11**, exactly 108 successful outcomes out of 216. For this mockup Burst uses **3d6 ≥ 9**, 160/216 (~74%) successful outcomes. Hero starts at 10 HP, rat at 4 HP. Rat attacks and Shoot deal a uniformly sampled 1–2 HP on success; Burst deals 1–3 HP. A miss deals zero. Using Burst, including a miss, blocks it for the next hero turn only (the use round counts as the first of two reload rounds). Special success requires a successful total and at least one actual die showing six. Rat special success adds poison; the optional hero wound description also requires special success. There is no separate poison probability roll. Status cards are descriptive only. Lethal results replace ordinary effects with a separate configurable death sequence.

Intro uncovers the rat face without turning. Enemy rolls automatically, black from above; the shared action-context lane displays the native SUCCESS/MISS result (ordinary project checks retain SUCCESS/FAIL). Success slides the actual enemy face upward, revealing LINEAR effects; failure turns front-to-front into the hero Fork. Player actions use native Fork input, USING, odds and check-reverse readiness. Light dice are thrown from below onto that actual reverse. Success slides the reverse upward to LINEAR effects; failure flips it into the next enemy action. Effect interiors uncover another front; the last effect uncovers a reverse that flips into the next phase. Results and dice fade use the same shared timing constants as ProjectPreview.

`rules.js` owns pure rules and raw-roll interpretation. `cards.js` defines this scenario's content. `scenario.js` coordinates existing presentation APIs; `PresentationDelay.js` only pauses result delays while hidden. Card movement uses the real deck scheduler, native trajectories/springs and actual face elements. No cloned card overlay or separate card-animation clock is used. Native engine finish/resize/background policy remains in force; scenario generations/aborts protect delayed callbacks and HP resolution.

## Effect arrival and resource indicators

Rolls resolve once internally for outcome/routing, but neither HP indicator publishes damage during the result, automatic departure, or incoming-card settling. Each effect card's `resourcePresentation` values are revealed only after that card finishes arriving on the scene. LINEAR interiors use the same boundary as the initial automatic slide. Previewing or canceling a swipe never reveals the next card's effect. Arrival is recorded per sequence/card index to avoid duplicate publication; restarting discards pending presentation. A lethal result publishes zero HP when the first death card settles. Description-only statuses publish no resource changes.

This metadata is internal to the test scenario, not an Encounter project schema. Future resource/status presentations should use this same per-card arrival hook rather than updating indicators from the dice-result callback. Focused browser reproduction: `node combat/effect-presentation-browser.cjs`.

## Shared additions

`CardDeck.transitionContent(content, {transition:'slide'|'front-turn', surface:'front'|'check', presentation:'closed'|'open', signal})` adds general-purpose native transitions. It returns a promise resolving true on completion, false when unavailable/superseded/canceled; invalid arguments reject. The check surface must be settled and currently supports slide. Requested open presentations fan directly; hosts can use the existing `updateActions` entrance choreography for later USING cards. Front-to-front rotation uses one uninterrupted native angular spring: the visible face changes at the edge-on midpoint without stopping or resetting velocity. Existing `replaceContent`, Linear and Fork behavior is retained.

Dice appearance optionally accepts `color:'black'|'light'` and `throwSide:'top'|'bottom'`. Omitting both preserves existing theme and random throw edges for all current hosts. Physical worker start positions, not canvas rotation, set direction. Vendor changes are confined to the embedded worker's start-position selection; license and source assets remain intact.

## Verification

- `node --test tests/*.test.js` (equivalent to `npm test`) runs application and new native-transition/dice/combat-rule tests.
- `node combat/browser-check.cjs` uses already installed Playwright and Chrome. Optional `COMBAT_URL`, `COMBAT_SCREENSHOTS`, `CHROME_EXECUTABLE`; set `NODE_PATH` to an existing package directory if needed.
- `python3 build_pages.py /tmp/nest-native-combat-pages` stages into a new/empty directory, including `combat.html` and the new shared modules.

Browser acceptance exercises real three-dice outcomes and native result/USING UI, actual face identity during auto slides, miss turns, LINEAR previews, status cards, death, reset, error/retry, narrow layout and reduced motion. It also runs a real existing ProjectPreview check with default dice overrides absent. Scripted scenario outcomes exercise all branches without depending on luck. Simulated visibility events do not prove OS throttling. Physical phones, Safari, Firefox, screen-reader output and legacy project files need separate verification. Recorded outcomes are in `verification.json`.

Rat damage is followed by a native caption when cumulative damage first crosses one third or two thirds of starting HP: “Rat seems slightly weakened.” / “Rat seems severely hurt.” Only the stronger caption is shown when one hit crosses both thresholds; lethal hits keep the death sequence. These descriptions do not require a special dice success and cause no extra damage.
