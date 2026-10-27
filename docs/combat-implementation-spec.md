# Combat implementation specification — Rat encounter

Implementation status and verification: [M0–M7 checkpoint](combat-implementation-status.md).

Prepared 27 October 2026. Planning milestone; no combat schema or editor/runtime
implementation is introduced by this document.

The [Combat technical implementation plan](combat-technical-plan.md) maps the
decisions below to architecture, migration/runtime contracts, milestones and
acceptance gates. It is a plan, not a claim of implementation.

This specification extends [Weapons and combat actions](weapons-and-combat-actions.md).
It distinguishes **Agreed** decisions from **Proposed** implementation choices,
**Reference** mockup behavior and **Open** product decisions. A reference value
or illustrative field name is not approval of a final schema or balance value.

## 1. Objective and boundaries

Replace scenario-specific combat content with authored Library definitions and a
chapter Combat beat, while preserving the functioning mockup's deck, dice,
USING presentation and damage-card commitment behavior. Combat must use the
actual run's health and inventory and return control to chapter progression.

**Reusable production mechanic:** this milestone builds the general combat and
Enemy-authoring capability, with Rat as its first authored example/acceptance
fixture. It is not another Rat-specific mockup. Enemy health reactions are a
shared gameplay mechanism: combat evaluates percentage rules authored on any
Enemy definition and presents that Enemy's embedded cards. Rat names, health,
threshold values and reaction text must not be hardcoded into production rules.

**Agreed first vertical slice (27 October 2026):** one Rat, enemy-first turns,
default barehanded action, carried Pistol providing Shoot/Burst, hit/miss,
damage cards and health changes, Burst unavailable for the next player turn
after use including a miss, Rat-specific hit/health-threshold/death cards and
victory/player-death completion. Author the encounter through the Library and
chapter editor and use the actual run's health and inventory.

Poison is omitted entirely from this first encounter, including its descriptive
announcement. Defend/Block mechanics, ammunition, fleeing, multiple enemies, healing and durable
mid-combat resume are deferred. These are first-slice limits, not permanent
restrictions. First-fixture numerical balance and terminal routing have now
been settled in the decision register below.

## 2. Decision register

