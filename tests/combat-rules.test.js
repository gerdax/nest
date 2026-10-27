import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, resolveAttack, terminal, sampleAttackEffects, DEFAULT_POOL, DEFAULT_TARGET, rollTotal } from '../combat/rules.js';

import { effectCards, linearCard, introCard, choices } from '../combat/cards.js';

const attack = (state, options = {}) => resolveAttack(state, {
  actor: state.actor, action: 'attack', value: 11, rolledDamage: 1, ...options
});
const physical = values => values.map(value => ({ sides: 6, value }));
const heroState = options => ({ ...initial(options), actor: 'hero' });

test('three d6 summed against eleven retains exactly 50% hit odds', () => {
  assert.deepEqual(DEFAULT_POOL, [{ sides: 6, count: 3 }]);
  assert.equal(DEFAULT_TARGET, 11);
  let hits = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const value = rollTotal([a, b, c].map(value => ({ sides: 6, value })));
    if (attack(initial(), { value, rolledDamage: value >= 11 ? 1 : 0 }).result.success) hits++;
  }
  assert.equal(hits, 108);
});

test('turns and descriptive poison resolve immutably with supplied damage', () => {
  const start = Object.freeze(initial());
  const choice = Object.freeze({ actor: 'rat', action: 'attack', value: 11, rolledDamage: 2, specialSuccess: true });
  const rat = resolveAttack(start, choice);
  assert.deepEqual(rat.result, { ...choice, success: true, damage: 2, poisoned: true });
  assert.equal(start.heroHp, 10);
  assert.equal(rat.state.heroHp, 8);
  assert.equal(rat.state.actor, 'hero');
  assert.equal(rat.state.burstReload, 0);
  assert.equal(Object.hasOwn(rat.state, 'poisoned'), false);
  const hero = attack(rat.state, { action: 'weapon', rolledDamage: 3 });
  assert.equal(hero.state.ratHp, 1);
  assert.equal(hero.state.round, 2);
  assert.equal(hero.state.actor, 'rat');
  assert.equal(hero.state.burstReload, 1);
  assert.equal(rat.state.ratHp, 4);
});

test('misses normalize absent damage; lethal hits clamp and retain terminal turns', () => {
  const miss = attack(initial(), { value: 10, rolledDamage: undefined });
  assert.deepEqual(miss.result, { actor: 'rat', action: 'attack', value: 10, success: false, damage: 0, rolledDamage: 0, specialSuccess: false, poisoned: false });
  const death = attack(initial({ heroHp: 1 }), { rolledDamage: 2, specialSuccess: true });
  assert.equal(death.result.damage, 1);
  assert.equal(death.result.rolledDamage, 2);
  assert.equal(death.state.actor, 'rat');
  assert.equal(death.state.round, 1);
  assert.equal(terminal(death.state), 'death');
  assert.throws(() => attack(death.state));
  const win = attack(heroState({ ratHp: 1 }), { action: 'weapon', rolledDamage: 3 });
  assert.equal(win.result.damage, 1);
  assert.equal(win.state.actor, 'hero');
  assert.equal(win.state.round, 1);
  assert.equal(win.state.burstReload, 1);
  assert.equal(terminal(win.state), 'victory');
});

for (const value of [8, 11]) test(`Burst reload skips exactly the next hero choice after total ${value}`, () => {
  let state = heroState({ ratHp: 20 });
  state = attack(state, { action: 'weapon', value, rolledDamage: value >= 11 ? 3 : 0 }).state;
  assert.equal(state.burstReload, 1);
  assert.equal(state.round, 2);
  state = attack(state, { value: 10, rolledDamage: 0 }).state;
  assert.equal(state.actor, 'hero');
  assert.equal(state.burstReload, 1, 'rat turn cannot advance reload');
  assert.throws(() => attack(state, { action: 'weapon' }), /unavailable/);
  state = attack(state, { value, rolledDamage: value >= 11 ? 2 : 0 }).state;
  assert.equal(state.burstReload, 0, 'next Shoot clears reload on hit or miss');
  state = attack(state, { value: 10, rolledDamage: 0 }).state;
  assert.equal(state.actor, 'hero');
  assert.equal(attack(state, { action: 'weapon', rolledDamage: 1 }).state.burstReload, 1);
});

