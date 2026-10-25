# Nest audit — 25 October 2026

Read-only review by GPT-6 Astra / medium. Scope is the current working tree, including preexisting uncommitted error-handling changes. No project source or original assets were changed. The lead independently verified the principal probes and owns final acceptance.

## Assessment

Nest's native-module, local-first architecture fits its current product: authoring reusable narrative cards and playing them through a physical card interface. Preserve the separation between authored data, atomic gameplay state, presentation choreography and independent dice results. A framework migration, backend, generalized plugin architecture or broad engine rewrite is not warranted by this audit.

The code has materially improved since the October 16 audit. Model responsibilities now have distinct owners; document commands operate on detached history drafts; compilation is detached; collection effects are consolidated; damaged-save backup/recovery is explicit; native Random weights are scaled; traversal and graph cycle checks use explicit stacks; Library indexes are operation-scoped; full history snapshots are UTF-8 buffers; accepted presentation IDs are bounded; persisted pagehide no longer destroys active previews. Do not re-report those historical defects as unfixed.

There is no newly demonstrated P0/P1 runtime defect in this review. There is a real authoring overwrite risk across independent editors, two smaller robustness/legacy defects, a non-green verification baseline caused by stale test assumptions, and concrete scalability/maintenance opportunities.

## Findings and evidence

### P2 — Concurrent editors silently overwrite a valid newer save

**Confirmed persistence behavior; actual two-browser-tab interaction was not exercised.** `/Users/adam.smereczynski2/Desktop/nest/project/storage.js:35` detects a changed primary string only to validate it; line 42 then writes the caller's whole project. There is no revision or expected-base comparison. `/Users/adam.smereczynski2/Desktop/nest/studio/editor.js` has no storage-event conflict handler.

A memory-adapter probe initialized the save, loaded two detached copies A/B, changed A's project name and saved it successfully, then changed B's chapter name and saved successfully. Reloading retained B's chapter edit but reverted A's name to `First expedition`. Both saves returned `{ok:true}`. The existing malformed-save recovery does not preserve A because A is valid JSON.

Impact: opening two editor tabs can lose recent authoring work without an unsaved/conflict warning. This does not require collaboration or a backend to fix. Retain the loaded/saved base payload or revision, detect changes before overwriting, preserve the competing document, and expose reload/export/adopt choices. A storage event can provide early notification, but should supplement a save-time check. Avoid implying localStorage compare/write is a fully atomic cross-tab transaction; if strict simultaneous-write guarantees are needed, use an appropriate local locking/storage mechanism.

### P3 — Legacy weighted selection still overflows

**Confirmed valid input gives the wrong branch.** `/Users/adam.smereczynski2/Desktop/nest/chapter/random.js:6` sums raw weights. Supported v1 and compiled `legacyPool` execution still use this helper (`/Users/adam.smereczynski2/Desktop/nest/project/ProjectController.js:169`). Native Random's separate implementation already scales by maximum weight.

A valid project containing a legacy pool with two eligible sequences weighted `1e308` each produces `validateProject(project) === []`. `selectPool(pool, 1, () => 0)` returns `['b']`, the second sequence, because the total is Infinity and `0 * Infinity` becomes NaN. Other nonzero draws also fall through incorrectly. Ordinary weights are unaffected.

Fix: use the scaled-weight selection rule in the legacy helper too, recalculating after each without-replacement draw, and test supported v1/migrated legacy playback as well as the pure helper. Prefer one shared small arithmetic helper if it can preserve both APIs and without-replacement semantics.

### P3 — Validation can throw while inspecting malformed placed mechanics

**Confirmed API/diagnostic robustness defect, not a validation bypass or demonstrated data loss.** `/Users/adam.smereczynski2/Desktop/nest/project/validation.js:290` resolves a placement after checking only some override-list shapes. `/Users/adam.smereczynski2/Desktop/nest/project/cards.js:56` spreads base and placement conditions/effects.