| ID | Status | Decision or question |
| --- | --- | --- |
| A1 | Agreed | Weapon, e.g. Pistol, is a special subtype of inventory Item. |
| A2 | Agreed | Scene-authored Actions can require an item/tag; carried Weapons instead provide attacks to the combat choice set. |
| A3 | Agreed | Weapon owns base damage, intrinsic attack effects and provided Action references. |
| A4 | Agreed | Action owns its check, costs, targeting, use/modification of weapon properties, action-specific effects and cooldown duration. |
| A5 | Agreed | Barehanded Actions define their own attack properties without a fictional inventory item. |
| A6 | Agreed | Each offered weapon attack retains its source weapon; it must not silently become an unarmed attack if that source is unavailable. |
| A7 | Agreed | Resolved damage is sampled once; HP commits once after the damage card's accepted departure. Inspection/canceled gestures apply nothing. |
| A8 | Agreed | Enemy content includes enemy-specific introduction, attack and reaction/death presentation; player-hit/status cards may be shared. |
| A9 | Agreed | First Rat slice uses the scope in section 1; omit poison entirely and defer ammunition, fleeing, multiple enemies, healing and durable combat saves. |
| A10 | Agreed | Pistol base damage is uniformly sampled 1–2 on a successful hit. Shoot uses that range unchanged; a miss deals zero. |
| A11 | Agreed | Burst adds 1 to the source weapon's maximum damage, leaves its minimum unchanged and uniformly samples the resulting range on a hit. With Pistol this is 1–3; a miss deals zero. Its use blocks Burst for the next player turn, including after a miss. |
| A12 | Agreed | Punch is the default barehanded fallback: fixed 1 damage on a successful hit, zero on a miss, no weapon requirement and no cooldown. It remains available while Burst is cooling down. |
| A13 | Agreed | Punch uses a fixed custom check: sum 3d6 ≥ 11, exactly 108/216 (50%) success, without character-stat modifiers in the first Rat encounter. |
| A14 | Agreed | Shoot uses a fixed custom check: sum 3d6 ≥ 11, exactly 108/216 (50%) success, without character-stat modifiers in the first Rat encounter. |
| A15 | Agreed | Burst uses a fixed custom check: sum 3d6 ≥ 9, exactly 160/216 (about 74.07%) success, without character-stat modifiers in the first Rat encounter. |
| A16 | Agreed | Rat starts the first encounter at 4 HP, authored on the Enemy definition. |
| A17 | Agreed | Bite is the Rat's natural attack and defines its own damage: uniformly sampled 1–2 on a successful hit, zero on a miss. No poison in the first encounter. |
| A18 | Agreed | Bite uses a fixed custom check: sum 3d6 ≥ 11, exactly 108/216 (50%) success, without modifiers in the first Rat encounter. |
| A19 | Agreed | Punch costs 0 Energy, preserving the barehanded fallback at zero Energy and while Burst is cooling down. |
| A20 | Agreed | Shoot and Burst each cost 0 Energy in the first Rat encounter. Combat Actions support configurable Energy costs for attacks provided by future weapons; zero is authored configuration, not a restriction of the combat system. |
| A21 | Agreed | Bite costs 0 Energy; the Rat has no Energy pool in the first encounter. |
| A22 | Agreed | Combat beat has a Victory output leading to the designated next beat in the current chapter. Winning the encounter does not itself complete the chapter or advance to another chapter. After Rat damage/death presentation finishes, follow that connection with the player's remaining health, Energy and inventory. No automatic healing or rewards; rewards can be authored in subsequent beats. |
| A23 | Agreed | A lethal hit's final damage card commits player health to zero on accepted departure, then transfers to the current chapter's Death beat. Death presentation is authored there, not hardcoded in combat. The beat is a dead end for this milestone (A28). |
| A24 | Agreed | Every chapter automatically contains exactly one mandatory Death beat: simplified Linear behavior, no introduction, one empty chapter-local Caption card by default, X icon, not deletable or duplicatable into a second Death beat. It has no input or output ports and no incoming/outgoing graph connections. |
| A25 | Agreed | Death-beat copying across chapters replaces the target chapter's existing Death beat rather than adding another. Same-chapter duplication is disallowed. |
| A26 | Agreed | Whenever committed player health becomes zero or below, in combat or other gameplay, interrupt the current beat and transfer once to the chapter's Death beat after the accepted swipe, using the existing turnover/back-rotation choreography. |
| A27 | Agreed | Project setting “Show death beat” defaults on and controls only Death-beat visibility in chapter graph views. Hiding it does not remove the beat or disable health-zero routing, death playback or validation. |
| A28 | Agreed for milestone | Death is a dead end: after its cards finish, gameplay stops without chapter continuation, automatic restart or a new restart/end-screen flow. Future post-death and retry UX is deferred. |
| A29 | Agreed | An unconnected Combat Victory output uses existing unavailable-route behavior: blackout/dim the enemy death card that would depart to the next beat, disable its swipe and display “Route unavailable”. No automatic chapter completion and no special pre-playback validation requirement solely for this missing connection. |
| A30 | Agreed | Pistol has unlimited uses (`permability: 0`) in the first encounter. Neither Shoot nor Burst consumes/removes the Pistol; Burst's cooldown remains separate. |
| A31 | Agreed | Rat health-reaction cards use percentages of encounter-starting health: remaining health ≤ two-thirds triggers “Rat seems weakened.”; ≤ one-third triggers “Rat seems severely hurt.” If one hit crosses both, show only the stronger reaction. Lethal hits skip these descriptions and show death. These exact ratio boundaries are authored on Rat, not universal fixed thresholds. |
| A32 | Agreed | Health reactions are a reusable game mechanic for Enemy definitions, not a Rat-only feature. Each Enemy owns its percentage thresholds and reaction cards (embedded per A35); the shared combat runtime evaluates them. Rat is the first authored example of the production system. |
| A33 | Agreed for milestone | Enemy attacks follow an authored ordered list, repeating from the beginning after the last entry. Advance once per completed enemy attack/turn, including a miss, not per reaction card. Rat's list contains only Bite. Schemes and random selection are deferred future extensions. |
| A34 | Agreed | Enemy attacks are entries authored directly inside the Enemy definition, with their own card content/artwork, check, damage and effects. Enemies have no inventory/weapons and require no separately created Library Action for each attack. Player attacks remain weapon-linked or default character Actions. Both authoring models use shared combat resolution/presentation. |
| A35 | Agreed | Enemy definition is self-contained: introduction, embedded attacks, damage-received cards, percentage-based health-reaction cards and enemy death cards/sequences are authored and previewed directly inside its inspector. Authors do not create/link separate Library cards for these slots. Combat selects the Enemy and uses that content. Shared Enemy edits affect encounters referencing it; player death remains chapter-owned. |
| A36 | Agreed for milestone | Combat beat selects an Enemy and connects Victory, with no per-encounter stat, attack or presentation/introduction overrides. Use the Enemy definition unchanged. Each encounter starts with fresh enemy health and attack order. Author a separate Enemy variant for different stats/content. Overrides may be added later. |
| A37 | Agreed | Shared Player Hit presentation is authored as a project-wide Library card selected in Project settings; combat supplies the resolved damage value. Lethal damage then routes to the chapter's Death beat. |
| A38 | Agreed | Effect Card is a separate authorable Library type, not a Health/Vignette/Caption reused with different semantics. Match the mockup's player damage-card layout (artwork, heading and resolved signed health value). Health/Energy cards represent world resource interactions; Effect Cards present system-triggered mechanical events. They do not independently calculate damage or execute collection effects. Player/enemy death sequences are separate from Effect Cards. |
| A39 | Agreed | A valid resolved Burst starts its cooldown on hit or miss. Burst is disabled for the next player turn; completing another player Action clears it. Effect-card swipes do not count as turns. An attempt aborted before a valid roll does not start cooldown. Presentation retries reuse the same resolved attack and cannot start or advance cooldown twice. |
| A40 | Agreed | Weapon-provided Action cooldowns are scoped per Action and per source weapon. Pistol Burst cooldown does not block Pistol Shoot or another weapon's attacks, even if another weapon provides the same Action definition. Weapon-wide/shared cooldown groups are deferred. |
| A41 | Agreed | Combat cooldowns are encounter-local and reset between encounters. Each Combat beat starts with attacks ready with respect to cooldown; other requirements still apply. Remaining player health, Energy and inventory carry forward unchanged. No exploration-turn countdown is introduced. |
| A42 | Agreed | Enemy definition has an optional introduction section. When enabled, its authored cards play before the first enemy attack; when disabled, combat begins directly with that attack. Rat's existing introduction is enabled. Combat beats cannot override this setting (A36). |
| A43 | Agreed | Combat Action is a separate authorable Library card type based on Action, with a distinct name and combat-specific fields. It is usable only within Combat/Encounter beats for now, not ordinary Fork, Linear, Container or other beat slots. Player weapon-provided Actions are Library Combat Actions referenced by Weapons; barehanded player attacks use the same type with their own damage. Enemy attacks stay embedded in Enemy definitions (A34) and share the combat resolution capabilities without requiring separate Library entries. |
| A44 | Agreed | Weapon owns the one-way “Provided combat Actions” references to Library Combat Actions. Actions use their runtime source weapon rather than naming a particular Weapon or maintaining reverse links. Carrying the Weapon makes its Actions available for player selection; it does not automatically execute them. Different Weapons may provide the same Action. |
| A45 | Agreed | Project settings contain Default combat Actions, referencing Library Combat Actions available without a weapon; initially Punch. Combat combines this list with carried Weapons' Provided combat Actions. |
| A46 | Agreed | Combat Action is broader than an attack: it can represent Defend, Block or other non-damaging combat choices. The model must not require every Combat Action to deal damage, target an enemy or use a weapon. Defend/Block mechanics are deferred beyond the first Rat milestone; its player Actions remain Punch, Shoot and Burst. Future defensive behavior/numerical rules remain undecided. |
| A47 | Agreed | New Enemy definitions start with editable embedded defaults: one attack, one damage-received Effect Card and one death card. These minimum entries are required for playback. Introduction and percentage-based health reactions are optional. Empty artwork is allowed for drafting/testing; do not silently substitute another Enemy's content. |
| A48 | Agreed | New projects automatically create and select a Player Hit Library Effect Card using the mockup's damage-card layout and artwork. Authors may edit it or select a replacement in Project settings. Combat requires a valid selected Effect Card before playback. |
| A49 | Agreed | Cross-chapter Death-beat paste replaces the target's card list, preserving the target beat identity and graph position. Preserve card sourcing: local cards become independent target-chapter local copies; Library-sourced cards remain Library-sourced references. Source chapter is unchanged; replacement is undoable. Never insert a second Death beat. |
| A50 | Agreed | Add the new required structures/defaults to existing projects as well as new ones, including one Death beat per chapter and missing project combat defaults. Preserve existing authored content and valid selections; do not overwrite them or duplicate defaults on subsequent loads. Existing-project migration details/schema versioning are implementation work. |
| P1 | Resolved | Combat Action is a distinct type (A43), rather than a normal Action with optional combat fields. Reuse underlying check/cost/card components where semantics match; preserve distinct authoring and beat compatibility. |
| P2 | Agreed direction | Enemy is a self-contained composite Library definition containing stats, embedded attacks and embedded presentation cards (A32–A35), not a single ordinary playable card. Exact serialization remains open. |
| P3 | Resolved | Use the separate Library type Effect Card (A38); the earlier name Result Card and proposal to reuse resource-card types are superseded. |
| P4 | Agreed direction | Combat beat references an Enemy without local overrides (A36) and has a Victory output (A22). Player death uses the chapter-wide Death beat (A23–A26), not a scene-authored Defeat route. Exact serialized fields remain open. |
| P5 | Proposed | Define the beat contract early and implement a narrow playable slice before completing broad editor controls. |
| O1 | Resolved for milestone | Scope, Victory routing/unavailable-route handling, mandatory portless Death beats, graph-only visibility and Death's dead-end behavior are agreed in A9/A22–A29. Future post-death/retry UX and fleeing are deferred. |
| O2 | Resolved for first fixture | Attack damage/checks, Rat starting health and all four attacks' 0 Energy costs are agreed in A10–A21. Rat has no Energy pool. Future attack Energy costs remain configurable. |
| O3 | Deferred | Poison is absent from the first encounter. Future status timing/stacking/removal and cross-combat persistence remain undecided. |
| O4 | Partly resolved | Burst timing, per-Action/per-weapon scope and encounter-local cooldown lifetime are agreed (A39–A41). Future nonzero-cost/finite-use commitment remains open. Shared cooldown groups are deferred. |
| O5 | Product decisions resolved for milestone | Types, authoring ownership, defaults, Death-beat paste and existing-project addition policy are agreed (A35–A38/A43–A50). Exact serialized fields/versioning and migration mechanics remain implementation work. No Combat overrides for this milestone (A36). |