test('damage, special success, state, actor, action, totals and absent weapon are validated', () => {
  for (const state of [initial(), heroState()]) {
    for (const rolledDamage of [undefined, 0, -1, 3, 1.5, NaN, Infinity, '1']) assert.throws(() => attack(state, { rolledDamage }));
  }
  for (const rolledDamage of [undefined, 0, -1, 4, 2.5]) assert.throws(() => attack(heroState(), { action: 'weapon', rolledDamage }));
  for (const rolledDamage of [1, null, '0', NaN]) assert.throws(() => attack(initial(), { value: 10, rolledDamage }));
  for (const specialSuccess of [1, 'true', null]) assert.throws(() => attack(initial(), { specialSuccess }));
  assert.throws(() => attack(initial(), { value: 10, rolledDamage: 0, specialSuccess: true }));
  assert.throws(() => attack(initial(), { poisoned: true }), /derived/);
  assert.equal(attack(heroState(), { specialSuccess: true }).result.poisoned, false);
  for (const value of [1, 2, 19, NaN, 11.5]) assert.throws(() => attack(initial(), { value }));
  for (const dice of [[], [{ sides: 6, value: 6 }], Array(3).fill({ sides: 6, value: 7 }), Array(3).fill({ sides: 20, value: 4 })]) assert.throws(() => rollTotal(dice));
  assert.throws(() => attack(initial(), { actor: 'hero' }));
  assert.throws(() => attack(initial(), { actor: 'other' }));
  assert.throws(() => attack(initial(), { action: 'weapon' }));
  assert.throws(() => attack(initial(), { action: 'other' }));
  assert.throws(() => attack(heroState({ weapon: false }), { action: 'weapon' }));
  for (const burstReload of [-1, 2, undefined, 0.5, '0']) assert.throws(() => terminal({ ...initial(), burstReload }));
});

for (const [actor, action, maximum] of [['hero', 'attack', 2], ['hero', 'weapon', 3], ['rat', 'attack', 2]]) {
  test(`${actor} ${action} samples uniform damage bins using one RNG draw per hit`, () => {
    const counts = Array(maximum).fill(0);
    for (let bin = 0; bin < maximum; bin++) for (let sample = 0; sample < 100; sample++) {
      let calls = 0;
      const result = sampleAttackEffects({ actor, action, value: 11, dice: physical([4, 4, 3]) }, () => { calls++; return (bin + sample / 100) / maximum; });
      counts[result.rolledDamage - 1]++;
      assert.equal(result.specialSuccess, false);
      assert.equal(calls, 1);
    }
    assert.deepEqual(counts, Array(maximum).fill(100));
    for (const [random, damage] of [[0, 1], [1 - Number.EPSILON, maximum]]) {
      assert.equal(sampleAttackEffects({ actor, action, value: 18, dice: physical([6, 6, 6]) }, () => random).rolledDamage, damage);
    }
  });
}

test('actual dice determine special success for all actors and only rat specials cause poison', () => {
  for (const actor of ['rat', 'hero']) for (const [values, specialSuccess] of [[[6, 3, 2], true], [[4, 4, 3], false], [[6, 1, 1], false], [[6, 6, 1], true], [[6, 6, 6], true]]) {
    const value = values.reduce((sum, die) => sum + die, 0);
    let calls = 0;
    const effects = sampleAttackEffects({ actor, action: 'attack', value, dice: physical(values) }, () => { calls++; return 0.75; });
    assert.deepEqual(effects, { rolledDamage: value >= 11 ? 2 : 0, specialSuccess });
    assert.equal(calls, value >= 11 ? 1 : 0);
    const resolved = attack(actor === 'rat' ? initial() : heroState(), { value, ...effects });
    assert.equal(resolved.result.specialSuccess, specialSuccess);
    assert.equal(resolved.result.poisoned, actor === 'rat' && specialSuccess);
    assert.equal(resolved.result.damage, value >= 11 ? 2 : 0, 'multiple sixes do not add damage');
    assert.deepEqual(Object.keys(resolved.state).sort(), Object.keys(initial()).sort());
  }
});

test('all 216 physical rolls produce 108 hits and 73 special successes', () => {
  let hits = 0, specials = 0, draws = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const value = a + b + c;
    const effects = sampleAttackEffects({ actor: 'rat', action: 'attack', value, dice: physical([a, b, c]) }, () => { draws++; return 0; });
    if (effects.rolledDamage) hits++;
    if (effects.specialSuccess) specials++;
    assert.equal(effects.specialSuccess, value >= 11 && [a, b, c].includes(6));
  }
  assert.equal(hits, 108);
  assert.equal(specials, 73);
  assert.equal(draws, 108);
});