Reproduction: `const p=createProject(); p.library[0].conditions={bad:true}; validateProject(p)` throws `TypeError: (base.conditions || []) is not iterable`. Replacing `conditions` with `effects` gives the analogous exception. The validator has already recognized malformed lists, but resolution throws instead of returning its error list. Similar malformed input deserves a systematic shape pass before semantic resolution.

Imports and storage catch exceptions, so malformed documents are still rejected and recovery protection remains; however callers lose structured chapter/node diagnostics and the exported validation API does not consistently return errors for invalid data. Guard all resolved collection shapes, or split shape validation from semantic resolution. Add table-driven malformed-data tests for definition/placement/override conditions, effects and onCollect; do not normalize malformed objects into empty lists and accidentally accept them.

### P2 verification debt — Main suite currently fails because a test assumes an obsolete default

**Confirmed by lead full-suite execution and source review.** 2,100 tests ran: 2,099 passed, one failed. `/Users/adam.smereczynski2/Desktop/nest/tests/inventory-item-authoring-scope.test.js:140` adds an effect then sets its key directly to `chapter-flag`. `/Users/adam.smereczynski2/Desktop/nest/studio/commands.js:197` now intentionally creates effects as `{op:'addItem', key:firstEligibleItem}`. `/Users/adam.smereczynski2/Desktop/nest/studio/document-commands.js:106` correctly rejects a variable as an Item-effect target.

This does **not** establish the owning-chapter bug suggested by the test's name: earlier assertions verify the owner context successfully. Update the test to change the new effect's operation to `set` before assigning the flag, retaining its assertion that chapter-local variables are available. Do not weaken the Item eligibility check to make the test pass.

The lead also ran the isolated demo suites: 31 tests, 30 passed, one failed. `/Users/adam.smereczynski2/Desktop/nest/demos/rat-dice-stack/tests/isolation.test.js:3` checks both the snapshot manifest hash and equality with today's root source. A frozen isolated demo can retain the correct manifest hash while the root renderer evolves; equality to the current root is then a stale contract. Follow the immutable snapshot/provenance contract, not an instruction to copy current production code into the preserved demo. Independent verification found all recorded Rat demo snapshot hashes intact; six source files have since diverged (renderer, CheckSurface, card-deck CSS, cardBacks, geometry and CardDeck). The failing assertion is equality with the current root renderer, not its recorded hash. Neither failure authorizes changing original demo assets.

## Material risks and design choices, separate from proven defects

### Generated identities have only 32 random bits

`/Users/adam.smereczynski2/Desktop/nest/studio/commands.js:7` uses `crypto.randomUUID().slice(0,8)` with a type prefix, without checking existing identities; creation at lines 13–14 pushes directly. This is an integrity/scalability risk, not an observed random collision. For 10,000 IDs in one prefix namespace the approximate birthday collision probability is 1.16%; for 5,000 it is about 0.29%. Placement IDs accumulate across chapters and copy operations.

The lead independently supplied two distinct UUIDs with the same `deadbeef` prefix in an isolated Node process: two makeDefinition calls created duplicate `event-deadbeef` IDs, and validation subsequently reported the duplicate. This proves the missing collision handling; it does not establish a naturally occurring collision in user data.

Use the full UUID or a collision-checked allocator. Validation can detect some duplicates later, but should not be the creation-time collision strategy. This is a small targeted change with more value than a broad architecture rewrite.

### Full-document authoring work is still synchronous and proportional to project size

`/Users/adam.smereczynski2/Desktop/nest/editor/DocumentHistory.js` keeps bounded full UTF-8 snapshots; `/Users/adam.smereczynski2/Desktop/nest/studio/document-session.js:8` clones and finalizes documents; save performs normalization, validation and serialization (`project/storage.js:32`); ordinary edits still rebuild substantial UI. The current architecture is coherent, but a keystroke/command can incur several document passes before DOM work.

