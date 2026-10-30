# Combat-production integrity fixes — 30 October 2026

## Version and scope

The audit and fixes use the production worktree on `codex/combat-production`,
starting at `3de757d311415f5a71afb12f54e2f0d641316db8`. The older Desktop
`main` checkout was not the basis for this audit. The production implementation
and fixes form the canonical `main` version. Original artwork,
source documents and frozen demo implementations remain preserved.

## Changes

- Declared numeric Health uses safe integer defaults, bounds, chapter overrides,
  costs, consumable values and effects. Runtime state rejects fractional/unsafe
  values without rounding, including chapter carry. Former fractional story
  Health content now requires explicit author correction. Nonnumeric story
  variables named `health` retain their behavior; combat requires numeric Health.
  Energy and other numeric variables retain their existing fractional rules.
- Validation checks effective own/Weapon damage ranges using the same resolver
  as runtime. Invalid bonus combinations and overflowing endpoints diagnose
  before combat choice construction.
- Coordinator observer notifications recheck encounter identity before payment,
  result feedback or further presentation. Stale failures cannot refund a new run.
- Combat formulas include resolved positive/negative/stat/variable modifiers.
  Probabilities remain computed from resolved rules; the compact UI rounds the
  percentage for display.
- Exchange exceptions compensate host state and recover the original live card
  face. Accepted or synchronously completed exchanges remain committed even if
  a later observer throws. Recovery cannot overwrite restarted playback; repeated
  adapter failure reports both the original and recovery errors.
- The authoring benchmark validates retained contiguous undo/redo within the
  byte budget, uses the runtime storage key and includes `errors.js` in its
  disposable profiling tree.

## Verification

- Main deterministic suite: **2,591 passed**, zero failures/skips.
- Isolated combat/Rat demo suites: **31 passed**.
- Static staging: **285 files / 169,320,626 bytes**, 103 artwork/font assets;
  checked local HTML/module/CSS references resolved. This is packaged size,
  not initial browser transfer.
- Full authoring benchmark completed timing, heap and profiling workloads.
  After 80 edits, 480/960/4,800-beat fixtures retained 69/48/13 undo steps,
  all validated through redo. Archived bytes stayed below 32 MiB.
- `git diff --check` passed. Astra independently reviewed the integrated changes;
  its final 161-test focused run passed with no blocking findings.
- Browser smoke used a separate localhost origin and a disposable imported
  project, leaving saved project data untouched. It covered Pistol collection,
  production Rat entry and the corrected `3d6 + 3 ≥ 11` / `84%` display, with
  no captured warnings/errors.

Engine-shaped tests include actual nested face text/artwork restoration under
injected decoration, deposit, cleanup and return-render failures in normal and
reduced motion. They do not establish physical gesture/device behavior.
Physical devices, Safari/Firefox, screen readers, GPU performance and the full
browser encounter/outcome matrix were not retested. These fixes do not establish
a supported large-project limit or remove the measured whole-document editing
and large-container scan costs. Source publication and website deployment are
separate actions.

## Reproduction

No installation or application build is required. With Node on PATH:

```sh
npm test
node --test demos/combat/tests/*.test.js demos/rat-dice-stack/tests/*.test.js
node --expose-gc tests/benchmark-authoring.mjs
python3 build_pages.py /tmp/nest-fixes-fresh-stage
```

Staging requires a new or empty directory outside source assets. The session
used the bundled Node executable because Node/npm were absent from shell PATH;
its `node --test tests/*.test.js` invocation is equivalent to the package script.
