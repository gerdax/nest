import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryIndex } from '../project/library-index.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { createProject } from '../project/model-data.js';
import { compileChapter } from '../project/compilation.js';
import { discardPlacementContext } from '../project/normalization.js';
import { validateProject } from '../project/validation.js';
import { outputsForNode, labelForOutput } from '../project/graph.js';

const placement = (definitionId, extra = {}) => ({id: 'placed', definitionId, ...extra});
const definition = (kind, id, extra = {}) => ({...createDefinition(kind, id), ...extra});

test('Library index retains first definitions and first matching contextual Items', () => {
  const action = definition('action', 'shared-id');
  const item = definition('item', 'shared-id', {inventoryKey: 'inventory-id', image: 'first.png'});
  const project = {library: [action, definition('event', 'shared-id'), item,
    definition('item', 'shared-id', {image: 'later.png'})]};
  const index = createLibraryIndex(project.library);
  assert.equal(index.byId.get('shared-id'), action);
  assert.equal(index.itemsById.get('shared-id'), item);
  const p = placement('shared-id', {contextItemId: 'shared-id', contextOverrideImage: true});
  assert.deepEqual(resolvePlacement(project, p, index), resolvePlacement(project, p));
  assert.equal(resolvePlacement(project, p, index).image, 'first.png');
  assert.equal(resolvePlacement(project, p, index).contextInventoryKey, 'inventory-id');
});

test('indexed resolution preserves missing-reference and contextual-choice errors', () => {
  const project = {library: [definition('action', 'action'), definition('event', 'event')]};
  const index = createLibraryIndex(project.library);
  for (const p of [placement('missing'), placement('action', {contextItemId: 'missing'}),
    placement('event', {contextItemId: 'event'})]) {
    let expected;
    try { resolvePlacement(project, p); } catch (error) { expected = error; }
    assert.throws(() => resolvePlacement(project, p, index), {name: expected.name, message: expected.message});
  }
});

test('index observes live mechanics and artwork while a new operation observes replacements', () => {
  const action = definition('action', 'action'), item = definition('item', 'item');
  const project = {library: [action, item]};
  const index = createLibraryIndex(project.library);
  const p = placement('action', {contextItemId: 'item', contextOverrideImage: true});
  action.effects.push({op: 'add', key: 'energy', value: 1});
  item.image = 'changed.png';
  assert.deepEqual(resolvePlacement(project, p, index), resolvePlacement(project, p));
  project.library = [definition('action', 'action', {name: 'Replacement'}), item];
  assert.equal(resolvePlacement(project, p, createLibraryIndex(project.library)).name, 'Replacement');
});

test('malformed Library entries preserve short-circuit success and scan errors', () => {
  for (const library of [[definition('action', 'action'), definition('item', 'item'), null],
    [definition('action', 'action'), null, definition('item', 'item')]]) {
    const project = {library}, index = createLibraryIndex(library);
    assert.deepEqual(resolvePlacement(project, placement('action'), index), resolvePlacement(project, placement('action')));
    const p = placement('action', {contextItemId: 'item'});
    if (library[1] === null) assert.throws(() => resolvePlacement(project, p, index), TypeError);
    else assert.deepEqual(resolvePlacement(project, p, index), resolvePlacement(project, p));
  }
  const project = {library: [definition('action', NaN, {resolution: 'check'})]};
  const index = createLibraryIndex(project.library);
  assert.equal(index.byId.has(NaN), false);
  assert.throws(() => resolvePlacement(project, placement(NaN), index), /Unknown definition/);
  const node = {type: 'fork', choices: [placement(NaN)]};
  assert.deepEqual(outputsForNode(project, node, index), outputsForNode(project, node));
  assert.equal(labelForOutput(project, node, 'placed', index), labelForOutput(project, node, 'placed'));
  assert.equal(labelForOutput(project, node, 'placed', index), 'placed');
  const itemIndex = createLibraryIndex([definition('item', NaN)]);
  assert.equal(itemIndex.itemsById.has(NaN), false);
});

