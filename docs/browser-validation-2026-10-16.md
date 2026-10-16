# Browser history and large-project validation — 16 October 2026

The browser checks confirmed and fixed a cached-page restoration bug in the studio and player. Both destroyed their live preview on `pagehide`, including departures where the browser kept the document for Back/Forward. The fix preserves services when `event.persisted` is true and retains terminal cleanup otherwise. The same cleanup rule applies to the dice demo and its worker/WebGL frame; their listeners remain registered after cached departures.

A measured performance fix removes idle graph rebuilding from `GraphView.cancel()`. Editing and history travel still cancel active gestures before replacing the document. Actual drags, pending connections, pan rollback, pointer capture release and click tracking retain their previous cancellation behavior.

## Browser verification

Chrome 155 on macOS, using dedicated localhost origins and diagnostic storage prefixes. Existing project storage and source assets were preserved. The diagnostic server serves the real hosts/modules, adding instrumentation and a test panel; these were not tests of the live GitHub Pages deployment.

| Scenario | Observed result |
| --- | --- |
| Before fix: player → checkpoint → Back | Same document token, `pageshow.persisted=true`; preview destroyed; Play reports “Project preview has been destroyed”. |
| Before fix: studio → checkpoint → Back | Same cached document; undo history remains, but Play fails with the same destroyed-preview message. |
| Fixed studio: collect an item, leave, Back, Forward, Back | Same document and live preview; collected item, variables and container position retained. Undo changes `Benchmark beat 6` to `Benchmark beat 5`; Redo restores it. Leaving the container then progresses to the fork. |
| Fixed studio → player → Back → Forward | Both host documents restore with `persisted=true`. Player retains its progressed container introduction and variable changes. |
| Fixed player → checkpoint → Back | Same live document, progressed card and variables retained; keyboard progression reveals the next collection item. |
| Development `Cache-Control: no-store` | Player Back produced a fresh document (`persisted=false`), with Play working. Studio Back restored a cached document (`persisted=true`), with the edited name, undo history and Play working. Cache eligibility is an observed browser decision, not assumed from headers. |
| Large graph pointer input | Native pointer panning worked. A node drag committed through the ordinary edit/save path, and Undo restored it. |

Actual cached restores were distinguished from reloads by both `pageshow.persisted` and an unchanged `performance.timeOrigin` diagnostic token. Callback tests alone do not establish browser cache behavior. No restart-on-pageshow workaround was added, so cached runs retain their state.

## Representative workload and timings

The deterministic fixture has 8 chapters, 480 mixed beats (288 linear, 96 fork, 48 container, 48 random), 1,112 placements, 610 definitions (250 shared and 360 local), ten variables, conditions, costs, effects, consumable items and six existing artwork paths. The generated pretty JSON is 803,213 bytes; browser-saved compact JSON is approximately 484 KB. Each chapter is independently playable. Controller tests exercise both contextual-check outcomes and chapter completion.

The matched comparison used the same Chrome tab at 1890 × 964 CSS pixels, DPR 1.6. A separate server supplied `GraphView.js` from commit `d70db82` for the baseline; other runtime code and diagnostic instrumentation were identical. Each run warmed up with two edits/undos, then performed seven edit/undo/redo/play/stop cycles and seven Library searches. Events were dispatched by the diagnostic runner through the actual UI handlers, with real namespaced localStorage writes. These are local observations, not performance guarantees.

| Operation | Before median / p95 (ms) | After median / p95 (ms) |
| --- | ---: | ---: |
| Beat-name change handler | 69.4 / 77.8 | 53.6 / 68.9 |
| Undo handler | 54.0 / 59.7 | 34.3 / 38.6 |
| Redo handler | 47.9 / 56.1 | 31.1 / 38.2 |
| Idle graph cancellation | 17.2 / 20.6 | <0.1 / <0.1 |
| Edit persistence, including validation/recovery checks | 18.6 / 24.6 | 19.9 / 22.8 |
| localStorage primary write | 1.0 / 1.5 | 1.0 / 1.4 |
| Synchronous preview play | 20.5 / 41.5 | 14.6 / 22.1 |
| Library search handler | 3.3 / 4.6 | 3.7 / 6.1 |

Graph rebuilds fell from 43 to 22 over the measured workload: the 21 idle cancellations no longer render the old document before the normal render. That operation-count change directly supports the optimization. Preview startup and Library search code were unchanged; timing variation there should not be attributed to this fix. Persistence recovery validation and history snapshots remain intact.

The fixed native node-drag observation measured nine move-handler calls at median 2.4 ms, p95 3.8 ms. Its release handler took 73.6 ms including document transaction, persistence and rendering. This single drag establishes an interactive path and identifies release work as a possible future profiling target; it is not a statistical drag benchmark. One observed studio initialization was 223.8 ms, and player initialization 378.2 ms; browser caches were uncontrolled, so neither is a cold-load guarantee.

[Machine-readable timing summaries](benchmarks/browser-validation-2026-10-16.json) retain operation counts, medians, p95 values, startup and pointer observations. With seven samples, p95 is effectively the maximum. `.twoRAF` values measure two animation-frame callbacks, not verified paint, full card animation, or dice readiness.

## Reproduction

No package installation or application build is required. Generate the fixture with Node:

```sh
node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {createLargeProject} from "./tests/fixtures/large-project.js"; writeFileSync("/tmp/nest-realistic-large.nest.json", JSON.stringify(createLargeProject(), null, 2));'
python3 tests/browser_benchmark_server.py --port 8945
```

Open `http://127.0.0.1:8945/editor.html?fixture=large`, run **Run warmed benchmark**, and inspect **Timing summary** or **Download results**. Native drags and Back/Forward must be performed separately. Use another unused port for ordinary application work: diagnostic writes use a prefix, but the harness intentionally changes the storage adapter inside its test document. Results download to the browser's configured download location.

For the old graph comparison, extract the module and start a second diagnostic origin:

```sh
git show d70db82:studio/GraphView.js > /tmp/nest-GraphView-before.js
python3 tests/browser_benchmark_server.py --port 8946 --graph-source /tmp/nest-GraphView-before.js
```

Use `--no-store` to match `serve.py`'s development cache policy. Default diagnostics use `Cache-Control: max-age=0` to exercise cache-friendly navigation. The runner edits only its isolated fixture; rerunning retains those test edits/history until a reload. A reload keeps its saved document but creates new in-memory history, as ordinary application loading does.

## Checks and limitations

- All 1,001 Node tests pass, including lifecycle policy, active/idle graph cancellation, large-project validation, portable round trips and contextual collection/check progression.
- Static staging succeeds: 179 files; local HTML/module/CSS references verified.
- Astra independently reviewed the runtime diff, tests and instrumentation and found no blockers. Browser execution and final acceptance were performed by the lead.
- Safari, Firefox, mobile/touch, physical devices, active WebGL dice restoration and legacy-format editor behavior were not exercised in this browser pass. Dice cleanup policy is covered by deterministic worker/WebGL fakes; those tests do not verify GPU restoration.
