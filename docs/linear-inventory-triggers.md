# Inventory triggers in Linear and Fork Actions

An Action placement can select an Inventory trigger in a Linear beat's card list
or a Fork's choices. Caption and Vignette cards can precede the Action without
changing its item semantics. Triggers remain placement settings; they are not
stored on shared definitions, story cards, introductions, or legacy sequences.
Save/load, chapter packages, tags, and card copy/paste retain Linear triggers.

Linear uses the existing unavailable-action policy, including the beat override:

| Setting | Missing trigger |
| --- | --- |
| Hide unmet rules & triggers | Skip the Action |
| Show unmet rules | Skip the Action; this setting does not show missing triggers |
| Show unmet triggers | Show the disabled Action and its missing-item reason |
| Show unmet rules & triggers | Show the disabled Action and its missing-item reason |

A skipped Action applies no effects and spends no costs or uses. A visible
disabled Action blocks forward progression. Skipping a final Action follows the
beat's Next connection; an unlinked Next retains the existing blocked behavior.
Owning the item permits normal Action resolution. Direct Actions commit one use;
checks commit one use after either result. Canceled gestures, interrupted checks
and blocked departures do not spend a use. Uses and ownership share the existing
atomic transaction; no new use control or confirmation is introduced.

The context caption is LAST USE when the selected concrete owned item has one
finite trigger remaining. This works for single-use items and the final use of
multi-use items, including selection through a tag. Permanent items show USING.
The same caption appears in item-only context and beside odds in combined
context. Results and unavailable reasons retain priority. Merely viewing or
inspecting an item never spends a use.

The browser fixture is `tests/fixtures/linear-inventory-trigger.html`. Its controls
exercise Caption → Vignette → Action → Next with owned, missing, permanent and
multi-use items, stat-check context, and canceled swipes. Fixture controls are
outside the product UI.
