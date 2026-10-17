# Stats and card-based checks

Agility, Intelligence and Composure are global integer variables from 1 to 10,
initially 3. Edit their defaults in Project variables and chapter settings, or
override starts for a chapter. Existing authored effects can add/set stats;
integer gains clamp at the bounds. The player HUD shows only health and energy.
Stat values remain available in Run state and editor diagnostics.

On an Action, choose Dice check resolution, then Stat check, a stat and a
difficulty from 1 to 10. The rule is **3d6 + selected stat ≥ 10 + difficulty**.
Matching stat and difficulty succeeds on 135 of 216 outcomes (62.5%). There are
no critical rolls, variable dice pools, automatic encounter scaling or hidden
rerolls. Even certain/impossible tests physically roll three d6.

The check card keeps its authored description. A prominent exact success
probability, rounded to one decimal percentage point, appears by or below the
card. A smaller contextual panel below it shows the stat name and current value
with the formula, for example **Agility 3 · 3d6 + 3 ≥ 15**. The global player
HUD remains limited to Health and Energy; stats and formulas are available in
this check panel. The probability is calculated from all 216 possible 3d6
results and updates from the current run state.

Award +1 at meaningful milestones. Author later difficulty around expected
growth, with easier/harder exceptions. A difficulty-5 check rises from 37.5% at
stat 3 to 83.8% at stat 7. Earlier encounters retain their original difficulty.
Campaign saves and cross-chapter carryover remain separate work: selecting a
chapter or restarting still starts a fresh run.

## Motion and state ownership

The selected Action and other fork choices depart normally. Their existing
underlying back remains in place; it does not turn until the check finishes.
Before commitment, a check Action uncovers an empty decorated back with its
target already visible. The total and outcome stay absent until the roll settles.
An accessible slot on that real back hosts the large modified total,
Success/Fail and target. The outcome is centered in the display font; the total
sits bottom-left in Big text and the target bottom-right in Medium text. Success
uses the Big color, Fail the Medium color. Physical dice render in a separate transparent top
layer above the cards and editor preview, with 20% larger dice and room beyond
the card edges. Their size is captured at the start of each roll; result copy
cannot resize or reposition their canvas. After a 1,000ms result hold, dice fade for
200ms and are destroyed before the back turns into the actual successor.
The result surface transfers to the successor’s reverse and remains there
through the final turn. It is released only when the turn finishes. Decorative
icon switching is independent of this lifecycle and cannot replace the result. No modal or fake story node
is inserted. Both editor and player use ProjectPreview for this composition.

The deck owns motion and the held surface; ProjectPreview owns dice and result
timing; ProjectController owns the accepted check snapshot, costs, effects and
routing. Costs/common/outcome effects commit once after feedback and final
validation. An awarded stat gain cannot improve its own check. Gameplay input
is locked after commitment; Escape does not cancel a committed check.
Editor Stop/Restart and technical errors abort without charging costs or
applying effects. Resize/reduced motion can settle departure but cannot resolve
the game check or reroll dice.

Old checks retain their original dice, modifier and target in Custom check mode,
with the same new presentation. Missing stat definitions are added on loading;
compatible existing values survive, conflicting definitions are reported.
Chapter packages retain collision-safe variable remapping, so conflicting
imported stat definitions may appear as additional renamed variables.

The owned `dice/themes/nest` theme reuses the supplied mesh/UV layout
with a vector atlas, light Big/Medium default green faces and black d6 pips.
Other dice retain numeric markings; the old numeric bump map is omitted. Vendor files are untouched.
The iframe explicitly uses dark color-scheme to preserve transparent composition
over the back. Tray resizing updates the existing dice world without rerolling.

## Verification

The integrated suite passed **1,041 tests**. Static staging verified local HTML,
module and CSS references and copied the owned theme. Astra independently passed
43 targeted tests, rejected nine malformed import cases, and found no remaining
acceptance-blocking issue in source review after the reported fixes.

Deterministic checks cover all 216 outcomes for all 100 stat/difficulty pairs,
label thresholds, stat bounds/privacy/imports, changing labels after inventory
use, unchanged card identity, result hold/fade timing, both outcomes, reduced
motion, abort/reset cleanup and terminal completion exactly once. Theme tests
compare non-d6 atlas silhouettes with the supplied numeric UV atlas and verify
each pip face against the actual collider value.

Real in-app browser checks used isolated storage and physical WebGL dice:

- Player success and failure at 320×568, 390×844 and 430×932; the proper successor
  appeared after each result. Card mounts retained 3:4 proportions.
- Editor success at those same actual viewport sizes; dice trays ranged from
  approximately 158×100px in the smallest preview to 252×224px. The complete
  editor chrome is not a mobile UI; minimizing the preview exposed Restart.
- Desktop editor success and native upward pointer swipe from a two-choice fork.
  Escape did not cancel the committed roll. Live resize retained one iframe;
  Stop removed it. The initial white iframe background was found and fixed.

The floating-dice update was additionally checked in the desktop editor and at
320×568, 390×844 and 430×932 in the player. The canvas bounds stayed identical
before and after the result headline appeared; Stop removed the floating layer
and iframe. An independent source review passed 36 targeted tests. These are
browser emulations, not physical-device checks.

Recorded measurements: [player](benchmarks/stat-checks-player.json),
[editor](benchmarks/stat-checks-editor.json). Reusable projects for these checks
are generated by `tests/fixtures/stat-check-project.js`; success/failure presets
use guaranteed/impossible odds while retaining physical dice rolls.

The pip/result update was checked in editor preview and in the player at
320×568, 390×844 and 430×932, including target-only preparation before outcome,
transparent compositing, and successor installation. Original physics arena and throw height are retained. Rendering uses a larger
transparent viewport and a proportionally wider camera; logical dice scale and
aspect remain unchanged. Desktop player verification captured the result on the turning reverse with
all decorative icons hidden. Large custom pools and every possible airborne
collision remain unverified; the physical screen edge still limits visibility.

These checks do not establish physical-phone touch behavior, Safari rendering,
GPU memory behavior, accessibility screen-reader behavior, or statistical
fairness of the physical dice engine. Existing dice deadline/error recovery is
retained; no invisible RNG fallback is introduced.

## October 17 contextual check panel update

Stat check fronts now retain only the authored fiction; the selected Action's
one-decimal success percentage appears below the card, followed by its current
stat value, formula and applicable resource-rule summary. These details track
selection and inventory effects, disappear for non-stat actions and committed
rolls, and reset on Stop/Restart. Custom checks keep their existing presentation.

All 1,043 deterministic tests pass. Static staging to
`/tmp/nest-check-ui-pages-20261017` passed HTML/module/CSS reference verification.
An independent source review found no actionable issues and passed 43 focused
tests. The reusable `tests/fixtures/check-details.html` exercised the shared
ProjectPreview/playfield composition in the in-app browser at 320×568, 375×667
and 390×844 field sizes. Visual checks covered panel placement, switching to a
direct action and back, and an item raising Composure from 3 to 7 (37.5% to
83.8%). A real dice attempt reached the failure consequence and charged one
energy; the pre-roll panel disappeared during resolution and on the successor.
These field sizes are CSS-sized test frames, not physical devices or browser
viewport emulation. The complete editor chrome, physical-phone touch behavior
and Safari were not reverified for this update.

**Project settings → Allow beat cycles** enables revisits across all chapters and is checked by default. See [chapter graph](chapter-editor.md#chapter-graph) for the
runtime automatic-loop guard and legacy validation boundaries.
