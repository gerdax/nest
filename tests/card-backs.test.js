import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardBack, validateCardBack, resolveBackAppearance, resolveBackOperation, selectBackIcon } from '../engine/cardBacks.js';

test('authored config validation accepts defaults, optional fields, and extension icons', () => {
  for (const config of [undefined, {}, defaultCardBack, { icons: { future: null } }, { switchProgress: 0 }, { switchProgress: 1 }]) {
    assert.deepEqual(validateCardBack(config), []);
  }
  assert.ok(Object.isFrozen(defaultCardBack));
  assert.ok(Object.isFrozen(defaultCardBack.icons));
});

test('authored config validation reports malformed objects and individual fields', () => {
  for (const config of [null, false, [], 'back.png']) assert.deepEqual(validateCardBack(config), ['cardBack must be an object']);
  assert.deepEqual(validateCardBack({ background: ' ', icons: { dice: false, collect: '' }, iconScale: Infinity, switchProgress: -1 }), [
    'cardBack.background must be a nonempty string',
    'cardBack.icons.dice must be a nonempty string',
    'cardBack.icons.collect must be a nonempty string',
    'cardBack.iconScale must be a positive finite number',
    'cardBack.switchProgress must be a number between 0 and 1',
  ]);
  assert.deepEqual(validateCardBack({ icons: [] }), ['cardBack.icons must be an object']);
  for (const iconScale of [0, -1, NaN, '1', null]) assert.equal(validateCardBack({ iconScale }).length, 1);
  for (const switchProgress of [2, Infinity, '0.5', null]) assert.equal(validateCardBack({ switchProgress }).length, 1);
});

test('missing or malformed config uses the layered UI assets', () => {
  for (const cardBack of [undefined, null, false, true, [], 'custom.png']) {
    const appearance = resolveBackAppearance({ cardBack });
    assert.equal(appearance.background, './assets/img/ui/cardback.png');
    assert.equal(appearance.icons.default, './assets/img/ui/default.png');
    assert.equal(appearance.icons.container, './assets/img/ui/container.png');
    assert.equal(appearance.iconScale, 1);
    assert.equal(appearance.switchDistance, 6);
    assert.equal(appearance.switchProgress, undefined);
  }
});

test('layered overrides merge known icons without mutating or sharing input state', () => {
  const content = Object.freeze({ cardBack: Object.freeze({
    background: 'paper.png', icons: Object.freeze({ dice: 'custom-dice.png', unknown: 'ignored.png' }), iconScale: 0.7, switchProgress: 0.2,
  }) });
  const appearance = resolveBackAppearance(content);
  assert.equal(appearance.background, 'paper.png');
  assert.equal(appearance.icons.dice, 'custom-dice.png');
  assert.equal(appearance.icons.collect, './assets/img/ui/collect.png');
  assert.equal(appearance.icons.unknown, undefined);
  assert.equal(appearance.iconScale, 0.7);
  assert.equal(appearance.switchProgress, 0.2);
  appearance.icons.default = 'mutated.png';
  assert.equal(resolveBackAppearance(content).icons.default, './assets/img/ui/default.png');
});

test('invalid appearance fields fall back and threshold endpoints are supported', () => {
  for (const invalid of [NaN, Infinity, -1, '0.2', null]) {
    const appearance = resolveBackAppearance({ cardBack: { iconScale: invalid, switchProgress: invalid, background: ' ', icons: { dice: false } } });
    assert.equal(appearance.iconScale, 1);
    assert.equal(appearance.switchDistance, 6);
    assert.equal(appearance.switchProgress, undefined);
    assert.equal(appearance.background, './assets/img/ui/cardback.png');
    assert.equal(appearance.icons.dice, './assets/img/ui/dice.png');
  }
  for (const switchProgress of [0, 1]) assert.equal(resolveBackAppearance({ cardBack: { switchProgress } }).switchProgress, switchProgress);
  assert.equal(resolveBackAppearance({ cardBack: { switchProgress: 2, iconScale: 0 } }).switchProgress, undefined);
  assert.ok(resolveBackAppearance(null));
});

test('operation policy gives blocked and introduction precedence over checks', () => {
  const content = { interaction: 'container', flipItemsOnReveal: true, backOperation: 'dice' };
  assert.equal(resolveBackOperation(content, { source: 'cover', action: { resolution: 'check' }, blocked: true }), null);
  assert.equal(resolveBackOperation(content, { source: 'cover', action: { resolution: 'check' } }), 'container');
  assert.equal(resolveBackOperation({}, { source: 'actions', action: { resolution: 'check' } }), 'dice');
  assert.equal(resolveBackOperation({ backOperation: 'dice' }, { source: 'cover' }), 'dice');
  assert.equal(resolveBackOperation({}, { source: 'cover', action: { resolution: 'check' } }), null);
  assert.equal(resolveBackOperation({ interaction: 'container' }, { source: 'actions', action: { resolution: 'check' }, direction: -1 }), 'dice');
});

test('container actions only preview discard upward or a single collect downward', () => {
  const content = { interaction: 'container' };
  assert.equal(resolveBackOperation(content, { source: 'actions', direction: -1, count: 3 }), 'discard');
  assert.equal(resolveBackOperation(content, { source: 'actions', direction: 1, count: 1 }), 'collect');
  for (const options of [{ direction: 1, count: 2 }, { direction: 0, count: 1 }, { direction: 1, count: 0 }, { direction: 1, count: '1' }]) {
    assert.equal(resolveBackOperation(content, { source: 'actions', ...options }), null);
  }
  assert.equal(resolveBackOperation(content, { source: 'cover', direction: -1 }), null);
  assert.equal(resolveBackOperation({ interaction: 'choice' }, { source: 'actions', direction: -1 }), null);
  assert.equal(resolveBackOperation(null, null), null);
});

test('icon selection switches exactly at configured progress and returns to default', () => {
  const appearance = resolveBackAppearance({ cardBack: { switchProgress: 0.6 } });
  assert.equal(selectBackIcon(appearance, 'collect', 0.599), appearance.icons.default);
  assert.equal(selectBackIcon(appearance, 'collect', 0.6), appearance.icons.collect);
  assert.equal(selectBackIcon(appearance, 'discard', 1), appearance.icons.discard);
  assert.equal(selectBackIcon(appearance, 'dice', 0.2), appearance.icons.default);
  for (const operation of [null, 'unknown']) assert.equal(selectBackIcon(appearance, operation, 1), appearance.icons.default);
  for (const progress of [NaN, Infinity, undefined]) assert.equal(selectBackIcon(appearance, 'dice', progress), appearance.icons.default);
  assert.equal(selectBackIcon(null, 'dice', 1), null);
});


test('default icon changes after six pixels of card movement independently of exposure',()=>{
 const appearance=resolveBackAppearance();
 for(const operation of ['container','dice','collect','discard']) {
  assert.equal(selectBackIcon(appearance,operation,1,0),appearance.icons.default);
  assert.equal(selectBackIcon(appearance,operation,1,5),appearance.icons.default);
  assert.equal(selectBackIcon(appearance,operation,0,6),appearance.icons[operation]);
 }
 assert.equal(resolveBackAppearance({cardBack:{switchDistance:12}}).switchDistance,12);
 for(const switchDistance of [-1,NaN,Infinity,'6',null])assert.equal(validateCardBack({switchDistance}).length,1);
 assert.equal(selectBackIcon(resolveBackAppearance({cardBack:{switchDistance:12}}),'dice',1,6),appearance.icons.default);
});
