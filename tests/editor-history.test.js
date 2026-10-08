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
