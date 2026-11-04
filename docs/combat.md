# Combat authoring and runtime

Production combat is included in the canonical `main` branch. The first Rat milestone was implemented on 27 October 2026 and has since gained Common/Weapon-owned Action authoring, Defend/Wait, Health costs and outcome effects. This guide describes the current behavior;
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
  preview. Select it to edit the Feedback directly. Combat supplies the
  signed damage value; the card has no independent collection effects. This
  required feedback entry cannot be deleted; its editor explains that constraint.
- Unassigned Common definitions remain editable, including preserved unused
  definitions from old projects. They are not automatically available in combat.

**Weapon** remains an Item subtype, combining its inventory representation,
base damage and full embedded Combat Action definitions. Edit Shoot/Burst
inside Pistol; each owns its name, artwork, check, Energy cost, damage profile
selection/modifiers and cooldown. Carrying a Weapon adds its owned Actions.
Weapon Actions slide in on the first player-choice display only. On later turns
they appear at the front in inventory/Action order; cooling-down Actions stay
visible but move to the end until ready again.
Action identities and cooldowns are scoped by source Weapon; editing one
Weapon's Action does not modify another Weapon. Player weaponless Actions
retain the same Combat Action structure, owned by Common instead.

Old Weapon→Library Action references migrate to independent embedded copies.
The old source is removed only if all references have migrated and no remaining
reference needs it; default/shared references retain their source. Missing,
wrong-kind, local or ambiguous sources remain explicit diagnostics. Names,
artwork, rules and stable Action identities survive migration. The original
input files remain unchanged.

**Enemy** contains the main-card introduction content, ordered Actions,
**Effects Feedback → Health damage**, percentage reactions and one required death card.
**Show introduction** is set independently on each Combat beat. It displays the
Enemy’s main card before combat; existing projects retain their previous setting.
Player and Enemy Feedback presentations use Name only as an editor label. Description
is the player-facing message, using the same large heading style in preview and combat.
Health damage uses a fixed section label; its internal Name is not editable. Existing name-only damage
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

A Combat beat with no assigned Enemy is a valid empty beat. Playback skips it
through its Victory connection, without an encounter or dice roll. A nonempty
reference to a missing or invalid Enemy still reports an error. Empty beats
require a continuation when reached; an unlinked output is not an implicit end.

Click **Enemy · Name ↗** inside a Combat graph node to open that Enemy in the
Library. Missing or invalid Enemy references show **Choose Enemy** without a
link; select the beat to repair its reference.
With **Match selected beat type** enabled, shared Enemies remain available for
a selected Combat beat. Single-click opens the definition for inspection.
Double-click assigns it to the selected beat, replacing any previously assigned
Enemy in one undoable edit. The Enemy selector remains available in the beat inspector.

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

New Enemy dice checks and **Add dice** default to **d6, Count 3**. Existing
authored pools remain unchanged. Enemy dice use the supplied atlas at
`assets/dice/themes/nest-black/numbers.png`, selected by the `nest-black` theme.

Damage is sampled once, then committed exactly once after the damage Effect
Card's accepted departure. Inspecting/canceling applies nothing. A valid result
survives presentation retries without rerolls or duplicate payment. A pre-result
player roll failure refunds provisional costs and restores choices. Configurable
Energy checks use pre-payment values, matching displayed odds.

Burst cooldown is per Action/source Weapon, starts on resolved hit/miss, and
clears after another completed player Action. Effect-card swipes are not turns.
Cooldowns reset between encounters. Pistol has unlimited uses; USING never
implicitly consumes it. Enemy Actions follow their authored repeating order. Attack, Defend and Wait
are supported, alongside Prepare, with the type-specific properties described below.
Legacy `attacks` lists migrate to `actions` of type `attack`, retaining identity,
presentation, order and rules.

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
Weapon intrinsic effects beyond the authored damage profile and Enemy resource
costs remain deferred. Common Action Progression effects
are supported as described below. Ordinary story progression effects and
Health/Energy collection retain their existing semantics.

See the [M0–M7 checkpoint](combat-implementation-status.md) for verification evidence and limits.

## Consumable authoring

The Library has one **+ Consumable** button, initially selecting Health.
Consumables use `kind: 'consumable'` and `subtype: 'health' | 'energy'`.
The subtype selects the resource changed by Value; additional collection rules
retain their explicit targets. Switching subtype preserves name, value, artwork
and rules. Consumables never enter inventory. Feedback remains separate.

