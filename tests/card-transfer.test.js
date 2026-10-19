import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, createChapter, outputsForNode} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createNode, synchronizeConnections} from '../studio/commands.js';
import {cardTransferSlot, transferCard} from '../studio/card-transfer.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {normalizeLocalOwnership} from '../project/local-ownership.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';
import {validateProject} from '../project/validation.js';

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
  normalizeLocalOwnership(f.project);
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

for (const [from, to] of [[0,2], [2,0], [1,2], [2,1]]) {
  test(`same-node replacement ${from} -> ${to} removes the displaced card without index drift`, () => {
    const f = fixture();
    const cards = ['a','b','c'].map(id => ({...f.placement, id}));
    f.source.cards = [...cards];
    const moved = transferCard(f.project, f.chapter, request(f, {
      placementId:cards[from].id, targetNodeId:f.source.id, targetPlacementId:cards[to].id,
    }));
    assert.equal(moved, cards[from]);
    assert.deepEqual(f.source.cards, cards.map((card, i) => i === to ? cards[from] : card).filter((_, i) => i !== from));
  });
}

for (const copy of [false, true]) test(`dropping a card onto itself is unchanged (copy=${copy})`, () => {
  const f = fixture(), before = structuredClone(f.project);
  assert.equal(transferCard(f.project, f.chapter, request(f, {
    targetNodeId:f.source.id, targetPlacementId:f.placement.id, copy,
  })), null);
  assert.deepEqual(f.project, before);
});

for (const kind of ['event', 'caption']) for (const type of ['fork','container']) {
  test(`${kind} replaces ${type} introduction as a slot and enables it`, () => {
    const f = fixture('linear', type, kind), displaced = f.target.intro;
    assert.equal(transferCard(f.project, f.chapter, request(f, {targetPlacementId:displaced.id, index:undefined})), f.placement);
    assert.equal(f.target.intro, f.placement);
    assert.equal(f.target.introEnabled, true);
    assert.equal(f.definition.kind, kind);
    assert.deepEqual(f.source.cards, []);
    assert.equal(f.target[cardTransferSlot(f.target)].some(p => p.id === displaced.id), false);
  });
}

for (const copy of [false,true]) test(`incompatible introduction replacement has no mutations (copy=${copy})`, () => {
  const f = fixture('linear','fork','action'), before = structuredClone(f.project);
  assert.equal(transferCard(f.project, f.chapter, request(f, {targetPlacementId:f.target.intro.id, copy})), null);
  assert.deepEqual(f.project, before);
});

test('unknown replacement id rejects before copy preparation', () => {
  const f = fixture(), before = structuredClone(f.project);
  assert.equal(transferCard(f.project, f.chapter, request(f, {targetPlacementId:'missing', copy:true})), null);
  assert.deepEqual(f.project, before);
});

for (const copy of [false,true]) for (const replace of [false,true]) {
  test(`introduction transfers to an array (copy=${copy}, replacement=${replace})`, () => {
    const f = fixture('fork','linear','event'), intro = f.source.intro;
    f.source.introEnabled = true;
    const targetCard = f.target.cards[0];
    const moved = transferCard(f.project, f.chapter, request(f, {
      placementId:intro.id, copy, ...(replace ? {targetPlacementId:targetCard.id} : {}),
    }));
    assert.ok(moved);
    assert.equal(f.target.cards[0], moved);
    assert.equal(f.target.cards.length, replace ? 1 : 2);
    if (copy) {
      assert.equal(f.source.intro, intro);
      assert.equal(f.source.introEnabled, true);
      assert.notEqual(moved.id, intro.id);
    } else {
      assert.equal(moved, intro);
      assert.equal(f.source.intro, undefined);
      assert.equal(f.source.introEnabled, false);
    }
  });
}

