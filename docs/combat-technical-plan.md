# Combat technical implementation plan

> Historical first-milestone scope. Production combat is implemented and is
> included in the canonical main version. Later work added Defend/Wait, Health
> costs and progression/outcome effects. Use [the current combat guide](combat.md)
> and [implementation checkpoints](combat-implementation-status.md) for current
> behavior and verification; the original decisions below remain preserved.

Implementation status and verification: [M0–M7 checkpoint](combat-implementation-status.md).

27 October 2026. Planning deliverable prepared with Astra's architecture review.
No runtime, schema or editor implementation is introduced by this document.

Product authority: [Combat implementation specification](combat-implementation-spec.md),
especially A1–A50. Rat is the first authored acceptance fixture for the reusable
system. The choices below are technical recommendations, not new gameplay
features. Preserve original source assets and the functioning mockup reference.

## 1. Target architecture

| Layer | Responsibility | Existing owners / recommended additions |
| --- | --- | --- |
| Document model | Definitions, defaults, typed references, scoped ownership, compatibility | Existing project model modules; proposed `combat-model.js` |
| Pure combat rules | Action availability, source binding, checks, damage, ordered attacks, reactions, cooldowns | Proposed `project/combat-rules.js`; reuse checks/state helpers |
| Project runtime | Authoritative player state, graph progression and global Death interruption | `ProjectController.js`; focused committed-state/death helper |
| Encounter coordinator | Combat phases, pending resolutions and effect-step commitment | Proposed `project/CombatCoordinator.js`, owned by ProjectController |
| Presentation adapter | Resolved content to shared deck/dice/UI payloads | Proposed `project/combat-presentation.js`; preview/player presentation host |
| Shared engine | Gestures, physical faces, transitions and their completion | CardDeck, renderer, existing motion components and DiceService |
| Authoring | Library inspectors, project settings, Combat/Death graph controls | Existing studio modules; proposed `studio/combat-inspectors.js` |

Names of new files are recommendations. Avoid making another generic framework
or moving game rules into CardDeck/dice physics. A Library definition is not
automatically playable in every beat: Enemy is composite, Combat Action is
combat-only, and Effect Card does not have Health pickup semantics.

### Authored data contract

Freeze exact serialized names at M0. Recommended concepts:

| Structure | Representation |
| --- | --- |
| Weapon | Item subtype, base damage/intrinsic effects and Provided combat Actions references |
| Combat Action | Distinct Library kind; requirements/check/costs, target/effect rules, cooldown and optional own/source attack profile |
| Effect Card | Distinct Library kind; mockup damage-card presentation and resolved signed value; no collection effects |
| Enemy | Composite definition: health, ordered embedded attacks, optional intro, embedded damage/reaction/death content |
| Combat beat | Enemy reference plus Victory connection; no overrides |
| Death beat | Constrained Linear behavior with local/Library card placements; no graph ports |
| Chapter | Mandatory Death reference separate from its start reference |
| Project | Default combat Actions, Player Hit selection, graph-only Show death beat setting |

Embedded Enemy attacks/cards have stable local identities for ordering, preview
and step commitment, but are not separate Library definitions. Player Combat
Actions may be referenced by multiple Weapons. Each runtime choice binds its
Action to the actual owned source Weapon. Preserve unique Item-definition
ownership; do not introduce duplicate inventory copies or equipment slots.

Damage profiles explicitly select own damage or source-Weapon damage. Optional
attack fields must not prevent future non-damaging Combat Actions. Do not
implement Defend/Block under the guise of placeholder zero-damage attacks.
Store percentage boundaries exactly, e.g. numerator/denominator; comparisons
must not use rounded display values for Rat's two-thirds/one-third thresholds.

### References are a shared model concern

Introduce/reuse one typed reference enumeration/remapping service. Prefer
consistent reference objects such as `{definitionId}` where practical, or
explicitly register any new string fields. Current dependency/clipboard code
understands only selected fields; new references will not work automatically.

Use the same reference contract for validation, dependency closure, compilation,
deletion/usage reporting, local ownership, variable references, import collision
rewriting, card/node clipboard and cleanup. Include:

- Weapon → Combat Actions.
- Combat beat → Enemy.
- Project defaults → Combat Actions and Player Hit.
- Genuine rule references inside embedded Enemy attacks/cards.
- Death beat → local or shared card definitions.

Project combat settings must be dependency roots. Current chapter export starts
from the chapter itself, and the dependency graph does not scan project-level
settings. Export/compile must retain default Actions, Player Hit and Weapon
Actions needed by carried inventory even without direct chapter placements.
Embedded Enemy content travels with its Enemy rather than separate exports.

### Versioning, storage and compatibility