## 3. Domain model and ownership

### Library definitions

| Definition | Authored content and rules | Runtime binding |
| --- | --- | --- |
| Weapon (Item subtype) | Existing identity, artwork, tags and collection fields; base damage, intrinsic effects, provided Actions | Owned source item; existing trigger budget where applicable |
| Combat Action (separate Library type) | Combat-specific requirements/check/costs, target/effect rules and cooldown; optional own/source-provided attack profile for damaging Actions | Actor, optional source/target, availability; Combat/Encounter only; includes non-attacking Actions |
| Effect Card (separate Library type) | Text, artwork and mockup damage-card layout with explicit resolved-value display | System-triggered effect's resolved values and optional pending operation; no pickup/collection semantics |
| Enemy (composite) | Starting stats, embedded attack entries/selection policy and embedded presentation cards/sequences | Encounter-local enemy health/state; fresh per encounter |
| Status (future, if approved) | Application, duration, tick timing, stacking, removal | Target-bound active status with remaining duration |

Weapon stays compatible with Item collection/inspection/ownership. Combat
Action is a distinct authorable type (A43), based on Action's reusable machinery
but with combat-specific labels, fields and semantics. Share check/condition/
cost components where appropriate; do not make normal Actions combat-capable
implicitly or allow Combat Actions in ordinary beat slots. Update inspectors,
slot validation, placement/clipboard commands and import validation consistently.
Weapon inspectors select/create referenced Library Combat Actions; Shoot and
Burst can be shared across different Weapons. Punch is a Library Combat Action
with its own attack profile. Project settings select **Default combat Actions**,
initially Punch (A45), rather than hardcoding a Punch special case. These combine
with carried Weapons' provided Actions at runtime.

