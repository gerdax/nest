import { nodeSlotCardKinds } from './nodeTypes.js';
/** The library stores content; placements store chapter-specific behavior. */
export const cardKinds = Object.freeze({
  event: { label: 'Beat', validate: card => typeof card.text === 'string' ? [] : ['Beat text must be a string.'] },
  caption: { label: 'Caption', validate: card => typeof card.text === 'string' ? [] : ['Caption text must be a string.'] },
  action: { label: 'Action', validate: card => ['direct','check'].includes(card.resolution) ? [] : ['Action resolution must be direct or check.'] },
  item: { label: 'Item', validate: card => Array.isArray(card.onCollect) ? [] : ['Item collection effects must be a list.'] }
});
export const canonicalCardKind = kind => kind === 'narrative' ? 'event' : kind;
export const isStoryKind = kind => ['event','caption'].includes(canonicalCardKind(kind));
export function createDefinition(kind, id) {
  kind = canonicalCardKind(kind);
  if (!Object.hasOwn(cardKinds, kind)) throw new TypeError(`Unknown card kind: ${kind}`);
  const base = { id, kind, name: `New ${cardKinds[kind].label}`, showName:kind==='item', text: '', image: '' };
  if (isStoryKind(kind)) return { ...base, effects: [] };
  if (kind === 'item') return { ...base, onCollect: [] };
  return { ...base, conditions: [], costs: [], effects: [], resolution: 'direct', check: {pool: [{sides:20,count:1}], modifier:0,target:10}, successEffects: [], failureEffects: [] };
}
export function resolvePlacement(project, placement) {
  const definition = project.library.find(d => d?.id === placement.definitionId);
  if (!definition) throw new TypeError(`Unknown definition: ${placement.definitionId}`);
  const base = {...definition, ...placement.overrides, kind:canonicalCardKind(definition.kind)};
  const resolved = {...base, conditions:[...(base.conditions || []),...(placement.conditions || [])], effects:[...(base.effects || []),...(placement.effects || [])], id:placement.id, definitionId:definition.id, unavailable:placement.unavailable ?? 'disabled', inventoryKey:definition.inventoryKey ?? definition.id};
  if (placement.contextItemId) {
    const item = project.library.find(d => d.id === placement.contextItemId && d.kind === 'item');
    if (base.kind !== 'action' || !item) throw new TypeError('Contextual choice needs an Action and an Item definition.');
    const key = item.inventoryKey ?? item.id;
    Object.assign(resolved, {contextItemId:item.id, contextInventoryKey:key, inventoryLabel:`Inventory · ${item.name}`, entrance:'bottom',
      image:item.image ?? '', imageScale:item.imageScale ?? 100, imageOffsetX:item.imageOffsetX ?? 0,
      imageOffsetY:item.imageOffsetY ?? 0, flipImage:!!item.flipImage});
    resolved.conditions.push({source:'inventory',key,op:'has'});
  }
  return resolved;
}
export function cardSummary(card, variables = [], library = []) {
  const variable = key => variables.find(v => v.id === key);
  const name = key => variable(key)?.name || library.find(d => d.id === key || d.inventoryKey === key)?.name || key;
  const effects = list => (list || []).map(e => {
    if (e.op === 'addItem' || e.op === 'removeItem') return `${e.op === 'addItem' ? 'Gain' : 'Remove'} ${name(e.key)}`;
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
  if (card.costs?.length) parts.push(`Cost: ${card.costs.map(c=>c.source==='inventory'?name(c.key):`${c.amount} ${name(c.key)}`).join(', ')}`);
  if (card.resolution === 'check') { const c = card.check; if(c) parts.push(`Check: ${(c.pool || []).map(d=>`${d.count}d${d.sides}`).join(' + ')}${c.modifier ? ` ${c.modifier >= 0 ? '+' : ''}${c.modifier}` : ''}${c.modifierVariable ? ` + ${name(c.modifierVariable)}` : ''} ≥ ${c.target}`); }
  if(card.effects?.length) parts.push(effects(card.effects));
  if(card.onCollect?.length) parts.push(`Collect: ${effects(card.onCollect)}`);
  if(card.successEffects?.length) parts.push(`Success: ${effects(card.successEffects)}`);
  if(card.failureEffects?.length) parts.push(`Failure: ${effects(card.failureEffects)}`);
  if(card.use) parts.push(`Use: ${effects(card.use.effects) || 'No effects'}`);
  return parts.join(' · ');
}

/** Fork placements are branches regardless of whether their content is event or an action. */
export function allowedCardKinds(nodeType,slot) {
 return nodeSlotCardKinds(nodeType,slot);
}