Recommend native **v3 project and chapter packages**, retaining the existing
document kind identities. Mandatory Death and new kinds cannot safely pretend
to be understood by a v2 reader. Accept v1/v2 through additive migration and
reject unsupported future versions explicitly. Do not overwrite original files.

Add an idempotent combat-default initializer on detached documents, after legacy
normalization and before current-schema validation. It adds only missing
structures, uses collision-safe identities, preserves authored content/valid
selections and distinguishes absent fields from deliberately empty settings.
An explicit broken reference remains a diagnostic, not a silent replacement.

New/upgraded projects receive the required Death beats, default Player Hit setup
and missing default Punch configuration. Do not inject Rat/Pistol into every
project or grant a Weapon: those belong to the separate acceptance fixture.
Chapter creation currently has no Library context; use a project-level chapter
insertion helper so every creation/import path can add the owned local Caption.

Recommended storage protocol:

- New v3 primary/recovery/conflict namespaces; retain v2/v1 as upgrade sources.
- Read older storage only when v3 is absent. A malformed v3 primary triggers
  recovery, never silent fallback to an older project.
- Preserve/verify the exact upgrade input before publishing its new save.
- Retain optimistic conflict checks. Detect changed upgrade inputs and newer
  writers; preserve old-key edits rather than silently merging or losing them.
- Repeated load/import does not duplicate defaults or reset existing Death cards.

Chapter packages carry necessary combat settings and their dependency closure.
Import continues to respect the destination project's selected settings. Source
defaults do not overwrite established destination Player Hit/default Actions;
import/remap content and validate compatibility with the destination selections.

## 2. Runtime contracts

### One owner of player state

ProjectController owns health, Energy and inventory. CombatCoordinator owns only
encounter-local Enemy health, attack index, cooldown map, phase and pending
resolution. It requests guarded player operations from ProjectController; it
does not create another run state or deck.

Recommended host interface: read immutable run snapshot; request dice; present
content; commit an identified player operation; request Victory adoption; hand
off on player Death. Reuse `PlayerUI`, `DiceLayer`, `DiceService` and shared result
timing. The pure rules layer accepts snapshots, supplied dice and random samples,
returns data, and never touches DOM, timers or graph navigation.

### Resolved attacks and exactly-once steps

Freeze a valid resolution with encounter/generation/turn identity, Action or
embedded attack identity, actor/target, source/profile snapshot, actual dice,
success, sampled/effective damage, cooldown/order changes and ordered effect
presentation steps. Each operation/step has stable identity and commit state.
This is in-memory lifecycle protection, not durable combat save/resume.

After a valid outcome exists, presentation retries reuse it. An unavailable or
canceled transition must not silently advance phase or reroll. Mark a step
committed only after its state publication succeeds. Async callbacks validate
encounter epoch, resolution and step identity before acting.

Damage commits after its Effect Card's accepted departure completes. Inspection
and canceled gestures commit nothing. Descriptive cards do not change resources
or count as turns. Do not copy the mockup's advanced-turn-state/restore-HP
workaround. If a source disappears after a future final-use cost, the already
resolved attack retains its captured profile.

Suggested phases: intro; enemy entrance/roll/result/effects; player choice and
departure/roll/result/effects; enemy death; Victory blocked/complete; player Death
handoff; error/canceled. One controller owns deck commit dispatch at a time.
Reuse actual transition completion and existing scheduler, not scenario polling
loops or a second animation clock.

Cooldown keys are Action + source Weapon identity. Resolved Burst starts once
on hit/miss; another completed player Action clears its one-turn cooldown.
Do not decrement a newly started cooldown on its own turn or per Effect Card.
Cooldowns reset on new encounters. Keep costs distinct from deferred HP: reuse
existing provisional-payment/refund semantics when implementing configurable
nonzero Energy costs. USING presentation alone must not consume a trigger budget.

### Global committed-health/Death policy

Keep `state.js` pure. Add a controller-owned commit/continuation policy and use
its pure terminal selector in route prediction as well as real commitment.
Audit current player-state publications: initial/chapter entry, automatic
entry/adopt, intro reveal, direct Action, completed check, collection completion,
inventory exchange and combat damage.

Provisional check payment, rollback and predictive traversal are not gameplay
commits and must not launch Death. Current ProjectController writes variables
at several of these sites; hooking only `commit()` is insufficient.

Required ordering:

1. Calculate/preflight candidate committed state.
2. If health is lethal, choose chapter Death **before** checking the normal
   outgoing route. An unavailable ordinary route must not disable a lethal card.
3. At accepted departure, publish the state and hand off once with the existing
   back-rotation choreography. Invalidate outgoing beat/check/combat callbacks.
4. Do not re-enter Death repeatedly because its health remains zero.

For chapter entry already at zero, use one automatic handoff without inventing
a swipe. Treat malformed health definitions as validation issues. Death must
have a halted/terminal reason distinct from successful chapter completion:
`ProjectPreview` currently uses `completed` to enable next-chapter UI. Final
Death cards must not enable that UI or add a restart flow.

