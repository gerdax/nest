import { canonicalCardKind, collectionEffects, resolvePlacement, isConsumableKind } from '../project/cards.js';

/** Show effective card rules, excluding check outcomes and implicit trigger ownership. */
export function cardRuleIndicators(project, placement, index) {
  let card;
  try {
    // Resolve explicit rules separately so an Inventory trigger does not also
    // count as a requirement merely because it adds an ownership condition.
    card = resolvePlacement(project, {...placement, contextItemId:undefined}, index);
  } catch { return []; } // Incomplete drafts can have missing definitions.
  const hasRules = rules => Array.isArray(rules) && rules.length > 0;
  const resource = isConsumableKind(card.kind);
  // Resolved resource collection begins with the automatic Value gain.
  const effects = resource ? card.onCollect.slice(1) : card.kind === 'item' ? collectionEffects(card) : card.effects;
  return [
    resource && [String(card.value), 'Value'],
    canonicalCardKind(card.kind) === 'action' && placement.contextItemId && ['T', 'Inventory trigger'],
    hasRules(card.conditions) && ['R', 'Requirements'],
    hasRules(card.costs) && ['C', 'Costs'],
    hasRules(effects) && ['E', 'Effects'],
  ].filter(Boolean);
}
