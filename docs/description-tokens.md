# Description tokens

Tokens expand only in Description text. Names, labels and other fields remain literal. Saved and exported descriptions retain the codes; the player resolves them when presenting the card. Use **Insert token** below any Description to insert an available token at the cursor. The resolved preview uses initial values; gameplay uses current values. Invalid or unavailable codes remain visible and show a warning in the editor.

| Code | Value |
| --- | --- |
| `[HP]` | Current player Health |
| `[ENERGY]` | Current player Energy |
| `[STAT:agility]` | Current value of this declared stat; use its stable variable ID |
| `[BASEDMG]` | Effective ordinary attack damage range, including weapon/action damage modifiers, before Preparation |
| `[DMG]` | Potential attack damage range, including the current player Preparation bonus, before defence and remaining target Health |
| `[PREPBONUS]` | Authored bonus on a Prepare action, or current preparation bonus on a player Attack |
| `[ENERGYCOST]` | Total upfront Energy cost of the action, including costs with hidden badges |
| `[ICON:damage]` | Custom four-point damage icon |
| `[ICON:energy]` | Game Energy icon (same asset as HUD/card corners) |
| `[ICON:health]` | Game Health icon (same asset as HUD/card corners) |
| `[ICON:round]` | Combat round icon (clockwise circular arrow; inherits text colour) |

Resources, declared stats and icons work on any Description. Damage requires an Attack or Weapon context; a weapon action uses its owning weapon. Enemy attack descriptions use that action's damage, without exposing hidden preparation. Other action descriptions may use Energy cost. Menus offer only tokens available for that field.

Example: `Deal [DMG] [ICON:damage]. Against defence, deal [BASEDMG].`

For an attack dealing 1–2 base damage with +2 Preparation, this displays the range 3–4 followed by the custom damage icon, then “Against defence, deal 1–2.” Preparation and defence mechanics are unchanged by the text system. Tokens are case-sensitive, expand once, and do not execute expressions or HTML.

## Prepared-only text

On player Attack descriptions, wrap optional text in `[IF:PREPARED]…[ENDIF]`. The section appears only when a Preparation bonus is active, and disappears after the next action consumes preparation. It never tests or reveals the enemy's hidden choice.

Example: `Deal [BASEDMG][ICON:damage][IF:PREPARED], +[PREPBONUS][ICON:damage] or breaks defence[ENDIF].`

Use **Only when prepared** in the Insert token menu to insert a paired section, or wrap selected text. The Description editor shows **Base:** and **Prepared:** together, using the default Prepare action's bonus (2 if none is configured). The **Preview prepared** checkbox above the full card preview switches the card itself between ordinary and prepared states. This preview control does not change saved gameplay or authored text. Sections can be repeated or nested. Missing/extra markers, unsupported conditions, and use outside player Attacks produce editor warnings and remain visible for correction.
