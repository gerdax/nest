# Integrity audit fixes — 25 October 2026

The pre-fix working tree, error-handling work and audit were committed as `7ddec37` before implementation. GPT-6 Astra / medium advised on persistence ownership and independently reviewed the integrated fixes. The lead inspected the changes and verification results. Original artwork, design assets and frozen demo runtime copies were preserved.

## Changes

- Editor persistence now owns an exact per-session primary-save baseline. A stale draft cannot replace a different valid or damaged primary without explicit resolution. Startup storage-read failures cannot silently adopt a later readable save as the fallback draft's baseline.
- Active editor writes snapshot data before queuing, coalesce ordinary saves that have not started, and hold `nest.project.v2.write` through the comparison, backup and write when Web Locks are available. The fallback is optimistic comparison and cannot guarantee simultaneous-write exclusion. Existing synchronous storage callers retain their API; session preconditions are optional arguments.
- A conflict leaves the working document/history intact. The panel offers draft export, exact competing-save download, confirmed reload, or keeping the draft. Keeping rechecks the exact competing payload, verifies a separate backup and pointer, and then saves. The latest competing backup remains available through Download previous save. Damaged-save recovery retains its separate keys/notices. Quota, access or write-verification failures leave the draft open and the failure visible.
- Local document commands remain synchronous. Their `ok` describes the in-memory command; `saved` is the persistence Promise. Import recovery acknowledgement waits for that Promise. Pending writes never report Saved. Unsaved navigation protection is attached only while needed. Deliberate conflict reload invalidates pending and lock-waiting writes before navigation; cached-page restoration rechecks the primary without replacing the run.
- Legacy weighted selection scales weights before summing and recalculates after each draw without replacement. An additional regression uncovered the migrated pool's queue being shifted inside a `find` predicate; it now consumes exactly one queued ID per lookup. Native game-state transaction timing and engine animation code were not changed.
- Validation checks raw list shapes before resolving placed mechanics and diagnoses malformed legacy overrides. Malformed definitions, placements and overrides produce errors rather than incidental spread exceptions; invalid input is not silently normalized away.
- New studio and retained v1 editor identities retain full UUIDs. Existing saved identities and references are unchanged.
- Undo/redo remains snapshot-based, bounded to 80 entries and now 32 MiB of archived UTF-8 data across both stacks. The active document is exempt. Pruning removes only far ends of contiguous history; large documents retain fewer undo steps, and oversized snapshots cannot be archived. Full editor renders share one validation result with graph error rendering instead of validating twice.
- The stale authoring test now changes an added effect to `set` before assigning a variable. Frozen demo isolation checks recorded hashes rather than equality with today's root source. No demo runtime copy was refreshed.
- README and architecture contracts now describe trigger-counted Items, Health/Energy cards, explicit chapter progression, save conflicts and bounded history. Historical verification remains labeled as checkpoints. The unmounted drawer debug module is preserved but excluded from staging; compatibility APIs and reference prototypes were retained deliberately.

## Measured operation and memory changes

`docs/benchmarks/integrity-fixes-2026-10-25.mjs` generates fixtures only in memory, makes 85 history edits, walks the remaining undo states, then queues ten saves in one burst against a memory storage adapter.

| Total beats | Retained history MiB | Available undo steps | Queued saves | Primary writes |
|---:|---:|---:|---:|---:|
| 480 | 31.86 | 69 | 10 | 1 |
| 960 | 31.93 | 48 | 10 | 1 |
| 4,800 | 29.72 | 13 | 10 | 1 |

The audit estimated 182.88 MiB for 80 snapshots of the 4,800-beat document. The new measured retained buffer size is below 32 MiB. This is archived UTF-8 storage, not total process heap. Queue coalescing applies to work that has not started; ordinary edits separated by completed writes do not coalesce.

Whole-document transaction costs remain proportional to document size. A repeat of the audit CPU probe measured roughly 66 ms for a 4,800-beat rename transaction and 61 ms for save preparation. These changes do not establish a supported large-project size, mobile performance guarantee or end-to-end latency target. Finer UI invalidation and patch-based history remain profile-driven future work; they were not introduced speculatively.

## Verification

- Main deterministic suite: **2,223 passed; zero failures or skips**.
- Both isolated demo suites: **31 passed; zero failures or skips**.
- New coverage includes malformed mechanics across source scopes, full UUID identities, legacy overflow and both first/non-first pool branches, stale sessions, explicit resolution rechecks, failed backup writes and silently discarded primary writes, delayed locks, transient load denial, queued snapshots/coalescing, cancellation before reload, UTF-8 budgets, pruning and rollback/redo.
- Static staging to `/tmp/nest-fixes-verified-pages-20261025` succeeded: **258 files / 131,397,270 bytes**. Local references resolved; active conflict UI was included, the unmounted debug tool/PSD sources excluded and the retained chapter controller preserved.
- `git diff --check` passed.
- Astra found one startup overwrite edge case during independent review; it was corrected and independently reprobed. The final review reported no remaining blocking findings.

Real Chrome checks used a separate localhost origin (`127.0.0.1:8957`) and disposable generated starter data, leaving existing app-origin storage untouched. Two studios loaded the same baseline. Tab A saved an edited beat name; Tab B received a conflict, kept editing its own name, and could not overwrite the primary. A third fresh studio still loaded Tab A's saved name. Tab B's Keep this draft succeeded and exposed Download previous save; the other studio received the new conflict notification. Reload's discard confirmation was displayed; accepting it and completing navigation could not be verified because browser automation timed out controlling the native confirmation. Queue cancellation and primary preservation for that path are covered deterministically.

The player loaded the saved project and successfully progressed a narrative, revealed the container, collected the Flashlight by keyboard, reached and chose the next Action, followed Random routing to the final narrative, and completed the chapter with Health/Energy unchanged. These browser observations do not establish physical pointer/touch behavior, mobile/GPU performance, real dice physics, denied/quota browser UX or BFCache behavior across all browsers. Those checks remain unverified. No deployment was performed.

## Reproduction

No package installation is needed. With Node on PATH:

```sh
npm test
node --test demos/combat/tests/*.test.js demos/rat-dice-stack/tests/*.test.js
node docs/benchmarks/integrity-fixes-2026-10-25.mjs
python3 build_pages.py /tmp/nest-fixes-fresh-pages
```

This session used the bundled Node executable at `/Users/adam.smereczynski2/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` with `--test tests/*.test.js`, equivalent to the package script. Staging requires a new or empty output directory outside source assets.
