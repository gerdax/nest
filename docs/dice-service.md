# Reusable 3D dice

Open `dice.html` through `python3 serve.py` to try the isolated tray. No package installation, CDN or application build is needed. The host container must have a visible, nonzero height (the demo uses at least 280px).

```js
import { DiceService } from './assets/dice/DiceService.js';
const dice = new DiceService().mount(document.querySelector('#my-tray'));
const controller = new AbortController();
const result = await dice.roll([
  { sides: 12, count: 1 },
  { sides: 6, count: 3 }
], { signal: controller.signal });
// result.dice: [{ sides: 12, value: ... }, { sides: 6, value: ... }, ...]
// The caller decides what these values mean.
dice.clear();   // Clear settled dice or reject an active roll with AbortError.
dice.destroy(); // Release the world permanently when the context closes.
```

`mount(container)` returns the service; initialization is lazy on the first `roll`. Each instance is independent of chapters, cards, nodes, actors, inventory and success rules. A pool accepts d4, d6, d8, d10, d12 and d20 with positive integer counts, up to 30 dice total. Multiple rolls on the same service cannot overlap. Returned array order is the engine's order; use `sides` when interpreting mixed pools. Only raw physical values are returned; no sum, target, modifier, advantage or resource spending is chosen here.

`roll` resolves after Dice Box reports physical values for all dice. Errors, aborts and the 30-second initialization/roll deadline unload the world; the next roll starts a fresh world. An already aborted signal does not start an engine. `clear` preserves the mount and allows another roll; `destroy` is permanent. Hosts should call `destroy` when closing their context. WebGL is required; unavailable WebGL produces an error instead of an invisible random-number fallback. Serve over HTTP(S), rather than opening a file URL. Hosting CSP must permit same-origin module/frame/asset requests, blob/data workers and WebAssembly as required by the vendored engine.

## Provenance

The vendored engine comes from the browser distribution used by [gerdax/onejournal](https://github.com/gerdax/onejournal) at commit `d9b0ddd3a204bfa7bd4488b5c7d99fe214c37d73` (`@3d-dice/dice-box` 1.1.4). The [runtime MIT license](../assets/dice/vendor/dice-box/LICENSE) ships with the active distribution. The Nest light and black themes share the default mesh and face map.

The fixtures in `tests/dice-reference/` preserve the offscreen bundle, the original CC0 atlas and the Nest SVG for comparison tests. The full former `dice/` directory, including the upstream README and optional themes, is preserved in the local archive alongside the repository.

The Nest wrapper adopts the physics and height-dependent scale settings shown in Onejournal's `dice-engine.js`, with a context-independent pool. Dice Box has no public disposal API, and clearing an active roll discards its promise. Nest therefore owns the engine in a disposable same-origin iframe, explicitly terminates that frame's workers and releases WebGL contexts before removing it. Cancelling always rejects the host promise, including during initialization.

Deterministic tests cover validation, lifecycle, concurrent-call rejection, cancellation, timeout and independent services using a fake transport. They do not verify GPU rendering, physical settlement, browser worker cleanup or mobile devices; those require browser checks of the actual demo.

Browser acceptance in Codex’s desktop browser confirmed settled d6 and d20 numerical rolls, cancellation during an active roll, and a fresh roll after cancellation, with no console errors. Actual phone testing and worker/GPU memory profiling remain unverified.
