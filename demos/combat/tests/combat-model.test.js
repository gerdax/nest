import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, normalizeEnemy, initialState, legalActions, resolveRound } from '../combat-model.js';

test('configuration validates individual integer bounds and creates independent arrays', () => {
  assert.deepEqual(normalizeEnemy(), { health: 10, energy: 10 });
  for (const config of [null, 10, 'enemy', []]) assert.throws(() => normalizeEnemy(config), TypeError);
  assert.deepEqual(normalizeEnemy({ health: 30, energy: 0 }), { health: 30, energy: 0 });
  for (const health of [0, 31, -1, 1.5, '10', NaN, Infinity]) {
    assert.throws(() => normalizeEnemy({ health }), RangeError);
  }
  for (const energy of [-1, 31, 1.5, '10', NaN, Infinity]) {
    assert.throws(() => normalizeEnemy({ energy }), RangeError);
  }
  const state = initialState({ health: 3, energy: 0 });
  assert.deepEqual(state, { hp: [10, 3], energy: [10, 0], maxHp: [10, 3], maxEnergy: [10, 0], quiet: 0, round: 0 });
  assert.notEqual(state.hp, state.maxHp);
  assert.notEqual(state.energy, state.maxEnergy);
  assert.deepEqual(ACTIONS.map(({ id, cost }) => [id, cost]), [['attack', 2], ['recover', 0], ['dodge', 1]]);
});

const pairs = [
  ['attack', 'attack', [8, 8], [10, 10], [0, 0], [false, false], [0, 0]],
  ['attack', 'recover', [8, 10], [10, 6], [0, 4], [false, false], [0, 0]],
  ['attack', 'dodge', [8, 9], [10, 10], [0, 0], [false, true], [0, 0]],
  ['recover', 'attack', [10, 8], [6, 10], [4, 0], [false, false], [0, 0]],
  ['recover', 'recover', [10, 10], [10, 10], [0, 0], [false, false], [0, 0]],
  ['recover', 'dodge', [10, 9], [10, 10], [0, 0], [false, false], [0, 0]],
  ['dodge', 'attack', [9, 8], [10, 10], [0, 0], [true, false], [0, 0]],
  ['dodge', 'recover', [9, 10], [10, 10], [0, 0], [false, false], [0, 0]],
  ['dodge', 'dodge', [9, 9], [10, 10], [0, 0], [false, false], [0, 0]],
];

for (const [player, enemy, energy, hp, hits, dodged, recovery] of pairs) {
  test(`${player} / ${enemy} simultaneous outcome`, () => {
    const state = initialState();
    const original = structuredClone(state);
    const pair = [player, enemy];
    const result = resolveRound(state, pair);
    assert.deepEqual(result.state, { ...original, hp, energy, round: 1, quiet: hits.some(Boolean) ? 0 : 1 });
    assert.deepEqual(result.costs, pair.map(id => ACTIONS.find(action => action.id === id).cost));
    assert.deepEqual(result.hits, hits);
    assert.deepEqual(result.dodged, dodged);
    assert.deepEqual(result.recovery, recovery);
    assert.equal(result.pressure, false);
    assert.equal(result.terminal, false);
    assert.deepEqual(result.before, original);
    assert.deepEqual(state, original);
    assert.notEqual(result.pair, pair);
    for (const field of ['hp', 'energy', 'maxHp', 'maxEnergy']) {
      assert.notEqual(result.state[field], state[field]);
      assert.notEqual(result.before[field], state[field]);
      assert.notEqual(result.before[field], result.state[field]);
    }
  });
}

test('recover gains energy while hit, caps individually, and respects zero capacity', () => {
  const state = initialState({ health: 3, energy: 1 });
  state.energy = [1, 0];
  const recovered = resolveRound(state, ['recover', 'recover']);
  assert.deepEqual(recovered.recovery, [2, 1]);
  assert.deepEqual(recovered.state.energy, [3, 1]);
  const hitState = initialState({ health: 3, energy: 5 });
  hitState.energy[1] = 2;
  const hit = resolveRound(hitState, ['attack', 'recover']);
  assert.deepEqual(hit.hits, [0, 3]);
  assert.deepEqual(hit.recovery, [0, 2]);
  assert.deepEqual(hit.state.energy, [8, 4]);
  assert.equal(hit.terminal, true);
  const zero = initialState({ energy: 0 });
  assert.deepEqual(legalActions(zero, 1), ['recover']);
  assert.equal(resolveRound(zero, ['recover', 'recover']).state.energy[1], 0);
  zero.energy[0] = 1;
  assert.deepEqual(legalActions(zero, 0), ['recover', 'dodge']);
  zero.energy[0] = 2;
  assert.deepEqual(legalActions(zero, 0), ['attack', 'recover', 'dodge']);
});

