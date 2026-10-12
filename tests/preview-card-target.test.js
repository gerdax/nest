import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCardTarget } from '../studio/preview-card-target.js';

const placement = id => ({ id, definitionId: `definition-${id}` });
function fixture(node, { sequence, index = 0, phase = 'closed', actions = [], selected = 0 } = {}) {
  const placements = [...(node.cards || []), ...(node.choices || []), ...(node.items || []), ...(node.intro ? [node.intro] : []),
    ...[node.sequence, ...(node.sequences || [])].filter(Boolean).flatMap(s => [...s.cards, ...(s.items || []), ...s.cards.flatMap(c => c.choices || [])])];
  return { chapterId: 'chapter', project: { chapters: [{ id: 'chapter', nodes: [node] }], library: placements.map(p => ({ id: p.definitionId })) },
    controller: { state: { idle: true, activeNodeId: node.id, cardId: 'stale-intro' }, location: { node, sequence, index } },
    deck: { phase, open: phase === 'choices', content: { actions }, index: selected } };
}
function expected(id, sequenceId, slot = 'cards', parentCardId) {
  return { chapterId: 'chapter', nodeId: 'node', placementId: id, definitionId: `definition-${id}`,
    ...(sequenceId ? { sequenceId, slot, ...(slot === 'choices' ? { parentCardId } : {}) } : {}) };
}

test('linear cards of every kind resolve the current placement rather than state.cardId', () => {
  for (const kind of ['event', 'caption', 'narrative', 'action', 'item']) {
    const f = fixture({ id: 'node', type: 'linear', cards: [placement('first'), { ...placement('current'), kind }] }, { index: 1, phase: ['action','item'].includes(kind) ? 'choices' : 'closed' });
    assert.deepEqual(previewCardTarget(f), expected('current'));
  }
});

for (const type of ['fork', 'container']) test(`${type} resolves closed intro and the actual selected open placement`, () => {
  const node = { id: 'node', type, intro: placement('intro'), [type === 'fork' ? 'choices' : 'items']: [placement('hidden'), placement('first'), placement('selected')] };
  const f = fixture(node);
  assert.deepEqual(previewCardTarget(f), expected('intro'));
  Object.assign(f.deck, { phase: 'choices', open: true, index: 1, content: { actions: [placement('first'), placement('selected')] } });
  assert.deepEqual(previewCardTarget(f), expected('selected'));
  f.deck.content.actions.splice(0, 1); f.deck.index = 0;
  assert.deepEqual(previewCardTarget(f), expected('selected'));
  f.deck.content.actions = [{ id: 'unavailable' }];
  assert.equal(previewCardTarget(f), null);
});

for (const nodeType of ['legacySequence', 'legacyPool']) test(`${nodeType} identifies current sequence and its inner cards, choices and items`, () => {
  for (const type of ['linear', 'forked', 'container']) {
    const sequence = { id: 'second', type, cards: [{ ...placement('intro'), choices: [placement('choice')] }], items: [placement('item')] };
    const node = { id: 'node', type: nodeType, ...(nodeType === 'legacyPool' ? { sequences: [{ ...sequence, id: 'first' }, sequence] } : { sequence }) };
    const f = fixture(node, { sequence });
    assert.deepEqual(previewCardTarget(f), expected('intro', 'second'));
    if (type !== 'linear') {
      const id = type === 'forked' ? 'choice' : 'item';
      Object.assign(f.deck, { phase: 'choices', open: true, content: { actions: [placement(id)] } });
      assert.deepEqual(previewCardTarget(f), expected(id, 'second', type === 'forked' ? 'choices' : 'items', 'intro'));
    }
    f.controller.location.sequence = { ...sequence, id: 'missing' };
    assert.equal(previewCardTarget(f), null);
  }
});

for (const nodeType of ['legacySequence', 'legacyPool']) test(`${nodeType} disambiguates repeated choices by their current parent card`, () => {
  const sequence = { id: 'sequence', type: 'forked', cards: [
    { ...placement('first-card'), choices: [placement('repeat')] },
    { ...placement('second-card'), choices: [placement('repeat')] },
  ] };
  const node = { id: 'node', type: nodeType, ...(nodeType === 'legacyPool' ? { sequences: [sequence] } : { sequence }) };
  const f = fixture(node, { sequence, phase: 'choices', actions: [placement('repeat')] });
  assert.deepEqual(previewCardTarget(f), expected('repeat', 'sequence', 'choices', 'first-card'));
  f.controller.location.index = 1;
  assert.deepEqual(previewCardTarget(f), expected('repeat', 'sequence', 'choices', 'second-card'));
});

test('legacy container preserves card versus item identity when ID and definition overlap', () => {
  const sequence = { id: 'sequence', type: 'container', cards: [placement('overlap')], items: [placement('overlap')] };
  const f = fixture({ id: 'node', type: 'legacySequence', sequence }, { sequence });
  assert.deepEqual(previewCardTarget(f), expected('overlap', 'sequence', 'cards'));
  Object.assign(f.deck, { phase: 'choices', open: true, content: { actions: [placement('overlap')] } });
  assert.deepEqual(previewCardTarget(f), expected('overlap', 'sequence', 'items'));
});

test('missing source and unstable playback never produce targets', () => {
  for (const mutate of [
    f => f.controller.state.idle = false, f => f.controller.state.completed = true, f => f.controller.state.checking = true,
    f => f.deck.busy = true, f => f.deck.state = { busy: true }, f => f.deck.drag = {},
    f => f.controller.pendingIntro = {}, f => f.controller.pendingItem = {}, f => f.controller.stagedDestination = {},
    f => f.controller.destroyed = true, f => f.deck.destroyed = true,
    ...['revealing', 'closing', 'committing', 'collecting', 'ended'].map(phase => f => f.deck.phase = phase),
    f => f.project.library = [], f => f.project.chapters = [], f => f.controller.location.index = 3,
    f => f.controller.state.activeNodeId = 'other',
  ]) {
    const f = fixture({ id: 'node', type: 'linear', cards: [placement('current')] });
    mutate(f); assert.equal(previewCardTarget(f), null);
  }
});