### Victory is a different terminal path

Combat Victory follows its designated next beat. Existing traversal interprets
null routes as chapter completion, so never reuse that interpretation here.
Reuse normal blackout/route-reason UI, but apply unavailable Victory only at
the final enemy-death card's departure. Earlier damage/death cards still work.

The killing damage must commit Enemy HP to zero even when Victory is unlinked.
Then the final enemy-death card is disabled with Route unavailable. Do not
preflight-reject that hit, reroll, resurrect the Enemy or commit damage twice.
Required definition/card-reference validation remains separate from missing
Victory connections, which do not create a new pre-playback rejection rule.

## 3. Milestones and gates

### M0 — Contract freeze and baseline

Write the canonical fields, typed-reference table, coordinator host interface
and phase/commit table from sections 1–2. Record working main/integration
checkpoints and current verification commands. Implement on an isolated branch
or worktree; keep the mockup/reference and original assets intact.

**Gate:** technical review confirms types, source identity, Death priority,
blocked Victory timing and version/storage upgrade strategy. No deferred
gameplay is invented to make the contract appear complete.

### M1 — Schema, migration and reference foundation

Implement definitions/defaults, v3 parsing/upgrades, slot/reference validation,
detached compilation and full reference closure/remapping. Update packages,
local ownership, storage/recovery, variable references and clipboard consumers
together so schema changes cannot lose dependencies.

**Owners:** project cards/model-data/migration/normalization/validation,
compilation/dependencies/local-ownership/packages/storage and model facade;
`studio/persistence.js`, variable/reference and transfer helpers where needed.

**Gate:** repeated v1/v2 upgrade is stable; v3 round trips and collision imports
preserve content/settings; no duplicate defaults/Death beats; exports include
project combat roots and carried-Weapon Actions. Combat-only types cannot enter
ordinary beat slots through parsing/paste. Do not publish a partial build that
writes v3 while its editor/loaders discard required fields.
Audit autosave queues, conflict/recovery, chapter/full-project exports, raw
recovery export and storage-event handling together; these are not all owned
by `project/storage.js` alone.

### M2 — Shared presentation capabilities

Selectively port native content transitions, renderer staging, black/light dice
and throw direction, shared result timing and necessary theme assets from the
integration branch. Port their regression tests. Do not overwrite main's newer
editor work, merge the entire branch or copy `combat/scenario.js` into production.

**Owners:** `engine/CardDeck.js`, renderer, DiceService/frame/theme and necessary
vendor direction changes, `studio/check-presentation.js` and host hooks.

**Gate:** real check-face identity, completion/abort/restart, background/resize
and reduced-motion behavior remain correct. Default noncombat dice retain their
appearance. Browser checks exercise actual bundled physics; preserve provenance.

### M3 — Mandatory Death and global committed-state routing

Implement automatic Death creation, X icon, no ports, graph-only visibility,
simplified inspector and empty local Caption. Enforce protection against delete,
cut/duplicate, Alt-drag, group commands and set-start at the command layer, not
only by hiding buttons. Death paste is one undoable replacement transaction:
keep target ID/position, clone local dependency ownership, retain Library refs.

Implement the committed-health gate and terminal-state distinction across
ordinary gameplay before attaching combat. Audit speculative route checks and
provisional payments separately from accepted commits.

**Owners:** death/model helpers, ProjectController, GraphView, document commands,
node/card clipboard/transfer, icons/menus/settings, ProjectPreview/player host.

**Gate:** noncombat lethal direct/check/intro/item/entry paths hand off once,
even if normal routing is unavailable; previews/rollback do not. Hidden Death
still plays. Final Death is a dead end, with no next-chapter/restart UI. Mixed
local/Library paste and chapter upgrade work through undo/redo/export/import.

### M4 — Pure combat rules and authored fixture data

Implement source-bound choices, own/source damage, exact checks/sampling,
clamping, ordered embedded attacks, percentage crossing and cooldowns. Create
the acceptance fixture through model factories, never Rat-name branches.

**Owners:** proposed combat-model/rules modules and focused behavioral tests.
No UI or authoritative project-state mutation belongs here.

**Gate:** exhaustive three-d6 checks give 50% and 160/216; Punch fixed 1, Shoot
uniform 1–2, Burst uniform 1–3, Rat 4 HP, Bite uniform 1–2. Exact fractions,
stronger-only/lethal reactions, multiple Weapons sharing an Action, cooldown
on misses and ordered multiattack enemies work. Effect swipes are not turns.

### M5 — Coordinator and production playable slice

Integrate CombatCoordinator under ProjectController using immutable compiled
definitions and host interfaces. Use one existing deck; coordinate listener
ownership rather than adding competing scenario listeners. Expose state through
the established PlayerUI/HUD/USING contracts and preview lifecycle.

