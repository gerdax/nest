# Combat authoring and runtime

Implemented first Rat milestone, 27 October 2026. This is the current behavior;
[product specification](combat-implementation-spec.md) records decisions and
[technical plan](combat-technical-plan.md) records milestone architecture.

## Library and project settings

- **Weapon** is an Item subtype. Set its damage range and select its **Provided
  combat Actions**. Its normal collection, inventory and artwork behavior remain.
- **Combat Action** is a distinct Library type. Configure requirements, Energy
  costs, Direct/Check resolution, own/source/no attack properties, range bonuses,
  cooldown and artwork. It cannot be placed in ordinary beat slots.
- **Effect Card** is a distinct presentation type, with the mockup's artwork,
  heading and signed resolved-health layout. It is not a negative Health pickup
  and never executes collection effects. Shared Player Hit is selected in
  Project settings and receives damage values from combat.
- **Enemy** contains its own attacks and presentation: an optional introduction using its main card’s artwork/text, ordered
  attacks, damage Effect Card, percentage health reactions and one required death card.
  Add/reorder/edit those entries directly inside the Enemy inspector. Embedded
  artwork has scale/offset/flip controls and previews. Reactions have percentage
  controls plus exact fraction controls; untouched thirds remain exact.
- **Default combat Actions** in Project settings supply weaponless choices such
  as Punch. Carrying Weapons adds their source-bound choices. The same Combat
  Action can serve different Weapons without sharing their cooldowns or damage.

New Enemies start with an attack, damage Effect Card and death card. Introduction and
health reactions are optional; missing artwork does not block testing. Use a
separate Enemy variant for changed content; Combat beats have no local overrides.

## Chapter beats

A **Combat** beat selects an Enemy and connects **Victory** to the next beat in
the current chapter. Victory retains player health/Energy/inventory and does not
grant rewards automatically. Unlinked Victory dims/disables departure of the
final enemy-death card with **Route unavailable**; killing damage still commits.

Each chapter contains exactly one **Death** beat, with an X icon, no ports and
an empty chapter-local Caption by default. It cannot be cut, deleted, duplicated
or made the chapter start. Cross-chapter paste replaces only its cards, retaining
target identity/position; local cards become independent copies and shared
Library references remain shared. Replacement is undoable.

Committed Health reaching zero interrupts ordinary or combat gameplay and
routes to the current chapter Death beat after accepted departure. Its final
card ends progression; no restart/end-screen flow is added. **Show death beat**
in Project settings affects graph visibility only, never runtime behavior.

## Resolution and the Rat fixture

The [non-saving Rat example](../player.html?example=rat) uses the production player
and explicit model-authored data from `project/combat-fixture.js`. It does not
replace browser storage. Collect Pistol, then play the Rat encounter. Health
starts at the normal project's 10 HP, not the old mockup UI's temporary 2 HP.

| Action | Check | Damage on hit | Energy | Cooldown |
| --- | --- | --- | --- | --- |
| Punch | 3d6 ≥ 11 | 1 | 0 | None |
| Shoot | 3d6 ≥ 11 | Pistol range 1–2 | 0 | None |
| Burst | 3d6 ≥ 9 | Source maximum +1: 1–3 | 0 | Next player turn |
| Rat Bite | 3d6 ≥ 11 | 1–2 | No Enemy Energy pool | None |

Rat has 4 HP and acts first. Enemy dice are black/from above; player dice are
light/from below. Rat reactions occur at ≤ two-thirds/one-third remaining
starting health; show only the stronger crossed reaction and skip both on death.

Damage is sampled once, then committed exactly once after the damage Effect
Card's accepted departure. Inspecting/canceling applies nothing. A valid result
survives presentation retries without rerolls or duplicate payment. A pre-result
player roll failure refunds provisional costs and restores choices. Configurable
Energy checks use pre-payment values, matching displayed odds.

Burst cooldown is per Action/source Weapon, starts on resolved hit/miss, and
clears after another completed player Action. Effect-card swipes are not turns.
Cooldowns reset between encounters. Pistol has unlimited uses; USING never
implicitly consumes it. Enemy attacks follow their authored repeating order.

## Format and compatibility

Native projects/chapter packages use version 3. Loading v1/v2 adds missing
combat defaults and Death beats without overwriting existing authored content.
Native saves use `nest.project.v3`; older storage is retained, and exact upgrade
payloads are backed up before the new save is published. Corrupt v3 data uses
recovery rather than silently loading an old v2 project. Imports remap references
and preserve destination project settings; exports include global combat roots.

Legacy story/item ownership promotion remains supported. New combat references
require shared Library definitions and do not silently promote local content.

## Deliberately deferred

Poison/statuses, Defend/Block, ammunition, equipment, multiple enemies, fleeing,
schemes/random attack selection, healing re-cross rules, finite-use weapon rules,
shared cooldown groups, post-death retry UX and durable combat resume are deferred.
Additional intrinsic/Action/embedded Enemy effects beyond the authored damage
profile are not silently accepted: current validation reports them as unsupported
for this milestone. Enemy Energy costs are similarly deferred. Ordinary story
progression effects and Health/Energy collection retain their existing semantics.

See the [M0–M7 checkpoint](combat-implementation-status.md) for verification evidence and limits.

## Consumable authoring

The Library has one **+ Consumable** button, initially selecting Health.
Consumables use `kind: 'consumable'` and `subtype: 'health' | 'energy'`.
The subtype selects the resource changed by Value; additional collection rules
retain their explicit targets. Switching subtype preserves name, value, artwork
and rules. Consumables never enter inventory. Effect Card remains separate.

Loading existing Health/Energy definitions converts their kind into the matching
Consumable subtype, preserving identities, local/shared ownership, placements,
custom rules and artwork. Project and chapter imports/exports and clipboard
copies retain the new form. Migration is idempotent and original files are not
rewritten; saving/exporting produces the migrated document.
