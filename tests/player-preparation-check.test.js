import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {ProjectController} from '../project/ProjectController.js';
import {createAlternativeRatCombatProject} from '../project/combat-fixture.js';
import {createEncounter,completePlayerTurn,resolveCombatAttack} from '../project/combat-rules.js';
import {compileChapter} from '../project/model.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({declaration='block',dice=[],health=10}={}){
 const compiled=compileChapter(createAlternativeRatCombatProject()),enemy=compiled.library.find(d=>d.id==='rat');
 Object.assign(compiled.library.find(d=>d.name==='Preparation'),{resolution:'check',check:{mode:'stat',modifierVariable:'composure',difficulty:3}});
 const node=compiled.nodes.find(n=>n.type==='combat');node.introEnabled=false;
 const deck=new EventTarget();Object.assign(deck,{phase:'closed',mount:{inert:false},state:{busy:false},content:{id:'initial'},replaceContent(content,options={}){this.content=content;this.phase=options.presentation==='open'?'choices':'closed';},async transitionContent(content,options){this.replaceContent(content,options);return true;},waitForDeparture(){return new Promise(resolve=>this.depart=resolve);}});
 const samples=declaration==='bite'?[0]:[.75,declaration==='block'?0:.75],rolls=[],feedback=[],errors=[];
 let won=0,draws=0;
 const host={deck,compiled,generation:1,serial:0,variables:{health,energy:3,agility:3,intelligence:3,composure:3},inventory:[],rng:()=>{draws++;return samples.shift()??0;},notify(){},error(error){errors.push(error);},async rollCheck(pool,options){rolls.push({pool,...options});const next=dice.shift()??[4,4,4];if(next instanceof Error)throw next;return {dice:next};},async onCheckResult(result){feedback.push(result);},combatVictoryReason:()=>'',completeCombatVictory(){won++;},commitCombatDamage(...args){return ProjectController.prototype.commitCombatDamage.apply(this,args);},commitCombatEffects(...args){return ProjectController.prototype.commitCombatEffects.apply(this,args);},deathDestination(){return this.variables.health<=0?{}:null;},handoffDeath(){this.combat.dispose();this.combat=null;}};
 const c=host.combat=new CombatCoordinator(host,enemy,node);
 return {host,c,deck,rolls,feedback,errors,samples,dice,get won(){return won;},get draws(){return draws;}};
}
async function swipe(h){const promise=h.c.accept({contentId:h.deck.content.id,action:{id:h.deck.content.actions[0].id}});await tick();h.deck.depart?.();await promise;}
async function select(h,name){const choice=h.c.choices().find(choice=>choice.action.name===name);assert(choice);const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();h.deck.depart?.();await promise;}
async function prepared(h){await h.c.start();assert.equal(h.c.phase,'enemy-action');assert.equal(h.deck.content.heading,'The rat prepares…');await swipe(h);assert.equal(h.c.phase,'choice');assert.equal(h.rolls.length,0);}

const checkedPrepare={id:'prepare',type:'prepare',resolution:'check',preparationBonus:2,check:{mode:'stat',modifierVariable:'composure',difficulty:3}};
const resolve=(action,variables,dice=[3,3,3],actor='player')=>resolveCombatAttack({actor,action,values:variables,dice,targetHp:8});

test('Composure decides checked Preparation independently of Agility, without damage',()=>{
 for(const [composure,agility,success] of [[4,1,true],[3,10,false]]){
  const result=resolve(checkedPrepare,{composure,agility});
  assert.equal(result.success,success);assert.equal(result.total,9+composure);assert.equal(result.target,13);assert.equal(result.damage,0);
 }
 assert.throws(()=>resolve({...checkedPrepare,damageReduction:4},{composure:10},[6,6,6],'enemy'),/Invalid Prepare/);
 assert.equal(resolve({...checkedPrepare,resolution:'direct'},{},[]).success,true);
});

test('failed Preparation clears an earlier bonus and consumes its normal cooldown turn',()=>{
 const enemy=compileChapter(createAlternativeRatCombatProject()).library.find(d=>d.id==='rat');
 const initial={...createEncounter(enemy,'test'),preparationBonus:3,cooldowns:{'attack@default':2}};
 const failed=completePlayerTurn(initial,{...checkedPrepare,cooldown:1},null,{success:false});
 assert.equal(failed.preparationBonus,0);assert.equal(failed.round,2);assert.deepEqual(failed.cooldowns,{'attack@default':1,'prepare@default':1});assert.equal(failed.guard,0);
 const passed=completePlayerTurn(failed,checkedPrepare,null,{success:true});
 assert.equal(passed.preparationBonus,2);assert.equal(completePlayerTurn(passed,checkedPrepare,null,{success:true}).preparationBonus,2);
 assert.equal(initial.preparationBonus,3);assert.equal(initial.cooldowns['attack@default'],2);
});

