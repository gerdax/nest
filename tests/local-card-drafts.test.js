import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject, exportChapter, parseProject, validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {addInventory, conditionsMet} from '../project/state.js';
import {createNode, makePlacement, synchronizeConnections} from '../studio/commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {cleanupLocalDefinitions} from '../project/dependencies.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';

const allowedKinds = ['event', 'caption', 'action', 'item'];
const definition = (project, placement) => project.library.find(d => d.id === placement.definitionId);
function setup(type = 'linear') {
  const project = createProject(), chapter = project.chapters[0], node = createNode(project, type);
  chapter.nodes.push(node);
  synchronizeConnections(project);
  const placement = (node.cards || node.choices || node.items)[0];
  const drafts = new LocalCardDrafts();
  drafts.setContext(chapter.id, node.id);
  return {project, chapter, node, placement, drafts};
}
const switchTo = (state, value) => state.drafts.switchSource(state.project, state.placement, value, {allowedKinds});
const condition = value => ({source:'variable', key:'energy', op:'gte', value});
const effect = value => ({op:'add', key:'energy', value});

test('local Action, Caption and Vignette share current content and retain hidden artwork', () => {
  const state = setup(), {project, placement} = state, id = placement.id;
  switchTo(state, 'local:action');
  const common = {name:'Remembered', text:'Story', image:'./assets/img/city.png', flipImage:true,
    imageScale:145, imageOffsetX:-12, imageOffsetY:8};
  Object.assign(definition(project, placement), common, {costs:[{source:'variable', key:'energy', amount:2}]});
  switchTo(state, 'local:caption');
  for (const [key, value] of Object.entries(common)) assert.equal(definition(project, placement)[key], value);
  assert.equal(definition(project, placement).costs, undefined);
  definition(project, placement).text = 'Edited Caption';
  switchTo(state, 'local:event');
  switchTo(state, 'local:action');
  const restored = definition(project, placement);
  assert.equal(placement.id, id);
  for (const [key, value] of Object.entries({...common, text:'Edited Caption'})) assert.equal(restored[key], value);
  assert.deepEqual(restored.costs, [{source:'variable', key:'energy', amount:2}]);
});

test('Action and Item restore independent definition rules and placement settings', () => {
  const state = setup(), {project, placement} = state;
  switchTo(state, 'local:action');
  Object.assign(definition(project, placement), {conditions:[condition(2)], effects:[effect(-2)],
    resolution:'check', check:{pool:[{sides:6,count:2}], modifier:3, target:9}, successEffects:[effect(3)]});
  placement.unavailable = 'hidden';
  switchTo(state, 'local:item');
  const item = definition(project, placement);
  assert.equal(item.resolution, undefined);
  assert.equal(item.costs, undefined);
  assert.equal(placement.unavailable, undefined);
  item.onCollect = [effect(1)]; item.permability = 2;
  placement.conditions = [condition(8)];
  switchTo(state, 'local:action');
  const action = definition(project, placement);
  assert.equal(action.onCollect, undefined); assert.equal(action.permability, undefined);
  assert.deepEqual(action.conditions, [condition(2)]); assert.deepEqual(action.effects, [effect(-2)]);
  assert.equal(action.resolution, 'check'); assert.equal(action.check.modifier, 3);
  assert.deepEqual(action.successEffects, [effect(3)]);
  assert.equal(placement.unavailable, 'hidden'); assert.equal(placement.conditions, undefined);
  switchTo(state, 'local:item');
  assert.deepEqual(definition(project, placement).onCollect, [effect(1)]);
  assert.equal(definition(project, placement).permability, 2);
  assert.deepEqual(placement.conditions, [condition(8)]);
});

