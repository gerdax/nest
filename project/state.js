import { createError } from '../errors.js';
import { isTagKey, tagIdFromKey } from './item-tags.js';
import { isStatVariable } from './checks.js';
/** Pure, atomic run-state operations. Inventory entries preserve legacy ownership and optional physical instance identities. */
export function initialValues(definitions = []) {
  return Object.fromEntries(definitions.map(d => [d.id, clamp(d.initial, d)]));
}
function clamp(value, definition) {
  if (definition?.id === 'health' && definition.type === 'number' && !Number.isSafeInteger(value)) throw createError('STATE_HEALTH_VALUES_MUST_BE_INTEGERS');
  if (isStatVariable(definition) && !Number.isInteger(value)) throw createError('STATE_STAT_VALUES_MUST_BE_INTEGERS');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw createError('STATE_VARIABLE_OVERFLOW');
    const bounded = Math.min(definition?.max ?? Infinity, Math.max(definition?.min ?? -Infinity, value));
    if (definition?.id === 'health' && definition.type === 'number' && !Number.isSafeInteger(bounded)) throw createError('STATE_HEALTH_VALUES_MUST_BE_INTEGERS');
    return bounded;
  }
  return value;
}
const concreteMatch = (item, key) => item.instanceId === key || item.definitionId === key || item.inventoryKey === key || item.id === key;
const equivalentItems = (left, right) => (left.definitionId ?? left.id) === (right.definitionId ?? right.id) ||
  (left.inventoryKey != null && left.inventoryKey === right.inventoryKey);
const sameInstance = (left, right) => left.instanceId != null || right.instanceId != null
  ? left.instanceId != null && left.instanceId === right.instanceId
  : equivalentItems(left,right);
