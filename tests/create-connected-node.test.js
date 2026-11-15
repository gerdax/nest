import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, outputsForNode } from '../project/model.js';
import { beatGroupFor, resolveBeatGroups } from '../project/beat-groups.js';
import { DocumentHistory } from '../studio/DocumentHistory.js';
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

function groupedProject(check = false) {
  const project = createProject(), chapter = project.chapters[0];
  if (check) {
    project.library.find(card => card.id === 'explore').resolution = 'check';
    chapter.nodes.find(node => node.id === 'route').connections = {
      'explore-choice:success':false, 'explore-choice:failure':false,
    };
  }
  chapter.beatGroups = [
    {id:'source-group', name:'Source', collapsed:false, memberIds:['route'],
      entryId:'route', incoming:[], outgoing:[], destination:false},
    {id:'destination-group', name:'Destination', collapsed:false, memberIds:['encounter'],
      entryId:'encounter', incoming:[], outgoing:[], destination:false},
  ];
  assert.deepEqual(resolveBeatGroups(project, chapter).issues, []);
  return project;
}

for (const [label, id, exit, groupId, check = false] of [
  ['grouped Fork direct output into the same group', 'route', 'explore-choice', 'source-group'],
  ['grouped Fork success output into the same group', 'route', 'explore-choice:success', 'source-group', true],
  ['grouped Fork failure output into the same group', 'route', 'explore-choice:failure', 'source-group', true],
  ['grouped source outside all groups with omitted destination', 'route', 'explore-choice', undefined],
  ['grouped source outside all groups with null destination', 'route', 'explore-choice', null],
  ['ungrouped source into an expanded group', 'arrival', 'next', 'destination-group'],
  ['grouped source into another expanded group', 'route', 'explore-choice', 'destination-group'],
]) {
  test(`create-and-connect places a beat from ${label} in one undo step`, () => {
    const project = groupedProject(check), state = session(project), before = state.history.document;
    const data = {id, exit, type:'fork', position:{x:654, y:321}};
    if (groupId !== undefined) data.groupId = groupId;
    const outcome = state.run(data);
    assert.equal(outcome.failure, undefined);
    const after = outcome.project, chapter = after.chapters[0];
    const added = chapter.nodes.find(node => node.id === outcome.result.selection.selected);
    assert.equal(added.type, 'fork');
    assert.equal(added.x, 654);
    assert.equal(added.y, 321);
    assert.equal(chapter.nodes.length, before.chapters[0].nodes.length + 1);
    assert.equal(chapter.nodes.find(node => node.id === id).connections[exit], added.id);
    assert.equal(beatGroupFor(chapter, added.id)?.id, groupId ?? undefined);
    for (const group of chapter.beatGroups) {
      const previous = before.chapters[0].beatGroups.find(candidate => candidate.id === group.id);
      assert.deepEqual(group.memberIds, group.id === groupId ? [...previous.memberIds, added.id] : previous.memberIds);
    }
    assert.equal(after.library.length, before.library.length + 3);
    for (const placement of [added.intro, ...added.choices]) {
      assert.equal(after.library.find(card => card.id === placement.definitionId).visibility, 'local');
    }
    assert.deepEqual(resolveBeatGroups(after, chapter).issues, []);
    assert.deepEqual(state.selection, {chapterId:before.activeChapterId, selected:'arrival'});
    assert.equal(state.history.undo(), true);
    assert.deepEqual(state.history.document, before);
    assert.equal(state.history.canUndo, false);
    assert.equal(state.history.redo(), true);
    assert.deepEqual(state.history.document, after);
    assert.equal(state.history.canRedo, false);
  });
}

for (const id of ['arrival', 'route']) {
  for (const destination of ['missing-group', 'collapsed-group']) {
    test(`create-and-connect rejects ${destination} from ${id} atomically`, () => {
      const project = groupedProject();
      if (destination === 'collapsed-group') project.chapters[0].beatGroups[1].collapsed = true;
      const state = session(project);
      state.history.transact(draft => { draft.name = 'Later'; });
      state.history.undo();
      const before = state.history.document;
      const outcome = state.run({id, exit:id === 'route' ? 'explore-choice' : 'next', type:'fork',
        groupId:destination === 'collapsed-group' ? 'destination-group' : destination});
      assert.equal(typeof outcome.failure, 'string');
      assert.equal(outcome.result, undefined);
      assert.deepEqual(outcome.project, before);
      assert.deepEqual(state.history.document, before);
      assert.deepEqual(state.selection, {chapterId:before.activeChapterId, selected:'arrival'});
      assert.equal(state.history.canUndo, false);
      assert.equal(state.history.canRedo, true);
      assert.equal(state.history.redo(), true);
      assert.equal(state.history.document.name, 'Later');
    });
  }
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
