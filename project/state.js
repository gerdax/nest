import { isTagKey, tagIdFromKey } from './item-tags.js';
import { isStatVariable } from './checks.js';
/** Pure, atomic run-state operations. Inventory entries represent unique ownership. */
export function initialValues(definitions = []) {
  return Object.fromEntries(definitions.map(d => [d.id, clamp(d.initial, d)]));
}
function clamp(value, definition) {
  if (isStatVariable(definition) && !Number.isInteger(value)) throw new TypeError('Stat values must be integers.');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Variable overflow');
    return Math.min(definition?.max ?? Infinity, Math.max(definition?.min ?? -Infinity, value));
  }
  return value;
}
const concreteMatch = (item, key) => item.definitionId === key || item.inventoryKey === key || item.id === key;
const matchingItems = (inventory, key) => {
  const concrete = inventory.filter(item => concreteMatch(item,key));
  return concrete.length ? concrete : isTagKey(key) ? inventory.filter(item => item.tagId === tagIdFromKey(key)) : [];
};
export function itemTriggersRemaining(item) {
  return (item.permability ?? 0) === 0 ? Infinity : (item.remainingTriggers ?? item.permability);
}
export function canTriggerItem(inventory = [], key) {
  return matchingItems(inventory,key).some(item => itemTriggersRemaining(item) > 0);
}
function trigger(inventory, selected) {
  return inventory.flatMap(item => {
    if (item !== selected) return [item];
    const remaining = itemTriggersRemaining(item);
    return remaining === Infinity ? [item] : remaining > 1 ? [{...item,remainingTriggers:remaining-1}] : [];
  });
}
export function inventoryQuantity(inventory = [], key) {
  return matchingItems(inventory,key).length ? 1 : 0;
}
export function conditionsMet(conditions = [], values = {}, inventory = []) {
  return conditions.every(c => {
    const value = c.source === 'inventory' ? inventoryQuantity(inventory,c.key) : values[c.key];
    if (c.source === 'inventory' && c.op === 'gte') return value === 1;
    if (c.source === 'inventory' && c.op === 'lte') return value === 0;
    if (c.source !== 'inventory' && !Object.hasOwn(values,c.key)) return false;
    switch(c.op) {
      case 'has': return value > 0;
      case 'missing': return value === 0;
      case 'eq': return value === c.value;
      case 'neq': return value !== c.value;
      case 'gte': return value >= c.value;
      case 'lte': return value <= c.value;
      default: return false;
    }
  });
}
function remove(inventory,key) {
  if (isTagKey(key) && !inventory.some(item => concreteMatch(item,key))) throw new TypeError('Inventory costs and effects require a concrete item.');
  if (!inventoryQuantity(inventory,key)) throw new RangeError(`Insufficient item: ${key}`);
  return inventory.filter(item => !concreteMatch(item,key));
}
function spend(values,inventory,costs,definitions = []) {
  const defs = new Map(definitions.map(d=>[d.id,d]));
  for (const cost of costs) {
    if (cost.source === 'inventory') inventory = remove(inventory,cost.key);
    else {
      if (!Number.isFinite(cost.amount) || cost.amount < 0) throw new TypeError('Invalid cost');
      if (typeof values[cost.key] !== 'number' || values[cost.key]-cost.amount < (defs.get(cost.key)?.min ?? 0)) throw new RangeError(`Insufficient variable: ${cost.key}`);
      if (isStatVariable(defs.get(cost.key)) && !Number.isInteger(cost.amount)) throw new TypeError('Stat costs must be integers.');
      values[cost.key] -= cost.amount;
    }
  }
  return inventory;
}
export function affordCosts(values = {}, inventory = [], costs = [], definitions = []) {
  try { spend({...values},ownedInventory(inventory),costs,definitions); return true; } catch { return false; }
}
function ownedInventory(inventory) {
  return inventory.reduce((items, item) => {
    const {quantity, ...entry} = item;
    const id = entry.definitionId ?? entry.id;
    if (!items.some(owned => (owned.definitionId ?? owned.id) === id ||
      (entry.inventoryKey != null && owned.inventoryKey === entry.inventoryKey))) items.push(entry);
    return items;
  }, []);
}
export function addInventory(inventory, definition) {
  if (!definition) throw new TypeError('Invalid item definition');
  const id = definition.definitionId ?? definition.id;
  const permability = definition.permability ?? 0;
  if (!Number.isSafeInteger(permability) || permability < 0) throw new TypeError('Invalid item permability');
  const {remainingTriggers = permability, ...content} = definition;
  if (permability > 0 && (!Number.isSafeInteger(remainingTriggers) || remainingTriggers < 1 || remainingTriggers > permability)) throw new TypeError('Invalid remaining item triggers');
  return ownedInventory([...inventory,{...content,id,definitionId:id,inventoryKey:definition.inventoryKey ?? id,
    ...(permability > 0 ? {remainingTriggers} : {})}]);
}
export function transact(values, inventory = [], { costs = [], effects = [], triggerItem } = {}, definitions = [], library = []) {
  const variables = {...values};
  let items = ownedInventory(inventory);
  const triggeringItem = triggerItem && matchingItems(items,triggerItem).find(item => itemTriggersRemaining(item) > 0);
  if (triggerItem && !triggeringItem) throw new RangeError(`Unavailable inventory trigger: ${triggerItem}`);
  items = spend(variables,items,costs,definitions);
  let originalTriggerOwned = triggeringItem && items.includes(triggeringItem);
  const defs = new Map(definitions.map(d=>[d.id,d]));
  const entries = library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library);
  for (const effect of effects) {
    if (effect.op === 'removeItem') {
      items = remove(items,effect.key);
      if (triggeringItem && concreteMatch(triggeringItem,effect.key)) originalTriggerOwned = false;
      continue;
    }
    if (effect.op === 'addItem') {
      const definition = entries.find(d=>(d.definitionId ?? d.id) === effect.key && d.kind === 'item');
      const selectedIndex = originalTriggerOwned ? items.indexOf(triggeringItem) : -1;
      items = addInventory(items,definition);
      if (selectedIndex >= 0) items[selectedIndex] = triggeringItem;
      continue;
    }
    if (!Object.hasOwn(variables,effect.key) || !['set','add'].includes(effect.op)) throw new TypeError(`Unknown variable or effect: ${effect.key}`);
    const value = effect.op === 'add' ? variables[effect.key]+effect.value : effect.value;
    const def = defs.get(effect.key);
    const expected = def?.type === 'flag' ? 'boolean' : def?.type === 'number' ? 'number' : typeof variables[effect.key];
    if (typeof value !== expected || (effect.op === 'add' && expected !== 'number')) throw new TypeError(`Invalid variable type: ${effect.key}`);
    variables[effect.key] = clamp(value,def);
  }
  // Explicit removal already spends ownership. A later grant is a fresh item.
  if (originalTriggerOwned) items = trigger(items,triggeringItem);
  for (const [key,value] of Object.entries(variables)) variables[key] = clamp(value,defs.get(key));
  return {variables,inventory:items};
}
