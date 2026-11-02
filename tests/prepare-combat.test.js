import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatAction,createEnemy,createWeapon} from '../project/combat-model.js';
import {createEncounter,resolveCombatAttack,completePlayerTurn,completeEnemyTurn,playerChoices} from '../project/combat-rules.js';

const prepare={...createCombatAction('prepare'),type:'prepare',resolution:'direct',preparationBonus:2};
const defend={...createCombatAction('defend'),type:'defend',resolution:'direct',damageReduction:1};
const wait={...createCombatAction('wait'),type:'wait',resolution:'direct'};
const punch=createCombatAction('punch');
const enemy=createEnemy('enemy');
const result=(action,extras={})=>resolveCombatAttack({actor:'player',action,targetHp:10,dice:[4,4,4],...extras});

test('Prepare spends a normal cooldown turn without protection or stacking, and starts fresh each encounter',()=>{
 let state=createEncounter(enemy,'a');
 state=completePlayerTurn(state,{...punch,cooldown:2});
 state=completePlayerTurn(state,prepare);
 assert.equal(state.cooldowns['punch@default'],1);
 assert.equal(state.preparationBonus,2);assert.equal(state.guard,0);
 state=completePlayerTurn(state,prepare);
 assert.equal(state.preparationBonus,2);assert.equal(state.cooldowns['punch@default'],0);
 assert.equal(state.round,4);
 assert.equal(completePlayerTurn(state,{...prepare,preparationBonus:3}).preparationBonus,3);
 assert.equal(createEncounter(enemy,'b').preparationBonus,0);
});

test('preparation survives Enemy turns and expires on the next player action',()=>{
 const state=completePlayerTurn(createEncounter(enemy,'a'),prepare);
 for(const action of [defend,wait])assert.equal(completePlayerTurn(state,action).preparationBonus,0);
 assert.equal(completeEnemyTurn(state,enemy).preparationBonus,2);
 assert.equal(completePlayerTurn(state,punch).preparationBonus,0);
 const noDamage={...punch,attack:{source:'none'}};
 assert.equal(completePlayerTurn(state,noDamage).preparationBonus,0);
 assert.equal(result(noDamage,{preparationBonus:2}).damage,0,'no-damage Attacks do not manufacture damage');
});

test('Prepare accepts player checks and legacy direct resolution; Enemy Prepare remains direct',()=>{
 const resolved=result(prepare,{dice:[],preparationBonus:2,random:()=>assert.fail('no damage sampling')});
 assert.equal(resolved.success,true);assert.equal(resolved.damage,0);
 assert.equal(result({...prepare,resolution:'check'}).success,true);
 assert.throws(()=>result({...prepare,resolution:'check',damageReduction:2},{actor:'enemy'}),/Invalid Prepare/);
 assert.throws(()=>result(prepare,{actor:'enemy',dice:[]}),/Invalid Prepare/);
 assert.equal(createEncounter({...enemy,actions:[prepare]},'a').enemyPreparation,null);
});

test('bonus adds to undefended unarmed, source Weapon and Direct damage before lethal cap',()=>{
 assert.equal(result(punch,{preparationBonus:2}).damage,3);
 const weapon=createWeapon('pistol'),shot={...punch,attack:{source:'weapon',minBonus:0,maxBonus:1}};
 for(const [sample,want] of [[0,3],[.5,4],[.99,5]]) {
  const resolved=result(shot,{source:weapon,preparationBonus:2,random:()=>sample});
  assert.equal(resolved.rolledDamage,want);assert.equal(resolved.preparationBonus,2);
 }
 for(const damageReduction of [1,2,3,Number.MAX_SAFE_INTEGER]){
  const blocked=result(punch,{preparationBonus:2,damageReduction});
  assert.equal(blocked.success,true);assert.equal(blocked.defenseBroken,true);assert.equal(blocked.baseDamage,1);assert.equal(blocked.damage,1);
 }
 assert.equal(result({...punch,resolution:'direct'},{preparationBonus:2,dice:[],targetHp:1}).damage,1);
 assert.equal(result(punch,{actor:'enemy',preparationBonus:2}).damage,1,'player preparation never empowers the Enemy');
});

test('misses deal no prepared damage and invalid/overflowing bonuses cannot enter a result',()=>{
 assert.equal(result(punch,{dice:[1,1,1],preparationBonus:2,random:()=>assert.fail('miss must not sample')}).damage,0);
 for(const bonus of [-1,.5,NaN,Infinity])assert.throws(()=>result(punch,{preparationBonus:bonus}),/Invalid preparation/);
 assert.throws(()=>result({...punch,attack:{source:'self',damage:{min:Number.MAX_SAFE_INTEGER,max:Number.MAX_SAFE_INTEGER}}},{preparationBonus:2}),/supported range/);
 const huge={...punch,attack:{source:'self',damage:{min:1,max:Number.MAX_SAFE_INTEGER}}};
 const compiled={library:[huge,prepare],variables:[],combat:{defaultActions:[{definitionId:huge.id},{definitionId:prepare.id}]}};
 const choices=playerChoices(compiled,{variables:{},inventory:[]},{...createEncounter(enemy,'a'),preparationBonus:2});
 assert.equal(choices[0].disabled,true);assert.match(choices[0].disabledReason,/supported range/);assert.equal(choices[1].disabled,false);
});

test('prepared attacks trade the bonus for full base damage against any positive defense',()=>{
 const ranged={...punch,attack:{source:'self',damage:{min:2,max:6}}};
 for(const damageReduction of [1,4,100,Number.MAX_SAFE_INTEGER])for(const [sample,base] of [[0,2],[.5,4],[.999,6]]){
  let draws=0;
  const resolved=result(ranged,{preparationBonus:2,damageReduction,random:()=>{draws++;return sample;}});
  assert.equal(draws,1);assert.equal(resolved.damage,base);assert.equal(resolved.baseDamage,base);assert.equal(resolved.defenseBroken,true);
 }
 const hidden=result(ranged,{preparationBonus:2,enemyPreparation:{kind:'block',value:100},random:()=>.5});
 assert.equal(hidden.damage,4);assert.deepEqual(hidden.preparationReveal,{kind:'block',value:100});
 assert.equal(result(ranged,{preparationBonus:2,damageReduction:100,targetHp:1,random:()=>.5}).damage,1);
 assert.equal(result(ranged,{preparationBonus:0,damageReduction:100,random:()=>.5}).damage,0);
});
