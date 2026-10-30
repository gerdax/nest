import { createCombatAction, createEffectCard, createEnemy } from './combat-model.js';
import { createError, errorMessage } from '../errors.js';
import { isTagKey, itemTag, itemTagLabel } from './item-tags.js';
import { editorCheckSummary, isStatVariable } from './checks.js';
import { nodeSlotCardKinds } from './nodeTypes.js';
/** The library stores content; placements store chapter-specific behavior. */
export const cardKinds = Object.freeze({
  combatAction: {label:'Combat Action',editorTint:'#d99bea',validate:()=>[]},
  effect: {label:'Feedback',editorTint:'#edb4dc',validate:()=>[]},
  enemy: {label:'Enemy',editorTint:'#ef947c',validate:()=>[]},
  event: { label: 'Vignette', editorTint: '#96f7a7', validate: card => typeof card.text === 'string' ? [] : [errorMessage('PROJECT_VIGNETTE_TEXT_MUST_BE_A_STRING')] },
  caption: { label: 'Caption', editorTint: '#e4ffeb', validate: card => typeof card.text === 'string' ? [] : [errorMessage('PROJECT_CAPTION_TEXT_MUST_BE_A_STRING')] },
  action: { label: 'Action', editorTint: '#a59bea', validate: card => ['direct','check'].includes(card.resolution) ? [] : [errorMessage('PROJECT_ACTION_RESOLUTION_MUST_BE_DIRECT_OR_CHECK')] },
  consumable: { label: 'Consumable', editorTint: '#9edcff', validate: validateResourceCard },
  item: { label: 'Item', editorTint: '#dfcf78', validate: card => Array.isArray(card.onCollect) ? [] : [errorMessage('PROJECT_ITEM_COLLECTION_EFFECTS_MUST_BE_A_LIST')] }
});
function validateResourceCard(card) {
  return [...(['health','energy'].includes(card.subtype) ? [] : ['Consumable subtype must be health or energy']), ...(Number.isFinite(card.value) ? [] : [errorMessage('PROJECT_VALUE_MUST_BE_A_FINITE_NUMBER')]),
    ...(Array.isArray(card.onCollect) ? [] : [errorMessage('PROJECT_COLLECTION_EFFECTS_MUST_BE_A_LIST')])];
}
export const isConsumableKind = kind => ['consumable','health','energy'].includes(kind);
// Health/Energy remain accepted at legacy input and visual-face boundaries.
export const consumableResource = card => (card?.kind??card?.cardKind)==='consumable'?card.subtype:(card?.kind??card?.cardKind);
export function normalizeConsumableCard(card) {
 if(card&&['health','energy'].includes(card.kind)){card.subtype=card.kind;card.kind='consumable';}
 return card;
}
export const resourceCollectionEffects = card => [{op:'add', key:consumableResource(card), value:card.value}, ...(Array.isArray(card.onCollect) ? card.onCollect : [])];
export const canonicalCardKind = kind => kind === 'narrative' ? 'event' : ['health','energy'].includes(kind)?'consumable':kind;
export const cardEditorTint = kind => cardKinds[canonicalCardKind(kind)]?.editorTint || '#aab8bb';
export const isStoryKind = kind => ['event','caption'].includes(canonicalCardKind(kind));
// Compiled placements include their added effects in onCollect. Legacy callers
// may still supply collection mechanics under effects instead.
export const collectionEffects = card => card.onCollect ?? card.effects ?? [];
const actionOverrideKeys = Object.freeze(['conditions', 'costs', 'effects', 'resolution', 'check', 'successEffects', 'failureEffects']);
const itemOverrideKeys = Object.freeze(['onCollect', 'permability']);
const resourceOverrideKeys = Object.freeze(['value', 'onCollect']);
const storyOverrideKeys = Object.freeze(['effects']);
export function placementOverrideKeys(kind, definition) {
  const keys=isConsumableKind(kind) ? resourceOverrideKeys : canonicalCardKind(kind) === 'item' ? itemOverrideKeys : isStoryKind(kind) ? storyOverrideKeys : actionOverrideKeys;
  if(!definition)return keys;
  // Imported cards can already carry mechanics outside their native editor's
  // fields. Allow instance overrides for those existing rules when sharing them.
  const legacy=['costs','effects','onCollect','successEffects','failureEffects'].filter(key=>Object.hasOwn(definition,key));
  if(Object.hasOwn(definition,'resolution')||Object.hasOwn(definition,'check'))legacy.push('resolution','check');
  return [...new Set([...keys,...legacy])];
}
export function createDefinition(kind, id) {
  const resource=['health','energy'].includes(kind)?kind:'health';
  kind = canonicalCardKind(kind);
  if (!Object.hasOwn(cardKinds, kind)) throw createError('PROJECT_UNKNOWN_CARD_KIND', { kind });
  if(kind==='combatAction')return createCombatAction(id);
  if(kind==='effect')return createEffectCard(id);
  if(kind==='enemy')return createEnemy(id);
  const base = { id, kind, name: cardKinds[kind].label, showName:kind==='item'||isConsumableKind(kind), text: '', image: '' };
  if (isStoryKind(kind)) return { ...base, effects: [] };
  if (isConsumableKind(kind)) return { ...base, subtype:resource, value: 1, onCollect: [] };
  if (kind === 'item') return { ...base, onCollect: [], permability: 0 };
  return { ...base, conditions: [], costs: [], effects: [], resolution: 'direct', check: {pool: [{sides:20,count:1}], modifier:0,target:10}, successEffects: [], failureEffects: [] };
}
export function resolvePlacement(project, placement, index) {
  const definition = index && index.usable !== false ? index.byId.get(placement.definitionId) : project.library.find(d => d?.id === placement.definitionId);
  if (!definition) throw createError('PROJECT_UNKNOWN_DEFINITION_ID', { definitionId: placement.definitionId });
  const overrides = definition.visibility === 'local' ? {} : Object.fromEntries(
    placementOverrideKeys(definition.kind,definition).filter(key => Object.hasOwn(placement.overrides ?? {}, key))
      .map(key => [key, placement.overrides[key]])
  );
  const base = normalizeConsumableCard({...definition, ...overrides});base.kind=canonicalCardKind(base.kind);
  const resolved = {...base, conditions:[...(base.conditions || []),...(placement.conditions || [])], effects:[...(base.effects || []),...(placement.effects || [])], id:placement.id, definitionId:definition.id, unavailable:placement.unavailable ?? 'disabled', inventoryKey:definition.inventoryKey ?? definition.id};
  if (isConsumableKind(base.kind)) {
    resolved.onCollect = [...resourceCollectionEffects(base), ...(placement.effects || [])];
    resolved.effects = resolved.onCollect;
  }
  if (base.kind === 'item') resolved.onCollect = [...collectionEffects(base), ...(placement.effects || [])];
  resolved.itemTags = project.itemTags || [];
  const contextItem = placement.contextItemId && (index && index.usable !== false ? index.itemsById.get(placement.contextItemId) : project.library.find(d => d.id === placement.contextItemId && d.kind === 'item'));
  if (placement.contextItemId && !contextItem && isTagKey(placement.contextItemId)) {
    if (base.kind !== 'action' || !itemTag(project, placement.contextItemId)) throw createError('PROJECT_CONTEXTUAL_CHOICE_NEEDS_AN_ACTION_AND_AN_ITEM_TAG');
    const key = placement.contextItemId;
    Object.assign(resolved, {contextItemId:key, contextInventoryKey:key, inventoryLabel:itemTagLabel(project,key), entrance:'bottom', contextOverrideImage:false});
    resolved.explicitConditions = [...resolved.conditions];
    resolved.conditions.push({source:'inventory',key,op:'has'});
  } else if (placement.contextItemId) {
    const item = contextItem;
    if (base.kind !== 'action' || !item) throw createError('PROJECT_CONTEXTUAL_CHOICE_NEEDS_AN_ACTION_AND_AN_ITEM_DEFINITION');
    const key = item.inventoryKey ?? item.id;
    Object.assign(resolved, {contextItemId:item.id, contextInventoryKey:key, inventoryLabel:`Inventory · ${item.name}`, entrance:'bottom', contextOverrideImage:placement.contextOverrideImage===true});
    if (placement.contextOverrideImage === true) Object.assign(resolved, {image:item.image ?? '', imageScale:item.imageScale ?? 100, imageOffsetX:item.imageOffsetX ?? 0,
      imageOffsetY:item.imageOffsetY ?? 0, flipImage:!!item.flipImage});
    resolved.explicitConditions=[...resolved.conditions];
    resolved.conditions.push({source:'inventory',key,op:'has'});
  }
  return resolved;
}
/** Upfront resource costs belong in Action badges; consequences do not. */
export const isActionEnergyCost = cost => cost.source !== 'inventory' && cost.key === 'energy';
export function actionResourceCost(card,key) {
  if (!['action','combatAction'].includes(canonicalCardKind(card?.kind ?? card?.cardKind))) return 0;
  return (card.costs || []).filter(cost=>cost.source!=='inventory'&&cost.key===key&&cost.hideBadge!==true).reduce((total, cost) => total + cost.amount, 0);
}
export const actionEnergyCost=card=>actionResourceCost(card,'energy');
export const actionHealthCost=card=>actionResourceCost(card,'health');
/** Missing flags preserve legacy either-outcome behaviour. Direct actions
 * ignore the saved dice options, including when both are unchecked. */
