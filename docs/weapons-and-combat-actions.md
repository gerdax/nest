# Weapons and combat actions

**28 October 2026 authoring amendment:** Weapons now own embedded Combat Actions;
weaponless default Actions and shared player Effect Cards are edited in Library
→ Common. Library → Content retains story definitions. This supersedes earlier
Weapon→Action reference authoring and Project-settings selectors below. See the
[current guide](combat.md) for the implemented layout and migration behavior.

Decision agreed on 27 October 2026. This document records the intended design;
it does not introduce a project schema, editor controls or production combat.
Field names below are conceptual until implementation.

Later authoring decision: player combat Actions are a separate Library type,
**Combat Action**, based on Action machinery with combat-specific fields. They
are usable only within Combat/Encounter beats for now, not ordinary beat card
slots. Weapons reference these Library definitions; barehanded player attacks
use the same type with their own damage. Enemy attacks remain authored inside
Enemy definitions. See A43 in the implementation specification.

The next milestone is specified in [Combat implementation specification — Rat
encounter](combat-implementation-spec.md), with explicit agreed/proposed/open
statuses and authoring/runtime acceptance gates.

## Weapon is a special inventory item

**Weapon: Pistol** is an Item with weapon-specific properties and provided combat
actions. It retains ordinary item identity, artwork, ownership and collection
behavior. Weapon is a meaningful subtype, rather than only a descriptive tag.

Two different relationships determine action availability:

| Relationship | Authoring starts with | Item's role |
| --- | --- | --- |
| Contextual item use | A scene action, such as Pick Lock at a closed door | An availability requirement: the player needs the specified item or item tag |
| Weapon use in combat | A carried weapon, such as Pistol | A source of attacks added to the player's combat choices |

A scene author designs Pick Lock first and specifies the required lockpick.
The lockpick does not add Pick Lock to every scene. In combat, the carried
weapons determine which additional attacks are offered; authors do not need to
place every possible weapon attack separately in each encounter.

A weapon can also satisfy a contextual scene requirement. For example, a
crowbar can provide combat attacks and enable a scene-authored Pry Door action.

## Ownership of properties and rules

| Owner | Responsibility |
| --- | --- |
| Weapon definition | Identity, artwork, category/tags, collection behavior, base damage, intrinsic attack effects and references to provided combat Actions |
| Action definition | Requirements, direct/check resolution, hit check, costs, targeting, how weapon damage/effects are used or modified, action-specific effects, failure consequences and cooldown |
| Character's default Action | Its own damage/effects for attacks without a weapon, such as Punch |
| Combat runtime | Source-item binding for each offered attack, remaining cooldowns, selected targets and pending/resolved outcomes |
| Effect card or sequence | Presentation of the outcome, including shared player cards and enemy-specific artwork/cards |

The weapon defines the damage and intrinsic effects it contributes. Each linked
Action explicitly defines how it uses those properties. For example, a poisoned
knife owns its base damage and intrinsic poison; Stab uses them on a successful
hit, while a heavier attack can modify damage and add a cost or cooldown. Do not
copy the same intrinsic effect onto both the weapon and each Action.

Barehanded Actions define their own attack properties. They do not require a
fictional inventory item. An attack that requires a weapon must not silently
fall back to barehanded damage when that weapon is absent.

## Assemble combat choices from their sources

The available choice set consists of default character actions plus the actions
provided by carried weapons, filtered by requirements, costs and current
availability. Every weapon-derived choice retains its source item, including
when several weapons reference the same Action. This binding supplies weapon
properties and the existing USING item presentation.

Conceptual example; final identifiers and numerical balance remain open:

```text
Weapon: Pistol
  base damage: defined on Pistol
  intrinsic attack effects: defined on Pistol
  provided actions: Shoot, Burst

Action: Shoot
  hit check: defined on Shoot
  on success: use source weapon's damage and applicable intrinsic effects

Action: Burst
  hit check and damage modification: defined on Burst
  cooldown: skip the next player turn after use, including a miss

Default action: Punch
  damage and effects: defined directly on Punch
```

Cooldown duration belongs to the Action definition. Its remaining countdown
belongs to combat runtime state associated with the Action and its source
weapon. The mockup's Burst behavior is an action cooldown; an ammunition system,
magazine capacity and an explicit Reload action have not been agreed here.
Item `permability` is a trigger-use budget, not a reload timer.

## Outcome cards and commitment

Effect Card is now agreed as a separate Library type for system-triggered
mechanical-effect presentation, with the mockup's player-damage card layout.
It is distinct from world-interaction Health/Energy cards and does not execute
their collection effects. Shared Player Hit is selected in Project settings;
enemy-specific effect presentation is embedded in Enemy definitions. Death
sequences remain separate. See decisions A37–A38 in the implementation spec.

Attack rules resolve damage/effects once and supply values and targets to the
resulting cards. A shared player-hit card can show different damage values;
an Enemy supplies its own hit/death artwork and descriptive cards. Presentation
must not independently recalculate damage or apply the same effect twice.

Preserve the inspected combat mockup's resource timing: a damage card carries a
pending HP change that commits exactly once after its accepted swipe departure.
Inspecting or canceling a gesture applies nothing. The combat controller owns
that commitment boundary. Persistent status behavior is separate from merely
showing a status card.

## Current implementation and remaining work

The main project's contextual Actions already use a Fork placement's
`contextItemId` to require an item or tag and supply USING presentation. Action
definitions already own checks, conditions, costs and common/success/failure
effects. Items do not currently generate combat choices automatically.

The inspected integration mockup, in the separate
`combat-engine-integration/nest` checkout, uses shared deck/UI components but
hardcodes attacks in `combat/cards.js` and `combat/rules.js`. Its weapon is a
boolean and placeholder inventory entry. Shoot deals 1–2 damage at 3d6 ≥ 11;
Burst deals 1–3 at 3d6 ≥ 9 and skips the next player turn after use. These are
reference mockup values, not a finalized Pistol definition. The UI currently
starts the hero at 2 HP even though the pure rules initializer defaults to 10.
Poison is descriptive only, and effect cards are generated in code.

Implementation must introduce Weapon authoring, weapon-to-Action references,
source-bound combat choice generation, weapon-property resolution and the
corresponding runtime state. Exact serialized fields, default barehanded attack
balance, ammunition rules and cross-action/shared weapon cooldowns remain open.

See [mechanics decisions](mechanics-decisions.md),
[run state](state-system.md) and [Action context panel](action-context-panel.md)
for the existing systems this design extends.