Combat Actions are not restricted to attacks (A46). A future Defend or Block
can be a default or source-provided Combat Action without damage or enemy
targeting. Keep attack-specific fields conditional; do not invent zero-damage
attacks to represent defense. Defend/Block mechanics are deferred beyond this
milestone; exact future defensive rules still need separate decisions. The
agreed Rat fixture uses Punch, Shoot and Burst as the player's Actions.

The Weapon field is named **Provided combat Actions** (A44). Weapon → Combat
Action references are authoritative; do not require manually synchronized
reverse Weapon references on each Action. Resolve source-weapon properties
from the bound choice at runtime. Providing makes an Action selectable in
combat; it is not an automatic attack when the Item is carried or collected.
Energy cost is configurable on the combat Action using the existing cost
model. Punch, Shoot and Burst are explicitly configured at 0 for this fixture;
future weapon attacks can have nonzero costs without a new combat subsystem.
No equipment slots or equip action are implied: the agreement currently says
**carried weapons**. Existing inventory owns at most one of each Item definition;
support for duplicate copies is not introduced by this design.

Enemy authoring deliberately stays simpler than player attack authoring (A34).
Inside an Enemy, add/reorder attack entries with their own artwork/text, check,
damage and effects. No enemy inventory, source weapon or separate Library Action
creation is required. At runtime an embedded enemy attack and a player Action
resolve into the shared attack contract (actor, target, check, damage/effects),
so distinct inspectors do not require duplicate combat rules or animation code.

Scene context remains placement-owned: a door's Pick Lock Action references its
required Lockpick through `contextItemId`. Combat source generation must not
require authors to enumerate every weapon attack in every chapter Fork.

### Effects, statuses and presentation

**Mechanical effect** means a state operation, such as damage to the selected
enemy, healing the actor, spending energy or applying a status. Targets must be
explicit; weapon attack effects normally target the enemy, while action costs
and possible self-effects target the actor. Intrinsic effects apply only under
the Action's specified conditions, not merely because the weapon is carried.

**Status** means a persistent rule-bearing condition. A poison announcement does
not itself define poison damage, ticks or duration.

**Effect Card** is a distinct Library type for presentation of system-triggered
mechanical effects (A38). Its initial layout matches the mockup's player-hit
card: artwork, heading and a resolved signed health value such as −2 HP. Combat
supplies the value; the definition supplies presentation. A future poison
announcement may use this type too, but persistent poison mechanics and exact
non-numeric presentation fields remain deferred.

Health/Energy cards instead represent world resource interactions, such as a
med station, with their own authored resource changes. An Effect Card is not a
Health pickup with a negative value and does not execute `onCollect` or another
independent resource effect. Shared visual components can be reused internally
without conflating the authorable card types or commitment rules.

Player Hit is a shared Library Effect Card selected in Project settings (A37).
For new projects, create and select this definition automatically using the
mockup's player-hit layout and artwork (A48). Authors can edit that shared card
or select another Effect Card. Validate the selection before combat playback;
do not silently calculate/apply damage without the required presentation.
Existing projects also receive missing defaults (A50), preserving authored
definitions and valid selections. Addition must be idempotent and use
collision-safe identities rather than overwriting a same-named authored card.
Enemy-specific Effect Card content stays embedded in the Enemy inspector (A35),
using the same effect-presentation capability without requiring separate
Library definitions/links. Percentage health reactions also remain enemy-owned;
the exact subtype/layout of descriptive reactions can follow their content.
Player death is authored in the chapter Death beat; enemy death is its own
embedded sequence. Neither is categorized as an Effect Card.

Connect these to existing progression `effects`: reuse `project/state.js`
transactions for supported hero-variable/inventory operations and extend only
the necessary combat target/status semantics. Enemy health is encounter-local,
not a permanent project variable named separately for every enemy.

The rules and card must not both apply the same damage. A result instance may
carry a pending operation, committed by the controller at A7's boundary; it
does not reroll, infer damage from text, or own an independent effect engine.

### Enemy composition

Recommended Enemy inspector groups:

- Identity and base stats.
- Embedded attack entries (own card artwork/text, check, damage/effects) and
  selection policy; no separate Weapon/Item/Library Action required.
- Optional introduction card/sequence with an Enemy-owned enable setting (A42).
- Attack presentation, associated with the relevant attack.
- Damage received, optional status reactions and death card/sequence.
- Optional health-threshold descriptions and their conditions.

Enemy attack selection initially uses a simple ordered, repeating list (A33).
Each encounter starts at its first entry; the runtime tracks the current index
per enemy encounter. A completed attack advances once, including on a miss;
descriptive/result cards do not advance the list. Restart/cancellation must not
accidentally skip or duplicate an attack. Rat authors `[Bite]`; the same runtime
supports longer authored lists. Schemes and random selection are future
extensions, not required in this milestone.

Health-threshold reactions are authored as percentages of encounter-starting
health (A31), not fixed HP. Thresholds and associated reaction cards belong to
each Enemy definition (A32); combat provides the reusable evaluation/selection
mechanism, not a universal fixed set of thresholds or Rat-specific conditions.
Rat's agreed thresholds are remaining health ≤ two-thirds / one-third,
corresponding to 2 / 1 HP with a 4-HP Rat. Preserve these exact ratio boundaries;
rounded display percentages must not change the comparisons. Other Enemy
definitions can author different thresholds and cards.

