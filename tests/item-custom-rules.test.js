import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import { normalizeLocalOwnership } from '../project/local-ownership.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, validateProject, parseProject, exportChapter, importChapter } from '../project/model.js';
import { createDefinition, resolvePlacement, collectionEffects } from '../project/cards.js';
import { definitionGraph } from '../project/dependencies.js';
import { addInventory, initialValues, transact } from '../project/state.js';
import { ProjectController } from '../project/ProjectController.js';
import { duplicatePlacement, duplicateNode, setCardSource } from '../studio/commands.js';

function fixture() {
  const project = createProject(), chapter = project.chapters[0];
  const definition = project.library.find(d => d.id === 'flashlight');
  Object.assign(definition, {permability:5, onCollect:[{op:'add', key:'energy', value:1}]});
  const placement = {id:'custom-item', definitionId:definition.id, overrides:{
    onCollect:[{op:'add', key:'energy', value:4}], permability:2
  }};
  const node = {id:'item-beat', name:'Item', type:'linear', x:0, y:0, cards:[placement], connections:{next:null}};
  chapter.nodes = [node]; chapter.startNode = node.id;
  restoreFixtureDefaults(project);
  return {project, chapter, definition, placement, node};
}

class Deck extends EventTarget {
  reset() { this.busy = false; }
  replaceContent(content) { this.content = content; }
  endContent() {}
}

test('Item custom collection rules replace source rules and preserve source content and inventory identity', () => {
  const {project, definition, placement, node} = fixture(), before = structuredClone(definition);
  definition.inventoryKey = 'torch'; before.inventoryKey = 'torch';
  const inherited = {id:'inherited', definitionId:definition.id}; node.cards.push(inherited);
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project), [custom, original] = compiled.nodes[0].cards;
  assert.deepEqual(custom.onCollect, placement.overrides.onCollect);
  assert.equal(custom.permability, 2);
  assert.deepEqual(original.onCollect, definition.onCollect);
  assert.equal(original.permability, 5);
  for (const key of ['name', 'text', 'image']) assert.equal(custom[key], definition[key]);
  assert.equal(custom.definitionId, definition.id); assert.equal(custom.inventoryKey, 'torch');
  custom.onCollect[0].value = 9;
  assert.deepEqual(definition, before); assert.equal(placement.overrides.onCollect[0].value, 4);
});

test('empty Item custom collection and permanent budget explicitly replace source values; legacy placement effects remain additive', () => {
  const {project, placement} = fixture();
  placement.overrides = {onCollect:[], permability:0};
  const legacy = {op:'add', key:'energy', value:2}; placement.effects = [legacy];
  assert.deepEqual(validateProject(project), []);
  const item = compileChapter(project).nodes[0].cards[0];
  assert.deepEqual(collectionEffects(item), [legacy]);
  assert.equal(item.permability, 0);
  delete placement.effects;
  assert.deepEqual(resolvePlacement(project, placement).onCollect, []);
});

test('Item overrides accept only collection and permability fields and cannot replace runtime identity or content', () => {
  for (const key of ['id', 'definitionId', 'kind', 'inventoryKey', 'name', 'text', 'image', 'conditions', 'effects', 'costs', 'resolution', 'check', 'successEffects', 'failureEffects']) {
    const {project, placement, definition} = fixture();
    placement.overrides[key] = ['conditions', 'effects', 'costs', 'successEffects', 'failureEffects'].includes(key) ? [] : 'changed';
    assert.ok(validateProject(project).some(e => e.message.includes('unsupported override')), key);
    const resolved = resolvePlacement(project, placement);
    assert.equal(resolved.id, placement.id); assert.equal(resolved.definitionId, definition.id);
    assert.equal(resolved.inventoryKey, definition.id); assert.equal(resolved.kind, 'item');
    for (const field of ['name', 'text', 'image']) assert.equal(resolved[field], definition[field]);
    assert.deepEqual(resolved.effects, []); assert.equal(resolved.resolution, undefined);
  }
});