test('normalization and compilation index isolated local rules and shared overrides', () => {
  const project = createProject();
  const local = definition('action', 'local', {visibility: 'local'});
  const shared = definition('action', 'shared', {visibility: 'shared'});
  project.library.push(local, shared);
  const effect = value => ({op: 'add', key: 'energy', value});
  project.chapters[0].nodes = [{id: 'fork', type: 'fork', choices: [
    placement('local', {id: 'one', effects: [effect(1)], overrides: {resolution: 'check'}}),
    placement('local', {id: 'two', effects: [effect(2)]}),
    placement('shared', {id: 'shared-one', effects: [effect(3)]}),
    placement('shared', {id: 'shared-two', effects: [effect(4)]}),
  ], connections: {one: null, two: null, 'shared-one': null, 'shared-two': null}}];
  const before = structuredClone(project), compiled = compileChapter(project);
  assert.deepEqual(project, before);
  assert.deepEqual(compiled.nodes[0].choices.map(p => p.effects), [
    [effect(1)], [effect(2)], [effect(3)], [effect(4)],
  ]);
  assert.deepEqual(Object.keys(compiled.nodes[0].connections), ['one', 'two', 'shared-one', 'shared-two']);
  compiled.nodes[0].choices[0].effects[0].value = 99;
  assert.deepEqual(project, before);
  const normalized = discardPlacementContext(structuredClone(project));
  assert.deepEqual(normalized.library.find(d => d.id === 'local').effects, []);
  const index = createLibraryIndex(normalized.library);
  assert.deepEqual(normalized.chapters[0].nodes[0].choices.map(p => resolvePlacement(normalized, p, index).effects), [
    [effect(1)], [effect(2)], [effect(3)], [effect(4)],
  ]);
  assert.deepEqual(normalized.library.find(d => d.id === 'shared').effects, []);
});

// Observe Library arrays only: unrelated chapter/choice finds are outside scope.
function libraryFindsDuring(run) {
  const original = Array.prototype.find;
  let count = 0;
  Array.prototype.find = function (...args) {
    if (this[0]?.kind === 'event' && this[0]?.id === 'arrival') count++;
    return Reflect.apply(original, this, args);
  };
  try { run(); } finally { Array.prototype.find = original; }
  return count;
}

test('bulk normalization, validation, compilation and indexed graph helpers avoid per-placement Library finds', () => {
  const project = createProject(), node = project.chapters[0].nodes.find(n => n.type === 'fork');
  node.choices = Array.from({length: 100}, (_, i) => placement('explore', {id: `choice-${i}`, contextItemId: 'flashlight'}));
  node.connections = Object.fromEntries(node.choices.map(p => [p.id, null]));
  project.chapters[0].nodes.push({id: 'legacy', name: 'Legacy', type: 'legacySequence', x: 0, y: 0,
    connections: {next: null}, sequence: {id: 'sequence', type: 'linear', exits: ['next'],
      cards: [{id: 'legacy-card', definitionId: 'arrival', title: '', text: '', image: '', choices: []}]}});
  assert.equal(libraryFindsDuring(() => resolvePlacement(project, node.choices[0])), 2);
  const index = createLibraryIndex(project.library);
  assert.equal(libraryFindsDuring(() => {
    discardPlacementContext(project, index);
    assert.deepEqual(validateProject(project), []);
    const compiled = compileChapter(project);
    assert.equal(compiled.nodes.find(n => n.id === node.id).choices.length, 100);
    assert.equal(compiled.nodes.find(n => n.id === 'legacy').sequence.cards[0].name, 'Arrival');
    assert.equal(outputsForNode(project, node, index).length, 100);
    assert.equal(labelForOutput(project, node, 'choice-0', index), 'Explore');
  }), 0);
});

test('validation keeps last-match kind checks and first-match resolved mechanics for duplicate IDs', () => {
  const project = createProject();
  const first = project.library.find(d => d.id === 'explore');
  first.effects = [{op: 'set', key: 'missing', value: 1}];
  project.library.push(definition('item', 'explore'));
  const errors = validateProject(project).map(error => error.message);
  assert.deepEqual(errors, [
    'Duplicate Definition ID: explore.',
    'Definition explore: invalid variable effect.',
    'Beat route: incompatible card kind.',
    'Beat route: invalid variable effect.',
  ]);
});