Enemy-specific cards are embedded content, edited and previewed inline in the
Enemy inspector (A35), not separately created/referenced Library cards. Its
introduction, attack, hit, health-reaction and death sections travel with the
Enemy definition. Runtime presentation selects the appropriate embedded content
and supplies resolved values. Shared Enemy edits affect all referencing
encounters. New Enemy definitions contain editable defaults for one attack,
one damage-received Effect Card and one death card (A47). Those minimum entries
are required for playback; missing/malformed entries are validation issues,
not a reason to silently substitute another Enemy's content. Introduction and
percentage-based health reactions are optional. Artwork may be empty while
drafting/testing and does not itself block playback. Do not invent a separate
shared-card linkage for these sections.

The introduction enable setting is authored on Enemy (A42). Enabled intros
play before its first attack; disabled intros begin directly with that attack.
Rat's existing intro is enabled, and Combat beats have no local intro override.

An Enemy definition contains no chapter destinations or encounter-specific
rewards. Those belong to the chapter beat and its outcome handling.

## 4. Chapter editor contract

**Agreed Combat beat inputs (A36):** select an Enemy definition and connect its
Victory output. No per-encounter stat, attack or card/introduction overrides in
this milestone. Use that definition unchanged, initializing fresh enemy health
and attack-list position for every encounter. For a stronger/differently
presented enemy, author a separate Enemy variant in the Library. The exact
serialized reference format remains an implementation choice.

**Agreed output:** Victory, connected to a following chapter beat. After all Rat
damage/death cards finish, follow that connection once with remaining player
health, Energy and inventory. Combat grants no automatic healing or rewards;
authors can place rewards in subsequent beats (A22).
Winning an encounter is not chapter completion: Victory continues to the
designated next beat in the current chapter, not directly to the next chapter.

**Agreed death destination:** current chapter's mandatory Death beat, reached
by a chapter-wide health-zero rule, not a separate Combat Defeat connection.
Flee remains deferred. An unconnected Victory output uses existing nodes'
unavailable-route behavior (A29): blackout/dim the enemy death card whose swipe
would leave combat, disable that swipe and display “Route unavailable”. In a
multi-card death sequence, this applies at the departure to the next beat,
rather than blocking earlier internal progression. Do not silently complete the
chapter or add a special pre-playback/export rejection solely for an unconnected
Victory output. Required definition/reference validation remains separate.

### Mandatory chapter Death beat

The following is agreed (A23–A28) unless marked Open:

- Automatically create exactly one Death beat per chapter. Its icon is an X
  formed by two crossed lines.
- Use simplified Linear card progression without introduction controls. Create
  one empty chapter-local Caption card by default, ready for authors to add
  chapter-specific death content. Do not prefill death text or artwork.
- Disallow deletion and creation of a second Death beat through duplicate,
  copy/paste or other authoring commands.
- Allow copying to another chapter, replacing that chapter's existing Death
  beat's card list instead of inserting another beat (A49). Keep the target's
  identity/graph position. Copy local cards independently into target chapter
  ownership; preserve Library-sourced references. Mixed local/Library lists
  remain mixed. Source content is unchanged; replacement is undoable.
- No input or output ports and no incoming/outgoing graph connections.
  Health-zero routing is implicit, not manually wired.
- Project setting “Show death beat” defaults on and controls only visibility
  in chapter graph views. When off, the Death beat remains part of its chapter;
  health-zero routing, death playback, content and validation remain active.

Existing chapters receive their missing Death beat too (A50), with the same
empty local Caption default. Keep authored beats/cards/routes intact; repeated
loading or migration must not recreate or reset an existing Death beat.

When committed player health becomes zero or below, interrupt the current beat
and transfer once to this chapter's Death beat, including outside combat. For
combat this happens after the accepted damage-card departure commits zero HP.
Use the existing turnover/back-rotation transition after the accepted swipe;
do not trigger on speculative previews or canceled gestures. Health bounds can
clamp a negative result to zero; detection must still catch that lethal result.
Cancel stale turn/route work so the outgoing beat cannot resume or follow its
ordinary output after death. Death presentation must be allowed at zero HP
without repeatedly routing back to its own beginning.

The Death beat is a dead end for this milestone (A28): after its final card,
gameplay stops without chapter continuation or automatic restart. Do not add a
new restart button or end-screen flow as part of this milestone; future
post-death/retry UX is deferred. No further combat
attack starts while death is being handled. Entering a chapter already at zero
HP and technical changes without a swipe need an explicit transition policy.

The beat supplies current run health, energy and carried inventory to combat.
Encounter-local enemy state is initialized from the resolved Enemy definition.
After all required enemy-terminal cards are committed, the controller returns
Victory and updated run state exactly once, then follows the configured output.
Lethal player damage instead hands off to the chapter Death beat through the
global rule above.
Rewards are authored in follow-up chapter content, not automatically granted by
the Combat beat (A22). Any explicit encounter bookkeeping flags must be applied
once at a specified boundary, never duplicated in routing and follow-up content.

## 5. Gameplay contract

### Available actions and turn flow

Assemble default character Actions plus carried-Weapon Actions. Bind each choice
to Action + source item, then evaluate requirements, affordability and cooldown.
Two different weapons providing the same Action must remain distinguishable.
Check odds and displayed damage must derive from the same resolved definitions
used for execution, rather than duplicate labels hardcoded in presentation.

**Reference flow to preserve in the first slice:**

