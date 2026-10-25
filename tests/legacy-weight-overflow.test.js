import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPool } from '../chapter/random.js';
import { validateChapter } from '../chapter/model.js';
import { ChapterController } from '../chapter/ChapterController.js';
import { migrateChapter, validateProject, compileChapter } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';

const pool = weights => weights.map((weight, i) => ({sequenceId: `s${i}`, weight}));
test('legacy selection scales finite weights on every draw without replacement', () => {
  const source = pool([1e308, 1e308, 1]);
  const before = structuredClone(source);
  assert.deepEqual(selectPool(source, 3, () => 0), ['s0', 's1', 's2']);
  assert.deepEqual(selectPool(source, 2, () => .75), ['s1', 's0']);
  assert.deepEqual(selectPool(pool([Number.MIN_VALUE, 1e308]), 2, () => 0), ['s0', 's1']);
  assert.deepEqual(selectPool(pool([1e308, 1, 1]), 3, () => .5), ['s0', 's2', 's1']);
  assert.deepEqual(source, before);
});
test('legacy selection preserves random source validation and empty-draw behavior', () => {
  for (const draw of [-1, 1, NaN, Infinity, '0', undefined]) {
    assert.throws(() => selectPool(pool([1e308, 1e308]), 1, () => draw), /Random source/);
  }
  const unexpected = () => { throw Error('unexpected random draw'); };
  assert.deepEqual(selectPool([], 1, unexpected), []);
  assert.deepEqual(selectPool(pool([1]), 0, unexpected), []);
});
class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content = content; }
}
function legacyChapter() {
  return {version: 1, name: 'Overflow', startNode: 'pool',
    nodes: [{id: 'pool', name: 'Pool', type: 'random', x: 0, y: 0, pool: pool([1e308, 1e308]), count: 2, connections: {next: null}}],
    sequences: [0, 1].map(i => ({id: `s${i}`, name: `Sequence ${i}`, type: 'linear', exits: ['next'],
      cards: [{id: `c${i}`, title: `Card ${i}`, text: '', image: ''}]}))};
}
for (const draw of [0, .75]) test(`v1 and migrated legacy pool playback select the expected first card at ${draw}`, () => {
  const chapter = legacyChapter();
  assert.deepEqual(validateChapter(chapter), []);
  const expected = draw === 0 ? 'c0' : 'c1';
  const legacy = new ChapterController(new Deck(), chapter, {rng: () => draw});
  assert.equal(legacy.state.cardId, expected);
  assert.deepEqual(legacy.queue, [draw === 0 ? 's1' : 's0']);
  legacy.destroy();
  const project = migrateChapter(chapter);
  assert.deepEqual(validateProject(project), []);
  const compiled = compileChapter(project);
  assert.equal(compiled.nodes[0].type, 'legacyPool');
  const migrated = new ProjectController(new Deck(), compiled, {rng: () => draw, onError: error => { throw error; }});
  assert.equal(migrated.state.cardId, expected);
  assert.deepEqual(migrated.location.queue, [draw === 0 ? 's1' : 's0']);
  migrated.destroy();
});