test('Action overrides retain their supported rule fields and reject Item-only rules', () => {
  const project = createProject(), placement = project.chapters[0].nodes[2].choices[0];
  placement.overrides = {conditions:[], costs:[], effects:[], resolution:'direct', check:{pool:[{sides:20, count:1}], modifier:0, target:10}, successEffects:[], failureEffects:[]};
  assert.deepEqual(validateProject(project), []);
  for (const overrides of [{onCollect:[]}, {permability:1}]) {
    placement.overrides = overrides;
    assert.ok(validateProject(project).some(e => e.message.includes('unsupported override')));
  }
});

test('custom Item budgets validate as nonnegative safe integers', () => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const {project, placement} = fixture(); placement.overrides.permability = value;
    assert.deepEqual(validateProject(project), []);
  }
  for (const value of [-1, 0.5, null, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const {project, placement} = fixture(); placement.overrides.permability = value;
    assert.ok(validateProject(project).some(e => e.message.includes('permability')), String(value));
  }
});

test('malformed custom collection lists and rules produce validation errors', () => {
  for (const value of [null, {}, 3, 'invalid', [{op:'add', key:'missing', value:1}], [{op:'add', key:'energy', value:false}]]) {
    const {project, placement} = fixture(); placement.overrides.onCollect = value;
    assert.ok(validateProject(project).some(e => /effects must be a list|invalid variable effect/.test(e.message)));
    assert.throws(() => parseProject(JSON.stringify(project)), TypeError);
  }
});

test('local Item rules come from its own definition and obsolete placement overrides are discarded on parse', () => {
  const {project, definition, placement} = fixture(); definition.visibility = 'local';
  const compiled = compileChapter(project).nodes[0].cards[0];
  assert.deepEqual(compiled.onCollect, definition.onCollect); assert.equal(compiled.permability, 5);
  const parsed = parseProject(JSON.stringify(project));
  assert.equal(parsed.chapters[0].nodes[0].cards[0].overrides, undefined);
  assert.equal(placement.overrides.permability, 2);
});

test('placement collection rules may use chapter variables while shared definitions remain global', () => {
  const {project, chapter, definition, placement} = fixture();
  chapter.variables = [{id:'local-energy', type:'number', initial:1}];
  placement.overrides.onCollect = [{op:'add', key:'local-energy', value:3}];
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project), item = compiled.nodes[0].cards[0];
  const result = transact(initialValues(compiled.variables), addInventory([], item), {effects:collectionEffects(item)}, compiled.variables, compiled.library);
  assert.equal(result.variables['local-energy'], 4); assert.equal(result.variables.energy, 3);
  definition.onCollect = structuredClone(placement.overrides.onCollect);
  assert.ok(validateProject(project).some(e => e.message.includes(`Definition ${definition.id}: invalid variable effect`)));
});

test('custom collection commits only after departure and its trigger budget drives inventory transactions', () => {
  const {project, definition} = fixture(), before = structuredClone(definition), deck = new Deck(), errors = [];
  const controller = new ProjectController(deck, compileChapter(project), {onError:error => errors.push(error)});
  const detail = {contentId:deck.content.id, action:deck.content.actions[0], final:true};
  controller.resolveItem(detail, 'collect');
  assert.equal(controller.state.variables.energy, 3); assert.deepEqual(controller.state.collectedItems, []);
  controller.transitionComplete({contentId:detail.contentId, transition:'collect'});
  assert.equal(controller.state.variables.energy, 7);
  const owned = controller.state.collectedItems;
  assert.equal(owned[0].remainingTriggers, 2); assert.equal(owned[0].definitionId, definition.id);
  const once = transact(controller.state.variables, owned, {triggerItem:definition.id}, controller.compiled.variables);
  assert.equal(once.inventory[0].remainingTriggers, 1);
  assert.deepEqual(transact(once.variables, once.inventory, {triggerItem:definition.id}, controller.compiled.variables).inventory, []);
  assert.deepEqual(errors, []); assert.deepEqual(definition, before);
  controller.destroy();
});

