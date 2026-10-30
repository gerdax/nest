# Combat implementation checkpoints

Current production behavior is documented in [combat.md](combat.md). The
implementation and subsequent fixes are included on the canonical `main`
branch; the worktree notes below describe where the original checkpoints were
verified. Later sections supersede the original milestone's deferred scope.

## Historical M0–M7 checkpoint

27 October 2026. This checkpoint was implemented in the isolated
`combat-production` worktree while the then-current main checkout and reference
combat mockup were preserved. Main now includes the production implementation.

## Milestone delivery

| Milestone | Delivered |
| --- | --- |
| M0 | Native v3 contracts and separate authored Rat fixture; agreed product decisions remain in the specification. |
| M1 | Weapon/Combat Action/Effect/Enemy definitions, mandatory Death, typed reference closure, migration, validation, compilation, package and storage compatibility. |
| M2 | Shared native slide/turn transitions and exact departure completion, staged rendering, black/light physical dice and shared result timing. |
| M3 | Protected chapter Death authoring, graph-only visibility, replacement paste and global committed-health interruption. |
| M4 | Pure source-bound combat rules, exact odds, sampled damage, ordered attacks, percentage reactions and per-Weapon Action cooldowns. |
| M5 | Production coordinator on the existing deck and player state; pending damage, retry guards, player Death and explicit/blocked Victory. |
| M6 | Library inspectors, embedded Enemy cards and artwork, project combat settings, Combat Enemy selector and Victory connection. |
| M7 | Regression suite, staging, architecture review, browser acceptance and this reviewable checkpoint. |

The [authoring/runtime guide](combat.md) describes the implemented fields and
explicitly deferred mechanics. The [technical plan](combat-technical-plan.md)
remains the original architectural plan rather than a new product specification.

## Verification evidence

- Full deterministic suite: **2,390 passed, 0 failed, 0 skipped** using the bundled
  Node runtime with `node --test tests/*.test.js`.
- Static staging: `python3 build_pages.py /tmp/nest-combat-release-stage-20261027`:
  280 files; local HTML, module and CSS references verified; 103 artwork/font assets.
- `git diff --check` passed. Original artwork and prototypes were preserved;
  the ported dice vendor change retains its existing provenance/license.
- Astra independently reviewed coordinator state/commitment and integration
  contracts. Findings concerning retry state, presentation progression and
  pre-payment check values were fixed and covered by behavioral tests.
- Existing tests were adapted to mandatory project defaults/Death and native v3;
  their original ownership, import and routing assertions remain exercised.

Real in-app browser checks used the production player/editor at port 8960:
Pistol collection, Rat intro, actual bundled black/light dice with hits/misses,
Punch/Shoot/Burst choices, deferred damage, one-turn Burst cooldown and recovery,
stronger-only Rat reaction, lethal Enemy damage, Enemy death and connected
Victory to the next story beat. Player health, Energy and inventory persisted.

Editor checks covered Library Weapon references, self-contained Enemy fields,
Combat selection/Victory, protected Death controls and graph-only visibility.
A separate isolated test changed player starting Health to 1 and Bite target to
3: pending damage left Health unchanged, accepted departure committed zero and
turned to the hidden chapter Death beat; its final card produced a Death dead end.
These authored test changes are not part of the fixture source/defaults.

Deterministic tests additionally cover unlinked Victory blackout, canceled and
duplicate callbacks, restart/destroy, presentation failures/retries, multiple
source Weapons, exact threshold boundaries, ordinary lethal paths, Death paste
undo/redo, upgrades, storage recovery and package reference remapping.

## Verification limits

The authored fixture was imported into the real editor and its controls inspected;
a complete encounter was not authored manually from an entirely blank project.
Unlinked Victory and lifecycle cases have deterministic coverage; they were not
all repeated manually in the browser. Reduced motion and narrow-layout edge
cases were not manually verified in this acceptance run. Physical phones, Safari/Firefox and screen readers were not tested.
No deterministic test is presented as evidence of those device/browser checks.

Poison/statuses, Defend/Block, ammo/equipment, multi-enemy combat, fleeing,
attack schemes/randomness, healing re-cross rules, finite-use Weapons, shared
cooldowns, post-death retry and durable combat resume remain deferred as agreed.
Later authoring work added common Combat Action Progression effects. Type-specific
properties remain separate; poison/statuses, Weapon intrinsic effects and Enemy
costs still receive explicit validation diagnostics. See [current action semantics](combat.md#action-properties-and-progression-effects).

## Try it

Run `python3 serve.py --host 127.0.0.1 --port 8960` from the current checkout.
Open `player.html?example=rat` for the non-saving example, or `editor.html`
for Library/chapter authoring. The example does not replace browser storage.

## 28 October 2026 authoring follow-up

Checkpoint before this work: `5103cc6` (Consumable migration and previous UI
refinements). Library now has Content/Common tabs; Common directly edits default
Actions and player damage feedback, including ordering, undoable creation and
preserved unassigned definitions. Weapons own embedded Actions; old reference
sources migrate without losing names, presentation, mechanics or live references.

Verification: 2,411 deterministic tests passed with no failures/skips; static
staging to `/tmp/nest-common-final-stage-20261028` verified 281 files and 103 assets.
An independent review checked migration, dependency closure and a collision import
probe involving a nested Weapon Action inventory condition. Real browser checks
covered Common navigation/feedback, default Action creation and Undo, Content
filtering, migrated Pistol Shoot/Burst editors, scaled feedback previews and a
production Rat run reaching Punch/Shoot/Burst choices with physical dice. Device,
Safari/Firefox and screen-reader checks were not repeated.

Later authoring work shares the existing On success/On failure effect sections
with checked Combat Actions. Progression effects remain common to either outcome;
per-effect dice checkboxes are no longer used.


## 30 October 2026 integrity follow-up

The current implementation includes Attack/Defend/Wait, Energy/Health costs,
shared progression and outcome-effect editors. The original M0–M7 deferrals
above are historical; the [current guide](combat.md) owns the feature list.

All six confirmed audit findings were addressed: numeric Health and effective
damage validation, observer lifecycle guards, modifier display, exchange
compensation and the authoring benchmark. Verification passed 2,591 main tests,
31 isolated demo tests, static staging and the repaired benchmark. Astra found
no remaining blocking issues in its final review. Browser verification confirmed
Pistol collection, entry into production combat and `3d6 + 3 ≥ 11` with `84%`.
Physical devices and other browsers were not retested. Full details and
reproduction commands are in [the integrity fix report](audit-fixes-2026-10-30.md).
