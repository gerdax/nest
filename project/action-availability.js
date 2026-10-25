import { affordCosts, canTriggerItem, conditionsMet, inventoryQuantity } from './state.js';
import { isTagKey, itemTagLabel } from './item-tags.js';

/** Presentation only; execution still validates requirements and transactions. */
export function actionAvailability(source, values, inventory, compiled, mode = 'disabled') {
  const definitions = compiled.variables ?? [];
  const library = compiled.library instanceof Map ? [...compiled.library.values()] : Array.isArray(compiled.library) ? compiled.library : Object.values(compiled.library ?? {});
  const name = (key, kind) => kind === 'inventory'
    ? [...library.filter(item => item.kind === 'item'), ...inventory].find(item => item.id === key || item.definitionId === key || item.inventoryKey === key)?.name
      || (isTagKey(key) ? itemTagLabel({itemTags:source.itemTags ?? compiled.itemTags}, key) : key)
    : definitions.find(v => v.id === key)?.name || key;
  const reasons = [];
  const resource = requirement => requirement.source === 'variable' && ['health','energy'].includes(requirement.key) ? requirement.key : null;
  const addReason = (text, metadata = {}) => reasons.push({text, ...metadata});
  const trigger = source.contextInventoryKey ?? source.contextItemId;
  const missingTrigger = !!trigger && !canTriggerItem(inventory, trigger);
  if (missingTrigger) addReason(inventoryQuantity(inventory, trigger) ? `${name(trigger,'inventory')} exhausted` : `Requires: ${name(trigger,'inventory')}`);
  for (const condition of source.conditions ?? []) {
    if (conditionsMet([condition], values, inventory)) continue;
    // Context placements append an ownership condition already explained above.
    if (missingTrigger && condition.source === 'inventory' && condition.key === trigger && ['has','gte'].includes(condition.op)) continue;
    const label = name(condition.key,condition.source);
    const operator = {eq:'=',neq:'≠',gte:'≥',lte:'≤',has:'>',missing:'='}[condition.op] ?? condition.op;
    const requirement = condition.source === 'inventory' && ['has','gte'].includes(condition.op) ? label
      : condition.source === 'inventory' && ['missing','lte'].includes(condition.op) ? `Without ${label}`
      : `${label} ${operator} ${condition.value ?? 0}`;
    addReason(`Requires: ${requirement}`, resource(condition) ? {resource:resource(condition), amount:condition.value, operator} : {});
  }
  // Group repeated costs so the explanation matches atomic affordability.
  const groups = new Map();
  for (const cost of source.costs ?? []) {
    const key = `${cost.source}:${cost.key}`;
    const group = groups.get(key) ?? [];
    group.push(cost);groups.set(key, group);
  }
  const costReasons = [];
  for (const costs of groups.values()) if (!affordCosts(values, inventory, costs, definitions)) {
    const cost = costs[0];
    const amount = costs.reduce((total,c) => total+c.amount,0);
    costReasons.push({text:`Requires: ${cost.source === 'inventory' ? name(cost.key,'inventory') : `${amount} ${name(cost.key,cost.source)}`}`, ...(resource(cost) ? {resource:resource(cost), amount} : {})});
  }
  const costsMet = affordCosts(values, inventory, source.costs, definitions);
  if (!costsMet && !costReasons.length) {
    // Legacy references can charge one item through different aliases. Replay
    // prefixes through the same atomic affordability check to find that cost.
    const prefix = [];
    for (const cost of source.costs ?? []) {
      prefix.push(cost);
      if (!affordCosts(values, inventory, prefix, definitions)) {
        costReasons.push({text:`Requires: ${cost.source === 'inventory' ? name(cost.key,'inventory') : `${cost.amount} ${name(cost.key,cost.source)}`}`, ...(resource(cost) ? {resource:resource(cost), amount:cost.amount} : {})});
        break;
      }
    }
  }
  reasons.push(...costReasons);
  // Compiled context actions keep authored rules separate from generated trigger ownership.
  const rules = (source.conditions ?? []).filter((condition, index) => !(
    source.explicitConditions && index === source.explicitConditions.length &&
    condition.source === 'inventory' && condition.key === trigger && condition.op === 'has'
  ));
  const rulesMet = conditionsMet(rules, values, inventory) && costsMet;
  const showTriggers = mode === 'triggers-only' || mode === 'disabled-triggers';
  const showRules = mode === 'disabled' || mode === 'disabled-triggers';
  // Match the legacy text's ordering and text-based deduplication exactly.
  const seenReasons = new Set();
  const disabledReasonParts = reasons.filter(reason => {
    if (seenReasons.has(reason.text)) return false;
    seenReasons.add(reason.text);
    return true;
  });
  return {
    hidden: missingTrigger && !showTriggers || !rulesMet && !showRules,
    disabled: missingTrigger || !rulesMet,
    disabledReason: disabledReasonParts.map(reason => reason.text).join(' · '),
    disabledReasonParts,
  };
}