export const matchingItems = (inventory, key) => {
  const exact = inventory.filter(item => item.instanceId != null && item.instanceId === key);
  if (exact.length) return exact;
  const concrete = inventory.filter(item => concreteMatch(item,key));
  return concrete.length ? concrete : isTagKey(key) ? inventory.filter(item => item.tagId === tagIdFromKey(key)) : [];
};
export const ownedItemInstance = (inventory = [], reference) => reference && inventory.find(item => sameInstance(item, reference));
export function itemTriggersRemaining(item) {
  return (item.permability ?? 0) === 0 ? Infinity : (item.remainingTriggers ?? item.permability);
}
export function canTriggerItem(inventory = [], key) {
  return !!selectTriggerItem(inventory, key);
}
function leastUsedItem(items) {
  return items.reduce((selected,item) => !selected || itemTriggersRemaining(item) < itemTriggersRemaining(selected) ? item : selected, undefined);
}
/** Select the same concrete trigger for presentation and for spending a use. */
export function selectTriggerItem(inventory = [], key) {
  if (!key) return undefined;
  const available = matchingItems(inventory,key).filter(item => itemTriggersRemaining(item) > 0);
  // Tag selection retains the first matching item kind, then exhausts its oldest uses.
  const first = available[0];
  return first && leastUsedItem(available.filter(item => equivalentItems(item,first)));
}
function trigger(inventory, selected) {
  const index = inventory.findIndex(item => sameInstance(item,selected));
  return inventory.flatMap((item,itemIndex) => {
    if (itemIndex !== index) return [item];
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
function removalItem(inventory,key) {
  if (isTagKey(key) && !inventory.some(item => concreteMatch(item,key))) throw createError('STATE_INVENTORY_COSTS_AND_EFFECTS_REQUIRE_A_CONCRETE_ITEM');
  const selected = leastUsedItem(matchingItems(inventory,key));
  if (!selected) throw createError('STATE_INSUFFICIENT_ITEM', { key });
  return selected;
}
function remove(inventory,key) {
  const selected = removalItem(inventory,key);
  const index = inventory.indexOf(selected);
  return inventory.filter((item,itemIndex) => itemIndex !== index);
}
function spend(values,inventory,costs,definitions = []) {
  const defs = new Map(definitions.map(d=>[d.id,d]));
  for (const cost of costs) {
    if (cost.source === 'inventory') inventory = remove(inventory,cost.key);
    else {
      if (!Number.isFinite(cost.amount) || cost.amount < 0) throw createError('STATE_INVALID_COST');
      if (typeof values[cost.key] !== 'number' || values[cost.key]-cost.amount < (defs.get(cost.key)?.min ?? 0)) throw createError('STATE_INSUFFICIENT_VARIABLE', { key: cost.key });
      if (cost.key === 'health' && (!Number.isSafeInteger(cost.amount) || !Number.isSafeInteger(values[cost.key]-cost.amount))) throw createError('STATE_HEALTH_VALUES_MUST_BE_INTEGERS');
      if (isStatVariable(defs.get(cost.key)) && !Number.isInteger(cost.amount)) throw createError('STATE_STAT_COSTS_MUST_BE_INTEGERS');
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
    if (!items.some(owned => sameInstance(owned,entry))) items.push(entry);
    return items;
  }, []);
}
function nextInstanceId(inventory,id) {
  const occupied = new Set(inventory.flatMap(item => [item.instanceId,item.id,item.definitionId,item.inventoryKey]));
  let suffix = 1;
  while (occupied.has(`item-instance:${id}:${suffix}`)) suffix++;
  return `item-instance:${id}:${suffix}`;
}
export function addInventory(inventory, definition, {allowMultiple = false} = {}) {
  if (!definition) throw createError('STATE_INVALID_ITEM_DEFINITION');
  const id = definition.definitionId ?? definition.id;
  const permability = definition.permability ?? 0;
  if (!Number.isSafeInteger(permability) || permability < 0) throw createError('STATE_INVALID_ITEM_PERMABILITY');
  const {remainingTriggers = permability, ...content} = definition;
  if (permability > 0 && (!Number.isSafeInteger(remainingTriggers) || remainingTriggers < 1 || remainingTriggers > permability)) throw createError('STATE_INVALID_REMAINING_ITEM_TRIGGERS');
  const items = ownedInventory(inventory);
  const entry = {...content,id,definitionId:id,inventoryKey:definition.inventoryKey ?? id,
    ...(permability > 0 ? {remainingTriggers} : {})};
  if (!allowMultiple && items.some(item => equivalentItems(item,entry))) return items;
  if (allowMultiple && entry.instanceId == null) entry.instanceId = nextInstanceId(items,id);
  return ownedInventory([...items,entry]);
}
export function transact(values, inventory = [], { costs = [], effects = [], triggerItem, triggerInstance, breakTriggerItem = false } = {}, definitions = [], library = [], {allowMultiple = false} = {}) {
  const variables = {...values};
  let items = ownedInventory(inventory);
  const triggeringItem = triggerInstance ? ownedItemInstance(items,triggerInstance) : selectTriggerItem(items,triggerItem);
  if ((triggerInstance || triggerItem) && !(triggeringItem && itemTriggersRemaining(triggeringItem)>0)) {
    throw createError('STATE_UNAVAILABLE_INVENTORY_TRIGGER', {triggerItem:triggerItem??triggerInstance.name});
  }
  items = spend(variables,items,costs,definitions);
  let originalTriggerOwned = triggeringItem && items.some(item => sameInstance(item,triggeringItem));
  const defs = new Map(definitions.map(d=>[d.id,d]));
  const entries = library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library);
  for (const effect of effects) {
    if (effect.op === 'removeItem') {
      const removed = removalItem(items,effect.key);
      items = remove(items,effect.key);
      if (triggeringItem && sameInstance(triggeringItem,removed)) originalTriggerOwned = false;
      continue;
    }
    if (effect.op === 'addItem') {
      const definition = entries.find(d=>(d.definitionId ?? d.id) === effect.key && d.kind === 'item');
      items = addInventory(items,definition,{allowMultiple});
      continue;
    }
    if (!Object.hasOwn(variables,effect.key) || !['set','add'].includes(effect.op)) throw createError('STATE_UNKNOWN_VARIABLE_OR_EFFECT', { key: effect.key });
    const value = effect.op === 'add' ? variables[effect.key]+effect.value : effect.value;
    const def = defs.get(effect.key);
    const expected = def?.type === 'flag' ? 'boolean' : def?.type === 'number' ? 'number' : typeof variables[effect.key];
    if (typeof value !== expected || (effect.op === 'add' && expected !== 'number')) throw createError('STATE_INVALID_VARIABLE_TYPE', { key: effect.key });
    variables[effect.key] = clamp(value,def);
  }
  // Explicit removal already spends ownership. A later grant is a fresh item.
  if (originalTriggerOwned) items = breakTriggerItem
    ? items.filter(item => !sameInstance(item,triggeringItem))
    : trigger(items,triggeringItem);
  for (const [key,value] of Object.entries(variables)) variables[key] = clamp(value,defs.get(key));
  return {variables,inventory:items};
}
