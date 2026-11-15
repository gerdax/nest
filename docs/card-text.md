# Card copy

`name` identifies a card in Studio. It does not control the visible card copy.
`headline` is edited as **Caption** and uses the same large typography across
card types. The Caption card type remains a separate, centered card layout.
`description` is the smaller text below Caption. Action, Combat Action, Item and
Consumable editors expose it separately. Switching a local card type retains
both fields, including descriptions temporarily hidden by a story editor.

Legacy input is migrated once at the card boundary. Vignette, Discovery, Caption,
Enemy and Feedback copy moves from `text` to `headline`. Actions and player/weapon
Combat Actions move their displayed name to `headline` and old `text` to
`description`. Enemy-owned Actions use old `text` as their headline. Items and
Consumables migrate a name only when it was visible (`showName: true`). Explicit
canonical fields, including empty strings, always win. Saved cards use
`headline` and `description`; old `text` is accepted at legacy input boundaries.
Both fields support the existing tokens, including import and clipboard STAT
reference remapping.