export function progressionEffects(card,outcome) {
  const effects=card?.effects??[];
  if(card?.resolution!=='check'||typeof outcome!=='boolean')return effects;
  const flag=outcome?'onDiceSuccess':'onDiceFailure';
  return effects.filter(effect=>effect[flag]!==false);
}
export function cardSummaryParts(card, variables = [], library = [], itemTags = card.itemTags || [], { omitActionEnergyCost = false,omitActionResourceCosts=false } = {}) {
  const variable = key => variables.find(v => v.id === key);
  const name = key => variable(key)?.name || library.find(d => d.id === key || d.inventoryKey === key)?.name || (isTagKey(key) ? itemTagLabel({itemTags},key) : key);
  const effects = list => (list || []).map(e => {
    if (e.op === 'addItem' || e.op === 'removeItem') return `${e.op === 'addItem' ? 'Gain' : 'Remove'} ${name(e.key)}`;
    if (e.op === 'set') return `Set ${name(e.key)} to ${e.value}`;
    if (e.value > 0 && variable(e.key)?.max !== undefined) return `Restore up to ${e.value} ${name(e.key)}`;
    return `${e.value >= 0 ? 'Add' : 'Lose'} ${Math.abs(e.value)} ${name(e.key)}`;
  }).join(', ');
  const requirements = (card.explicitConditions ?? card.conditions ?? []).map(c => {
    if (c.source === 'inventory') return c.op === 'has' ? `Own ${name(c.key)}` : c.op === 'missing' ? `Without ${name(c.key)}` : `${name(c.key)} ${c.op === 'gte' ? '≥' : '≤'} ${c.value}`;
    return `${name(c.key)} ${{eq:'=',neq:'≠',gte:'≥',lte:'≤'}[c.op]} ${c.value}`;
  });
  const parts = [];
  if (card.kind === 'item' && card.tagId) parts.push(itemTagLabel({itemTags},card.tagId));
  if(card.contextItemId) parts.push(`Triggered by: ${name(card.contextItemId)}`);
  if (requirements.length) parts.push(`Requires: ${requirements.join(', ')}`);
  const costs = (card.costs || []).filter(cost => !['action','combatAction'].includes(canonicalCardKind(card.kind ?? card.cardKind))||!(omitActionEnergyCost&&isActionEnergyCost(cost)||omitActionResourceCosts&&cost.source!=='inventory'&&['health','energy'].includes(cost.key)));
  if (costs.length) parts.push(`Cost: ${costs.map(c=>c.source==='inventory'?name(c.key):`${c.amount} ${name(c.key)}`).join(', ')}`);
  if (card.resolution === 'check') { const c = card.check; if(c?.mode === 'stat') { try { parts.push(`Check: ${editorCheckSummary(c, variables)}`); } catch { parts.push('Check: Invalid stat check'); } } else if(c) parts.push(`Check: ${(c.pool || []).map(d=>`${d.count}d${d.sides}`).join(' + ')}${c.modifier ? ` ${c.modifier >= 0 ? '+' : ''}${c.modifier}` : ''}${c.modifierVariable ? ` + ${name(c.modifierVariable)}` : ''} ≥ ${c.target}`); }
  if(!isConsumableKind(card.kind)&&card.effects?.length) parts.push(`Effects: ${effects(card.effects)}`);
  const collect = isConsumableKind(card.kind) ? (card.effects ?? resourceCollectionEffects(card)) : card.onCollect;
  if(collect?.length) parts.push(`Collect: ${effects(collect)}`);
  if(card.successEffects?.length) parts.push(`Success: ${effects(card.successEffects)}`);
  if(card.failureEffects?.length) parts.push(`Failure: ${effects(card.failureEffects)}`);
  if(card.kind === 'item') parts.push(`Action triggers: ${card.permability > 0 ? (card.remainingTriggers ?? card.permability) + ' remaining' : 'permanent'}`);
  return parts;
}
export function cardSummary(card, variables = [], library = [], itemTags = card.itemTags || [], options = {}) {
  return cardSummaryParts(card,variables,library,itemTags,options).join(' · ');
}

/** Authored text and resource rules stay separate from the contextual stat-check panel. */
export function playerCardSummary(card, variables = [], library = [], values = {}) {
  const concealed = key => isStatVariable(variables.find(v => v.id === key));
  const visible = rules => rules?.filter(rule => rule.source === 'inventory' || ['addItem','removeItem'].includes(rule.op) || !concealed(rule.key));
  const filtered = {...card};
  for (const key of ['conditions','explicitConditions','costs','effects','onCollect','successEffects','failureEffects']) if (card[key]) filtered[key] = visible(card[key]);
  if (card.check?.mode === 'stat') filtered.resolution = 'direct';
  const parts = cardSummaryParts(filtered, variables, library, card.itemTags || [], {omitActionResourceCosts:true});
  return parts.join(' · ');
}

/** Fork placements are branches regardless of whether their content is event or an action. */
export function allowedCardKinds(nodeType,slot) {
 return nodeSlotCardKinds(nodeType,slot);
}