for (const copy of [false,true]) test(`introduction replaces introduction (copy=${copy})`, () => {
  const f = fixture('container','fork','item'), intro = f.source.intro;
  f.source.introEnabled = true;
  const moved = transferCard(f.project, f.chapter, request(f, {
    placementId:intro.id, targetPlacementId:f.target.intro.id, copy,
  }));
  assert.ok(moved);
  assert.equal(f.target.intro, moved);
  assert.equal(f.target.introEnabled, true);
  assert.equal(f.source.introEnabled, copy);
  if (copy) assert.equal(f.source.intro, intro);
  else {
    assert.ok(f.source.intro);
    assert.notEqual(f.source.intro.id, intro.id);
    assert.notEqual(f.source.intro.definitionId, intro.definitionId);
  }
  assert.equal(Object.hasOwn(f.target.connections, moved.id), false);
});

for (const reverse of [false,true]) test(`same Fork transfer between intro and choices (reverse=${reverse})`, () => {
  const f = fixture('fork','fork','event'), intro = f.source.intro;
  f.source.connections = {[f.placement.id]:'arrival', [`${f.placement.id}:stale`]:'stale'};
  const moved = transferCard(f.project, f.chapter, request(f, {
    targetNodeId:f.source.id, placementId:reverse ? intro.id : f.placement.id,
    targetPlacementId:reverse ? f.placement.id : intro.id,
  }));
  assert.ok(moved);
  if (reverse) {
    assert.equal(f.source.intro, undefined);
    assert.equal(f.source.introEnabled, false);
    assert.deepEqual(f.source.choices, [intro]);
    assert.deepEqual(f.source.connections, {[intro.id]:false});
  } else {
    assert.equal(f.source.intro, f.placement);
    assert.equal(f.source.introEnabled, true);
    assert.deepEqual(f.source.choices, []);
    assert.deepEqual(f.source.connections, {});
  }
});

for (const sameNode of [false,true]) for (const copy of [false,true]) {
  test(`Fork replacement cleans displaced edges and carries only moved choice edges (sameNode=${sameNode}, copy=${copy})`, () => {
    const f = fixture('fork','fork','action');
    f.definition.resolution = 'check';
    const target = sameNode ? f.source : f.target;
    const displaced = {...f.placement, id:'displaced'};
    target.choices.push(displaced);
    f.source.connections = {[`${f.placement.id}:success`]:'arrival', [`${f.placement.id}:failure`]:null};
    target.connections = {...target.connections, displaced:'old', 'displaced:success':'old', 'displaced:failure':null, keep:false};
    const moved = transferCard(f.project, f.chapter, request(f, {
      targetNodeId:target.id, targetPlacementId:displaced.id, copy,
    }));
    assert.ok(moved);
    assert.equal(target.choices.includes(displaced), false);
    assert.equal(Object.keys(target.connections).some(key => key.startsWith('displaced')), false);
    assert.equal(target.connections[`${moved.id}:success`], copy ? false : 'arrival');
    assert.equal(target.connections[`${moved.id}:failure`], copy ? false : null);
    assert.equal(target.connections.keep, false);
    if (!copy && !sameNode) assert.deepEqual(f.source.connections, {});
    if (copy) assert.equal(f.source.connections[`${f.placement.id}:success`], 'arrival');
  });
}

for (const intro of [false,true]) test(`replacement command restores displaced placement and edges on undo (intro=${intro})`, () => {
  const f = fixture('linear','fork', intro ? 'caption' : 'action');
  const displaced = intro ? f.target.intro : f.target.choices[0];
  f.target.connections[displaced.id] = null;
  normalizeLocalOwnership(f.project);
  const history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
  const selection = {chapterId:f.chapter.id, selected:f.source.id, mode:'chapter'};
  const before = structuredClone(history.document);
  const {result, failure} = transactDocument(history, drafts, draft => applyDocumentCommand(draft, selection,
    'transfer-card', request(f, {targetPlacementId:displaced.id}), drafts));
  assert.equal(failure, undefined);
  assert.ok(result.value);
  const after = structuredClone(history.document);
  assert.equal(history.undo(), true);
  assert.deepEqual(history.document, before);
  assert.equal(history.redo(), true);
  assert.deepEqual(history.document, after);
});