test('miss sampling consumes no RNG; dice totals, inputs and RNG outputs are validated', () => {
  const hit = { actor: 'hero', action: 'attack', value: 11, dice: physical([6, 3, 2]) };
  for (const actor of ['rat', 'hero']) assert.deepEqual(sampleAttackEffects({ actor, action: 'attack', value: 8, dice: physical([6, 1, 1]) }, () => { throw new Error('must not draw'); }), { rolledDamage: 0, specialSuccess: false });
  for (const bad of [-0.01, 1, Infinity, NaN, '0.5', undefined]) assert.throws(() => sampleAttackEffects(hit, () => bad));
  for (const input of [{}, { ...hit, actor: 'rat', action: 'weapon' }, { ...hit, action: 'other' }, { ...hit, value: 19 }, { ...hit, value: 12 }, { ...hit, dice: undefined }, { ...hit, dice: [null, ...physical([6, 5])] }, { ...hit, dice: [,...physical([6, 5])] }, { ...hit, dice: physical([6, 5]) }]) assert.throws(() => sampleAttackEffects(input));
  assert.throws(() => sampleAttackEffects(hit, null));
});

test('intro uncovers front; effect interiors uncover fronts and final effect stages reverse',()=>{const state=initial(),cards=effectCards(state,{actor:'rat',damage:1,poisoned:true},{statuses:true}),successor={content:choices(state),presentation:'open'};assert.equal(introCard(state).nextTransition,'reveal');assert.equal(linearCard(cards,0,successor).nextTransition,'reveal');assert.equal(linearCard(cards,1,successor).nextTransition,'flip');assert.deepEqual(linearCard(cards,1,successor).nextDeckPreview,successor);for(const card of cards){assert.equal(card.effects,undefined);assert.equal(card.costs,undefined);}});


test('special status cards require a special success and never stack per six', () => {
 const state=initial();
 for(const specialSuccess of [false,true]) {
  const rat=effectCards(state,{actor:'rat',damage:1,poisoned:specialSuccess,specialSuccess},{statuses:false});
  assert.equal(rat.length,specialSuccess?2:1);
  const hero=effectCards(state,{actor:'hero',damage:1,specialSuccess},{statuses:true});
  assert.equal(hero.length,specialSuccess?2:1);
 }
 assert.equal(effectCards(state,{actor:'hero',damage:1,specialSuccess:true},{statuses:false}).length,1);
});


test('rat condition captions appear once at crossed thirds, using only the strongest crossed threshold',()=>{
 const captions=(hp,damage,max=4)=>effectCards({...initial(),ratHp:hp},{actor:'hero',damage},{ratStartingHp:max}).slice(1);
 assert.deepEqual(captions(3,1),[]);
 assert.equal(captions(2,1)[0].text,'Rat seems weakened.');
 assert.equal(captions(1,1)[0].text,'Rat seems severely hurt.');
 assert.equal(captions(1,3).length,1);
 assert.equal(captions(1,3)[0].text,'Rat seems severely hurt.');
 assert.deepEqual(captions(0,2),[],'lethal hit has no condition caption');
 assert.equal(captions(6,3,9)[0].text,'Rat seems weakened.');
 assert.deepEqual(captions(5,1,9),[],'same range does not repeat');
 assert.equal(captions(3,2,9)[0].text,'Rat seems severely hurt.');
 assert.deepEqual(captions(2,1,9),[],'severe range does not repeat');
 assert.deepEqual(captions(2,0),[],'miss has no caption');
 const cards=effectCards({...initial(),ratHp:2},{actor:'hero',damage:1});
 assert.equal(cards[1].cardKind,'caption');
 assert.equal(cards[1].resourcePresentation,undefined);
 assert.equal(linearCard(cards,0,{content:choices(initial())}).nextTransition,'reveal');
 assert.equal(linearCard(cards,1,{content:choices(initial())}).nextTransition,'flip');
});


test('mockup Burst succeeds on nine with 160 of 216 outcomes; other attacks retain eleven',()=>{
 let hits=0;
 for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++){
  const value=a+b+c,dice=physical([a,b,c]);
  const effects=sampleAttackEffects({actor:'hero',action:'weapon',value,dice},()=>0);
  const resolved=attack(heroState(),{action:'weapon',value,...effects});
  if(resolved.result.success)hits++;
  assert.equal(resolved.result.success,value>=9);
  assert.equal(resolved.result.specialSuccess,value>=9&&[a,b,c].includes(6));
 }
 assert.equal(hits,160);
 const burst=choices(heroState()).actions.find(action=>action.id==='weapon');
 assert.equal(burst.checkInfo.formula,'3d6 ≥ 9');
 assert.equal(burst.checkInfo.chance,'74');
 for(const actor of ['hero','rat'])assert.equal(attack(actor==='hero'?heroState():initial(),{value:9,rolledDamage:0}).result.success,false);
});


test('combat actions declare native check targets before any swipe exposes the check reverse',()=>{
 const cards=choices(heroState()).actions;
 assert.equal(cards.find(a=>a.id==='attack').checkTarget,11);
 assert.equal(cards.find(a=>a.id==='weapon').checkTarget,9);
 assert.equal(choices({...heroState(),burstReload:1}).actions.find(a=>a.id==='weapon').checkTarget,9);
});
