# Mixed cards in Linear beats

Linear beats play Vignette, Caption, Action and Item cards in their authored order. Add each type in the beat inspector, or select a compatible shared card from Card source. The beat retains one Next connector.

Vignettes and captions advance upward. Actions appear directly for selection and apply their requirements, costs and effects. Check actions resolve the dice check and apply common plus success or failure effects; both outcomes continue to the next eligible card in the list. Canceling a check spends nothing and restores the action.

Items appear directly. Down or Enter takes the item; up discards it. Both gestures continue to the next eligible card. Taking grants ownership and applies collection effects only after the departure finishes. Discarding grants nothing and applies no collection effects. A standalone item uses the same sideways departure and pivoted rotation as a container discard, during both dragging and release. Canceling restores its pose; reversing downward returns to the ordinary take animation. It still resolves only that item. On a downward take, the reverse underneath recedes in depth with the same easing as untouched container items. While receding, backgrounds also shift upward to keep their projected top edge fixed; the depth and scale curves stay the same. The successor starts at that depth and compensated position and approaches during its reveal, rather than jumping forward when the taken item leaves.

Placement conditions skip ineligible cards. An action whose costs cannot be afforded stays unavailable until run state changes, or is skipped when Unavailable action is set to Skip. Inventory and effects from a completed card determine eligibility of the following cards.

Forks retain Vignette, Caption and Action choices; Item cards remain excluded.

An Unlinked Next output blocks the final departure from a Linear beat; earlier eligible cards still advance. An explicit End chapter output remains playable. Blocked departures do not apply effects, spend costs or grant/remove item ownership.