Implement frozen resolutions, pending Effect Card commits, embedded Enemy
presentation, global player Death handoff, and Victory/blocked departure.
Invalidate generations on Stop/Restart/destroy; clear encounter-local state on
exit without restoring player resources or mutating Library definitions.

**Gate:** model-authored Rat encounter plays against real run state through
victory, player Death and unlinked Victory. No early/double HP commitment,
reroll-on-presentation-retry or attack after lethal damage. Later encounters
reset cooldowns. Existing contextual Lockpick Actions still behave normally.

### M6 — Complete Library and chapter authoring

Add Weapon Provided combat Actions controls, Combat Action fields, separate
Effect Card editing, and self-contained Enemy editing/inline previews. Include
optional intro, attack ordering, percentage reactions and death sequence. Add
project Default combat Actions/Player Hit controls and Combat Enemy selector
with Victory connector. Preserve scoped pickers, editable drafts and undo/redo.

**Owners:** focused combat inspector helpers plus existing inspectors/forms,
Library type/usage controls, card preview/navigation, settings, document commands
and graph/drag compatibility. No Combat overrides or enemy inventory controls.

**Gate:** create and play the fixture entirely through the real editor. Shared
Enemy edits and separate variants work; empty artwork permits testing; missing
required content is diagnosed. Picker/drag/paste/import compatibility agrees.
Keep the fixture as a separate example, not edits to existing user chapters.

### M7 — Acceptance, compatibility review and release checkpoint

Run the full deterministic suite, package round trips, upgrade tests, staging
outside source assets and real browser authoring/player checks. Exercise new
and upgraded existing projects separately. Update implemented-versus-deferred
docs and produce a reviewable checkpoint with exact validation evidence.

**Gate:** product-spec acceptance passes, with no duplicate state writer,
missing reference closure, silent chapter completion or overwritten originals.
Check keyboard/native gestures, narrow layout, reduced motion, real dice,
Stop/Restart, inspect/cancel and unavailable-route blackout. Report phone,
Safari/Firefox and screen-reader coverage separately if not performed.

## 4. Dependencies and work ownership

```text
M0 -> M1 -> M3 --------> M5 -> M6 -> M7
       |                 ^
       +----> M4 --------+
M0 ---------> M2 --------+   (M3 transition integration also requires M2)
```

M2 engine/dice work and M4 pure rules can proceed independently after stable
contracts. Model/reference changes need one integration owner. M3 and M5 both
touch ProjectController and should integrate sequentially. M6 forms can start
after M1 with non-overlapping ownership, but final UI acceptance depends on M5.
These are logical gates, not instructions to release incomplete versions.

Use Astra for contract review and consequential commitment/death/reference
reviews; bounded implementation can follow repository worker routing. Give
tasks explicit owned files, interfaces and tests. Do not assign simultaneous
edits of the controller or schema/migration boundary to different workers.

## 5. Validation and operational notes

Native JavaScript modules require no package installation/build. Current
`package.json` maps `npm test` to `node --test tests/*.test.js`. If shell PATH
lacks Node/npm, use the available bundled Node binary and record its path.
Recheck scripts/runtime location when implementation begins.

| Check | Command / scope |
| --- | --- |
| Full deterministic suite | `npm test` or available Node binary with `--test tests/*.test.js` |
| Local serving | `python3 serve.py --host 127.0.0.1 --port <available-port>` |
| Static staging | `python3 build_pages.py /tmp/<fresh-combat-staging-directory>` |
| Source hygiene | `git diff --check`; inspect unrelated changes/original assets |
| Browser acceptance | Real editor/player plus isolated lifecycle fixtures, distinct from pure tests |

Tests should assert behavior: duplicate/late callbacks, pending-outcome retries,
restart during Death, group commands containing Death, mixed local/Library
paste, export global roots, collision imports and old-version recovery. Preserve
exact input saves before migration testing. Historical mockup test counts are
reference evidence, not proof that the planned implementation passes.

## 6. Deferred scope and escalation

Statuses/poison, Defend/Block, ammunition, equipment, multiple enemies, fleeing,
schemes/random selection, healing re-cross semantics, finite-use weapon rules,
shared cooldowns, post-death retry UX and durable combat resume remain deferred.
Do not add placeholder mechanics that imply these features are implemented.

Surface newly discovered behavior conflicts, especially future lethal self-costs,
unsupported health definitions or simultaneous-death precedence. Resolve field
names/module details within the technical plan without repeatedly reopening
already agreed product behavior. Rat's zero-cost damage-only fixture does not
need future status/defense semantics in order to be complete.

See [weapons model](weapons-and-combat-actions.md) and the
[product specification](combat-implementation-spec.md) for accepted decisions.