test('Library detours restore local drafts while Convert copies current effective shared rules', () => {
  const state = setup(), {project, placement, drafts} = state;
  switchTo(state, 'local:action');
  const local = definition(project, placement);
  local.name = 'Local draft'; local.text = 'Local story'; local.costs = [{source:'variable', key:'energy', amount:1}];
  switchTo(state, 'explore');
  placement.overrides = {costs:[{source:'variable', key:'energy', amount:7}], resolution:'check',
    check:{pool:[{sides:20,count:1}], modifier:4, target:12}};
  switchTo(state, 'local:action');
  assert.equal(definition(project, placement).name, 'Local draft');
  assert.deepEqual(definition(project, placement).costs, local.costs);
  assert.equal(placement.overrides, undefined);
  switchTo(state, 'explore');
  placement.overrides = {costs:[{source:'variable', key:'energy', amount:7}], resolution:'check',
    check:{pool:[{sides:20,count:1}], modifier:4, target:12}};
  const shared = structuredClone(project.library.find(d => d.id === 'explore'));
  drafts.convert(project, placement);
  const converted = definition(project, placement);
  assert.equal(converted.visibility, 'local'); assert.equal(converted.name, shared.name);
  assert.deepEqual(converted.costs, [{source:'variable', key:'energy', amount:7}]);
  assert.equal(converted.check.modifier, 4); assert.equal(converted.resolution, 'check');
  assert.equal(placement.overrides, undefined);
  assert.deepEqual(project.library.find(d => d.id === 'explore'), shared);
  switchTo(state, 'local:caption'); switchTo(state, 'local:action');
  assert.deepEqual(definition(project, placement).costs, converted.costs);
});

test('same context retains inactive drafts; beat, chapter and explicit resets discard them', () => {
  for (const reset of [
    state => state.drafts.setContext(state.chapter.id, 'another-beat'),
    state => state.drafts.setContext('another-chapter', state.node.id),
    state => state.drafts.reset()
  ]) {
    const state = setup();
    switchTo(state, 'local:action');
    definition(state.project, state.placement).costs = [{source:'variable', key:'energy', amount:5}];
    definition(state.project, state.placement).text = 'Active content';
    switchTo(state, 'local:caption');
    state.drafts.setContext(state.chapter.id, state.node.id);
    switchTo(state, 'local:action');
    assert.equal(definition(state.project, state.placement).costs[0].amount, 5);
    switchTo(state, 'local:caption'); reset(state); switchTo(state, 'local:action');
    assert.deepEqual(definition(state.project, state.placement).costs, []);
    assert.equal(definition(state.project, state.placement).text, 'Active content');
  }
});

test('first same-kind Library-to-local switch copies overrides and keeps placement context', () => {
  const state = setup('fork'), {project, placement, drafts} = state;
  placement.definitionId = 'explore';
  placement.overrides = {costs:[{source:'variable',key:'energy',amount:4}], resolution:'check',
    check:{pool:[{sides:20,count:1}],modifier:6,target:14}};
  placement.contextItemId = 'flashlight'; placement.contextOverrideImage = true; placement.unavailable = 'hidden';
  drafts.switchSource(project, placement, 'local:action', {allowedKinds});
  assert.equal(definition(project, placement).costs[0].amount, 4);
  assert.equal(definition(project, placement).check.modifier, 6);
  assert.equal(definition(project, placement).resolution, 'check');
  assert.equal(placement.overrides, undefined);
  assert.equal(placement.contextItemId, 'flashlight'); assert.equal(placement.contextOverrideImage, true);
  assert.equal(placement.unavailable, 'hidden');
  switchTo(state, 'local:caption');
  assert.equal(placement.contextItemId, undefined); assert.equal(placement.contextOverrideImage, undefined);
  switchTo(state, 'local:action');
  assert.equal(placement.contextItemId, 'flashlight'); assert.equal(placement.contextOverrideImage, true);
});

test('changing Library kind drops placement rules and shared cards cannot be cleared', () => {
  const state = setup(), {project, placement, drafts} = state;
  switchTo(state, 'local:action');
  placement.unavailable = 'hidden'; placement.conditions = [condition(9)]; placement.effects = [effect(9)];
  switchTo(state, 'arrival');
  assert.equal(placement.unavailable, undefined); assert.equal(placement.conditions, undefined);
  assert.equal(placement.effects, undefined);
  const before = structuredClone(project);
  assert.throws(() => drafts.clear(project, placement)); assert.deepEqual(project, before);
  switchTo(state, 'local:action');
  assert.equal(placement.unavailable, 'hidden');
  assert.deepEqual(placement.conditions, [condition(9)]); assert.deepEqual(placement.effects, [effect(9)]);
});

