import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, compileChapter, parseProject, exportChapter, importChapter, normalizeSingleItems, validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createLegacyStarterChapter} from '../chapter/model.js';
import {saveProject, loadProject} from '../project/storage.js';
import {exportStudioChapter} from '../studio/persistence.js';
import {ProjectController} from '../project/ProjectController.js';

const retiredNames = ['quantity', 'use', 'remainingTriggers'];
class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content = content; }
  endContent() {}
}
function runtime(compiled) {
  const deck = new Deck(), controller = new ProjectController(deck, compiled);
  const snapshot = {variables: controller.state.variables, cardId: controller.state.cardId,
    actions: deck.content.actions.map(({id, disabled}) => ({id, disabled: !!disabled}))};
  controller.destroy();
  return snapshot;
}

for (const scope of ['global', 'chapter']) test(`${scope} variables named after retired item fields survive document round trips`, () => {
  const project = createProject(), chapter = project.chapters[0];
  const variables = retiredNames.map((id, i) => ({id, type:'number', initial:i + 1}));
  if (scope === 'global') project.variables.push(...variables);
  else chapter.variables = variables;
  chapter.initialValues = Object.fromEntries(retiredNames.map((id, i) => [id, i + 11]));
  const before = structuredClone(project), entries = new Map();
  const storage = {getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value)};
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(saveProject(project, storage), {ok:true});
  const pkg = exportChapter(project), packageBefore = structuredClone(pkg), destination = createProject();
  const destinationBefore = structuredClone(destination);
  const imported = importChapter(destination, pkg);
  for (const restored of [parseProject(JSON.stringify(project)), loadProject(storage).project,
    parseProject(JSON.stringify(pkg)), imported]) {
    const restoredChapter = restored.chapters.at(-1);
    assert.deepEqual(restoredChapter.initialValues, chapter.initialValues);
    const compiled = compileChapter(restored, restoredChapter.id), state = runtime(compiled).variables;
    for (const id of retiredNames) assert.equal(state[id], chapter.initialValues[id]);
  }
  assert.deepEqual(project, before);
  assert.deepEqual(pkg, packageBefore);
  assert.deepEqual(destination, destinationBefore);
});

test('legacy item fields and inventory rules still normalize in definitions, placements, overrides and compiled cards', () => {
  const project = createProject(), chapter = project.chapters[0];
  const item = project.library.find(d => d.kind === 'item'), action = project.library.find(d => d.kind === 'action');
  const legacy = {quantity:7, use:{effects:[]}, remainingTriggers:99};
  Object.assign(item, legacy);
  Object.assign(chapter.nodes[1].items[0], legacy, {overrides:{...legacy}});
  action.conditions = [{source:'inventory', key:item.id, op:'gte', value:7}, {source:'inventory', key:item.id, op:'lte', value:7}];
  action.costs = [{source:'inventory', key:item.id, amount:7}, {source:'variable', key:'energy', amount:2}];
  action.effects = [{op:'addItem', key:item.id, quantity:7}, {op:'removeItem', key:item.id, quantity:7}];
  const before = structuredClone(project);
  for (const output of [parseProject(JSON.stringify(project)), compileChapter(project), exportChapter(project)]) {
    const d = output.library.find(d => d.id === item.id), a = output.library.find(d => d.id === action.id);
    for (const key of retiredNames) assert.equal(Object.hasOwn(d, key), false);
    assert.deepEqual(a.conditions, [{source:'inventory', key:item.id, op:'has'}, {source:'inventory', key:item.id, op:'missing'}]);
    assert.deepEqual(a.costs, [{source:'inventory', key:item.id, amount:1}, {source:'variable', key:'energy', amount:2}]);
    assert.deepEqual(a.effects, [{op:'addItem', key:item.id}, {op:'removeItem', key:item.id}]);
    const nodes = output.nodes ?? output.chapter?.nodes ?? output.chapters[0].nodes;
    const placement = nodes[1].items[0];
    for (const key of retiredNames) {
      assert.equal(Object.hasOwn(placement, key), false);
      assert.equal(Object.hasOwn(placement.overrides ?? {}, key), false);
    }
  }
  assert.deepEqual(project, before);
});