1. Optional introduction uncovers the enemy attack card.
2. Enemy rolls automatically, black dice from above, then shows SUCCESS/MISS.
3. A hit leads to linear damage/reaction cards; a miss proceeds to player choices.
4. Player chooses an Action through native Fork interaction, including USING.
5. Light player dice roll from below on the actual check reverse.
6. A hit leads to target damage/reaction cards; a miss proceeds to the next turn.
7. Lethal damage leads through damage then death presentation; no further attack
   or ordinary status description starts. Terminal cards require progression
   before the beat returns its final outcome.

Enemy-first is agreed for this first Rat encounter, not a universal initiative
system. Punch is the agreed default barehanded fallback, with no weapon
requirement or cooldown and a fixed 3d6 ≥ 11 check (50%, no character-stat
modifiers in this encounter). Future rules must
preserve a usable fallback or define explicit no-available-action behavior.

### Resolution and commitment

Keep authored definitions, mutable encounter state and presentation state
separate. Pure rules produce one resolved outcome and ordered pending changes;
the presentation adapter stages the corresponding cards. The controller owns
commit identity/lifecycle guards, not artwork, animation timers or card text.

Preflight requirements, source availability, required result references and
routing before irreversible changes. Capture the accepted source/profile,
actual dice and sampled outcomes for the pending resolution. After a valid
outcome exists, presentation retries reuse it; a new roll is allowed only when
no valid outcome was produced. Block inventory mutation and additional attacks
while resolution is pending. An already-resolved attack retains its source
profile even if a final item-use trigger removes that weapon.

HP and health indicators remain unchanged until the relevant damage card's
accepted departure finishes. Repeated callbacks cannot apply that change twice.
The next attack cannot start while required changes are pending. Restart,
technical abort and stale dice/transition completions cannot revive an old turn.

**Open timing contract:** ordinary project checks currently display provisionally
paid costs before rolling and restore them on abort, then commit completed
outcomes/trigger use after result presentation. Combat's deferred damage must
not silently redefine all Action effects. Specify when costs, weapon trigger
uses and status application commit, including errors
between roll, result entrance and accepted departure.
Pistol has unlimited uses (`permability: 0`, A30); neither Shoot nor Burst
consumes/removes it. For future finite-use weapons, whether provided attacks
consume the Item trigger budget remains open; do not inherit it accidentally
from USING UI.

Burst's agreed timing (A39): a valid resolved attack starts cooldown on hit or
miss. It remains disabled during the next player turn, and completing another
player Action clears it. Effect-card swipes do not advance turns/cooldowns.
An abort before a valid roll starts no cooldown; presentation retry after a
valid outcome reuses that resolution and cannot start/decrement cooldown twice.
Cooldown duration is Action data; remaining cooldown is runtime state
bound to Action + weapon source. `permability` is a use budget that can remove
an exhausted item, not a reload timer. Per-Action/per-weapon cooldown scope is
agreed (A40): cooling Pistol Burst does not block Shoot or another weapon's
attacks, including another source of Burst. Shared weapon-wide cooldown groups,
ammunition and an explicit Reload action are deferred extensions. Cooldowns
reset between encounters (A41): a new Combat beat starts with no remaining
cooldowns, without restoring health/Energy or changing inventory. Availability
requirements still apply; exploration has no cooldown-counting turns.

Current project policy starts a fresh run on page reload. Durable mid-combat
resume is **not required by this milestone**. If later approved, it must persist
sampled outcomes, pending changes and commit identity, preventing rerolls or
double payment; saving only visible HP would be insufficient.

## 6. Rat encounter example

### Inspected mockup facts (Reference, not final balance)

Source: separate `codex/combat-engine-integration` checkout's
`combat/rules.js`, `combat/cards.js` and `combat/scenario.js`, inspected on
27 October 2026. The main project does not yet author this through Library/beat
definitions. Code takes precedence over older comments/README descriptions.

| Element | Reference behavior |
| --- | --- |
| Health | Rat starts at 4; scenario starts hero at 2; pure rules initializer defaults hero to 10 |
| Shoot | Always offered even without the placeholder weapon; 3d6 ≥ 11 (50%), uniform 1–2 damage on hit |
| Burst | Placeholder weapon boolean adds it; 3d6 ≥ 9 (160/216, about 74%), uniform 1–3 damage on hit |
| Burst cooldown | Use, including a miss, blocks the next player turn; following an alternative player action clears it |
| Rat attack | 3d6 ≥ 11, uniform 1–2 damage on hit |
| Special success | Successful roll with at least one actual six; not a separate probability roll |
| Poison | Rat special success adds “You've been poisoned.”; no persistent poison mechanics |
| Rat threshold cards | First crossing one-third/two-thirds cumulative starting-health loss shows “Rat seems weakened.” / “Rat seems severely hurt.”; only the stronger if both crossed; skipped on lethal hit |
| Optional wound caption | Hero special success plus enabled extra description; descriptive only |
| Lethal result | Damage-card departure sets target HP to zero, followed by death sequence; no next combat turn |

Threshold crossing is computed from pre/post-hit health. The reference fixture
has no healing or persistent “already announced” set; once-per-encounter
announcements after healing would require a new rule.

Rat's default introduction is “A rat jumps out of the corner!”; damage artwork
uses `player_hit.png` and `rat_hit.png`. Default death texts are “So.. this is how
it feels. And suddenly you feel nothing. You die.” and “The rat falls down dead
in a puddle of its own blood.” These are reusable content references, not rules
embedded in the future engine.

### Proposed authored fixture