for (const copy of [false,true]) test(`cross-chapter intro replacement preserves move/copy behavior and does not create choice edges (copy=${copy})`, () => {
  const f = fixture('fork','fork','event');
  f.source.intro = f.placement;
  f.source.choices = [];
  f.source.introEnabled = true;
  const destination = createChapter('destination');
  f.chapter.nodes.splice(f.chapter.nodes.indexOf(f.target), 1);
  destination.nodes.push(f.target);
  f.project.chapters.push(destination);
  const moved = transferCard(f.project, destination, request(f, {
    sourceChapterId:f.chapter.id, targetPlacementId:f.target.intro.id, copy,
  }));
  assert.ok(moved);
  assert.equal(f.target.intro, moved);
  assert.equal(f.target.introEnabled, true);
  assert.equal(f.source.introEnabled, copy);
  assert.equal(f.source.intro, copy ? f.placement : undefined);
  assert.equal(Object.hasOwn(f.target.connections, moved.id), false);
  if (copy) assert.notEqual(moved.definitionId, f.definition.id);
});


for (const replace of [false,true]) test(`moving a Container introduction preserves a fresh hidden valid slot (replacement=${replace})`, () => {
  const f = fixture('container','linear','item'), intro = f.source.intro;
  f.source.introEnabled = true;
  normalizeLocalOwnership(f.project);
  synchronizeConnections(f.project);
  assert.deepEqual(validateProject(f.project, {allowDraft:true}), []);
  const targetCard = f.target.cards[0];
  const moved = transferCard(f.project, f.chapter, request(f, {
    placementId:intro.id, ...(replace ? {targetPlacementId:targetCard.id} : {}),
  }));
  assert.equal(moved, intro);
  const fresh = f.source.intro;
  assert.ok(fresh);
  assert.notEqual(fresh.id, moved.id);
  assert.notEqual(fresh.definitionId, moved.definitionId);
  assert.equal(f.source.introEnabled, false);
  const definition = f.project.library.find(card => card.id === fresh.definitionId);
  assert.equal(definition.kind, 'event');
  assert.equal(definition.text, '');
  assert.equal(definition.visibility, 'local');
  assert.equal(definition.chapterId, f.chapter.id);
  assert.deepEqual(validateProject(f.project, {allowDraft:true}), []);
  const selection = {chapterId:f.chapter.id, selected:f.source.id, mode:'chapter'};
  applyDocumentCommand(f.project, selection, 'field', {
    scope:'node', path:'introEnabled', checked:true, inputType:'checkbox',
  }, new LocalCardDrafts());
  assert.equal(f.source.introEnabled, true);
  assert.equal(f.source.intro, fresh);
  assert.deepEqual(validateProject(f.project, {allowDraft:true}), []);
});

const headerRequest = (f, extra = {}) => ({
  sourceNodeId:f.source.id, placementId:f.placement.id, targetNodeId:f.target.id, targetSlot:'intro', ...extra,
});

for (const type of ['fork','container']) for (const kind of ['event','caption']) {
  for (const state of ['enabled','disabled','missing']) for (const copy of [false,true]) {
    test(`header ${kind} ${copy ? 'copy' : 'move'} targets ${state} ${type} introduction`, () => {
      const f = fixture('linear', type, kind);
      if (state === 'missing') delete f.target.intro;
      f.target.introEnabled = state === 'enabled';
      const sourceBefore = structuredClone(f.source);
      const moved = transferCard(f.project, f.chapter, headerRequest(f, {copy}));
      assert.ok(moved);
      assert.equal(f.target.intro, moved);
      assert.equal(f.target.introEnabled, true);
      assert.equal(f.project.library.find(d => d.id === moved.definitionId).kind, kind);
      assert.equal(Object.hasOwn(f.target.connections, moved.id), false);
      if (copy) {
        assert.deepEqual(f.source, sourceBefore);
        assert.notEqual(moved.id, f.placement.id);
        assert.notEqual(moved.definitionId, f.definition.id);
      } else {
        assert.equal(moved, f.placement);
        assert.deepEqual(f.source.cards, []);
      }
    });
  }
}

