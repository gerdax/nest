import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocalOwnership } from '../project/local-ownership.js';

const local = (id, extras = {}) => ({id, kind: 'event', visibility: 'local', ...extras});
const chapter = (id, references = [], variables = []) => ({id, variables, nodes: [{id: `${id}-node`, cards: references.map(definitionId => ({definitionId}))}]});
const project = (library, chapters) => ({library, chapters, variables: [], activeChapterId: chapters[0]?.id});
const placement = (p, index) => p.chapters[index].nodes[0].cards[0];
const definition = (p, id) => p.library.find(d => d.id === id);

function idempotent(p) {
  const before = structuredClone(p);
  assert.equal(normalizeLocalOwnership(p), p);
  assert.deepEqual(p, before);
}

test('legacy local definitions get an owner and foreign uses get detached copies with collision-safe IDs', () => {
  const p = project([local('draft'), {id: 'draft-b', visibility: 'shared'}], [chapter('a', ['draft']), chapter('b', ['draft'])]);
  assert.equal(normalizeLocalOwnership(p), p);
  assert.equal(definition(p, 'draft').chapterId, 'a');
  const id = placement(p, 1).definitionId;
  assert.equal(id, 'draft-b-2');
  assert.equal(definition(p, id).chapterId, 'b');
  definition(p, id).name = 'Changed';
  assert.equal(definition(p, 'draft').name, undefined);
  idempotent(p);
});

test('clones cyclic local dependency graphs and inventory/context references together', () => {
  const p = project([
    local('action', {kind: 'action', contextItemId: 'item', effects: [{op: 'addItem', key: 'item'}], link: {definitionId: 'nested'}}),
    local('item', {kind: 'item', inventoryKey: 'bag', conditions: [{source: 'inventory', key: 'bag', op: 'has'}], link: {definitionId: 'action'}}),
    local('second', {kind: 'item', inventoryKey: 'bag'}),
    local('nested', {effects: [{op: 'removeItem', key: 'second'}]}),
  ], [chapter('a', ['action']), chapter('b', ['action'])]);
  placement(p, 1).contextItemId = 'item';
  p.chapters[1].nodes[0].costs = [{source: 'inventory', key: 'bag', amount: 1}];
  normalizeLocalOwnership(p);
  const action = definition(p, placement(p, 1).definitionId);
  const item = definition(p, action.contextItemId);
  const nested = definition(p, action.link.definitionId);
  const second = definition(p, nested.effects[0].key);
  assert.equal(item.chapterId, 'b');
  assert.equal(action.effects[0].key, item.id);
  assert.equal(item.link.definitionId, action.id);
  assert.equal(placement(p, 1).contextItemId, item.id);
  assert.notEqual(item.inventoryKey, 'bag');
  assert.equal(second.inventoryKey, item.inventoryKey);
  assert.equal(item.conditions[0].key, item.inventoryKey);
  assert.equal(p.chapters[1].nodes[0].costs[0].key, item.inventoryKey);
  assert.equal(definition(p, 'item').inventoryKey, 'bag');
  idempotent(p);
});

test('promotes transitive local dependencies of shared roots without dropping drafts', () => {
  const p = project([
    {id: 'shared', kind: 'action', effects: [{op: 'addItem', key: 'bag'}]},
    local('item', {kind: 'item', inventoryKey: 'bag', chapterId: 'a', link: {definitionId: 'nested'}}),
    local('nested', {link: {definitionId: 'item'}}), local('orphan'),
  ], [chapter('a'), chapter('b', ['item'])]);
  normalizeLocalOwnership(p);
  assert.equal(p.library.length, 4);
  for (const id of ['item', 'nested']) {
    assert.equal(definition(p, id).visibility, 'shared');
    assert.equal(Object.hasOwn(definition(p, id), 'chapterId'), false);
  }
  assert.equal(definition(p, 'orphan').visibility, 'local');
  idempotent(p);
});

test('unplaced drafts infer transitive chapter variables, then active or first chapter', () => {
  const p = project([
    local('draft', {link: {definitionId: 'rule'}}),
    local('rule', {check: {modifierVariable: 'score'}}),
    local('fallback'), local('explicit', {chapterId: 'a', conditions: [{source: 'variable', key: 'score'}]}),
  ], [chapter('a'), chapter('b', [], [{id: 'score'}])]);
  normalizeLocalOwnership(p);
  assert.equal(definition(p, 'draft').chapterId, 'b');
  assert.equal(definition(p, 'rule').chapterId, 'b');
  assert.equal(definition(p, 'fallback').chapterId, 'a');
  assert.equal(definition(p, 'explicit').chapterId, 'a');
  idempotent(p);
  const active = project([local('draft')], [chapter('a'), chapter('b')]);
  active.activeChapterId = 'b';
  normalizeLocalOwnership(active);
  assert.equal(active.library[0].chapterId, 'b');
  const first = project([local('draft')], [chapter('a'), chapter('b')]);
  first.activeChapterId = 'missing';
  normalizeLocalOwnership(first);
  assert.equal(first.library[0].chapterId, 'a');
});

test('preserves explicit owner drafts and clones foreign uses; invalid authored owners remain invalid', () => {
  const p = project([local('owned', {chapterId: 'b'}), local('invalid', {chapterId: 'missing'}), local('empty', {chapterId: ''})], [chapter('a', ['owned', 'invalid', 'empty']), chapter('b')]);
  normalizeLocalOwnership(p);
  assert.equal(definition(p, 'owned').chapterId, 'b');
  assert.notEqual(placement(p, 0).definitionId, 'owned');
  assert.equal(definition(p, placement(p, 0).definitionId).chapterId, 'a');
  assert.equal(definition(p, 'invalid').chapterId, 'missing');
  assert.equal(definition(p, 'empty').chapterId, '');
  assert.equal(p.library.length, 4);
  idempotent(p);
});

test('orphan owner graphs also get detached dependencies', () => {
  const p = project([local('root', {chapterId: 'b', link: {definitionId: 'child'}}), local('child', {chapterId: 'a'})], [chapter('a'), chapter('b')]);
  normalizeLocalOwnership(p);
  const child = definition(p, definition(p, 'root').link.definitionId);
  assert.notEqual(child.id, 'child');
  assert.equal(child.chapterId, 'b');
  idempotent(p);
});

test('shared definitions cannot retain chapter ownership, even in chapterless drafts', () => {
  const p = project([{id: 'shared', visibility: 'shared', chapterId: 'a'}], []);
  normalizeLocalOwnership(p);
  assert.equal(Object.hasOwn(p.library[0], 'chapterId'), false);
});

test('handles malformed draft structures defensively for subsequent validation', () => {
  for (const p of [null, {}, {library: {}}, {library: [null, local('x')], chapters: [null, {id: 'a', nodes: {bad: true}}]}]) {
    assert.doesNotThrow(() => normalizeLocalOwnership(p));
  }
});
