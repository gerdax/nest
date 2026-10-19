import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, exportChapter, validateProject, migrateChapter } from '../project/model.js';
import { createLegacyStarterChapter } from '../chapter/model.js';
import { createDefinition } from '../project/cards.js';
import { definitionGraph, definitionReferences, unusedLocalDefinitions, deleteDefinition, cleanupLocalDefinitions } from '../project/dependencies.js';
import { definitionInspector } from '../studio/inspectors.js';
import { makePlacement, replaceCard } from '../studio/commands.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';

test('compilation isolates nested checks, overrides, collection rules, conditions and effects in both directions', () => {
  const project = createProject(), action = project.library.find(d => d.kind === 'action'), item = project.library.find(d => d.kind === 'item');
  action.resolution = 'check';
  action.effects = [{ op: 'add', key: 'energy', value: 1 }];
  item.onCollect = [{ op: 'add', key: 'energy', value: 2 }];
  item.conditions = [{ source: 'inventory', key: item.id, op: 'has' }];
  const placement = project.chapters[0].nodes.find(n => n.type === 'fork').choices[0];
  placement.conditions = [{ source: 'variable', key: 'energy', op: 'gte', value: 1 }];
  placement.overrides = { check: { pool: [{ sides: 6, count: 1 }], modifier: 0, target: 4 } };
  const before = structuredClone(project), compiled = compileChapter(project);
  const choice = compiled.nodes.find(n => n.type === 'fork').choices[0], taken = compiled.nodes.find(n => n.type === 'container').items[0];
  choice.check.pool[0].count = 2; choice.conditions[0].value = 2; choice.effects[0].value = 9;
  taken.onCollect[0].value = 7; taken.conditions[0].op = 'missing';
  assert.deepEqual(project, before);
  placement.overrides.check.target = 100; action.effects[0].value = 12; item.onCollect[0].value = 15;
  assert.equal(choice.check.target, 4); assert.equal(choice.effects[0].value, 9); assert.equal(taken.onCollect[0].value, 7);
  const other = compileChapter(before); other.nodes[0].cards[0].effects.push({ op: 'add', key: 'energy', value: 1 });
  assert.deepEqual(before.chapters[0].nodes[0].cards[0].effects, undefined);
});

test('runtime normalization preserves source data, including legacy nested mechanics', () => {
  const project = migrateChapter(createLegacyStarterChapter());
  const item = project.library.find(d => d.kind === 'item');
  item.onCollect = [{ op: 'add', key: 'energy', value: 1, quantity: 7 }];
  const before = structuredClone(project);
  const compiled = compileChapter(project);
  assert.deepEqual(project, before);
  assert.equal(compiled.library.find(d => d.id === item.id).onCollect[0].quantity, undefined);
});

test('effect-only dependencies prevent deletion and appear in the shared definition inspector', () => {
  const project = createProject(); project.chapters[0].nodes.find(n => n.type === 'container').items = [];
  const arrival = project.library.find(d => d.id === 'arrival');
  arrival.effects = [{ op: 'addItem', key: 'flashlight' }];
  assert.deepEqual(validateProject(project), []);
  assert.equal(definitionReferences(project, 'flashlight').length, 1);
  const before = structuredClone(project);
  assert.throws(() => deleteDefinition(project, 'flashlight'), /gameplay rules/);
  assert.deepEqual(project, before);
  const html = definitionInspector(project, project.library.find(d => d.id === 'flashlight'));
  assert.match(html, /<h3>Referenced in<\/h3>/);
  assert.match(html, /data-command="edit-shared" data-definition="arrival"/);
  assert.match(html, /aria-label="E: Effects"/);
  assert.match(html, /data-command="delete-definition" disabled/);
});

test('inventory aliases, costs, conditions and legacy placements share export and usage tracking', () => {
  const project = migrateChapter(createLegacyStarterChapter()), item = project.library.find(d => d.kind === 'item');
  const action = project.library.find(d => d.kind === 'action');
  action.conditions = [{ source: 'inventory', key: item.inventoryKey, op: 'has' }];
  action.costs = [{ source: 'inventory', key: item.id, amount: 1 }];
  assert.ok(definitionReferences(project, item.id).some(ref => ref.kind === 'placement'));
  assert.equal(definitionReferences(project, item.id).filter(ref => ref.sourceDefinition === action).length, 2);
  assert.ok(exportChapter(project).library.some(d => d.id === item.id));
  assert.throws(() => deleteDefinition(project, item.id), /still used/);
});