for (const sourceType of ['fork','container']) for (const copy of [false,true]) {
  test(`${sourceType} introduction ${copy ? 'copy' : 'move'} onto missing Fork header`, () => {
    const f = fixture(sourceType, 'fork'), intro = f.source.intro;
    delete f.target.intro;
    f.source.introEnabled = true;
    const moved = transferCard(f.project, f.chapter, headerRequest(f, {placementId:intro.id, copy}));
    assert.ok(moved);
    assert.equal(f.target.intro, moved);
    assert.equal(f.target.introEnabled, true);
    if (copy) {
      assert.equal(f.source.intro, intro);
      assert.notEqual(moved.id, intro.id);
    } else {
      assert.equal(moved, intro);
      assert.equal(f.source.introEnabled, false);
      if (sourceType === 'container') {
        assert.ok(f.source.intro);
        assert.notEqual(f.source.intro.id, intro.id);
        assert.equal(f.project.library.find(d => d.id === f.source.intro.definitionId).kind, 'event');
      } else assert.equal(f.source.intro, undefined);
    }
  });
}

for (const type of ['fork','container']) for (const enabled of [false,true]) for (const copy of [false,true]) {
  test(`own ${type} introduction header is unchanged (enabled=${enabled}, copy=${copy})`, () => {
    const f = fixture(type, type);
    f.source.introEnabled = enabled;
    const before = structuredClone(f.project);
    assert.equal(transferCard(f.project, f.chapter, headerRequest(f, {
      targetNodeId:f.source.id, placementId:f.source.intro.id, copy,
    })), null);
    assert.deepEqual(f.project, before);
  });
}

for (const copy of [false,true]) test(`invalid header requests reject without mutations (copy=${copy})`, () => {
  for (const kind of ['action','item','health','energy']) {
    const f = fixture('linear','fork',kind), before = structuredClone(f.project);
    assert.equal(transferCard(f.project, f.chapter, headerRequest(f, {copy})), null);
    assert.deepEqual(f.project, before);
  }
  for (const type of ['linear','random','legacySequence','unknown']) {
    const f = fixture();
    f.target.type = type;
    // Even an intro-shaped property cannot add an unsupported node slot.
    f.target.intro = {...f.placement, id:'fake-intro'};
    const before = structuredClone(f.project);
    assert.equal(transferCard(f.project, f.chapter, headerRequest(f, {copy})), null);
    assert.deepEqual(f.project, before);
  }
  for (const extra of [
    {targetSlot:'choices'}, {targetSlot:'cards'}, {targetSlot:null}, {targetSlot:''},
    {targetPlacementId:'missing'}, {targetPlacementId:'choice'},
  ]) {
    const f = fixture('linear','fork');
    f.target.choices[0].id = 'choice';
    const before = structuredClone(f.project);
    assert.equal(transferCard(f.project, f.chapter, headerRequest(f, {...extra, copy})), null);
    assert.deepEqual(f.project, before);
  }
});

test('header accepts a matching introduction replacement id', () => {
  const f = fixture('linear','fork');
  assert.equal(transferCard(f.project, f.chapter, headerRequest(f, {targetPlacementId:f.target.intro.id})), f.placement);
  assert.equal(f.target.intro, f.placement);
});

