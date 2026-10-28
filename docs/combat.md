# Combat authoring and runtime

Implemented first Rat milestone, 27 October 2026. This is the current behavior;
[product specification](combat-implementation-spec.md) records decisions and
[technical plan](combat-technical-plan.md) records milestone architecture.

## Library: Content and Common

**Content** keeps the story-building Library grid: Vignettes, Captions, story
Actions, Items/Weapons, Consumables and Enemies. Its existing creation, search,
compatibility and placement controls remain. **Common** contains project-wide
combat definitions; it does not offer chapter placement.

- **Default combat Actions** lists weaponless Actions such as Punch. Select one
  to edit its presentation, check, requirements, Energy cost, own/no damage and
  cooldown in the right panel. Add, reorder, remove from defaults or reassign
  existing Actions here. **Delete card** at the bottom of the right editor deletes
  an Action and removes its default membership in one undoable transaction.
  **Remove from defaults** only changes availability and preserves its definition under
  **Unassigned common cards**; it does not delete authored content.
- **Player combat feedback** has a fixed **Damage received** entry with a small
  preview. Select it to edit the Effect Card directly. Combat supplies the
  signed damage value; the card has no independent collection effects. This
  required feedback entry cannot be deleted; its editor explains that constraint.
- Unassigned Common definitions remain editable, including preserved unused
  definitions from old projects. They are not automatically available in combat.

**Weapon** remains an Item subtype, combining its inventory representation,
base damage and full embedded Combat Action definitions. Edit Shoot/Burst
inside Pistol; each owns its name, artwork, check, Energy cost, damage profile
selection/modifiers and cooldown. Carrying a Weapon adds its owned Actions.
Action identities and cooldowns are scoped by source Weapon; editing one
Weapon's Action does not modify another Weapon. Player weaponless Actions
retain the same Combat Action structure, owned by Common instead.

Old Weapon→Library Action references migrate to independent embedded copies.
The old source is removed only if all references have migrated and no remaining
reference needs it; default/shared references retain their source. Missing,
wrong-kind, local or ambiguous sources remain explicit diagnostics. Names,
artwork, rules and stable Action identities survive migration. The original
input files remain unchanged.

**Enemy** contains its optional main-card introduction, ordered Actions,
**Effect cards → Health damage**, percentage reactions and one required death card.
Health damage has a fixed editor label and no editable Name. Its Description
uses the large heading style in preview and combat. Existing name-only damage
copy migrates into Description once, preserving the displayed text. All artwork
sections use preview → artwork path → image scale/position. Reaction percentages
retain exact fraction boundaries. New Enemies have an Attack Action, damage Effect
Card and death card; artwork is optional for testing. Use a separate Enemy
variant rather than local Combat beat overrides.

Project settings retain **Show death beat in chapter graph**. Default Actions
and player feedback are edited in Common, without separate settings selectors.
Internally Common definitions retain the existing project-level reference and
package machinery; this is an authoring organization change, not a second
runtime Library or a new run-state owner.

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
implicitly consumes it. Enemy Actions follow their authored repeating order. Each has an explicit Action
type; Attack is the initial supported type, with its own check and damage fields.
Legacy `attacks` lists migrate to `actions` of type `attack`, retaining identity,
presentation, order and rules. Additional types remain deferred.

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

Poison/statuses, advanced blocking rules, ammunition, equipment, multiple enemies, fleeing,
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

Library card editors open their collapsible sections closed by default. Sections
manually expanded stay open during subsequent edits of the same card.

## Shared Combat Action types

Common default Actions, Weapon-owned Actions and Enemy Actions share one
Combat Action structure and offer **Attack**, **Defend** and
**Wait**. Existing Actions migrate to Attack without changing their check, damage
or availability; no new Actions are injected into authored projects.

- Attack retains own/source damage, Direct/Check resolution and existing rules.
- Defend is direct and spends the turn. Its damage reduction defaults to 1 and
  applies to the next opposing attack, then expires on hit or miss. Protection does
  not stack or carry between encounters. Fully blocked attacks show BLOCKED.
- Wait is direct and spends the turn with no other effect.

Requirements, Energy costs and cooldowns remain available. Defend/Wait hide
attack-only check/damage fields; prior attack settings are retained if the type
is changed back, and the Attack resolution can be configured again. Protection
is granted after accepted departure; dice/presentation retries reuse frozen
results and do not apply protection, turns or costs twice.

Enemy Actions use the same type, resolution, check, own-damage profile and
Defend reduction fields. Existing Enemy root damage ranges migrate into
`attack.damage` without changing the range or other authored content. Their
ordered selection remains separate from player choice. Enemy availability
requirements, Energy costs, cooldowns and Weapon sources remain unsupported and
are diagnosed rather than ignored.

Direct Enemy Actions (Defend, Wait or a direct Attack) show their card until
accepted departure. Both sides gain protection after their Defend card commits;
only the opponent's next Attack consumes it. Wait/Defend do not consume the
opponent's protection. Neither protection nor turns are repeated on retry.

Action type is above Description in Common, Weapon and Enemy editors. The
**Effect** section contains type-specific mechanical fields; Effect Cards remain
presentation. Statuses, initiative manipulation, extra turns and escape routing
are outside this simple implementation.
