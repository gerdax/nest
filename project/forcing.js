import { resolveCheck } from './checks.js';
import { itemTriggersRemaining, matchingItems } from './state.js';

/** Compare success chances with the same dice pool and target for every tool. */
export function bestForcingTool(action, values, inventory) {
  const key = action.assistTool?.key;
  if (!key) return undefined;
  const candidates = matchingItems(inventory,key)
    .filter(item => Number.isSafeInteger(item.forcingBonus) && item.forcingBonus>0 && itemTriggersRemaining(item)>0);
  if (candidates.length<2) return candidates[0];

  const {pool, modifier, target} = resolveCheck(action.check,values);
  // Every integer total in this range is reachable. Equal winning thresholds
  // give equal odds, including when success is guaranteed or impossible.
  const minimum = pool.reduce((sum,die) => sum+die.count,0);
  const maximum = pool.reduce((sum,die) => sum+die.count*die.sides,0);
  let chosen, chosenThreshold = Infinity;
  for (const tool of candidates) {
    const adjustedModifier = modifier+tool.forcingBonus;
    let threshold = minimum;
    while (threshold<=maximum && threshold+adjustedModifier<target) threshold++;
    if (threshold<chosenThreshold || threshold===chosenThreshold
      && itemTriggersRemaining(tool)===Infinity && itemTriggersRemaining(chosen)!==Infinity) {
      chosen=tool;
      chosenThreshold=threshold;
    }
  }
  return chosen;
}