for (const copy of [false,true]) test(`same Fork choice to header cleans only moved outputs (copy=${copy})`, () => {
  const f = fixture('fork','fork');
  delete f.source.intro;
  f.source.connections = {[f.placement.id]:'arrival', [`${f.placement.id}:stale`]:null, keep:false};
  const before = structuredClone(f.source.connections);
  const moved = transferCard(f.project, f.chapter, headerRequest(f, {targetNodeId:f.source.id, copy}));
  assert.ok(moved);
  assert.equal(f.source.intro, moved);
  assert.equal(f.source.introEnabled, true);
  assert.deepEqual(f.source.choices, copy ? [f.placement] : []);
  assert.deepEqual(f.source.connections, copy ? before : {keep:false});
});

for (const state of ['enabled','disabled','missing']) for (const copy of [false,true]) {
  test(`header transfer command validates and restores ${state} introduction (copy=${copy})`, () => {
    const f = fixture('linear','fork','caption');
    if (state === 'missing') delete f.target.intro;
    f.target.introEnabled = state === 'enabled';
    normalizeLocalOwnership(f.project);
    synchronizeConnections(f.project);
    assert.deepEqual(validateProject(f.project, {allowDraft:true}), []);
    const history = new DocumentHistory(f.project), drafts = new LocalCardDrafts();
    const selection = {chapterId:f.chapter.id, selected:f.source.id, mode:'chapter'};
    const before = structuredClone(history.document);
    const {result, failure} = transactDocument(history, drafts, draft => applyDocumentCommand(draft, selection,
      'transfer-card', headerRequest(f, {copy}), drafts));
    assert.equal(failure, undefined);
    assert.ok(result.value);
    assert.deepEqual(result.selection, {selected:f.target.id, mode:'chapter'});
    assert.deepEqual(validateProject(history.document, {allowDraft:true}), []);
    const after = structuredClone(history.document);
    assert.equal(history.undo(), true);
    assert.deepEqual(history.document, before);
    assert.equal(history.redo(), true);
    assert.deepEqual(history.document, after);
    assert.deepEqual(validateProject(history.document, {allowDraft:true}), []);
  });
}

for (const copy of [false,true]) test(`cross-chapter header transfer remaps dependencies and variables (copy=${copy})`, () => {
  const f = fixture('linear','fork');
  const variable = {id:'header-flag', name:'Header flag', type:'flag', initial:false};
  f.chapter.variables = [variable];
  const item = {...createDefinition('item','header-item'), visibility:'local', chapterId:f.chapter.id,
    onCollect:[{op:'set', key:variable.id, value:true}]};
  f.project.library.push(item);
  f.definition.effects = [{op:'addItem', key:item.id}];
  f.placement.conditions = [{source:'variable', key:variable.id, op:'eq', value:true}];
  const destination = createChapter('header-destination');
  f.chapter.nodes.splice(f.chapter.nodes.indexOf(f.target), 1);
  destination.nodes.push(f.target);
  delete f.target.intro;
  f.project.chapters.push(destination);
  const sourceBefore = structuredClone([f.source, f.definition, item]);
  const moved = transferCard(f.project, destination, headerRequest(f, {sourceChapterId:f.chapter.id, copy}));
  assert.ok(moved);
  assert.equal(f.target.intro, moved);
  assert.equal(f.target.introEnabled, true);
  assert.equal(moved.id === f.placement.id, !copy);
  const movedDefinition = f.project.library.find(d => d.id === moved.definitionId);
  const movedItem = f.project.library.find(d => d.id === movedDefinition.effects[0].key);
  assert.notEqual(movedDefinition.id, f.definition.id);
  assert.notEqual(movedItem.id, item.id);
  assert.notEqual(destination.variables[0].id, variable.id);
  assert.equal(moved.conditions[0].key, destination.variables[0].id);
  assert.equal(movedItem.onCollect[0].key, destination.variables[0].id);
  assert.deepEqual([f.definition, item], sourceBefore.slice(1));
  if (copy) assert.deepEqual(f.source, sourceBefore[0]);
  else assert.deepEqual(f.source.cards, []);
  assert.equal(Object.hasOwn(f.target.connections, moved.id), false);
});
