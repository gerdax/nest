import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,createEnemy,ensureCombatDefaults,validateProject} from '../project/model.js';
import {applyActionProtection,completePlayerTurn} from '../project/combat-rules.js';
import {combatCard} from '../project/combat-presentation.js';

test('player defense retains V1 numeric guard bookkeeping without enemy protection flags',()=>{
 const state={round:1,cooldowns:{},guard:0,enemyGuard:2,preparationBonus:2};
 const defend={...createCombatAction('defend'),type:'defend',resolution:'direct',damageReduction:3,protection:'all'};
 assert.deepEqual(applyActionProtection(state,'player',defend),{...state,guard:3});
 const result=completePlayerTurn(state,defend,null);
 assert.equal(result.guard,3);assert.equal(result.preparationBonus,0);assert(!Object.hasOwn(result,'guardAll'));assert(!Object.hasOwn(result,'enemyGuardAll'));
 const enemy=applyActionProtection(state,'enemy',defend);assert.equal(enemy.enemyGuardAll,true);
});

for(const context of ['common','weapon'])test(`${context} player Defend still requires Direct while enemy Dodge may check`,()=>{
 const project=createProject(),action={...createCombatAction('custom-player-defense'),type:'defend',resolution:'check',damageReduction:1,protection:'all'};
 if(context==='common')project.library.push(action);else {const weapon=createWeapon('weapon');weapon.combat.actions=[action];project.library.push(weapon);}
 assert(validateProject(project).some(error=>error.message.includes('Defend, Enemy Prepare and Wait are direct Actions')));
 const enemy=createEnemy('enemy');enemy.preparedActions=[{...action,id:'enemy-dodge'}];project.library=project.library.filter(d=>!['custom-player-defense','weapon'].includes(d.id));project.library.push(enemy);
 assert.deepEqual(validateProject(project),[]);
});

test('enemy presentation kinds do not change player cards or suppress their V1 action layout',()=>{
 const action={...createCombatAction('attack'),text:'Deal [DMG]',attack:{source:'self',damage:{min:4,max:4},minBonus:0,maxBonus:0}};
 const player=combatCard(action,'card');
 assert.deepEqual(combatCard({...action,presentationKind:'caption'},'card'),player);
 assert.equal(player.cardKind,'action');assert.equal(player.typeLabel,'ATTACK');
 const enemy=combatCard({...action,presentationKind:'caption'},'card',{enemy:true});assert.equal(enemy.cardKind,'caption');assert.equal(enemy.text,'Deal 4');
});

test('enemy upgrades preserve all existing player action definitions and combat assignments',()=>{
 const project=createProject(),enemy=createEnemy('enemy');
 enemy.mechanics='opposed-preparation';enemy.actions.push({...createCombatAction('enemy-prepare'),type:'prepare',resolution:'direct',preparationBonus:2,damageReduction:4});project.library.push(enemy);
 const playerDefinitions=structuredClone(project.library.filter(d=>d.kind==='combatAction')),settings=structuredClone(project.combat);
 ensureCombatDefaults(project);
 assert.deepEqual(project.library.filter(d=>d.kind==='combatAction'),playerDefinitions);assert.deepEqual(project.combat,settings);
 assert(enemy.preparedActions.length>0);
});
