# Rat dice combat — one stack

Open `http://127.0.0.1:8937/demos/rat-dice-stack/` with the existing `python3 serve.py` development server. `?seed=123` supplies a reproducible random sequence.

This is an isolated playable proposal. It uses a pristine snapshot of the current game's CardDeck and copies of the Interaction Preview composition, card styles, fonts and artwork. No project controller, project data or application storage is loaded. All runtime references stay inside this folder. `snapshot.json` records every copied source and SHA-256 hash; the originals and the earlier combat demo are unchanged.

## Flow

1. An incoming rat card flips on the existing deck plane. Its attack (2 or 3 damage) and d6 are committed and visible.
2. Swipe the rat up to uncover three response cards. No resource changes happen on reveal or browsing.
3. Roll the player's d6, with one optional replacement roll costing 2 energy. The replacement is final. The fan stays in place and retains selection.
4. Browse Attack / Dodge / Recover. Both the selected card and the existing context lane show exact effects from the dice, remaining health and energy.
5. Swipe the response up. The result card underneath flips in, on the same stack. Health and energy update once the successor arrives.
6. Swipe the result up to expose the next rat attack. A terminal result stays on the stack.

Buttons and the engine's normal arrow/Enter controls provide equivalent input. No separate table, combat overlay or second deck is created. The dice are lightweight 2D prototype displays, not the project's separate 3D dice tray.

## Proposed rules

The player starts at 10 health / 10 energy; the rat has 10 health. There is no passive recovery.

| Card | Cost | Player die higher | Dice tied | Player die lower |
| --- | --- | --- | --- | --- |
| Attack | 2 E | Deal 3, take 0 | Deal up to 2, take up to 2 | Deal 1, take full attack |
| Dodge | 1 E | Deal 1, take 0 | Deal 0, take 0 | Deal 0, take 0 |
| Recover | 0 | Gain up to 3 E, take attack minus 1 | Gain up to 3 E, take full attack | Gain up to 3 E, take full attack |

Recover's incoming damage is at least 1. All damage is clamped to remaining health. Damage and recovery resolve simultaneously; a mutual knockout is a draw. Paid rerolls reduce energy before card affordability and previews update. History includes both reroll and card costs.

The design takes inspiration from choosing an ability after a dice result and having a reroll decision. These are original simplified combat rules, not a reproduction of Dice Throne. Dice determine advantage while every exchange retains a player response. Values are exploratory, not a balance claim.

## Verification

No installation or application build is needed. With an available Node runtime:

```sh
node --test demos/rat-dice-stack/tests/*.test.js
```

The browser test requires an already available Playwright installation, Chrome and the running development server:

```sh
node demos/rat-dice-stack/tests/browser-check.cjs
```

Use `NODE_PATH` if Playwright is provided by an existing bundled runtime. Optional environment variables: `RAT_URL`, `CHROME_EXECUTABLE`, `RAT_SCREENSHOTS`.

Deterministic tests cover dice commitment, replacement-roll costs and limits, all response outcomes, exact resource previews, unavailable-card copy, zero energy, simultaneous knockout, immutable state, seeded fights, copied-source hashes and local runtime references. Browser checks cover the single stack, flips and swipe cancellation/commit, response reveal, reroll selection continuity, reset during roll/departure, narrow-screen containment, reduced motion and full terminal play. These do not verify physical touch devices, Safari, Firefox or assistive-technology output.