for(const opposed of [true,false])test(`failed Preparation reports FAIL and enemy retaliates (${opposed?'opposed':'classic'})`,async()=>{
 const h=harness({declaration:'charge',dice:[[1,1,1],[4,4,4]]});await prepared(h);
 if(!opposed){h.c.opposed=false;h.c.declaration=null;}
 h.c.encounter.preparationBonus=3;
 if(!opposed){h.c.encounter.actionIndex=0;h.c.encounter.enemyPreparation=null;}
 await select(h,'Preparation');
 assert.equal(h.feedback[0].label,'FAIL');assert.equal(h.feedback[0].success,false);assert.equal(h.c.encounter.preparationBonus,0);assert.equal(h.c.encounter.round,2);
 assert.equal(h.c.pending.actor,'enemy');assert.equal(h.c.pending.damage,opposed?4:2);assert.equal(h.rolls.length,2);assert.equal(h.host.variables.health,10);
 await swipe(h);assert.equal(h.host.variables.health,opposed?6:8);h.c.dispose();
});

test('Preparation freezes Composure before payment and retry applies costs and effects once',async()=>{
 const h=harness(),action=h.host.compiled.library.find(d=>d.name==='Preparation');
 action.costs=[{source:'variable',key:'composure',amount:1},{source:'variable',key:'energy',amount:1}];
 action.successEffects=[{op:'add',key:'energy',value:1}];action.cooldown=2;
 await prepared(h);let finish;const nativeRoll=h.host.rollCheck;
 h.host.rollCheck=async(pool,options)=>{h.rolls.push({pool,...options});return new Promise(resolve=>finish=resolve);};
 const promise=select(h,'Preparation');await tick();assert.equal(h.host.variables.composure,2);assert.equal(h.host.variables.energy,2);
 h.host.variables.composure=1;
 const native=h.host.onCheckResult;let fail=true;h.host.onCheckResult=async result=>{await native(result);if(fail){fail=false;throw new Error('Feedback unavailable');}};
 finish({dice:[4,3,3]});await promise;h.host.rollCheck=nativeRoll;
 assert.equal(h.c.phase,'error');assert.equal(h.feedback[0].total,13);assert.equal(h.feedback[0].success,true);assert.equal(h.c.encounter.round,1);
 await h.c.retry();assert.equal(h.rolls.length,1);assert.equal(h.host.variables.energy,2);assert.equal(h.c.encounter.preparationBonus,2);assert.equal(h.c.encounter.round,2);assert.equal(h.c.encounter.cooldowns[`${action.id}@default`],2);
 await swipe(h);assert.equal(h.host.variables.energy,3);assert.equal(h.host.variables.composure,1);assert.equal(h.c.encounter.round,2);h.c.dispose();
});

test('Attack uses Agility independently, while rat attacks keep their fixed check',()=>{
 const compiled=compileChapter(createAlternativeRatCombatProject()),attack=compiled.library.find(d=>d.name==='Attack'),rat=compiled.library.find(d=>d.id==='rat');
 assert.equal(attack.check.modifierVariable,'agility');
 assert.equal(resolve(attack,{agility:4,composure:1}).success,true);assert.equal(resolve(attack,{agility:3,composure:10}).success,false);
 assert.equal(rat.stats,undefined);
 for(const agility of [1,10]){
  const result=resolve(rat.actions[0],{agility,composure:agility},[3,3,3],'enemy');
  assert.equal(result.total,9);assert.equal(result.target,10);assert.equal(result.success,false);
 }
});

test('Defend remains direct and guarantees the block regardless of player stats',async()=>{
 const h=harness({declaration:'charge',dice:[[4,4,4],[3,3,3]]});await prepared(h);
 const choice=h.c.choices().find(choice=>choice.action.type==='defend');assert.equal(choice.action.resolution,'direct');
 const shown=h.deck.content.actions.find(action=>action.id===choice.id);assert.equal(shown.checkInfo,undefined);
 h.host.variables.agility=10;h.host.variables.composure=10;
 const promise=h.c.accept({contentId:h.deck.content.id,action:{id:choice.id}});await tick();assert.equal(h.rolls.length,0);assert.equal(h.host.variables.energy,2);
 h.deck.depart();await promise;assert.deepEqual(h.rolls.map(roll=>roll.color),['black']);assert.equal(h.host.variables.health,10);assert.equal(h.c.pending.damage,0);assert.equal(h.c.phase,'effects');assert.equal(h.deck.content.text,'You blocked the attack');await swipe(h);assert.equal(h.c.phase,'choice');h.c.dispose();
});
