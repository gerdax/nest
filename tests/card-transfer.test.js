import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, createChapter, outputsForNode} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createNode, synchronizeConnections} from '../studio/commands.js';
import {cardTransferSlot, transferCard} from '../studio/card-transfer.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';

function fixture(sourceType = 'linear', targetType = 'linear', kind = 'event') {
  const project = createProject(), chapter = project.chapters[0];
  const source = createNode(project, sourceType), target = createNode(project, targetType);
  chapter.nodes.push(source, target);
  const definition = {...createDefinition(kind, 'transfer-definition'), visibility:'local'};
  const placement = {id:'transfer-placement', definitionId:definition.id};
  project.library.push(definition);
  source[cardTransferSlot(source)] = [placement];
  return {project, chapter, source, target, definition, placement};
}
const request = ({source, target, placement}, extra = {}) => ({
  sourceNodeId:source.id, placementId:placement.id, targetNodeId:target.id, index:0, ...extra,
});

for (const [sourceType, targetType, kind] of [
  ['linear','fork','event'], ['fork','linear','caption'], ['linear','container','item'],
  ['container','linear','item'], ['fork','fork','action'],
]) test(`move ${kind} from ${sourceType} to ${targetType} preserves placement and definition identity`, () => {
  const f = fixture(sourceType, targetType, kind), count = f.project.library.length;
  assert.equal(transferCard(f.project, f.chapter, request(f)), f.placement);
  assert.equal(f.source[cardTransferSlot(f.source)].length, 0);
  assert.equal(f.target[cardTransferSlot(f.target)][0], f.placement);
  assert.equal(f.project.library.length, count);
  assert.equal(f.placement.definitionId, f.definition.id);
});

for (const [gap, expected] of [[0,['b','a','c']], [1,['a','b','c']], [2,['a','b','c']], [3,['a','c','b']]]) {
  test(`same-slot move uses destination gap ${gap} and suppresses unchanged positions`, () => {
    const f = fixture(), cards = ['a','b','c'].map(id => ({...f.placement, id}));
    f.source.cards = cards;
    const result = transferCard(f.project, f.chapter, request(f, {placementId:'b', targetNodeId:f.source.id, index:gap}));
    assert.deepEqual(f.source.cards.map(card => card.id), expected);
    assert.equal(!!result, gap === 0 || gap === 3);
  });
}

test('Fork move carries check success/failure including explicit chapter ending and deletes stale source keys', () => {
  const f = fixture('fork','fork','action');
  f.definition.resolution = 'check';
  f.source.connections = {[`${f.placement.id}:success`]:'arrival', [`${f.placement.id}:failure`]:null, [f.placement.id]:'stale', keep:false};
  transferCard(f.project, f.chapter, request(f));
  assert.deepEqual(f.source.connections, {keep:false});
  assert.equal(f.target.connections[`${f.placement.id}:success`], 'arrival');
  assert.equal(f.target.connections[`${f.placement.id}:failure`], null);
  assert.equal(Object.hasOwn(f.target.connections, f.placement.id), false);
});

test('same-Fork reorder retains outgoing connections exactly', () => {
  const f = fixture('fork','fork','action');
  f.source.choices.push({...f.placement, id:'second'});
  f.source.connections = {[f.placement.id]:null, second:'arrival'};
  const before = structuredClone(f.source.connections);
  transferCard(f.project, f.chapter, request(f, {targetNodeId:f.source.id, index:2}));
  assert.deepEqual(f.source.connections, before);
});

for (const allowCycles of [false, true]) test(`Fork move handles a carried direct-self connection with allowCycles=${allowCycles}`, () => {
  const f = fixture('fork','fork','action');
  f.project.allowCycles = allowCycles;
  f.definition.resolution = 'check';
  f.source.connections = {[`${f.placement.id}:success`]:f.target.id, [`${f.placement.id}:failure`]:null};
  transferCard(f.project, f.chapter, request(f));
  assert.equal(f.target.connections[`${f.placement.id}:success`], allowCycles ? f.target.id : false);
  assert.equal(f.target.connections[`${f.placement.id}:failure`], null);
  assert.deepEqual(f.source.connections, {});
});

test('leaving Fork clears outgoing keys and entering Fork creates unlinked outputs', () => {
  const f = fixture('fork','linear','action');
  f.definition.resolution = 'check';
  f.source.connections = {[`${f.placement.id}:success`]:'arrival', [`${f.placement.id}:failure`]:null};
  transferCard(f.project, f.chapter, request(f));
  assert.deepEqual(f.source.connections, {});
  transferCard(f.project, f.chapter, request(f, {sourceNodeId:f.target.id, targetNodeId:f.source.id}));
  assert.deepEqual(f.source.connections, {[`${f.placement.id}:success`]:false, [`${f.placement.id}:failure`]:false});
});

