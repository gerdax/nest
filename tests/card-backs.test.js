import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardBack, validateCardBack, resolveBackAppearance } from '../engine/cardBacks.js';

test('authored config validation accepts defaults, optional fields, and extension icons', () => {
  for (const config of [undefined, {}, defaultCardBack, { icons: { future: null, dice: false, collect: '' }, switchIcons: 'legacy', switchDistance: -1, switchProgress: 2 }]) {
    assert.deepEqual(validateCardBack(config), []);
  }
  assert.ok(Object.isFrozen(defaultCardBack));
  assert.ok(Object.isFrozen(defaultCardBack.icons));
});

test('authored config validation reports malformed objects and individual fields', () => {
  for (const config of [null, false, [], 'back.png']) assert.deepEqual(validateCardBack(config), ['cardBack must be an object']);
  assert.deepEqual(validateCardBack({ background: ' ', icons: { default: false }, iconScale: Infinity, switchProgress: -1 }), [
    'cardBack.background must be a nonempty string',
    'cardBack.icons.default must be a nonempty string',
    'cardBack.iconScale must be a positive finite number',
  ]);
  assert.deepEqual(validateCardBack({ icons: [] }), ['cardBack.icons must be an object']);
  for (const iconScale of [0, -1, NaN, '1', null]) assert.equal(validateCardBack({ iconScale }).length, 1);
});

test('missing or malformed config uses the layered UI assets', () => {
  for (const cardBack of [undefined, null, false, true, [], 'custom.png']) {
    const appearance = resolveBackAppearance({ cardBack });
    assert.equal(appearance.background, './assets/img/ui/cardback.png');
    assert.equal(appearance.icons.default, './assets/img/ui/default.png');
    assert.equal(appearance.iconScale, 1);
  }
});

test('layered overrides retain only the default icon without mutating or sharing input state', () => {
  const content = Object.freeze({ cardBack: Object.freeze({
    background: 'paper.png', icons: Object.freeze({ default: 'custom-default.png', dice: 'ignored.png', unknown: 'ignored.png' }), iconScale: 0.7, switchProgress: 0.2,
  }) });
  const appearance = resolveBackAppearance(content);
  assert.equal(appearance.background, 'paper.png');
  assert.deepEqual(appearance.icons, { default: 'custom-default.png' });
  assert.equal(appearance.icons.unknown, undefined);
  assert.equal(appearance.iconScale, 0.7);
  appearance.icons.default = 'mutated.png';
  assert.equal(resolveBackAppearance(content).icons.default, 'custom-default.png');
});

test('invalid active appearance fields fall back', () => {
  for (const invalid of [NaN, Infinity, -1, '0.2', null]) {
    const appearance = resolveBackAppearance({ cardBack: { iconScale: invalid, switchProgress: invalid, background: ' ', icons: { default: false } } });
    assert.equal(appearance.iconScale, 1);
    assert.equal(appearance.background, './assets/img/ui/cardback.png');
    assert.deepEqual(appearance.icons, { default: './assets/img/ui/default.png' });
  }
  assert.ok(resolveBackAppearance(null));
});
