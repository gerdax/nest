/** Pure, atomic run-state operations. Inventory entries are quantity-bearing stacks. */
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
  return inventory.reduce((sum, item) => sum + (matches(item,key) ? (item.quantity ?? 1) : 0), 0);
}
export function conditionsMet(conditions = [], values = {}, inventory = []) {
  return conditions.every(c => {
    const value = c.source === 'inventory' ? inventoryQuantity(inventory,c.key) : values[c.key];
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
function remove(inventory,key,quantity) {
  if (!Number.isInteger(quantity) || quantity < 0) throw new TypeError('Invalid item quantity');
  if (inventoryQuantity(inventory,key) < quantity) throw new RangeError(`Insufficient item: ${key}`);
  for (const item of inventory) if (matches(item,key)) {
    const take = Math.min(item.quantity ?? 1,quantity);
    item.quantity = (item.quantity ?? 1)-take; quantity -= take;
  }
  return inventory.filter(item => item.quantity > 0);
}
function spend(values,inventory,costs,definitions = []) {
  const defs = new Map(definitions.map(d=>[d.id,d]));
  for (const cost of costs) {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) throw new TypeError('Invalid cost');
    if (cost.source === 'inventory') inventory = remove(inventory,cost.key,cost.amount);
    else {
      if (typeof values[cost.key] !== 'number' || values[cost.key]-cost.amount < (defs.get(cost.key)?.min ?? 0)) throw new RangeError(`Insufficient variable: ${cost.key}`);
      values[cost.key] -= cost.amount;
    }
  }
  return inventory;
}
export function affordCosts(values = {}, inventory = [], costs = [], definitions = []) {
  try { spend({...values},inventory.map(i=>({...i})),costs,definitions); return true; } catch { return false; }
}
export function addInventory(inventory, definition, quantity = 1) {
  if (!definition || !Number.isInteger(quantity) || quantity < 1) throw new TypeError('Invalid item definition or quantity');
  const id = definition.definitionId ?? definition.id;
  const next = inventory.map(i=>({...i}));
  const entry = next.find(i=>i.definitionId === id);
  if (entry) entry.quantity = (entry.quantity ?? 1)+quantity;
  else next.push({...definition,id,definitionId:id,inventoryKey:definition.inventoryKey ?? id,quantity});
  return next;
}
export function transact(values, inventory = [], { costs = [], effects = [] } = {}, definitions = [], library = []) {
  const variables = {...values};
  let items = spend(variables,inventory.map(i=>({...i})),costs,definitions);
  const defs = new Map(definitions.map(d=>[d.id,d]));
  const entries = library instanceof Map ? [...library.values()] : Array.isArray(library) ? library : Object.values(library);
  for (const effect of effects) {
    if (effect.op === 'removeItem') { items = remove(items,effect.key,effect.quantity ?? 1); continue; }
    if (effect.op === 'addItem') {
      const definition = entries.find(d=>(d.definitionId ?? d.id) === effect.key && d.kind === 'item');
      items = addInventory(items,definition,effect.quantity ?? 1); continue;
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
