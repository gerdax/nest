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

Optional intro swipe → rat reverse reveals its bite → automatic black d6 thrown from above → SUCCESS/FAIL and immediate hero HP update → 1200 ms result hold → front-to-front turn into hero action → optional weapon action enters from below → hero swipes a choice → automatic light d6 thrown from below onto the real check reverse → result and immediate rat HP update → 1200 ms hold → next rat card. Terminal hits reveal a final death/victory caption and stop the loop. An optional poison caption adds one swipe after the first rat attack and has no mechanical effect.

Use swipe up, ArrowUp or Enter to continue/play; left/right arrows browse. Buttons provide equivalent controls. Scenario toggles restart combat. Restart cancels active dice and presentation work. Presentation delays and front-turn animations pause when hidden; a completed physical roll waits for visibility before updating HP. An unresolved failed roll exposes retry, without changing HP or inventing a fallback result. Reduced motion retains readable result holds.

Defaults: hero 10 HP, rat 4 HP, weapon enabled, intro enabled, poison caption disabled. Independent 1d6 tests succeed on 4–6; rat deals 1, ordinary hero attack 2, weapon attack 3. No energy, rerolls or other effects. Values are exploratory. Pure model `initial`, `resolveAttack`, `terminal` lives in `combat-model.js`; presentation uses explicit phases in `combat-demo.js`.

## Copied sources

All runtime modules, CSS, artwork, fonts, dice models, worker code and WASM stay under this folder. `snapshot.json` records copied source paths and hashes. The current CardDeck copy adds only the demo-specific `turnFrontToChoices` method; its baseline hash is retained. `dice/snapshot.json` records pristine and derived dice files. `dice/COPY-NOTES.md` explains the local appearance API, black texture and physical throw-origin change. Vendor license/provenance files remain present.

## Verification

```sh
node --test demos/rat-combat-sequence/tests/*.test.js demos/rat-combat-sequence/dice/tests/*.test.js
node demos/rat-combat-sequence/tests/browser-check.cjs
```

The browser script uses an already available Playwright package and Chrome. Set `NODE_PATH` to an existing package location when needed. Optional variables: `COMBAT_URL`, `CHROME_EXECUTABLE`, `COMBAT_SCREENSHOTS`. No packages are installed. Production rolls are physical; browser scenario tests additionally inject known roll results to cover endings and cancellation reliably.

Main application regression command: `npm test`, equivalently `node --test tests/*.test.js`. Static staging: `python3 build_pages.py /tmp/nest-pages-rat-sequence` with a new/empty output directory. The application's staging script deliberately remains unchanged and does not publish this independent demo.

See `verification.json` for executed checks and limits. Chrome viewport emulation does not verify a physical phone. Simulated visibility events do not verify OS background throttling. Safari, Firefox, screen readers and legacy project formats were not manually tested.
