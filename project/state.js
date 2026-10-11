/** Pure, atomic run-state operations. Inventory entries represent unique ownership. */
export function initialValues(definitions = []) {
  return Object.fromEntries(definitions.map(d => [d.id, clamp(d.initial, d)]));
}
function clamp(value, definition) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Variable overflow');
    return Math.min(definition?.max ?? Infinity, Math.max(definition?.min ?? -Infinity, value));
  }
  return value;
}
const matches = (item, key) => item.definitionId === key || item.inventoryKey === key || item.id === key;
export function inventoryQuantity(inventory = [], key) {
  return inventory.some(item => matches(item,key)) ? 1 : 0;
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
  if (!inventoryQuantity(inventory,key)) throw new RangeError(`Insufficient item: ${key}`);
  return inventory.filter(item => !matches(item,key));
}
function spend(values,inventory,costs,definitions = []) {
  const defs = new Map(definitions.map(d=>[d.id,d]));
  for (const cost of costs) {
    if (cost.source === 'inventory') inventory = remove(inventory,cost.key);
    else {
      if (!Number.isFinite(cost.amount) || cost.amount < 0) throw new TypeError('Invalid cost');
      if (typeof values[cost.key] !== 'number' || values[cost.key]-cost.amount < (defs.get(cost.key)?.min ?? 0)) throw new RangeError(`Insufficient variable: ${cost.key}`);
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
  return ownedInventory([...inventory,{...definition,id,definitionId:id,inventoryKey:definition.inventoryKey ?? id}]);
}
export function transact(values, inventory = [], { costs = [], effects = [] } = {}, definitions = [], library = []) {
  const variables = {...values};
  let items = spend(variables,ownedInventory(inventory),costs,definitions);
  const defs = new Map(definitions.map(d=>[d.id,d]));
  const entries = library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library);
  for (const effect of effects) {
    if (effect.op === 'removeItem') { items = remove(items,effect.key); continue; }
    if (effect.op === 'addItem') {
      const definition = entries.find(d=>(d.definitionId ?? d.id) === effect.key && d.kind === 'item');
      items = addInventory(items,definition); continue;
    }
    if (!Object.hasOwn(variables,effect.key) || !['set','add'].includes(effect.op)) throw new TypeError(`Unknown variable or effect: ${effect.key}`);
    const value = effect.op === 'add' ? variables[effect.key]+effect.value : effect.value;
    const def = defs.get(effect.key);
    const expected = def?.type === 'flag' ? 'boolean' : def?.type === 'number' ? 'number' : typeof variables[effect.key];
    if (typeof value !== expected || (effect.op === 'add' && expected !== 'number')) throw new TypeError(`Invalid variable type: ${effect.key}`);
    variables[effect.key] = clamp(value,def);
  }
  for (const [key,value] of Object.entries(variables)) variables[key] = clamp(value,defs.get(key));
  return {variables,inventory:items};
}
export function applyEffects(values, effects = [], definitions = [], inventory = []) {
  return transact(values,inventory,{effects},definitions).variables;
}