Loading existing Health/Energy definitions converts their kind into the matching
Consumable subtype, preserving identities, local/shared ownership, placements,
custom rules and artwork. Project and chapter imports/exports and clipboard
copies retain the new form. Migration is idempotent and original files are not
rewritten; saving/exporting produces the migrated document.

Library card editors open their collapsible sections closed by default. Sections
manually expanded stay open during subsequent edits of the same card.

## Shared Combat Action types

Common default Actions and Weapon-owned Actions offer **Attack**, **Defend** and
**Prepare**. Existing player **Wait** Actions remain editable. Enemy Actions offer
**Attack**, **Defend**, **Prepare** and **Wait**. Enemy Prepare secretly chooses
protection or stronger damage, as described below. All share one
Combat Action structure. Existing Actions migrate to Attack without changing their check, damage
or availability; no new Actions are injected into authored projects.
Fresh projects start with Punch, Defend and Prepare in Common, including the
non-saving Rat example. Loading an existing project preserves its selected
defaults, including legacy Wait Actions; use Common to add or change Actions.

- Attack retains own/source damage, Direct/Check resolution and existing rules.
- Defend is direct and spends the turn. Its damage reduction defaults to 1 and
  applies to the next opposing attack, then expires on hit or miss. Protection does
  not stack or carry between encounters. Successful attacks show SUCCESS even when protection absorbs all damage.
- Player Prepare is direct and spends the turn. Its positive safe integer preparation
  bonus defaults to 2. It adds to both damage endpoints of the player's next
  Attack, including a Common Attack or an Attack from any Weapon. The bonus belongs
  to the player, does not stack, persists through Defend and Wait, and is consumed
  on hit or miss. Repeating Prepare replaces the stored bonus with the latest
  Action's bonus. Preparation resets each encounter.
  It grants no protection or Energy regeneration. The bonus is applied before
  the Enemy's damage reduction and does not create damage for an Attack with
  No attack properties. Such an Attack still consumes preparation. The player
  sees `PREPARED · +N DAMAGE` above the cards until the bonus is consumed.
- Wait is direct and spends the turn without an additional type-specific property.

Requirements, Energy/Health costs and cooldowns remain available. Defend/Prepare/Wait hide
attack-only check/damage fields; prior attack settings are retained if the type
is changed back, and the Attack resolution can be configured again. Protection
is granted after accepted departure; dice/presentation retries reuse frozen
results and do not apply protection, turns or costs twice.
Player Prepare follows the same accepted-departure boundary, advances cooldowns once
like any player Action, and ignores stored On success/On failure effects as a
Direct Action. A technical failure before an Attack result preserves preparation;
a valid result consumes it, and presentation retries reuse that frozen result.

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
**Effect** section contains type-specific mechanical fields; Feedback presentations remain
presentation. Statuses, initiative manipulation, extra turns and escape routing
are outside this simple implementation.

“Go to card” keeps ordinary placed cards in their Chapter inspector. During
combat it opens the owning Library definition: Enemy introduction, Actions,
health feedback/reactions and death presentation; the source Weapon and its
selected embedded Action; or the selected Common Action/player feedback card.
Nested sections expand automatically. Targets follow stable card IDs when
Actions are reordered, and unavailable/removed sources disable the link.
Navigation is disabled during gestures, transitions and dice resolution.

## Action properties and Progression effects

Every Combat Action separates its type-specific **Action properties** (Attack
damage, Defend damage reduction, Prepare bonus, or Wait passing the turn) from its common
**Progression effects**. The latter reuse ordinary action operations on run
variables and inventory. Combat retains integer Health values; Energy and other
numeric variables keep their existing numeric rules. Enemy effects affect that same player/world state, not
a separate Enemy inventory. Requirements, Energy/Health costs and cooldown controls
retain their existing player-only availability; Enemy actions still run in order.

Progression effects apply once on completion, on either dice outcome, including
misses and fully blocked hits. Checked Combat Actions also expose **On success
effects** and **On failure effects**, using the same separate lists as ordinary
Actions. Completion applies common progression first, then the matching outcome
list. A blocked hit is still success. Direct actions ignore both outcome lists
and hide their editors while retaining saved contents. For damaging actions, all
completion effects commit when the damage Feedback is advanced; otherwise they commit before the next turn. Intrinsic
player health damage and progression operations share one transaction, in that
order, before testing for death. Enemy HP and run changes publish together. This
means authored healing can offset damage, weapon removal changes subsequent
choices, and lethal progression redirects to the chapter Death beat. Killing-hit
progression commits before publishing the Enemy death card and checking Victory.

