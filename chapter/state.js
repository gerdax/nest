/** Pure run state. No animation, DOM, expressions, dice, or chapter traversal. */
export function initialValues(definitions = []) {
  return Object.fromEntries(definitions.map(variable => [variable.id, variable.initial]));
}
export function conditionsMet(conditions = [], values = {}, inventory = []) {
  return conditions.every(condition => {
    if (condition.source === 'inventory') {
      const owned = inventory.some(item => item.id === condition.key);
      return condition.op === 'has' ? owned : !owned;
    }
    if (!Object.hasOwn(values, condition.key)) return false;
    const value = values[condition.key];
    switch (condition.op) {
      case 'eq': return value === condition.value;
      case 'neq': return value !== condition.value;
      case 'gte': return value >= condition.value;
      case 'lte': return value <= condition.value;
      default: return false;
    }
  });
}
export function applyEffects(values, effects = []) {
  const next = { ...values };
  for (const effect of effects) {
    if (!Object.hasOwn(next, effect.key)) throw new TypeError(`Unknown variable: ${effect.key}`);
    const value = effect.op === 'add' ? next[effect.key] + effect.value : effect.value;
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError(`Variable ${effect.key} overflowed.`);
    next[effect.key] = value;
  }
  return next;
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validateStateConfig(chapter, { references = true } = {}) {
  const errors = [];
  const definitions = Array.isArray(chapter.variables) ? chapter.variables : [];
  if (chapter.variables !== undefined && !Array.isArray(chapter.variables)) errors.push('Variables must be a list.');
  const variables = new Map();
  for (const variable of definitions) {
    if (!object(variable) || typeof variable.id !== 'string' || (references && !/^[A-Za-z][A-Za-z0-9_]*$/.test(variable.id)) || !['flag','number'].includes(variable.type) || (variable.type === 'flag' ? typeof variable.initial !== 'boolean' : !Number.isFinite(variable.initial))) {
      errors.push('Variables need an identifier, flag/number type and matching initial value.'); continue;
    }
    if (references && variables.has(variable.id)) errors.push(`Duplicate variable: ${variable.id}.`);
    variables.set(variable.id, variable);
  }
  const sequences = Array.isArray(chapter.sequences) ? chapter.sequences : [];
  const items = new Set(sequences.flatMap(s => Array.isArray(s?.items) ? s.items.map(i=>i?.id) : []));
  const inspect = (target, label, choices = false) => {
    if (!object(target)) return;
    if (target.conditions !== undefined && (!choices || !Array.isArray(target.conditions))) errors.push(`${label}: conditions belong to choices and must be a list.`);
    for (const condition of Array.isArray(target.conditions) ? target.conditions : []) {
      if (!object(condition) || !['variable','inventory'].includes(condition.source) || typeof condition.key !== 'string') {errors.push(`${label}: invalid condition.`);continue;}
      if (condition.source === 'inventory') {
        if (!['has','missing'].includes(condition.op) || (references && !items.has(condition.key))) errors.push(`${label}: inventory condition needs an existing item and has/missing operator.`);
      } else {
        const variable = variables.get(condition.key);
        if ((!variable && references) || !['eq','neq','gte','lte'].includes(condition.op) || !['boolean','number'].includes(typeof condition.value) || (typeof condition.value === 'number' && !Number.isFinite(condition.value)) || (variable && (typeof condition.value !== (variable.type==='flag'?'boolean':'number') || (variable.type==='flag' && !['eq','neq'].includes(condition.op))))) errors.push(`${label}: condition needs a matching variable, comparison and value.`);
      }
    }
    if (target.unavailable !== undefined && (!choices || !['hidden','disabled'].includes(target.unavailable))) errors.push(`${label}: unavailable must be hidden or disabled on a choice.`);
    if (target.effects !== undefined && !Array.isArray(target.effects)) errors.push(`${label}: effects must be a list.`);
    for (const effect of Array.isArray(target.effects) ? target.effects : []) {
      if (!object(effect) || typeof effect.key !== 'string' || !['set','add'].includes(effect.op) || !['boolean','number'].includes(typeof effect.value) || (typeof effect.value==='number'&&!Number.isFinite(effect.value))) {errors.push(`${label}: invalid effect.`);continue;}
      const variable=variables.get(effect.key);
      if ((!variable&&references) || (effect.op==='add' && typeof effect.value!=='number') || (variable && (typeof effect.value !== (variable.type==='flag'?'boolean':'number') || (effect.op==='add'&&variable.type!=='number')))) errors.push(`${label}: effect needs a matching variable and set/add value.`);
    }
  };
  for (const node of Array.isArray(chapter.nodes)?chapter.nodes:[]) if (node?.conditions !== undefined || node?.effects !== undefined) errors.push(`Node ${node.id}: attach conditions to choices and effects to cards, choices or items.`);
  for (const sequence of sequences) {
    for (const card of Array.isArray(sequence?.cards) ? sequence.cards : []) {
      inspect(card,`Sequence ${sequence.id}, card ${card?.id}`);
      if (card?.effects?.length && sequence.type!=='linear') errors.push(`Sequence ${sequence.id}: card effects belong to Linear cards; use choice or item effects instead.`);
      for (const choice of Array.isArray(card?.choices)?card.choices:[]) inspect(choice,`Sequence ${sequence.id}, choice ${choice?.id}`,true);
    }
    for (const item of Array.isArray(sequence?.items)?sequence.items:[]) inspect(item,`Sequence ${sequence.id}, item ${item?.id}`);
  }
  return errors;
}