Lead measurements, synthetic desktop Node, medians of seven samples after two warmups:

| Total beats | Definitions | Compact JSON bytes | Validate ms | Compile ms | Rename transaction ms | Save with memory adapter ms | 80 UTF-8 snapshot estimate |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 480 | 610 | 484,244 | 4.78 | 8.29 | 12.66 | 10.22 | 36.94 MiB |
| 960 | 610 | 697,552 | 6.31 | 11.14 | 18.16 | 16.42 | 53.22 MiB |
| 4,800 | 610 | 2,397,040 | 29.53 | 38.97 | 66.43 | 61.20 | 182.88 MiB |

These are separate operation timings; do not sum overlapping operations and present them as a measured interaction. Snapshot figures are storage-size estimates, not measured process heap. No DOM, true localStorage I/O, image decode, GPU, mobile hardware or end-to-end input latency is included. At 4,800 beats a single measured transaction already exceeds a 60 Hz frame interval. Measure real edits/undo/drag/startup before introducing patch history or incremental views. Coalescing persistence, a byte-budget for history and finer view invalidation are candidates; preserve explicit transaction/rollback and immediate save-status behavior.

### Documentation mixes current and retired mechanics

`/Users/adam.smereczynski2/Desktop/nest/README.md:31` still describes consumable Item **Use**, while the current runtime has trigger-counted Items and Health/Energy resource cards, and normalization deletes old `use` data. `/Users/adam.smereczynski2/Desktop/nest/docs/architecture.md:59` repeats the retired Use contract; line 71 calls node cycles opt-in although project defaults permit them. `/Users/adam.smereczynski2/Desktop/nest/docs/state-system.md:5` is more current about explicit chapter progression and carried shared Items.

Treat these as documentation drift, not a request to restore removed mechanics. Align the entry documentation with the current product and label historical verification sections as checkpoints. This matters because contradictory contracts can cause future regressions even when tests pass.

## Modularity and refactoring

The main responsibilities are sound: model facade with acyclic owners; pure state transactions; dependency analysis reused for portability and deletion; controller owns game semantics; CardDeck owns gesture/presentation lifecycle; renderer and geometry are separate; preview owns dice/DOM lifetimes. Lead static first-party import analysis found zero cycles. This does not prove behavioral independence, but supports keeping the boundaries.

Concentrated complexity remains in CardDeck (~1,805 lines), renderer (~605), ProjectController (~597), studio editor (~515), validation (~380) and ProjectPreview (~343). Size alone is not a defect. The principal risk is timing/state coupling and dense one-line orchestration. Format touched complex functions rather than mass-formatting unrelated files.

Useful next boundaries:

1. Explicit persistence session/revision ownership to solve the confirmed lost-update case.
2. Validator shape preflight before resolving semantics; retain public facade and structured diagnostics.
3. A shared description of gameplay transaction intent used by prediction/authorization/completion, while retaining distinct commit timing. Controller currently repeats costs/effects/trigger construction in departureReason, transaction and collection paths. Do not move gameplay rules into the deck.
4. A narrow stable content/presentation contract between controller and deck, documented with acceptance/removal/adoption milestones. Existing tests are valuable here; retain synchronous callback/reentrancy coverage.
5. Profile-backed UI invalidation or persistence/history changes; avoid mechanical extraction into helpers sharing unrestricted mutable internals.

## Dead code and retained compatibility

No broad safe-deletion list is established. The README explicitly retains chapter/editor v1 APIs and original playground/ScenarioController references. Dice iframe entrypoints and dynamically reached assets must not be judged by a static root import closure alone. Frozen demos are preserved source artifacts and should remain isolated.

Repository symbol search found these candidates outside active application use:

