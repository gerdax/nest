import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,createEnemy,parseProject,validateProject} from '../project/model.js';
import {resolveCombatAttack,attackProfile} from '../project/combat-rules.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

test('legacy default and Weapon Actions gain Attack type without changing their authored mechanics',()=>{
 const p=createProject(),action=p.library.find(d=>d.kind==='combatAction'),weapon=createWeapon('weapon');
 delete action.type;const embedded={...createCombatAction('shoot'),attack:{source:'weapon',minBonus:0,maxBonus:0}};delete embedded.type;weapon.combat.actions.push(embedded);p.library.push(weapon);
 const before=structuredClone(action),loaded=parseProject(JSON.stringify(p));
 assert.deepEqual(loaded.library.find(d=>d.id===action.id),{...before,type:'attack'});assert.equal(loaded.library.find(d=>d.id==='weapon').combat.actions[0].type,'attack');
 assert.equal(loaded.combat.defaultActions.length,p.combat.defaultActions.length);
});
test('Defend and Wait editors expose only their relevant rules and are direct Actions',()=>{
 const p=createProject(),a=p.library.find(d=>d.kind==='combatAction'),s={chapterId:p.chapters[0].id,selected:p.chapters[0].startNode,definitionId:a.id};
 for(const type of ['defend','wait']){
  applyDocumentCommand(p,s,'field',{scope:'definition',path:'type',value:type});
  assert.equal(a.resolution,'direct');assert.equal(attackProfile(a),null);
  const html=definitionInspector(p,a);assert(html.includes('Action type'));assert(!html.includes('Attack properties'));assert(!html.includes('data-path="check.target"'));assert.equal(html.includes('data-path="damageReduction"'),type==='defend');assert.deepEqual(validateProject(p),[]);
 }
});
test('protection reduces actual enemy damage and clamps fully blocked damage at zero',()=>{
 const attack={...createCombatAction('bite'),damage:{min:2,max:2},attack:{source:'self',damage:{min:2,max:2},minBonus:0,maxBonus:0}},args={actor:'enemy',action:attack,targetHp:5,dice:[4,4,4],id:'result'};
 const partial=resolveCombatAttack({...args,damageReduction:1});assert.equal(partial.rolledDamage,2);assert.equal(partial.blockedDamage,1);assert.equal(partial.damage,1);assert.equal(partial.targetHp,4);
 const full=resolveCombatAttack({...args,damageReduction:5});assert.equal(full.damage,0);assert.equal(full.targetHp,5);
});
test('unsupported types, checked support Actions and invalid protection are diagnosed',()=>{
 const p=createProject(),a=p.library.find(d=>d.kind==='combatAction');a.type='flee';assert(validateProject(p).some(e=>e.message.includes('unsupported Combat Action type')));
 a.type='defend';a.damageReduction=0;assert(validateProject(p).some(e=>e.message.includes('damage reduction')));a.damageReduction=1;assert(validateProject(p).some(e=>e.message.includes('direct Actions')));
});

test('Action type appears before Description for Common, Weapon and Enemy editors',()=>{
 const p=createProject(),a=p.library.find(d=>d.kind==='combatAction'),w=createWeapon('weapon'),e=createEnemy('enemy');p.library.push(e);w.combat.actions=[{...createCombatAction('block'),type:'defend',resolution:'direct',damageReduction:1}];p.library.push(w);
 const cases=[[a,'type','text'],[w,'combat.actions.0.type','combat.actions.0.text'],[e,'actions.0.type','actions.0.text']];
 for(const [definition,typePath,textPath] of cases){const html=definitionInspector(p,definition);assert(html.indexOf(`data-path="${typePath}"`)<html.indexOf(`data-path="${textPath}"`));assert.equal(html.split(`data-path="${typePath}"`).length-1,1);}
});
