import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, resolveAttack, terminal } from '../combat-model.js';

const roll = (state, value, action = 'attack') => resolveAttack(state, { actor: state.actor, value, action });
const heroTurn = options => roll(initial(options), 1).state;

test('initial defaults and configuration are independent', () => {
  assert.deepEqual(initial(), { heroHp: 10, ratHp: 4, weapon: true, round: 1, actor: 'rat' });
  assert.deepEqual(initial({ heroHp: 2, ratHp: 8, weapon: false }), { heroHp: 2, ratHp: 8, weapon: false, round: 1, actor: 'rat' });
  assert.notEqual(initial(), initial());
  assert.equal(terminal(initial()), null);
});

for (const [actor, action, strength] of [['rat', 'attack', 1], ['hero', 'attack', 2], ['hero', 'weapon', 3]]) {
  for (let value = 1; value <= 6; value++) {
    test(`${actor} ${action} resolves d6 value ${value}`, () => {
      const state = actor === 'rat' ? initial() : heroTurn();
      const success = value >= 4;
      const damage = success ? strength : 0;
      const outcome = resolveAttack(state, { actor, value, action });
      assert.deepEqual(outcome.result, { actor, value, success, damage, action });
      assert.equal(outcome.state.heroHp, state.heroHp - (actor === 'rat' ? damage : 0));
      assert.equal(outcome.state.ratHp, state.ratHp - (actor === 'hero' ? damage : 0));
      assert.equal(outcome.state.actor, actor === 'rat' ? 'hero' : 'rat');
      assert.equal(outcome.state.round, actor === 'rat' ? 1 : 2);
      assert.equal(outcome.state.weapon, true);
    });
  }
}

test('attacks preserve frozen inputs and return a fresh state', () => {
  const state = Object.freeze(heroTurn());
  const choice = Object.freeze({ actor: 'hero', value: 6, action: 'weapon' });
  const before = structuredClone(state);
  const outcome = resolveAttack(state, choice);
  assert.deepEqual(state, before);
  assert.deepEqual(choice, { actor: 'hero', value: 6, action: 'weapon' });
  assert.notEqual(outcome.state, state);
  outcome.state.heroHp = 99;
  assert.deepEqual(state, before);
});

test('rat starts, turns alternate, rounds advance after surviving hero turns', () => {
  let state = initial();
  for (let round = 1; round <= 3; round++) {
    assert.equal(state.actor, 'rat');
    assert.equal(state.round, round);
    state = roll(state, 2).state;
    assert.equal(state.actor, 'hero');
    assert.equal(state.round, round);
    state = roll(state, 3).state;
  }
  assert.equal(state.round, 4);
  assert.equal(state.heroHp, 10);
  assert.equal(state.ratHp, 4);
});

test('each attack succeeds independently, without a shared or opposed roll', () => {
  const ratMiss = roll(initial(), 1).state;
  assert.equal(roll(ratMiss, 4).state.ratHp, 2);
  const ratHit = roll(initial(), 6).state;
  assert.equal(roll(ratHit, 1).state.ratHp, 4);
  assert.equal(ratHit.heroHp, 9);
});

test('lethal attacks clamp HP, stop turns, and reject further resolution', () => {
  const dead = roll(initial({ heroHp: 1 }), 4);
  assert.equal(dead.state.heroHp, 0);
  assert.equal(dead.state.actor, 'rat');
  assert.equal(dead.state.round, 1);
  assert.equal(terminal(dead.state), 'death');
  assert.throws(() => roll(dead.state, 6), RangeError);
  for (const action of ['attack', 'weapon']) {
    const won = roll(heroTurn({ ratHp: 1 }), 4, action);
    assert.equal(won.state.ratHp, 0);
    assert.equal(won.result.damage, 1);
    assert.equal(won.state.actor, 'hero');
    assert.equal(won.state.round, 1);
    assert.equal(terminal(won.state), 'victory');
    assert.throws(() => roll(won.state, 1), RangeError);
  }
  assert.equal(terminal(initial({ heroHp: 0 })), 'death');
  assert.equal(terminal(initial({ ratHp: 0 })), 'victory');
});

test('weapon availability applies only to hero; ordinary attacks remain available', () => {
  assert.throws(() => roll(initial(), 6, 'weapon'), RangeError);
  const state = heroTurn({ weapon: false });
  assert.throws(() => roll(state, 6, 'weapon'), RangeError);
  assert.equal(roll(state, 6).result.damage, 2);
});

test('invalid rolls, turns and actions throw without changing state', () => {
  const state = Object.freeze(initial());
  for (const value of [0, 7, -1, 1.5, '4', null, undefined, NaN, Infinity]) {
    assert.throws(() => resolveAttack(state, { actor: 'rat', value, action: 'attack' }), RangeError);
  }
  for (const choice of [undefined, {}, { actor: 'hero', value: 6, action: 'attack' }, { actor: 'other', value: 6, action: 'attack' }, { actor: 'rat', value: 6, action: 'other' }]) {
    assert.throws(() => resolveAttack(state, choice), RangeError);
  }
  assert.deepEqual(state, initial());
});

test('invalid configuration and malformed state are rejected', () => {
  for (const value of [-1, 1.5, '10', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => initial({ heroHp: value }), RangeError);
    assert.throws(() => initial({ ratHp: value }), RangeError);
  }
  assert.throws(() => initial({ weapon: 'yes' }), TypeError);
  for (const state of [null, [], undefined]) assert.throws(() => terminal(state), TypeError);
  for (const patch of [{ round: 0 }, { round: 1.5 }, { actor: 'other' }, { heroHp: -1 }]) {
    assert.throws(() => terminal({ ...initial(), ...patch }), RangeError);
  }
});