```text
Library
  Weapon: Pistol
    base damage: uniform 1–2 on a successful hit (agreed A10)
    unlimited uses: permability 0 (agreed A30); no consumption/removal on attack
    intrinsic effects: no additional effect specified in this damage-only fixture
    Provided combat Actions: references to Shoot, Burst (A44)
  Combat Action: Shoot
    Energy cost: 0 (agreed A20)
    weapon required; uses Pistol damage unchanged (agreed A10)
    fixed custom check: sum 3d6 >= 11 (50%), no character-stat modifiers (A14)
    miss deals zero
  Combat Action: Burst
    Energy cost: 0 (agreed A20)
    weapon required; source maximum damage +1, minimum unchanged (agreed A11)
    uniform resulting range: 1–3 with Pistol on hit; zero on miss
    fixed custom check: sum 3d6 >= 9 (160/216, about 74.07%)
    no character-stat modifiers (A15)
    unavailable next player turn after use, including a miss
  Combat Action: Punch (selected in Project settings -> Default combat Actions)
    fixed 1 damage on hit, zero on miss (agreed A12)
    Energy cost: 0 (agreed A19)
    no weapon requirement or cooldown
    fixed custom check: sum 3d6 >= 11 (50%), no character-stat modifiers (A13)
  Enemy: Rat
    starting health: 4 (agreed A16)
    embedded attack: Bite (A34), own uniform 1–2 damage on hit, zero on miss (A17)
    attack selection: ordered repeating list [Bite] (agreed A33)
    Bite Energy cost: 0; no Rat Energy pool (A21)
    no poison; fixed custom check: sum 3d6 >= 11 (50%), no modifiers (A18)
    presentation: enabled intro (A42), Bite, Rat hit, percentage-threshold captions, Rat death
    reaction thresholds: <= 2/3 remaining -> weakened; <= 1/3 -> severely hurt
    stronger-only when both crossed; skip on lethal hit (agreed A31)
  Shared player Effect Cards (Library)
    Player Hit: selected in Project settings; mockup damage-card layout (A37–A38)
    no poison announcement in first slice
  Chapter-local Death content
    one empty local Caption by default, authored within mandatory Death beat

Chapter
  Acquire Pistol -> Combat: Rat -> Victory: continue chapter
  Health reaches zero after accepted swipe -> chapter's mandatory Death beat
    simplified Linear, empty local Caption by default, X icon, no outgoing connection
    after final death card: dead end; gameplay stops (A28)
```

Project settings select `[Punch]` as Default combat Actions (A45). This list is
not restricted to attacks: future Defend/Block Actions can be selected here
once their mechanics are specified (A46).

This intentionally changes the mockup: Shoot becomes Pistol-provided, while the
unarmed fallback becomes Punch. Pistol's uniform 1–2 base damage and Shoot's
unchanged use are agreed. Burst increases the source maximum by 1 before
uniform sampling, preserving the reference 1–3 range with Pistol. It does not
add 1 to already sampled damage, which would instead produce 2–3. Remaining
Punch, Shoot and Burst cost 0 Energy (A19–A20). Bite costs 0 and the Rat has no
Energy pool (A21). First-fixture attack balance is settled; future attack Energy
costs remain configurable.

**Example resolved hit:** choose Shoot with Pistol, succeed, resolve 2 damage
once against a 4-HP Rat; show Rat hit with −2; Rat HP remains 4 during inspection;
accepted departure commits Rat HP 2 exactly once. Then show any configured
threshold caption before the next turn. This uses the agreed Pistol profile
and Rat starting health.

**Example lethal hit:** with Rat at 1 HP, resolve a hit for 2 rolled damage;
effective HP loss is clamped to 1. Damage-card departure commits 0 HP, then Rat
death is shown. No poison/threshold/next attack starts; final accepted terminal
progression returns Victory once. Routing/reward callbacks are guarded too.

## 7. Implementation sequence and acceptance gates

| Stage | Work | Gate |
| --- | --- | --- |
| 1. Resolve contract | Confirm P1–P5 and v1 scope; settle O1–O5 fields needed for the slice | One agreed fixture with explicit timing and no implied status/ammo rules |
| 2. Model and references | Defaults, validation, compatibility/version policy, typed references and source binding | Existing project behavior unchanged; valid export/import round trips; broken references rejected |
| 3. Runtime vertical slice | Pure resolution + minimal Combat beat integration using authored Rat/Pistol definitions | Real run state; one complete victory and defeat path through existing deck/dice/UI |
| 4. Authoring | Weapon/Action/Enemy/result inspectors, reference pickers, previews and beat wiring; no Combat-specific overrides | Author can construct and play the fixture through Library and chapter editor |
| 5. Regression and acceptance | Deterministic rules/state tests and actual browser authoring/playback checks | Timing, routing, export and legacy contextual Action regressions pass |

Reference/dependency analysis must include Weapon → Actions, any genuine rule
references within Enemy's embedded attacks/cards, and Combat beat →
Enemy references. Embedded attacks and presentation cards travel with their Enemy
rather than requiring separate Library Action/card exports. Chapter export, collision remapping,
Library usage/deletion protection and unused-local cleanup must agree on this
closure. Assets must survive static staging; source originals remain preserved.
Merely adding labels to `nodeTypes.js` does not implement controller semantics.

Recommended module boundaries reuse `project/cards.js`, `project/checks.js`,
`project/state.js`, model validation/compilation/dependencies and existing UI.
Keep pure combat rules and a combat coordinator distinct from CardDeck, renderer
and dice physics. Adapt the integration scenario's tested presentation flow;
do not ship its hardcoded HP, boolean weapon or global `window.combatScenario`
as production authoring architecture.

Required acceptance cases:

- Pistol acquired/not acquired; Punch fallback; unavailable/removed source;
  distinct weapons referencing the same Action; insufficient energy/use budget.
