import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceDrum} from '../studio/ResourceDrum.js';

function fixture(reducedMotion = false) {
  const doc = {
    defaultView: {matchMedia: () => ({matches: reducedMotion})},
    createElement: () => ({
      ownerDocument: doc,
      children: [],
      classList: {add() {}},
      setAttribute() {},
      style: {},
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      animate(frames) {
        const animation = {
          frames, progress: 0,
          effect: {getComputedTiming: () => ({progress: animation.progress})},
          cancel() { this.cancelled = true; },
        };
        return animation;
      },
    }),
  };
  const root = doc.createElement();
  return {root, drum: new ResourceDrum(root)};
}

const angles = animation => animation.frames.map(({offset, transform}) =>
  [offset, Number(transform.match(/rotateX\((-?\d+)deg\)$/)[1])]);
const settled = root => root.children.map(window => window.children[0].children[0].textContent).join('');

test('tens wait for the carry or borrow and units traverse every intervening digit', () => {
  const {drum, root} = fixture();
  drum.update(8);
  drum.update(12);
  assert.deepEqual(angles(drum.animations[0]), [[0, 0], [.25, 0], [.5, -36], [1, -36]]);
  assert.deepEqual(angles(drum.animations[1]), [[0, 0], [.25, -36], [.5, -72], [.75, -108], [1, -144]]);
  drum.animations[0].onfinish();
  assert.equal(settled(root), '12');

  drum.update(8);
  assert.deepEqual(angles(drum.animations[0]), [[0, 0], [.5, 0], [.75, 36], [1, 36]]);
  assert.equal(angles(drum.animations[1]).at(-1)[1], 144);
  drum.animations[0].onfinish();
  assert.equal(settled(root), '08');
});

test('a full turn of units advances tens once and a new value can interrupt the roll', () => {
  const {drum} = fixture();
  drum.update(8);
  drum.update(18);
  const [tens, units] = drum.animations;
  assert.deepEqual(angles(tens), [[0, 0], [.1, 0], [.2, -36], [1, -36]]);
  assert.equal(angles(units).at(-1)[1], -360);
  tens.progress = .3;
  drum.update(12);
  assert.equal(units.cancelled, true);
  assert.equal(drum.animations.length, 1);
  assert.deepEqual(angles(drum.animations[0]), [[0, 0], [1, -36]]);
});

test('reduced motion displays the new value immediately', () => {
  const {drum, root} = fixture(true);
  drum.update(9);
  drum.update(10);
  assert.equal(drum.animations.length, 0);
  assert.equal(settled(root), '10');
});