- `/Users/adam.smereczynski2/Desktop/nest/studio/inspectors.js:184` `variableInspector`: a compatibility composition wrapper used by several tests; active editor uses separate project/chapter inspectors. Mark compatibility intent or migrate its remaining callers deliberately.
- `/Users/adam.smereczynski2/Desktop/nest/project/dependencies.js:90` `deleteDefinition` and line 95 `cleanupLocalDefinitions`: exercised by tests and usable as public pure document APIs; active UI has richer removal/session logic. They are not safe deletion targets merely because production calls moved elsewhere.
- `/Users/adam.smereczynski2/Desktop/nest/studio/drawer-debug.js:67` `mountDrawerDebug`: no current repository caller found in the symbol search; only `createDrawerTraceFilter` is imported by tests. The file is included through blanket studio staging. This is a plausible orphaned developer tool. Confirm whether manual console/external use is intended, then either document/wire the debugging entrypoint or exclude it from active staging while preserving the source.

A small explicit active/compatibility/debug/reference manifest would make staging intent clearer. Avoid a tree-shaking/build-system migration for this purpose.

## Coverage and limitations

| Area | Reviewed evidence | Remaining verification |
|---|---|---|
| Product intent | AGENTS, README, architecture, state documentation, prior audit | Documentation reconciliation with current intended UX |
| Persistence | storage/recovery/session code; independent-editor memory-adapter reproduction | Actual multi-tab UX, real quota/denial and simultaneous writes |
| Model/integrity | normalization, compilation, packages, validation, dependency/local ownership, clipboard/transfer code | Exhaustive malformed/legacy corpus; no formal schema proof |
| Gameplay | state/checks/controller, prediction/acceptance/completion paths, weighted-selection probe | Real interaction combinations, live dice cancellation/physics |
| Modularity/dead code | owner modules, import-cycle result, repository symbol searches | External consumers and manual debug entrypoints |
| Performance | current hot-path structure; lead CPU/snapshot measurements | Browser DOM/GPU/image/device traces and end-to-end timings |
| Delivery | lead staging passed, 258 files / 131,394,718 bytes | Deployment and browser asset loading were not performed |
| Regression baseline | lead full main and isolated-demo suites; failure root-cause review | Baseline must be green after correcting stale test contracts |
| Browser lifecycle | persisted-pagehide guards now present in both active hosts | Actual BFCache restore, physical touch, mobile GPU and real dice |

Staging size is total packaged size, not initial page transfer. Preserve original artwork; create separate optimized derivatives only if profiling identifies decode/upload/memory pressure. No live browser or physical device verification was performed by this audit. Passing deterministic tests or reference staging must not be represented as covering those checks.

## Recommended order

1. Restore a trustworthy green verification baseline by correcting the two stale test assumptions without weakening valid checks or modifying frozen assets.
2. Add local editor conflict detection/recovery for valid concurrent saves.
3. Fix legacy weighted arithmetic and validation shape handling with narrow regression tests; use full/collision-checked IDs.
4. Reconcile current user/developer documentation and clarify active versus compatibility/debug entrypoints.
5. Profile representative browser interactions and optimize the measured persistence/history/view costs; retain native modules and current gameplay/presentation boundaries.

## Reproduction commands used by the lead

The shell did not expose npm or Node on PATH. The main suite used the bundled Node executable with the package script's equivalent command:

```sh
/Users/adam.smereczynski2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.js
/Users/adam.smereczynski2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test demos/combat/tests/*.test.js demos/rat-dice-stack/tests/*.test.js
python3 build_pages.py /tmp/nest-audit-pages-20261025
```

Staging requires a fresh or empty output directory. The audit's CPU probe is retained alongside this report in `docs/benchmarks/audit-scale-2026-10-25.mjs`; run it from this repository using the same Node executable. It mutates only generated in-memory fixtures. Timings vary with host load and runtime. Test execution logs for this session are `/tmp/nest-audit-tests.log` and `/tmp/nest-audit-demo-tests.log`.