test('failed custom collection is atomic, and discard applies no collection rules', () => {
  const {project, placement} = fixture();
  placement.overrides.onCollect.push({op:'set', key:'missing', value:1});
  const compiled = compileChapter(project), deck = new Deck(), errors = [];
  const controller = new ProjectController(deck, compiled, {onError:error => errors.push(error)});
  const detail = {contentId:deck.content.id, action:deck.content.actions[0], final:true};
  controller.resolveItem(detail, 'collect');
  assert.ok(errors.length > 0); assert.equal(controller.state.variables.energy, 3);
  assert.deepEqual(controller.state.collectedItems, []); assert.equal(controller.pendingItem, null);
  const discard = {...detail, contentId:deck.content.id, action:deck.content.actions[0]};
  controller.resolveItem(discard, 'discard');
  controller.transitionComplete({contentId:discard.contentId, transition:'discard'});
  controller.transitionComplete({contentId:discard.contentId, transition:'commit'});
  assert.equal(controller.state.variables.energy, 3); assert.deepEqual(controller.state.collectedItems, []);
  assert.equal(controller.state.completed, true); controller.destroy();
});

test('serialization, portable dependency export and conflict import preserve and remap Item custom rules', () => {
  const {project, chapter, placement} = fixture();
  chapter.variables = [{id:'local-energy', type:'number', initial:1}];
  project.library.push({...createDefinition('item', 'battery'), visibility:'local', onCollect:[{op:'addItem', key:'spare'}]}, {...createDefinition('item', 'spare'), visibility:'local'});
  placement.overrides.onCollect = [{op:'addItem', key:'battery'}, {op:'add', key:'local-energy', value:2}];
  normalizeLocalOwnership(project);
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  const pkg = exportChapter(project), before = structuredClone(pkg);
  assert.ok(pkg.library.some(d => d.id === 'battery')); assert.ok(pkg.library.some(d => d.id === 'spare'));
  assert.ok(definitionGraph(project).reachableFrom(chapter).has('spare'));
  const target = createProject();
  target.chapters[0].variables = [{id:'local-energy', type:'number', initial:8}];
  target.library.push({...createDefinition('item', 'battery'), name:'Other battery'}, {...createDefinition('item', 'spare'), name:'Other spare'});
  const imported = importChapter(target, pkg), importedChapter = imported.chapters.at(-1);
  assert.deepEqual(pkg, before); assert.deepEqual(validateProject(imported), []);
  const custom = importedChapter.nodes[0].cards[0].overrides;
  assert.equal(custom.permability, 2);
  assert.equal(custom.onCollect[0].key, 'battery-2'); assert.equal(custom.onCollect[1].key, 'local-energy-2');
  assert.equal(imported.library.find(d => d.id === 'battery-2').onCollect[0].key, 'spare-2');
});

test('duplicating shared Item placements and beats detaches custom rules; converting to local retains customized rules', () => {
  const {project, node, definition, placement} = fixture(), before = structuredClone(definition);
  const copy = duplicatePlacement(project, node, placement), beatCopy = duplicateNode(project, node);
  assert.equal(copy.definitionId, definition.id); assert.deepEqual(copy.overrides, placement.overrides);
  assert.deepEqual(beatCopy.cards[0].overrides, placement.overrides);
  copy.overrides.permability = 1; copy.overrides.onCollect[0].value = 8;
  assert.equal(placement.overrides.permability, 2); assert.equal(placement.overrides.onCollect[0].value, 4);
  setCardSource(project, placement, 'local:item', {allowedKinds:['item']});
  const local = project.library.find(d => d.id === placement.definitionId);
  assert.equal(local.visibility, 'local'); assert.equal(local.permability, 2);
  assert.deepEqual(local.onCollect, [{op:'add', key:'energy', value:4}]);
  assert.equal(placement.overrides, undefined); assert.deepEqual(definition, before);
  assert.deepEqual(validateProject(project), []);
});
