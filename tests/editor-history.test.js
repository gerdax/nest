import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { createStarterChapter } from '../chapter/model.js';

test('transactions isolate input, returned snapshots and retained edit drafts', () => {
  const source = createStarterChapter();
  const originalName = source.name;
  const history = new DocumentHistory(source);
  source.name = 'external';
  history.document.name = 'snapshot';
  assert.equal(history.document.name, originalName);
  let retained;
  history.transact(draft => { retained = draft; draft.name = 'edited'; });
  retained.name = 'later mutation';
  assert.equal(history.document.name, 'edited');
  history.undo();
  assert.equal(history.document.name, originalName);
  history.redo();
  assert.equal(history.document.name, 'edited');
});

test('failed and no-op edits preserve document and redo; divergent edits clear redo', () => {
  const history = new DocumentHistory(createStarterChapter());
  history.transact(draft => { draft.name = 'second'; });
  history.undo();
  const before = history.document;
  assert.throws(() => history.transact(draft => { draft.nodes = []; throw new Error('failed'); }), /failed/);
  assert.deepEqual(history.document, before);
  assert.equal(history.transact(() => {}), false);
  assert.equal(history.canRedo, true);
  history.transact(draft => { draft.name = 'branch'; });
  assert.equal(history.canRedo, false);
  history.undo();
  assert.deepEqual(history.document, before);
});

test('history allows incomplete drafts and replacement imports, with one shared cap', () => {
  const history = new DocumentHistory(createStarterChapter(), { limit: 2 });
  history.transact(draft => { draft.nodes = []; });
  assert.deepEqual(history.document.nodes, []);
  const replacement = createStarterChapter(); replacement.name = 'import';
  history.transact(() => replacement);
  replacement.name = 'external change';
  history.transact(draft => { draft.nodes[0].x += 10; });
  assert.equal(history.undo(), true);
  assert.equal(history.document.name, 'import');
  assert.equal(history.undo(), true);
  assert.deepEqual(history.document.nodes, []);
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), true);
  assert.equal(history.redo(), true);
  assert.equal(history.redo(), false);
});

test('discarding a gesture draft preserves committed coordinates and redo', () => {
  const history = new DocumentHistory(createStarterChapter());
  history.transact(draft => { draft.name = 'edit'; }); history.undo();
  const before = history.document;
  const drag = history.document;
  drag.nodes[0].x += 50;
  assert.deepEqual(history.document, before);
  assert.equal(history.canRedo, true);
  history.transact(draft => { draft.nodes[0].x = drag.nodes[0].x; });
  assert.equal(history.canRedo, false);
  history.undo();
  assert.deepEqual(history.document, before);
});

test('default history cap retains exactly 80 complete snapshots through undo and redo', () => {
  const history = new DocumentHistory({ index: 0, nested: { values: [0] } });
  for (let index = 1; index <= 85; index++) {
    assert.equal(history.transact(draft => {
      draft.index = index;
      draft.nested.values = [index, { value: index }];
    }), true);
  }
  for (let index = 84; index >= 5; index--) {
    assert.equal(history.undo(), true);
    assert.deepEqual(history.document, { index, nested: { values: [index, { value: index }] } });
  }
  assert.equal(history.undo(), false);
  for (let index = 6; index <= 85; index++) {
    assert.equal(history.redo(), true);
    assert.deepEqual(history.document, { index, nested: { values: [index, { value: index }] } });
  }
  assert.equal(history.redo(), false);
  history.transact(draft => { draft.index = 86; });
  for (let count = 0; count < 80; count++) assert.equal(history.undo(), true);
  assert.equal(history.document.index, 6);
  assert.equal(history.undo(), false);
});

test('snapshots preserve JSON clone semantics and call user toJSON only once', () => {
  let calls = 0;
  const source = { toJSON() {
    calls++;
    return { calls, date: new Date('2020-01-02T00:00:00Z'), omitted: undefined,
      fn: () => {}, symbol: Symbol('ignored'), values: [undefined, () => {}, NaN, Infinity, -0] };
  } };
  const history = new DocumentHistory(source);
  const expected = { calls: 1, date: '2020-01-02T00:00:00.000Z', values: [null, null, null, null, 0] };
  assert.deepEqual(history.document, expected);
  assert.equal(calls, 1);
  const replacement = { toJSON() { calls++; return { calls, value: 'import' }; } };
  assert.equal(history.transact(() => replacement), true);
  assert.equal(calls, 2);
  assert.deepEqual(history.document, { calls: 2, value: 'import' });
  replacement.toJSON = () => ({ changed: true });
  history.undo();
  assert.deepEqual(history.document, expected);
  history.redo();
  assert.deepEqual(history.document, { calls: 2, value: 'import' });
  assert.equal(calls, 2);
});