test('six bloodless rounds apply pressure, repeated cycles work, and a hit resets count', () => {
  let state = initialState();
  for (let round = 1; round <= 12; round++) {
    const result = resolveRound(state, ['recover', 'recover']);
    assert.equal(result.pressure, round % 6 === 0);
    assert.equal(result.state.quiet, round % 6);
    assert.deepEqual(result.state.hp, [10 - Math.floor(round / 6), 10 - Math.floor(round / 6)]);
    state = result.state;
  }
  state.quiet = 5;
  const hit = resolveRound(state, ['attack', 'recover']);
  assert.equal(hit.pressure, false);
  assert.equal(hit.state.quiet, 0);
  assert.deepEqual(hit.state.hp, [8, 4]);
  const blocked = initialState();
  blocked.quiet = 5;
  assert.equal(resolveRound(blocked, ['attack', 'dodge']).pressure, true);
});

test('pressure can end both sides and terminal states have no legal actions', () => {
  const state = initialState({ health: 1, energy: 0 });
  state.hp[0] = 1;
  state.quiet = 5;
  const result = resolveRound(state, ['recover', 'recover']);
  assert.deepEqual(result.state.hp, [0, 0]);
  assert.equal(result.terminal, true);
  assert.deepEqual(legalActions(result.state, 0), []);
  assert.deepEqual(legalActions(result.state, 1), []);
  assert.throws(() => resolveRound(result.state, ['recover', 'recover']), RangeError);
});

test('invalid pair, action, and unaffordable choice leave state unchanged', () => {
  const state = initialState({ energy: 0 });
  const original = structuredClone(state);
  for (const pair of [null, [], ['recover'], ['recover', 'recover', 'recover'], ['unknown', 'recover'], ['recover', 'attack'], ['recover', 'dodge']]) {
    assert.throws(() => resolveRound(state, pair));
    assert.deepEqual(state, original);
  }
  assert.throws(() => legalActions(state, 2), RangeError);
  assert.throws(() => resolveRound({ ...state, quiet: 6 }, ['recover', 'recover']), RangeError);
  assert.throws(() => resolveRound({ ...state, energy: [11, 0] }, ['recover', 'recover']), RangeError);
});

test('all legal pairs preserve bounds and are symmetric under swapping sides', () => {
  const swap = state => ({ ...state, hp: [...state.hp].reverse(), energy: [...state.energy].reverse(), maxHp: [...state.maxHp].reverse(), maxEnergy: [...state.maxEnergy].reverse() });
  for (const hp of [1, 3, 10]) for (const energy of [0, 1, 2, 9, 10]) for (const quiet of [0, 5]) {
    const state = initialState({ health: hp, energy });
    state.energy[0] = energy;
    state.hp[0] = hp;
    state.quiet = quiet;
    for (const player of legalActions(state, 0)) for (const enemy of legalActions(state, 1)) {
      const result = resolveRound(state, [player, enemy]);
      const mirrored = resolveRound(swap(state), [enemy, player]);
      assert.deepEqual(mirrored.state, swap(result.state));
      for (const field of ['costs', 'hits', 'dodged', 'recovery']) assert.deepEqual(mirrored[field], [...result[field]].reverse());
      assert.equal(mirrored.pressure, result.pressure);
      assert.equal(mirrored.terminal, result.terminal);
      for (let side = 0; side < 2; side++) {
        assert.ok(result.state.hp[side] >= 0 && result.state.hp[side] <= result.state.maxHp[side]);
        assert.ok(result.state.energy[side] >= 0 && result.state.energy[side] <= result.state.maxEnergy[side]);
      }
    }
  }
});