test('Alt copy creates independent local definitions and transitive inventory dependencies, with unlinked outputs', () => {
  const f = fixture('fork','fork','action');
  const item = {...createDefinition('item','local-item'), visibility:'local', inventoryKey:'old-key'};
  const nested = {...createDefinition('item','nested-item'), visibility:'local'};
  item.onCollect = [{op:'addItem', key:nested.id}, {op:'removeItem', key:item.inventoryKey}];
  f.project.library.push(item, nested);
  f.placement.contextItemId = item.id;
  f.placement.conditions = [{source:'inventory', key:item.inventoryKey, op:'has'}];
  f.definition.effects = [{op:'addItem', key:item.id}];
  f.definition.resolution = 'check';
  f.source.connections = {[`${f.placement.id}:success`]:'arrival', [`${f.placement.id}:failure`]:null};
  const before = structuredClone([f.source, f.definition, item, nested]);
  const copied = transferCard(f.project, f.chapter, request(f, {copy:true}));
  const copiedDefinition = f.project.library.find(d => d.id === copied.definitionId);
  const copiedItem = f.project.library.find(d => d.id === copied.contextItemId);
  assert.notEqual(copied.id, f.placement.id);
  assert.notEqual(copiedDefinition.id, f.definition.id);
  assert.notEqual(copiedItem.id, item.id);
  assert.equal(copiedItem.inventoryKey, undefined);
  assert.equal(copiedDefinition.effects[0].key, copiedItem.id);
  assert.equal(copied.conditions[0].key, copiedItem.id);
  assert.equal(copiedItem.onCollect[1].key, copiedItem.id);
  assert.notEqual(copiedItem.onCollect[0].key, nested.id);
  assert.ok(f.project.library.some(d => d.id === copiedItem.onCollect[0].key));
  assert.deepEqual([f.source, f.definition, item, nested], before);
  assert.ok(outputsForNode(f.project, {...f.target, choices:[copied]}).every(output => f.target.connections[output] === false));
});

test('copy retains shared references and local inventory identities required by shared rules', () => {
  const f = fixture('fork','fork','action');
  f.definition.visibility = 'shared';
  const item = {...createDefinition('item','global-local-item'), visibility:'local', inventoryKey:'inventory-alias'};
  f.project.library.push(item);
  f.definition.conditions = [{source:'inventory', key:item.inventoryKey, op:'has'}];
  f.placement.contextItemId = item.id;
  const count = f.project.library.length;
  const copy = transferCard(f.project, f.chapter, request(f, {copy:true}));
  assert.equal(copy.definitionId, f.definition.id);
  assert.equal(copy.contextItemId, item.id);
  assert.equal(f.project.library.length, count);
});

test('same-slot copy inserts at the original gap without removing or adjusting source', () => {
  const f = fixture();
  f.source.cards.push({...f.placement, id:'second'});
  const copied = transferCard(f.project, f.chapter, request(f, {targetNodeId:f.source.id, index:1, copy:true}));
  assert.deepEqual(f.source.cards.map(p => p.id), [f.placement.id, copied.id, 'second']);
  assert.notEqual(copied.definitionId, f.placement.definitionId);
});

test('invalid drops leave the complete project unchanged, including copy dependencies', () => {
  const f = fixture('fork','container','event');
  const random = createNode(f.project, 'random'), legacy = {id:'legacy', type:'legacySequence', cards:[f.placement]};
  f.chapter.nodes.push(random, legacy);
  const other = createChapter('other');
  const otherNode = createNode(f.project, 'linear');
  other.nodes.push(otherNode); f.project.chapters.push(other);
  for (const extra of [
    {}, {targetNodeId:random.id}, {sourceNodeId:random.id}, {targetNodeId:legacy.id},
    {sourceNodeId:legacy.id}, {targetNodeId:otherNode.id}, {sourceNodeId:otherNode.id},
    {sourceNodeId:'missing'}, {placementId:'missing'}, {placementId:f.source.intro.id},
    {index:-1}, {index:100}, {index:0.5}, {index:NaN}, {index:undefined},
  ]) {
    const before = structuredClone(f.project);
    assert.equal(transferCard(f.project, f.chapter, request(f, {...extra, copy:true})), null);
    assert.deepEqual(f.project, before);
  }
  assert.equal(transferCard(f.project, {...f.chapter}, request(f)), null);
});

test('missing definitions are rejected before mutation', () => {
  const f = fixture(); f.placement.definitionId = 'missing';
  const before = structuredClone(f.project);
  assert.equal(transferCard(f.project, f.chapter, request(f)), null);
  assert.deepEqual(f.project, before);
});

for (const [sourceType, targetType, kind] of [
  ['linear','fork','item'], ['linear','container','action'], ['linear','container','caption'],
  ['container','fork','item'],
]) test(`incompatible ${kind} drop from ${sourceType} to ${targetType} does not mutate`, () => {
  const f = fixture(sourceType, targetType, kind), before = structuredClone(f.project);
  assert.equal(transferCard(f.project, f.chapter, request(f)), null);
  assert.equal(transferCard(f.project, f.chapter, request(f, {copy:true})), null);
  assert.deepEqual(f.project, before);
});

for (const copy of [false, true]) test(`transfer-card command is one undoable transaction (copy=${copy})`, () => {
  const f = fixture('fork','fork','action');
  f.source.connections = {[f.placement.id]:null};
  synchronizeConnections(f.project);
  const history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  const selection = {chapterId:f.chapter.id, selected:f.source.id, mode:'chapter'};
  const run = data => transactDocument(history, drafts, draft => applyDocumentCommand(draft, selection, 'transfer-card', data, drafts));
  const before = history.document;
  const {result, failure} = run(request(f, {copy}));
  assert.equal(failure, undefined);
  assert.deepEqual(result.selection, {selected:f.target.id, mode:'chapter'});
  assert.ok(result.value);
  const after = history.document;
  assert.equal(history.undo(), true);
  assert.deepEqual(history.document, before);
  const invalid = run(request(f, {targetNodeId:'missing', copy}));
  assert.deepEqual(invalid.result, {});
  assert.deepEqual(history.document, before);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(), true);
  assert.deepEqual(history.document, after);
});