test('drafts are isolated by placement', () => {
  const state = setup('fork'), other = state.node.choices[1];
  definition(state.project, state.placement).costs = [{source:'variable', key:'energy', amount:2}];
  definition(state.project, other).costs = [{source:'variable', key:'energy', amount:6}];
  switchTo(state, 'local:caption');
  state.drafts.switchSource(state.project, other, 'local:caption', {allowedKinds});
  switchTo(state, 'local:action');
  state.drafts.switchSource(state.project, other, 'local:action', {allowedKinds});
  assert.equal(definition(state.project, state.placement).costs[0].amount, 2);
  assert.equal(definition(state.project, other).costs[0].amount, 6);
});

test('Clear is one undoable edit, defaults local rules/settings and preserves IDs and destinations', () => {
  const state = setup('fork'), {project, node, placement, drafts} = state;
  const id = placement.id, definitionId = placement.definitionId;
  Object.assign(definition(project, placement), {name:'Edited', text:'Story', image:'art.png', imageScale:150,
    resolution:'check', costs:[{source:'variable',key:'energy',amount:2}]});
  Object.assign(placement, {unavailable:'hidden', contextItemId:'flashlight', contextOverrideImage:true});
  node.connections = {[`${id}:success`]:'arrival', [`${id}:failure`]:'supplies'};
  synchronizeConnections(project);
  const history = new DocumentHistory(project), before = history.document;
  assert.equal(history.transact(draft => {
    const p = draft.chapters[0].nodes.find(n => n.id === node.id).choices[0];
    drafts.clear(draft, p); synchronizeConnections(draft);
  }), true);
  const after = history.document, clearedNode = after.chapters[0].nodes.find(n => n.id === node.id), p = clearedNode.choices[0];
  assert.deepEqual(p, {id, definitionId});
  assert.deepEqual(definition(after, p), {...createDefinition('action', definitionId), visibility:'local'});
  assert.equal(clearedNode.connections[id], 'arrival');
  assert.equal(history.undo(), true); assert.deepEqual(history.document, before);
  assert.equal(history.redo(), true); assert.deepEqual(history.document, after);
});

test('Clear discards inactive rules so returning to a prior type starts from defaults', () => {
  const state = setup(); switchTo(state, 'local:action');
  definition(state.project, state.placement).costs = [{source:'variable',key:'energy',amount:3}];
  switchTo(state, 'local:caption');
  const id = state.placement.definitionId;
  state.drafts.clear(state.project, state.placement);
  assert.equal(state.placement.definitionId, id);
  switchTo(state, 'local:action');
  assert.deepEqual(definition(state.project, state.placement).costs, []);
});

test('restored and converted Item drafts remap inventory self references and aliases', () => {
  const state = setup(); switchTo(state, 'local:item');
  const item = definition(state.project, state.placement);
  item.inventoryKey = 'draft-alias';
  item.conditions = [{source:'inventory',key:item.id,op:'has'}, {source:'inventory',key:'draft-alias',op:'has'}];
  item.onCollect = [{op:'removeItem',key:item.id}];
  state.placement.conditions = [{source:'inventory',key:'draft-alias',op:'has'}];
  switchTo(state, 'local:action'); switchTo(state, 'local:item');
  const restored = definition(state.project, state.placement);
  assert.equal(restored.id, item.id);
  assert.ok(restored.conditions.every(c => c.key === restored.id));
  assert.equal(restored.onCollect[0].key, restored.id);
  assert.equal(state.placement.conditions[0].key, restored.id);
  const shared = state.project.library.find(d => d.id === 'flashlight');
  shared.inventoryKey = 'shared-alias'; shared.conditions = [{source:'inventory',key:'shared-alias',op:'has'}];
  shared.onCollect = [{op:'addItem',key:shared.id}];
  switchTo(state, shared.id); state.drafts.convert(state.project, state.placement);
  const converted = definition(state.project, state.placement);
  assert.notEqual(converted.id, shared.id);
  assert.equal(converted.inventoryKey, undefined);
  assert.equal(converted.conditions[0].key, converted.id);
  assert.equal(converted.onCollect[0].key, converted.id);
});