test('integer keys normalize before no-op comparison and preserve redo', () => {
  const original = { 1: 'one', 2: 'two', name: 'before' };
  const reordered = new Proxy(original, { ownKeys() { return ['2', '1', 'name']; } });
  const history = new DocumentHistory(reordered);
  history.transact(draft => { draft.name = 'after'; });
  history.undo();
  assert.equal(history.transact(() => reordered), false);
  assert.equal(history.canRedo, true);
  assert.equal(JSON.stringify(history.document), JSON.stringify(original));
});

test('serialization failures roll back document and both history stacks', () => {
  const history = new DocumentHistory({ value: 0 });
  history.transact(draft => { draft.value = 1; });
  history.transact(draft => { draft.value = 2; });
  history.undo();
  const cyclic = {}; cyclic.self = cyclic;
  const failures = [
    () => cyclic,
    draft => { draft.value = 1n; },
    () => ({ toJSON() { throw new Error('serialization failed'); } }),
    () => ({ toJSON() { return undefined; } }),
    () => (() => {}),
    () => Symbol('unsupported'),
  ];
  for (const edit of failures) {
    assert.throws(() => history.transact(edit));
    assert.deepEqual(history.document, { value: 1 });
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, true);
  }
  assert.equal(history.undo(), true);
  assert.deepEqual(history.document, { value: 0 });
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), true);
  assert.equal(history.redo(), true);
  assert.deepEqual(history.document, { value: 2 });
});

test('constructor rejects unsupported JSON roots and invalid history limits', () => {
  for (const value of [undefined, () => {}, Symbol('unsupported'), 1n]) {
    assert.throws(() => new DocumentHistory(value));
  }
  for (const limit of [0, -1, 1.5, NaN, '80']) {
    assert.throws(() => new DocumentHistory({}, { limit }), RangeError);
  }
});

test('primitive and null documents retain replacement and nullish fallback behavior', () => {
  const history = new DocumentHistory(null);
  assert.equal(history.transact(() => undefined), false);
  assert.equal(history.transact(() => 3), true);
  assert.equal(history.document, 3);
  assert.equal(history.transact(() => null), false);
  assert.equal(history.transact(() => false), true);
  assert.equal(history.document, false);
  history.undo();
  assert.equal(history.document, 3);
  history.undo();
  assert.equal(history.document, null);
});

test('raw JSON values normalize to the same snapshots as JSON clones', {
  skip: typeof JSON.rawJSON !== 'function',
}, () => {
  const history = new DocumentHistory({ value: JSON.rawJSON('1e2') });
  assert.deepEqual(history.document, { value: 100 });
  history.transact(draft => { draft.value = 200; });
  history.undo();
  assert.equal(history.transact(() => ({ value: JSON.rawJSON('100.0') })), false);
  assert.equal(history.canRedo, true);
});

test('archived snapshots preserve Unicode keys, emoji and lone surrogates exactly', () => {
  const snapshots = [
    { '\uFEFFkey': 'Zażółć gęślą jaźń — 中文 😀', lone: '\uD800', values: ['\uDC00', '\uD800\uDC00'] },
    { '😀': '𝄞 café — Καλημέρα', lone: '\uDC00', values: ['\uD800', '\uDFFF'] },
    { '中文': '\uFEFFtext\u0000\n', lone: '\uD800tail', values: ['head\uDC00', '😀'] },
  ];
  const history = new DocumentHistory(snapshots[0]);
  for (const snapshot of snapshots.slice(1)) history.transact(() => snapshot);
  for (let pass = 0; pass < 3; pass++) {
    for (let index = snapshots.length - 2; index >= 0; index--) {
      assert.equal(history.undo(), true);
      assert.deepEqual(history.document, snapshots[index]);
      assert.equal(JSON.stringify(history.document), JSON.stringify(snapshots[index]));
    }
    assert.equal(history.undo(), false);
    for (let index = 1; index < snapshots.length; index++) {
      assert.equal(history.redo(), true);
      assert.deepEqual(history.document, snapshots[index]);
      assert.equal(JSON.stringify(history.document), JSON.stringify(snapshots[index]));
    }
    assert.equal(history.redo(), false);
  }
});
