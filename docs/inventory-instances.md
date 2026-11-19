# Independent inventory instances

In **Project settings → Already-owned items**, **Allow multiple** replaces **Show unavailable**. Each collected copy occupies one drawer slot and retains its own remaining uses. **Skip / hide** continues to omit already-owned sources. Existing saved `disabled` settings are accepted as an alias for Allow multiple; explicit `multiple` is also supported. Consumables remain outside inventory.

A finite item displays **USES: N** on its card, drawer thumbnail and trigger thumbnail. The Action context caption also uses **USES: N**, including **USES: 1**, replacing both the former USING and last-use DISCARD captions. Permanent items retain USING and have no finite counter.

Contextual actions select the equivalent available instance with the fewest remaining uses. Ties retain inventory order. For example, copies with 3 and 2 uses select the latter; two accepted uses remove only that copy, leaving the first at 3. A tag matching different item types retains its existing first-type strategy, then selects the least-used equivalent copy. Weapon action choices also select one equivalent source rather than duplicating identical actions.

Pickup, drawer layout, holds, full-drawer replacement, returned items and chapter continuation use physical instance identity. Source definitions and shared inventory keys still identify item kinds for rules. Counts are never summed. Conditions continue to test possession; an inventory removal or cost removes one matching instance. Preview and canceled gestures do not consume uses.

The separate fixture `/tests/fixtures/inventory-instances.html` collects one Library item, uses it once, then collects another copy. It verifies two distinct drawer entries with 2 and 3 uses and exposes the context of an action using that item. The fixture does not save an authored project.
