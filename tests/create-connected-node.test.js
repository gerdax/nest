import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, outputsForNode } from '../project/model.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { transactDocument } from '../studio/document-session.js';

function session(project = createProject()) {
  const history = new DocumentHistory(project), localDrafts = new LocalCardDrafts();
  const selection = Object.freeze({chapterId:project.activeChapterId, selected:'arrival'});
  const run = data => transactDocument(history, localDrafts,
    draft => applyDocumentCommand(draft, selection, 'create-connected-node', data, localDrafts));
  return {history, localDrafts, selection, run};
}

test('creating a connected beat adds its local definitions, wire and selection in one undo step', () => {
  const state = session(), before = state.history.document;
  const outcome = state.run({id:'arrival', exit:'next', type:'fork', position:{x:321, y:456}});
  assert.equal(outcome.failure, undefined);
  const after = outcome.project, chapter = after.chapters[0];
  const added = chapter.nodes.find(node => node.id === outcome.result.selection.selected);
  assert.equal(added.type, 'fork');
  assert.equal(added.x, 321);
  assert.equal(added.y, 456);
  assert.equal(chapter.nodes.length, before.chapters[0].nodes.length + 1);
  assert.equal(chapter.nodes[0].connections.next, added.id);
  assert.equal(after.library.length, before.library.length + 3);
  for (const placement of [added.intro, ...added.choices]) {
    assert.equal(after.library.find(card => card.id === placement.definitionId).visibility, 'local');
  }
  assert.deepEqual(Object.keys(added.connections), outputsForNode(after, added));
  assert.deepEqual(state.selection, {chapterId:before.activeChapterId, selected:'arrival'});
  assert.equal(state.history.undo(), true);
  assert.deepEqual(state.history.document, before);
  assert.equal(state.history.canUndo, false);
  assert.equal(state.history.redo(), true);
  assert.deepEqual(state.history.document, after);
  assert.equal(state.history.canRedo, false);
});

for (const [label, id, exit, check] of [
  ['random route', 'encounter', 'quiet', false],
  ['random fallback', 'encounter', 'fallback', false],
  ['fork direct', 'route', 'explore-choice', false],
  ['fork check success', 'route', 'explore-choice:success', true],
  ['fork check failure', 'route', 'explore-choice:failure', true],
]) {
  test(`create-and-connect resolves the actual ${label} output`, () => {
    const project = createProject();
    if (check) project.library.find(card => card.id === 'explore').resolution = 'check';
    const state = session(project), outcome = state.run({id, exit, type:'linear'});
    assert.equal(outcome.failure, undefined);
    const source = outcome.project.chapters[0].nodes.find(node => node.id === id);
    const target = outcome.result.selection.selected;
    assert.equal(source.type === 'random'
      ? exit === 'fallback' ? source.fallback : source.routes.find(route => route.id === exit).target
      : source.connections[exit], target);
    assert.equal(outcome.project.chapters[0].nodes.at(-1).id, target);
    assert.equal(state.history.undo(), true);
    assert.deepEqual(state.history.document, project);
    assert.equal(state.history.canUndo, false);
  });
}

for (const [label, id, exit, check, type = 'fork'] of [
  ['deleted source', 'deleted', 'next', false],
  ['source in another chapter', 'other-node', 'next', false],
  ['linear invalid output', 'arrival', 'invented', false],
  ['removed random route', 'encounter', 'removed-route', false],
  ['random invalid next', 'encounter', 'next', false],
  ['removed fork choice', 'route', 'removed-choice', false],
  ['stale direct fork output', 'route', 'explore-choice', true],
  ['stale check fork output', 'route', 'explore-choice:failure', false],
  ['unknown node type', 'arrival', 'next', false, 'unknown'],
]) {
  test(`create-and-connect rejects ${label} without changing document or history`, () => {
    const project = createProject();
    project.chapters.push({id:'other', name:'Other', startNode:'other-node', nodes:[
      {id:'other-node', type:'linear', cards:[], connections:{next:false}},
    ]});
    if (check) project.library.find(card => card.id === 'explore').resolution = 'check';
    const state = session(project);
    // Keep a redo entry so failures must preserve both history stacks.
    state.history.transact(draft => { draft.name = 'Later'; });
    state.history.undo();
    const before = state.history.document;
    const outcome = state.run({id, exit, type});
    assert.equal(typeof outcome.failure, 'string');
    assert.equal(outcome.result, undefined);
    assert.deepEqual(outcome.project, before);
    assert.deepEqual(state.history.document, before);
    assert.equal(state.history.canUndo, false);
    assert.equal(state.history.canRedo, true);
    state.history.redo();
    assert.equal(state.history.document.name, 'Later');
  });
}

test('failed transaction finalization rolls back the new beat, definitions, wire and selection', () => {
  const state = session(), before = state.history.document;
  state.localDrafts.refreshChangedDefinitions = () => { throw new Error('Refresh failed'); };
  const outcome = state.run({id:'arrival', exit:'next', type:'container'});
  assert.equal(outcome.failure, 'Refresh failed');
  assert.equal(outcome.result, undefined);
  assert.deepEqual(outcome.project, before);
  assert.equal(state.history.canUndo, false);
  assert.equal(state.history.canRedo, false);
});
