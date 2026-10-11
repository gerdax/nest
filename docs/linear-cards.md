# Mixed cards in Linear nodes

Linear nodes play Event, Caption, Action and Item cards in their authored order. Add each type in the node inspector, or select a compatible shared card from Card source. The node retains one Next connector.

Events and captions advance upward. Actions appear directly for selection and apply their requirements, costs and effects. Check actions resolve the dice check and apply common plus success or failure effects; both outcomes continue to the next eligible card in the list. Canceling a check spends nothing and restores the action.

Items appear directly. Down or Enter takes the item; up discards it. Both gestures continue to the next eligible card. Taking grants ownership and applies collection effects only after the departure finishes. Discarding grants nothing and applies no collection effects.

Placement conditions skip ineligible cards. An action whose costs cannot be afforded stays unavailable until run state changes, or is skipped when Unavailable action is set to Skip. Inventory and effects from a completed card determine eligibility of the following cards.

Forks retain Event, Caption and Action choices; Item cards remain excluded.
