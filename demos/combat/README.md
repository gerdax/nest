# Isolated Nest combat demo

Open `http://127.0.0.1:8949/demos/combat/` after starting the existing development server from the repository root:

```sh
python3 serve.py --host 127.0.0.1 --port 8949
```

This directory is self-contained. It can also be served independently, without the application directory:

```sh
python3 -m http.server 8950 --bind 127.0.0.1 --directory demos/combat
```

Then open `http://127.0.0.1:8950/`. No installation or application build is needed.

## Interaction

The choice view uses the copied **CardDeck** engine with a coverless Fork: browse left/right and swipe up to play. Arrow keys also work. An accepted action departs using the real engine's motion. The demo then switches to a table, flies the player's face-up card in from below and the enemy's reverse from above, flips the enemy card, resolves once, holds feedback, and automatically returns to the Fork. A terminal round stays on the table.

The frame reuses Interaction Preview's width formula, 796:1654 body ratio, 80% studio scale, HUD, shared playfield layout, fonts, card renderer and material. Only the demo owns the table choreography. Restart cancels outstanding presentation work. Reduced motion omits physical movement but retains a readable result. Hiding the document settles an accepted round without rerolling or resolving it twice.

The opponent commits one uniformly random affordable action before player selection. Optional `?seed=1000` supplies a reproducible RNG for verification; it does not alter combat rules. No project is loaded or saved and no application storage is accessed.

## Rules

- Player starts at 10 health / 10 energy. Enemy settings: health 1–30, energy 0–30. Changing settings starts a fresh fight. Enemy energy sets both its initial reserve and recovery cap.
- Attack costs 2 energy and deals 4 damage against Recover. Attack/Attack cancels damage, but both pay.
- Dodge costs 1 energy and avoids Attack.
- Recover costs 0 and restores 2 energy up to that character's cap, including when hit. There is no passive recovery or opening mechanic.
- Every sixth consecutive round without an attack hit removes 1 health from each fighter. A hit resets this pressure counter.

## Isolation and copied sources

All runtime imports, styles, fonts, textures and artwork are local to this directory. `snapshot.json` records source paths and SHA-256 hashes for unchanged copies. These copies include the source working tree's pre-existing local changes at the moment of copying. The derived `studio/preview-window.css` contains only the original editor's window rules. The demo does not import the project controller, editor, player host or project storage.

Only these demo-owned files implement new behavior:

- `combat-model.js`: pure simultaneous rules and validation.
- `combat-cards.js`: action payloads and table faces using the copied game renderer. Existing supplied artwork is illustrative; USING/item actions are not implemented yet.
- `combat-demo.js`: accepted Fork actions, enemy precommit, table phases, HUD and history.
- `presentation-clock.js`: cancelable timers and Web Animations.
- `index.html` and `combat-demo.css`: isolated host and table layout.

## Verification

Run from the repository root with an existing Node.js runtime:

```sh
node --test demos/combat/tests/*.test.js
```

This covers all nine card pairs, costs, custom caps, zero-energy recovery, pressure, terminal states, immutability, invalid inputs, symmetry, canceled presentation work, pristine snapshot copies and local runtime references.

The browser check uses an existing Playwright installation and Chrome, with the HTTP server running:

```sh
node demos/combat/tests/browser-check.cjs
```

Set `NODE_PATH` to an existing bundled `node_modules` if Playwright is not on the module path. Optional environment variables: `COMBAT_URL`, `CHROME_EXECUTABLE`, `COMBAT_SCREENSHOTS` (default `/tmp/nest-combat-engine`). No packages are installed by this demo.

Browser coverage and limitations are recorded in `verification.json`. Touch emulation is not physical-phone verification. Simulated visibility-event checks are not OS background-throttling or browser-cache checks. Safari, Firefox and assistive-technology output require separate verification.
