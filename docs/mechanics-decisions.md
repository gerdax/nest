# Chapter mechanics decisions

Agreed design changes from the October 9, 2026 discussion. These changes are pending implementation. The current editor and runtime behaviour remains documented in [Chapter editor](chapter-editor.md), [Architecture](architecture.md), and [Run state](state-system.md).

## Random routes to chapter nodes

A Random node selects a destination from a weighted list of nodes present in the chapter and on the editor canvas. It jumps to the selected node, after which playback follows that node’s ordinary connections.

The selected destination can start an entire encounter flow, such as Linear introduction, Combat, and optional loot. Random does not automatically regain control after a selected node finishes. Branches converge only where the author connects them.

This replaces the current behaviour that selects reusable sequences and returns to the Random runner. Repeated selection, encounter counts, and repetition tracking require further design; they are not implied by the new routing behaviour.

## Checks belong to action cards

A check is optional resolution functionality of an action card, not a separate Check node. In a Fork, each action has one of two resolution modes:

- Direct resolution follows a single destination when the action is chosen.
- Check resolution resolves the attempted action and follows either its Success or Failure connector.

The action owns its requirements, attempt costs, and check settings. Requirements determine whether the action is available; the check determines whether the available attempt succeeds. Choosing the action commits the attempt without an additional attempt card or confirmation.

For example, a locked cabinet Fork can offer Use key with a direct destination, Pick lock with Success and Failure destinations, and Leave with a direct destination. Successful lockpicking can lead straight to a Container; failure can lead to an authored consequence.

Exact resolution rules, dice configuration, cost timing, retry rules, and feedback presentation remain undecided. The dice service remains independent: it returns results, and the action resolution system interprets them.