test('Reset positioning on current type removes obsolete positioning from restored Action', () => {
  const state = setup(); switchTo(state, 'local:action');
  Object.assign(definition(state.project, state.placement), {imageScale:160, imageOffsetX:15, imageOffsetY:-8});
  switchTo(state, 'local:caption');
  for (const key of ['imageScale','imageOffsetX','imageOffsetY']) delete definition(state.project, state.placement)[key];
  switchTo(state, 'local:action');
  for (const key of ['imageScale','imageOffsetX','imageOffsetY']) {
    assert.equal(Object.hasOwn(definition(state.project, state.placement), key), false, key);
  }
});

test('restoring an Action materializes a cached local Item dependency removed during a Library detour', () => {
  const state = setup(), {project, chapter, placement, drafts} = state;
  const itemNode = createNode(project, 'linear'); chapter.nodes.push(itemNode);
  const itemPlacement = itemNode.cards[0];
  drafts.switchSource(project, itemPlacement, 'local:item', {allowedKinds});
  const item = definition(project, itemPlacement); item.name = 'Dependency item'; item.onCollect = [effect(2)];
  const savedItem = structuredClone(item);
  switchTo(state, 'local:action');
  definition(project, placement).effects = [{op:'addItem',key:item.id}];
  switchTo(state, 'local:caption');
  drafts.switchSource(project, itemPlacement, 'flashlight', {allowedKinds});
  assert.equal(project.library.some(d => d.id === item.id), false);
  switchTo(state, 'local:action');
  assert.deepEqual(project.library.find(d => d.id === item.id), savedItem);
  assert.deepEqual(definition(project, placement).effects, [{op:'addItem',key:item.id}]);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('cached Item restoration retains identity used by another active Action inventory condition', () => {
  const state = setup(), {project, chapter, placement, drafts} = state;
  switchTo(state, 'local:item');
  const itemId = placement.definitionId;
  const actionNode = createNode(project, 'linear'); chapter.nodes.push(actionNode);
  const actionPlacement = actionNode.cards[0];
  drafts.switchSource(project, actionPlacement, 'local:action', {allowedKinds});
  definition(project, actionPlacement).conditions = [{source:'inventory',key:itemId,op:'has'}];
  switchTo(state, 'local:caption'); switchTo(state, 'local:item');
  assert.equal(placement.definitionId, itemId);
  const conditions = definition(project, actionPlacement).conditions;
  assert.equal(conditions[0].key, itemId);
  assert.equal(conditionsMet(conditions, {}, addInventory([], definition(project, placement))), true);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('Action dependency restoration prefers the latest Item draft over its older dependency snapshot', () => {
  const state = setup(), {project, chapter, placement, drafts} = state;
  const itemNode = createNode(project, 'linear'); chapter.nodes.push(itemNode);
  const itemPlacement = itemNode.cards[0];
  drafts.switchSource(project, itemPlacement, 'local:item', {allowedKinds});
  const item = definition(project, itemPlacement), itemId = item.id;
  item.name = 'Old'; item.onCollect = [effect(1)];
  switchTo(state, 'local:action');
  definition(project, placement).effects = [{op:'addItem',key:itemId}];
  switchTo(state, 'local:caption');
  item.name = 'Edited'; item.onCollect = [effect(5)];
  drafts.switchSource(project, itemPlacement, 'flashlight', {allowedKinds});
  assert.equal(project.library.some(d => d.id === itemId), false);
  switchTo(state, 'local:action');
  const restoredItem = project.library.find(d => d.id === itemId);
  assert.ok(restoredItem);
  assert.equal(restoredItem.name, 'Edited');
  assert.deepEqual(restoredItem.onCollect, [effect(5)]);
  assert.deepEqual(definition(project, placement).effects, [{op:'addItem',key:itemId}]);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

function cachedItemAction() {
  const state = setup(), {project, chapter, drafts} = state;
  const itemNode = createNode(project, 'linear'); chapter.nodes.push(itemNode);
  const itemPlacement = itemNode.cards[0];
  drafts.switchSource(project, itemPlacement, 'local:item', {allowedKinds});
  const item = definition(project, itemPlacement);
  item.inventoryKey = 'cleared-item-alias'; item.onCollect = [effect(9)];
  item.permability = 4;
  switchTo(state, 'local:action');
  definition(project, state.placement).effects = [{op:'addItem',key:item.id}];
  switchTo(state, 'local:caption');
  return {...state, itemNode, itemPlacement, itemId:item.id};
}

test('Clear refreshes cached Item dependencies before placement removal and unused cleanup', () => {
  const state = cachedItemAction(), {project, drafts, itemNode, itemPlacement, itemId} = state;
  drafts.clear(project, itemPlacement);
  const cleared = structuredClone(definition(project, itemPlacement));
  drafts.removePlacement(project, itemPlacement); itemNode.cards = [{id:'replacement',definitionId:'arrival'}];
  assert.ok(cleanupLocalDefinitions(project) > 0);
  assert.equal(project.library.some(d => d.id === itemId), false);
  switchTo(state, 'local:action');
  assert.deepEqual(project.library.find(d => d.id === itemId), cleared);
  assert.equal(cleared.inventoryKey, 'cleared-item-alias');
  assert.deepEqual(definition(project, state.placement).effects, [{op:'addItem',key:itemId}]);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('cleared Item defaults survive automatic pruning during a Library detour', () => {
  const state = cachedItemAction(), {project, drafts, itemPlacement, itemId} = state;
  drafts.clear(project, itemPlacement);
  const cleared = structuredClone(definition(project, itemPlacement));
  drafts.switchSource(project, itemPlacement, 'flashlight', {allowedKinds});
  assert.equal(project.library.some(d => d.id === itemId), false);
  switchTo(state, 'local:action');
  assert.deepEqual(project.library.find(d => d.id === itemId), cleared);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('placement removal refreshes older dependency copies from the current Item', () => {
  const state = cachedItemAction(), {project, drafts, itemNode, itemPlacement, itemId} = state;
  definition(project, itemPlacement).onCollect = [effect(2)];
  const current = structuredClone(definition(project, itemPlacement));
  drafts.removePlacement(project, itemPlacement); itemNode.cards = [{id:'replacement',definitionId:'arrival'}];
  cleanupLocalDefinitions(project);
  switchTo(state, 'local:action');
  assert.deepEqual(project.library.find(d => d.id === itemId), current);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

function sameBeatItemAction() {
  const state = setup(), {project, node} = state;
  const itemPlacement = makePlacement(project, 'item'); node.cards.push(itemPlacement);
  const item = definition(project, itemPlacement);
  switchTo(state, 'local:action');
  definition(project, state.placement).effects = [{op:'addItem',key:item.id}];
  return {...state, itemPlacement, item};
}

test('removal refreshes newly added transitive dependencies in the same beat before cleanup', () => {
  const state = sameBeatItemAction(), {project, node, drafts, itemPlacement, item} = state;
  switchTo(state, 'local:caption');
  const nextPlacement = makePlacement(project, 'item'); node.cards.push(nextPlacement);
  const next = definition(project, nextPlacement);
  item.onCollect = [{op:'addItem',key:next.id}];
  next.onCollect = [{op:'addItem',key:item.id}];
  const expected = [structuredClone(item), structuredClone(next)];
  for(const p of [itemPlacement, nextPlacement]){
    drafts.removePlacement(project, p); node.cards = node.cards.filter(card => card.id !== p.id);
  }
  cleanupLocalDefinitions(project);
  assert.ok(expected.every(d => !project.library.some(current => current.id === d.id)));
  switchTo(state, 'local:action');
  for(const saved of expected)assert.deepEqual(project.library.find(d => d.id === saved.id), saved);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('Clear removes obsolete transitive dependencies from cached Item closures', () => {
  const state = sameBeatItemAction(), {project, node, drafts, itemPlacement, item} = state;
  const nextPlacement = makePlacement(project, 'item'); node.cards.push(nextPlacement);
  const next = definition(project, nextPlacement);
  item.onCollect = [{op:'addItem',key:next.id}];
  switchTo(state, 'local:caption');
  drafts.clear(project, itemPlacement);
  const cleared = structuredClone(definition(project, itemPlacement));
  for(const p of [itemPlacement, nextPlacement]){
    drafts.removePlacement(project, p); node.cards = node.cards.filter(card => card.id !== p.id);
  }
  cleanupLocalDefinitions(project);
  switchTo(state, 'local:action');
  assert.deepEqual(project.library.find(d => d.id === item.id), cleared);
  assert.equal(project.library.some(d => d.id === next.id), false);
  synchronizeConnections(project); assert.deepEqual(validateProject(project), []);
});

test('Undo and Redo reset session snapshots while restoring exact cleared Item documents', () => {
  const state = cachedItemAction(), {drafts, itemPlacement, itemId} = state;
  const history = new DocumentHistory(state.project), before = history.document;
  history.transact(project => {
    const p = project.chapters[0].nodes.find(n => n.id === state.itemNode.id).cards[0];
    drafts.clear(project, p);
  });
  const after = history.document;
  // Match editor travel: cached drafts reset before either history operation.
  drafts.reset(); assert.equal(history.undo(), true);
  assert.deepEqual(history.document, before);
  assert.deepEqual(history.document.library.find(d => d.id === itemId).onCollect, [effect(9)]);
  drafts.reset(); assert.equal(history.redo(), true);
  assert.deepEqual(history.document, after);
  state.project = history.document;
  state.placement = state.project.chapters[0].nodes.find(n => n.id === state.node.id).cards[0];
  const p = state.project.chapters[0].nodes.find(n => n.id === state.itemNode.id).cards[0];
  assert.equal(p.id, itemPlacement.id);
  assert.equal(definition(state.project, p).inventoryKey, 'cleared-item-alias');
  switchTo(state, 'local:action');
  assert.deepEqual(definition(state.project, state.placement).effects, []);
  assert.deepEqual(definition(state.project, p).onCollect, []);
  synchronizeConnections(state.project); assert.deepEqual(validateProject(state.project), []);
});

test('disallowed local/shared kinds and another local definition leave the document unchanged', () => {
  const state = setup('fork'), {project, placement, drafts} = state;
  const before = structuredClone(project);
  for (const value of ['local:item', 'flashlight', state.node.choices[1].definitionId, 'missing']) {
    assert.throws(() => drafts.switchSource(project, placement, value, {allowedKinds:['event','caption','action']}));
    assert.deepEqual(project, before);
  }
  const count = project.library.length;
  drafts.switchSource(project, placement, 'local:action', {allowedKinds:['action']});
  assert.equal(project.library.length, count);
});

test('parse/export retain only active draft data and do not serialize cached type rules', () => {
  const state = setup(); switchTo(state, 'local:action');
  definition(state.project, state.placement).check.modifier = 12345;
  switchTo(state, 'local:caption');
  definition(state.project, state.placement).text = 'Saved Caption';
  synchronizeConnections(state.project);
  const json = JSON.stringify(state.project), exported = JSON.stringify(exportChapter(state.project));
  assert.ok(!json.includes('12345')); assert.ok(!exported.includes('12345'));
  assert.deepEqual(parseProject(json), state.project);
  const restored = parseProject(exported);
  assert.equal(restored.library.find(d => d.id === state.placement.definitionId).text, 'Saved Caption');
  const fresh = new LocalCardDrafts();
  fresh.switchSource(restored, restored.chapters[0].nodes.find(n => n.id === state.node.id).cards[0], 'local:action', {allowedKinds});
  const p = restored.chapters[0].nodes.find(n => n.id === state.node.id).cards[0];
  assert.equal(definition(restored, p).check.modifier, 0);
});

test('repeated type and Library switching bounds local definitions and respects existing references', () => {
  const state = setup(), initialCount = state.project.library.length;
  for (let i = 0; i < 12; i++) {
    for (const value of ['local:action','local:item','local:caption','local:event','arrival']) {
      switchTo(state, value);
      assert.ok(state.project.library.length <= initialCount);
    }
  }
  switchTo(state, 'local:item');
  const retained = definition(state.project, state.placement);
  state.project.library.find(d => d.id === 'explore').costs = [{source:'inventory',key:retained.id,amount:1}];
  switchTo(state, 'local:event');
  assert.ok(state.project.library.some(d => d.id === retained.id));
  const alsoUsed = definition(state.project, state.placement);
  const other = createNode(state.project, 'linear');
  state.chapter.nodes.push(other); other.cards[0].definitionId = alsoUsed.id;
  switchTo(state, 'local:caption');
  assert.ok(state.project.library.some(d => d.id === alsoUsed.id));
  synchronizeConnections(state.project);
  assert.deepEqual(validateProject(state.project), []);
});

// Execute the editor's real transaction and event handlers with DOM/rendering
// replaced by inert ports. This catches missing wiring as well as cache behavior.
function editorHandlers(state, definitionId) {
  const source = readFileSync(new URL('../studio/editor.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const context = {
    project:state.project, history:new DocumentHistory(state.project), localDrafts:state.drafts,
    definitionId, graph:{cancel(){}}, saveProject:() => ({ok:true}), render(){}, report(){},
    applyDocumentCommand, transactDocument,
    selection:() => ({chapterId:state.chapter.id,selected:state.node.id,definitionId:context.definitionId,mode:'library'}),
    node:() => context.project.chapters[0].nodes.find(n => n.id === state.node.id),
    scopeRoot:() => context.project.library.find(d => d.id === context.definitionId),
    findPlacement:() => undefined
  };
  runInNewContext([
    section('function edit(type,data={},', 'function renderGraph()'),
    section('function changeField(event){', 'for(const root of'),
    section('function command(event){', 'for(const root of')
  ].join('\n'), context);
  return context;
}

function cachedSharedItem() {
  const state = setup();
  const item = createDefinition('item', 'shared-cached-item');
  item.onCollect = [effect(1)]; state.project.library.push(item);
  switchTo(state, 'local:action');
  definition(state.project, state.placement).effects = [{op:'addItem',key:item.id}];
  switchTo(state, 'local:caption');
  return {...state,item};
}

function restoreEditorAction(state, editor) {
  state.project = editor.project;
  state.placement = state.project.chapters[0].nodes.find(n => n.id === state.node.id).cards[0];
  switchTo(state, 'local:action');
  return state.project.library.find(d => d.id === state.item.id);
}

test('editor Library field edits and deletion preserve current shared Item dependency drafts', () => {
  const state = cachedSharedItem(), editor = editorHandlers(state, state.item.id);
  editor.changeField({target:{dataset:{scope:'definition',path:'onCollect.0.value'},
    matches:() => false, closest:() => null, type:'number', value:'5'}});
  assert.deepEqual(editor.project.library.find(d => d.id === state.item.id).onCollect, [effect(5)]);
  editor.command({target:{closest:() => ({dataset:{command:'delete-definition'}})}});
  assert.equal(editor.project.library.some(d => d.id === state.item.id), false);
  assert.deepEqual(restoreEditorAction(state, editor).onCollect, [effect(5)]);
  synchronizeConnections(state.project); assert.deepEqual(validateProject(state.project), []);
});

test('editor Library rule removal refreshes obsolete transitive dependencies before deletion', () => {
  const state = cachedSharedItem();
  const extra = createDefinition('item', 'extra-shared-item');
  state.project.library.push(extra);
  state.item.onCollect = [{op:'addItem',key:extra.id}];
  // Capture the current dependency closure, including the transitive Item.
  switchTo(state, 'local:action'); switchTo(state, 'local:caption');
  const editor = editorHandlers(state, state.item.id);
  editor.command({target:{closest:() => ({dataset:{command:'remove-rule',scope:'definition',path:'onCollect',index:'0'}})}});
  editor.command({target:{closest:() => ({dataset:{command:'delete-definition'}})}});
  editor.definitionId = extra.id;
  editor.command({target:{closest:() => ({dataset:{command:'delete-definition'}})}});
  assert.deepEqual(restoreEditorAction(state, editor).onCollect, []);
  assert.equal(state.project.library.some(d => d.id === extra.id), false);
  synchronizeConnections(state.project); assert.deepEqual(validateProject(state.project), []);
});