Retries preserve the resolved result and commit identity, so effects cannot
repeat after a publication failure. A failed progression transaction applies
neither its run mutations nor intrinsic damage. This does not add statuses such
as poison or independent effects to Feedback presentations.

Player Combat Actions may spend Energy or integer Health. Health payment is
provisional during a check and is refunded if the attempt fails technically or
is cancelled. Completion applies progression effects before the global death
check, allowing authored healing to offset a Health cost. **Hide badge** is
presentation-only and never changes affordability, payment or refund amounts.

The temporary per-effect dice checkboxes have been removed. Any saved checkbox
metadata is ignored; common progression effects once again apply on both outcomes.


## Validation and interruption safeguards — 30 October 2026

Numeric player Health uses safe integers across the whole run, including ordinary
story/collection effects, Consumables, chapter overrides and carried state.
Fractional Health is diagnosed rather than rounded; Energy retains its existing
numeric rules. Effective attack ranges combine the authored bonuses with the
own/source Weapon range and must remain nonnegative, ordered safe integers.
Invalid ranges are reported before playback instead of preventing all choices.

The displayed check formula includes the resolved modifier, including stat or
variable bonuses. The compact probability display rounds to a whole percentage;
its calculation still uses the full resolved probability. A `+3` modifier on
`3d6 ≥ 11` therefore displays `3d6 + 3 ≥ 11` and `84%`.

Observers may stop/restart playback during phase/payment notifications. An old
encounter must not spend resources, refund a replacement run or publish later
presentation after such a lifecycle change. See the
[integrity fix report](audit-fixes-2026-10-30.md) for regression and browser evidence.

Player combat cards show their Action type (ATTACK, DEFEND or WAIT) in the top
label; enemy Action cards omit that label. Unaffordable combat choices name the
missing resource in their status, for example NOT ENOUGH ENERGY.

Combat requirement statuses name the missing resource without numeric thresholds
(NOT ENOUGH ENERGY / NOT ENOUGH HEALTH), or show NO REQUIRED ITEM for a missing
required item. Health and Energy equality requirements act as minimums during
combat: a requirement of 3 permits 3 or more. Other equality and maximum rules
keep their authored meaning and show the failed rule; flag requirements name the
condition. Requirements do not spend resources; costs still do.

Weapon cards use the WEAPON corner label in authoring, inventory previews and
playback. Source Weapon actions show their calculated damage range beside the
minimum/maximum bonus fields, including both endpoint calculations. Invalid
ranges mark the bonus fields and validation reports the contributing values.

Combat check odds show the tested variable name above the percentage when a
variable/stat is selected. Checks without a variable retain ATTACK. The caption
uses the same Very low / Low / Medium / High / Very high bands as regular Actions;
the dice formula remains in authoring diagnostics.

## Player Prepare verification — 31 October 2026

At the player Prepare release, the integrated deterministic suite passed 2,652 tests with no failures or skips.
Prepare coverage includes accepted/canceled departure, provisional-cost refunds,
cooldown progression, nonstacking replacement, cross-Weapon/Direct damage,
protection and lethal clamping, miss consumption, technical-failure preservation,
frozen-result retries, overflow diagnostics, authoring roundtrips, legacy defaults,
Enemy rejection and Prepared indicator lifecycle. Static staging verified local
HTML/module/CSS references. Independent source review found no blocking issues.

In-app browser verification used the production Rat example: Pistol collection,
five player choices, direct Prepare, visible preparation while Enemy damage was
pending, Health commitment, and consumption after a missed Shoot. The new-project
editor showed Punch/Defend/Prepare in Common and the editable preparation bonus.
The indicator was visually inspected above the card without overlapping resources.
These checks used the desktop in-app browser; physical touch devices, other
browsers, narrow layouts and screen-reader announcements were not newly verified.


### Hidden Enemy preparation

Set an Enemy Action’s **Action type** to **Prepare** to keep its benefit hidden.
It spends the Enemy turn without a dice check and secretly chooses, with equal
probability, either **Damage reduction** against your next Attack or
**Preparation bonus** damage on its next successful Attack. The chosen benefit
is revealed in a card before the affected damage feedback. A missed player
Attack still consumes a prepared block; the Enemy’s damage bonus survives misses.
Player Defend or Prepare does not consume an Enemy block. Another Enemy Prepare
replaces the previous hidden benefit; benefits do not stack and reset each encounter.
Existing Attack, Defend and Wait cards retain their behavior. To use this for a
Rat, change its preparation Action to Prepare in the Enemy’s Library definition.
