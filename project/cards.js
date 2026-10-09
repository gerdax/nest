/** The library stores content; placements store chapter-specific behavior. */
export const cardKinds = Object.freeze({
  narrative: { label: 'Narrative', layout: 'card', validate: card => typeof card.text === 'string' ? [] : ['Narrative text must be a string.'], fields: ['name','heading','text','image','effects'] },
  action: { label: 'Action', layout: 'choice', validate: card => ['direct','check'].includes(card.resolution) ? [] : ['Action resolution must be direct or check.'], fields: ['name','heading','text','image','conditions','costs','effects','resolution','check','successEffects','failureEffects'] },
  item: { label: 'Item', layout: 'item', validate: card => Array.isArray(card.onCollect) ? [] : ['Item collection effects must be a list.'], fields: ['name','heading','text','image','onCollect','use'] }
});
export function createDefinition(kind, id) {
  if (!Object.hasOwn(cardKinds, kind)) throw new TypeError(`Unknown card kind: ${kind}`);
  const base = { id, kind, name: `New ${kind}`, heading: '', text: '', image: '' };
  if (kind === 'narrative') return { ...base, effects: [] };
  if (kind === 'item') return { ...base, onCollect: [] };
  return { ...base, conditions: [], costs: [], effects: [], resolution: 'direct', check: {pool: [{sides:20,count:1}], modifier:0,target:10}, successEffects: [], failureEffects: [] };
}
export function resolvePlacement(project, placement) {
  const definition = project.library.find(d => d?.id === placement.definitionId);
  if (!definition) throw new TypeError(`Unknown definition: ${placement.definitionId}`);
  const base = {...definition, ...placement.overrides};
  return {...base, conditions:[...(base.conditions || []),...(placement.conditions || [])], effects:[...(base.effects || []),...(placement.effects || [])], id:placement.id, definitionId:definition.id, quantity:placement.quantity ?? 1, unavailable:placement.unavailable ?? 'disabled', inventoryKey:definition.inventoryKey ?? definition.id};
}
export function cardSummary(card, variables = [], library = []) {
  const variable = key => variables.find(v => v.id === key);
  const name = key => variable(key)?.name || library.find(d => d.id === key || d.inventoryKey === key)?.name || key;
  const effects = list => (list || []).map(e => {
    if (e.op === 'addItem' || e.op === 'removeItem') return `${e.op === 'addItem' ? 'Gain' : 'Remove'} ${e.quantity} ${name(e.key)}`;
    if (e.op === 'set') return `Set ${name(e.key)} to ${e.value}`;
    if (e.value > 0 && variable(e.key)?.max !== undefined) return `Restore up to ${e.value} ${name(e.key)}`;
    return `${e.value >= 0 ? 'Add' : 'Lose'} ${Math.abs(e.value)} ${name(e.key)}`;
  }).join(', ');
  const requirements = (card.conditions || []).map(c => {
    if (c.source === 'inventory') return c.op === 'has' ? `Own ${name(c.key)}` : c.op === 'missing' ? `Without ${name(c.key)}` : `${name(c.key)} ${c.op === 'gte' ? '≥' : '≤'} ${c.value}`;
    return `${name(c.key)} ${{eq:'=',neq:'≠',gte:'≥',lte:'≤'}[c.op]} ${c.value}`;
  });
  const parts = [];
  if (requirements.length) parts.push(`Requires: ${requirements.join(', ')}`);
  if (card.costs?.length) parts.push(`Cost: ${card.costs.map(c=>`${c.amount} ${name(c.key)}`).join(', ')}`);
  if (card.resolution === 'check') { const c = card.check; if(c) parts.push(`Check: ${(c.pool || []).map(d=>`${d.count}d${d.sides}`).join(' + ')}${c.modifier ? ` ${c.modifier >= 0 ? '+' : ''}${c.modifier}` : ''}${c.modifierVariable ? ` + ${name(c.modifierVariable)}` : ''} ≥ ${c.target}`); }
  if(card.effects?.length) parts.push(effects(card.effects));
  if(card.onCollect?.length) parts.push(`Collect: ${effects(card.onCollect)}`);
  if(card.successEffects?.length) parts.push(`Success: ${effects(card.successEffects)}`);
  if(card.failureEffects?.length) parts.push(`Failure: ${effects(card.failureEffects)}`);
  if(card.use) parts.push(`Use: ${effects(card.use.effects) || 'No effects'}`);
  return parts.join(' · ');
}