test('local cleanup retains transitive dependencies of every chapter and shared definition', () => {
  const project = createProject(), chapter = project.chapters[0];
  const tool = { ...createDefinition('item', 'tool'), visibility: 'local', inventoryKey: 'old-tool' };
  const battery = { ...createDefinition('item', 'battery'), visibility: 'local' };
  tool.onCollect = [{ op: 'addItem', key: battery.id }];
  project.library.push(tool, battery);
  const placement = makePlacement(project, 'event'); chapter.nodes[0].cards.push(placement);
  project.library.find(d => d.id === placement.definitionId).effects = [{ op: 'addItem', key: tool.id }];
  const spare = { ...createDefinition('item', 'spare'), visibility: 'local' };
  project.library.push(spare);
  project.library.find(d => d.id === 'explore').conditions = [{ source: 'inventory', key: spare.id, op: 'missing' }];
  const orphan = makePlacement(project, 'event');
  assert.deepEqual(unusedLocalDefinitions(project).map(d => d.id), [orphan.definitionId]);
  const exported = exportChapter(project);
  for (const id of [tool.id, battery.id, spare.id]) assert.ok(exported.library.some(d => d.id === id), id);
  assert.equal(cleanupLocalDefinitions(project), 1);
  assert.deepEqual(validateProject(project), []);
});

test('cleanup removes unreachable local dependency cycles, preserves shared cards and is undoable', () => {
  const project = createProject();
  for (const [id, target] of [['orphan-a', 'orphan-b'], ['orphan-b', 'orphan-a']]) project.library.push({
    ...createDefinition('item', id), visibility: 'local', onCollect: [{ op: 'addItem', key: target }],
  });
  const unusedShared = createDefinition('item', 'unused-shared'); project.library.push(unusedShared);
  const before = structuredClone(project), history = new DocumentHistory(project);
  history.transact(draft => { assert.equal(cleanupLocalDefinitions(draft), 2); });
  assert.ok(history.document.library.some(d => d.id === unusedShared.id));
  assert.equal(history.document.library.some(d => d.id === 'orphan-a'), false);
  history.undo(); assert.deepEqual(history.document, before);
  history.redo(); assert.equal(history.document.library.some(d => d.id === 'orphan-b'), false);
  assert.equal(history.transact(draft => { cleanupLocalDefinitions(draft); }), false);
});

test('self-references do not block deletion of an otherwise unused definition', () => {
  const project = createProject(), item = { ...createDefinition('item', 'self'), visibility: 'shared' };
  item.conditions = [{ source: 'inventory', key: item.id, op: 'has' }];
  item.onCollect = [{ op: 'removeItem', key: item.id }];
  project.library.push(item);
  assert.deepEqual(definitionReferences(project, item.id), []);
  deleteDefinition(project, item.id);
  assert.equal(project.library.some(d => d.id === item.id), false);
});

test('replaced local definitions remain recoverable until explicit cleanup', () => {
  const project = createProject(), node = project.chapters[0].nodes[0], placement = makePlacement(project, 'event');
  node.cards.push(placement); const originalId = placement.definitionId;
  replaceCard(project, placement, 'event');
  assert.ok(project.library.some(d => d.id === originalId));
  assert.ok(unusedLocalDefinitions(project).some(d => d.id === originalId));
  assert.ok(definitionGraph(project).retained().has(placement.definitionId));
  assert.equal(cleanupLocalDefinitions(project), 1);
});


test('obsolete direct-use rules do not retain dependencies or block deletion', () => {
  const project = createProject(), item = project.library.find(d => d.kind === 'item');
  const obsolete = {...createDefinition('item', 'obsolete-use-only'), visibility:'local'};
  project.library.push(obsolete);
  item.use = {effects:[{op:'addItem',key:obsolete.id}]};
  const before = structuredClone(project);
  assert.deepEqual(definitionReferences(project, obsolete.id), []);
  assert.ok(unusedLocalDefinitions(project).some(d => d.id === obsolete.id));
  for (const output of [compileChapter(project), exportChapter(project)]) {
    assert.equal(output.library.some(d => d.id === obsolete.id), false);
    assert.equal(output.library.find(d => d.id === item.id).use, undefined);
  }
  assert.deepEqual(project, before);
  deleteDefinition(project, obsolete.id);
  assert.equal(project.library.some(d => d.id === obsolete.id), false);
});