- Direct versus checked resolution where supported; exact odds; hit/miss;
  Burst cooldown on both outcomes and no decrement per descriptive card.
- Damage entrance/inspection/canceled swipe versus accepted departure;
  duplicate callbacks; restart/abort at each pending phase; failed dice request.
- Threshold crossing once in the no-healing reference fixture, skipping weaker/lethal descriptions, damage then
  death, no action by a dead actor and terminal output/rewards exactly once.
- Unconnected Victory: enemy death card uses the normal route-unavailable
  blackout, its departure swipe is disabled and “Route unavailable” is shown;
  no chapter completion, routing callback or repeated combat resolution.
- Existing contextual Lockpick Action, Item collection, trigger budgets and
  ordinary chapter progression remain unchanged.
- Combat Actions are offered only in Combat/Encounter context, not ordinary
  Fork/Linear/Container/other beat slots, including paste/import and inspector
  pickers. Normal contextual Actions retain their existing behavior.
- Shared Enemy edits versus separate variants, absence of Combat overrides,
  missing/wrong-kind references, export/import
  collisions, dependency deletion protection and fresh-run reload policy.
- Missing/non-numeric player health, incompatible bounds, nonpositive initial
  enemy health and lethal self-costs: reject invalid definitions or define
  ordering explicitly. Simultaneous death precedence remains open.
- Real browser creation of the fixture, USING/check UI, dice, result sequences,
  resize and reduced motion. Report physical device/browser coverage separately;
  pure tests do not establish touch, accessibility or real dice rendering.

## 8. Decisions to resolve before implementation

1. **First-slice scope — settled:** see A9 and section 1. One Rat, enemy-first;
   no poison, including descriptive-only poison cards.
2. **Profiles and checks — settled for this fixture:** Pistol base damage is uniform 1–2;
   Shoot uses it unchanged (A10). Burst adds 1 to the source maximum before
   uniform sampling (A11). Punch deals fixed 1 on hit, zero on miss, without a
   weapon requirement or cooldown (A12). Punch uses fixed 3d6 ≥ 11 without
   character-stat modifiers (A13); Shoot uses the same fixed check (A14).
   Burst uses fixed 3d6 ≥ 9 without character-stat modifiers (A15).
   Rat starts at 4 HP (A16). Bite deals uniform 1–2 on hit, zero on miss (A17);
   its fixed check is 3d6 ≥ 11 (50%), without modifiers (A18).
   Punch, Shoot and Burst cost 0 Energy (A19–A20); future weapon attacks support
   configurable Energy costs. Bite costs 0 and Rat has no Energy pool (A21).
3. **Terminal policy — settled for milestone:** Victory follows its connection after
   terminal cards, retaining player state without automatic healing/rewards
   (A22). Any committed health-zero result interrupts gameplay and transfers
   after the accepted swipe to the chapter's mandatory Death beat (A23–A28).
   Death is a dead end for this milestone; post-death/retry UX is deferred.
   Missing Victory connection uses blackout/disabled departure on the enemy
   death card and “Route unavailable” (A29); automatic chapter completion is
   excluded. Show death beat affects graph visibility only (A27).
4. **Timing — partly settled:** Burst cooldown timing and pre-roll abort behavior
   and per-Action/per-weapon scope are agreed (A39–A40); cooldowns reset between
   encounters (A41). Future nonzero-cost/use boundaries and abort recovery,
   and simultaneous death precedence remain open. Shared cooldown groups are deferred.
   Pistol is unlimited-use (A30); finite-use weapon trigger-budget consumption
   is a future decision.
5. **Content model — product decisions settled for milestone:** separate Effect Card Library type with
   mockup damage-card layout; project-wide Player Hit selected in Project
   settings (A37–A38). Enemy minimum/default entries are settled in A47;
   automatic Player Hit setup for new projects is settled in A48. Existing
   projects receive missing defaults without content overwrite (A50), and
   Death-beat paste preserves local/Library sourcing (A49). Exact serialized
   fields, versioning and migration code are implementation work.
   No encounter overrides for this milestone (A36).
   Enemy content is embedded
   and edited inside its definition (A35). Enemy attack selection is settled for
   this milestone: ordered repeating list (A33); schemes/random are deferred.
6. **Future statuses:** application, first tick, duration unit, stacking,
   immunity, lethal ticks, end-of-combat removal/persistence. Defer mechanics
   explicitly if these are not settled for the first slice.
7. **Healing reactions:** should health-threshold descriptions repeat after
   healing and re-crossing, or be tracked once per encounter? Healing is deferred
   for this slice. Percentage-based reactions/stronger-only/lethal skipping are
   agreed (A31), with Rat thresholds at ≤ two-thirds / one-third remaining.

## 9. Readiness after product decisions

The first Rat milestone has no remaining blocking product-authoring decisions.
Remaining work is to consolidate the schema/API contract, implement additive
compatibility, and build/verify the reusable system against the authored fixture.
Detailed field names, IDs, migration mechanics and module boundaries can be
chosen during implementation, with any newly discovered behavior ambiguity
surfaced rather than silently expanding scope.

Future status/defense/healing/ammunition/finite-use mechanics, shared cooldown
groups and post-death retry UX remain deferred. Their unresolved rules do not
require the first Rat fixture to simulate features it does not use. Configurable
nonzero Energy costs should build on existing Action transaction semantics;
reconcile/test those semantics when implementing that capability, without
inventing new cost behavior merely for the zero-cost fixture.

See [architecture](architecture.md), [run state](state-system.md),
[mechanics decisions](mechanics-decisions.md) and
[Action context panel](action-context-panel.md) for existing contracts.