test('normalization supports raw v1 and legacy sequence/compiled shapes while retaining value dictionaries', () => {
  const raw = createLegacyStarterChapter();
  raw.initialValues = {quantity:4, use:5, remainingTriggers:6};
  const item = raw.sequences.find(s => s.items?.length).items[0];
  Object.assign(item, {quantity:8, use:{effects:[]}, remainingTriggers:8});
  item.effects = [{op:'addItem', key:'flashlight', quantity:5}];
  raw.nodes[0].connections = {quantity:null, use:'route', remainingTriggers:'supplies'};
  const expectedConnections = structuredClone(raw.nodes[0].connections);
  const expectedValues = structuredClone(raw.initialValues);
  normalizeSingleItems(raw);
  assert.deepEqual(raw.initialValues, expectedValues);
  assert.deepEqual(raw.nodes[0].connections, expectedConnections);
  for (const key of retiredNames) assert.equal(Object.hasOwn(item, key), false);
  assert.deepEqual(item.effects, [{op:'addItem', key:'flashlight'}]);
  const sequence = {cards:[{id:'story', choices:[{id:'choice', costs:[{source:'inventory', key:'key', amount:9}]}]}],
    items:[{id:'key', quantity:2, use:{}, remainingTriggers:2}]};
  const compiled = {initialValues: expectedValues, nodes:[{type:'legacySequence', sequence, connections:structuredClone(expectedConnections)}, {type:'legacyPool', sequences:[structuredClone(sequence)], connections:structuredClone(expectedConnections)}]};
  normalizeSingleItems(compiled);
  for (const seq of [compiled.nodes[0].sequence, compiled.nodes[1].sequences[0]]) {
    assert.deepEqual(seq.items, [{id:'key'}]);
    assert.equal(seq.cards[0].choices[0].costs[0].amount, 1);
  }
  assert.deepEqual(compiled.initialValues, expectedValues);
  for (const node of compiled.nodes) assert.deepEqual(node.connections, expectedConnections);
});

function availabilityProject(type, projectPolicy, flag) {
  const project = createProject(), chapter = project.chapters[0];
  project.unavailableActions = projectPolicy;
  if (flag !== undefined) project.ignoreAllOverrides = flag;
  const blocked = project.library.find(d => d.kind === 'action');
  blocked.conditions = [{source:'variable', key:'energy', op:'gte', value:99}];
  project.library.push(createDefinition('action', 'available'));
  const cards = [{id:'blocked', definitionId:blocked.id}, {id:'available', definitionId:'available'}];
  chapter.startNode = 'start';
  chapter.nodes = [{id:'start', name:'Start', type, x:0, y:0,
    unavailableActions:projectPolicy === 'hidden' ? 'disabled' : 'hidden',
    ...(type === 'fork' ? {choices:cards, connections:{blocked:null, available:null}} : {cards, connections:{next:null}})}];
  return project;
}

for (const type of ['fork', 'linear']) for (const policy of ['hidden', 'disabled']) for (const flag of [true, false, undefined]) {
  test(`${type} standalone chapter retains ${policy} playback with ignoreAllOverrides=${flag}`, () => {
    const project = availabilityProject(type, policy, flag), before = structuredClone(project);
    const pkg = exportStudioChapter(project), restored = parseProject(JSON.stringify(pkg));
    assert.equal(pkg.ignoreAllOverrides, flag);
    assert.equal(restored.ignoreAllOverrides, flag);
    const compiled = compileChapter(restored), original = compileChapter(project);
    assert.deepEqual(runtime(compiled), runtime(original));
    const effectiveHidden = flag === true ? policy === 'hidden' : policy !== 'hidden';
    const snapshot = runtime(compiled);
    if (type === 'fork') {
      assert.deepEqual(snapshot.actions, effectiveHidden
        ? [{id:'available', disabled:false}]
        : [{id:'blocked', disabled:true}, {id:'available', disabled:false}]);
    } else assert.equal(snapshot.cardId, effectiveHidden ? 'available' : 'blocked');
    assert.deepEqual(project, before);
  });
}

test('chapter imports keep destination project-wide playback policies including ignoreAllOverrides', () => {
  const source = availabilityProject('fork', 'hidden', true), pkg = exportChapter(source), before = structuredClone(pkg);
  for (const ignore of [true, false, undefined]) {
    const destination = createProject();
    destination.unavailableActions = 'disabled';
    if (ignore !== undefined) destination.ignoreAllOverrides = ignore;
    const original = structuredClone(destination), imported = importChapter(destination, pkg);
    assert.equal(imported.ignoreAllOverrides, ignore);
    assert.equal(imported.unavailableActions, 'disabled');
    assert.equal(imported.ownedItemsVisibility, destination.ownedItemsVisibility);
    assert.equal(compileChapter(imported).nodes[0].unavailableActions, ignore === true ? undefined : 'disabled');
    assert.deepEqual(destination, original);
  }
  assert.deepEqual(pkg, before);
});
