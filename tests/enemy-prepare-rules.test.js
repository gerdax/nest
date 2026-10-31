import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatAction,createEnemy} from '../project/combat-model.js';
import {createEncounter,resolveCombatAttack,settleEnemyPreparation} from '../project/combat-rules.js';

const attack={...createCombatAction('hit'),resolution:'direct',attack:{source:'self',damage:{min:4,max:4}}};
const prepare={...attack,type:'prepare',preparationBonus:3,damageReduction:2};
const block={kind:'block',value:2},bonus={kind:'attack',value:3};
const resolve=(action=attack,extras={})=>resolveCombatAttack({actor:'enemy',action,targetHp:20,dice:[],...extras});
const encounter=()=>createEncounter(createEnemy('enemy'),'encounter');
const settle=(preparation,result)=>settleEnemyPreparation({...encounter(),enemyPreparation:preparation},result).enemyPreparation;

test('enemy Prepare samples once, choosing block below .5 and attack from .5',()=>{
 for(const [draw,want] of [[0,block],[.499999,block],[.5,bonus],[.999999,bonus]]){
  let samples=0;
  const result=resolve(prepare,{random:()=>{samples++;return draw;}});
  assert.equal(samples,1);assert.deepEqual(result.enemyPreparation,want);
  assert.equal(result.preparationReveal,null);assert.equal(result.rolledDamage,0);
  assert.equal(result.damage,0);assert.equal(result.preparationBonus,0);
 }
 assert.equal(resolve().enemyPreparation,null);
 assert.equal(resolve().preparationReveal,null);
});

test('enemy Prepare validates direct resolution, both positive safe values and random draws',()=>{
 for(const field of ['preparationBonus','damageReduction'])for(const value of [undefined,null,0,-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>resolve({...prepare,[field]:value},{random:()=>assert.fail('invalid action must not sample')}),/Invalid Prepare/);
 }
 assert.throws(()=>resolve({...prepare,resolution:'check'}),/Invalid Prepare/);
 for(const draw of [-.1,1,NaN,Infinity,undefined,'0.5'])assert.throws(()=>resolve(prepare,{random:()=>draw}),/Invalid preparation random/);
});

test('malformed hidden preparations and prepared damage overflow are rejected before sampling',()=>{
 for(const enemyPreparation of [false,0,'attack',{},[],{kind:'other',value:2},{kind:'block',value:0},{kind:'attack',value:-1},{kind:'attack',value:.5},{kind:'attack',value:Infinity},{kind:'attack',value:Number.MAX_SAFE_INTEGER+1}]){
  assert.throws(()=>resolve(attack,{enemyPreparation,random:()=>assert.fail('must not sample')}),/Invalid enemy preparation/);
 }
 const huge={...attack,attack:{source:'self',damage:{min:0,max:Number.MAX_SAFE_INTEGER}}};
 assert.throws(()=>resolve(huge,{enemyPreparation:bonus,random:()=>assert.fail('overflow must not sample')}),/supported range/);
 assert.equal(resolve(attack,{enemyPreparation:block}).damage,4);
});

test('block uses the maximum guard, reveals on a damaging player hit and expires on any player Attack',()=>{
 for(const [guard,blocked] of [[0,2],[1,2],[3,3]]){
  const result=resolve(attack,{actor:'player',enemyPreparation:block,damageReduction:guard});
  assert.equal(result.blockedDamage,blocked);assert.equal(result.damage,4-blocked);
  assert.deepEqual(result.preparationReveal,block);assert.equal(settle(block,result),null);
 }
 const miss={...attack,resolution:'check'};
 const zero={...attack,attack:{source:'self',damage:{min:0,max:0}}};
 const noProfile={...attack,attack:{source:'none'}};
 for(const [action,extras] of [[miss,{dice:[1,1,1]}],[zero,{}],[noProfile,{}]]){
  const result=resolve(action,{actor:'player',enemyPreparation:block,random:()=>assert.fail('must not sample'),...extras});
  assert.equal(result.rolledDamage,0);assert.equal(result.preparationReveal,null);
  assert.equal(settle(block,result),null);
 }
});

test('attack preparation adds before protection and health cap; player preparation stays player-only',()=>{
 const result=resolve(attack,{enemyPreparation:bonus,preparationBonus:100,damageReduction:2,targetHp:3});
 assert.equal(result.rolledDamage,7);assert.equal(result.blockedDamage,2);assert.equal(result.damage,3);
 assert.equal(result.preparationBonus,0);assert.deepEqual(result.preparationReveal,bonus);
 assert.equal(settle(bonus,result),null);
 const zero=resolve({...attack,attack:{source:'self',damage:{min:0,max:0}}},{enemyPreparation:bonus});
 assert.equal(zero.damage,3);assert.deepEqual(zero.preparationReveal,bonus);assert.equal(settle(bonus,zero),null);
 const player=resolve(attack,{actor:'player',enemyPreparation:bonus,preparationBonus:2});
 assert.equal(player.rolledDamage,6);assert.equal(player.preparationBonus,2);
 assert.equal(player.preparationReveal,null);assert.deepEqual(settle(bonus,player),bonus);
 const randomAttack={...attack,attack:{source:'self',damage:{min:0,max:2}}};
 let samples=0;
 const rolledZero=resolve(randomAttack,{enemyPreparation:bonus,random:()=>{samples++;return 0;}});
 assert.equal(samples,1);assert.equal(rolledZero.rolledDamage,3);assert.equal(settle(bonus,rolledZero),null);
});

test('attack preparation survives misses, absent damage profiles and support from either actor',()=>{
 for(const [action,extras] of [
  [{...attack,resolution:'check'},{dice:[1,1,1]}],
  [{...attack,attack:{source:'none'}},{}],
  [{...attack,type:'wait'},{}],
  [{...attack,type:'defend',damageReduction:1},{}],
  [attack,{actor:'player'}],
 ]){
  const result=resolve(action,{enemyPreparation:bonus,...extras});
  assert.equal(result.preparationReveal,null);assert.deepEqual(settle(bonus,result),bonus);
 }
 for(const actor of ['enemy','player'])for(const type of ['wait','defend']){
  const result=resolve({...attack,type,damageReduction:1},{actor,enemyPreparation:block});
  assert.deepEqual(settle(block,result),block);
 }
});

test('Prepare replaces either hidden branch without stacking, settlement clones state, and encounters reset',()=>{
 for(const previous of [null,block,bonus])for(const draw of [0,.5]){
  const before={...encounter(),enemyPreparation:previous};
  const snapshot=structuredClone(before);
  const result=resolve(prepare,{enemyPreparation:previous,random:()=>draw});
  const next=settleEnemyPreparation(before,result);
  assert.deepEqual(next.enemyPreparation,draw===0?block:bonus);assert.deepEqual(before,snapshot);
  assert.notEqual(next,before);assert.notEqual(next.enemyPreparation,result.enemyPreparation);
 }
 const state={...encounter(),enemyPreparation:bonus};
 const next=settleEnemyPreparation(state,resolve({...attack,type:'wait'}));
 assert.notEqual(next.enemyPreparation,state.enemyPreparation);
 assert.equal(encounter().enemyPreparation,null);
 assert.equal(createEncounter({...createEnemy('enemy'),actions:[prepare]},'new').enemyPreparation,null);
});
