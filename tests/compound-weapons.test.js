import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,parseProject,validateProject,compileChapter} from '../project/model.js';
import {migrateWeaponActions} from '../project/combat-model.js';
import {definitionGraph} from '../project/dependencies.js';
import {createEncounter,playerChoices,completePlayerTurn} from '../project/combat-rules.js';

function legacyWeaponProject(){
 const project=createProject(),action={...createCombatAction('shoot'),name:'Shoot',image:'shoot.png',imageScale:125,attack:{source:'weapon',minBonus:1,maxBonus:2},cooldown:2},weapon=createWeapon('pistol');
 weapon.combat.actions=[{definitionId:action.id}];project.library.push(action,weapon);return {project,action,weapon};
}
test('legacy Weapon links migrate to detached, stable embedded Actions and remove only copied unreferenced sources',()=>{
 const {project,action,weapon}=legacyWeaponProject(),orphan=createCombatAction('unused-authored');project.library.push(orphan);const original=JSON.stringify(project);
 const parsed=parseProject(original),embedded=parsed.library.find(d=>d.id===weapon.id).combat.actions[0];
 assert.equal(JSON.stringify(project),original);assert.deepEqual(embedded,action);assert.equal(embedded.definitionId,undefined);
 assert(!parsed.library.some(d=>d.id===action.id));assert(parsed.library.some(d=>d.id===orphan.id));
 assert.equal(JSON.stringify(parseProject(JSON.stringify(parsed))),JSON.stringify(parsed));
 embedded.attack.minBonus=7;assert.equal(action.attack.minBonus,1);
});
test('migration keeps sources used by Common defaults or any remaining authored reference',()=>{
 const {project,action,weapon}=legacyWeaponProject();project.combat.defaultActions.push({definitionId:action.id});
 migrateWeaponActions(project);assert(project.library.includes(action));assert.notEqual(weapon.combat.actions[0],action);
 const next=legacyWeaponProject();next.project.customContent={definitionId:next.action.id};migrateWeaponActions(next.project);assert(next.project.library.includes(next.action));
});
test('missing and wrong-kind legacy sources remain visible errors; duplicate embedded Action IDs are rejected',()=>{
 const {project,weapon}=legacyWeaponProject();weapon.combat.actions=[{definitionId:'missing'}];const before=JSON.stringify(project);
 assert(validateProject(project).some(e=>e.message.includes('missing')));assert.equal(JSON.stringify(project),before);assert.throws(()=>parseProject(before),/missing/);
 weapon.combat.actions=[{definitionId:'player-hit'}];assert(validateProject(project).some(e=>e.message.includes('expected combatAction')));
 weapon.combat.actions=[createCombatAction('same'),createCombatAction('same')];assert(validateProject(project).some(e=>e.message.includes('duplicate Provided combat Action')));
 const ambiguous=legacyWeaponProject();ambiguous.project.library.push({...ambiguous.action});migrateWeaponActions(ambiguous.project);
 assert.equal(ambiguous.weapon.combat.actions[0].definitionId,'shoot');assert.equal(ambiguous.project.library.filter(d=>d.id==='shoot').length,2);
});
test('legacy local Action sources retain their ownership and invalid reference for diagnosis',()=>{
 const {project,action,weapon}=legacyWeaponProject();action.visibility='local';action.chapterId=project.chapters[0].id;
 const original=JSON.stringify(project);migrateWeaponActions(project);assert.equal(JSON.stringify(project),original);
 assert.equal(weapon.combat.actions[0].definitionId,action.id);assert(project.library.includes(action));
 assert(validateProject(project).some(e=>e.message.includes('shared Library')));assert.throws(()=>parseProject(original),/shared Library/);
});
test('embedded Action rules are validated and traversed as Weapon dependencies',()=>{
 const project=createProject(),weapon=createWeapon('wand'),item=project.library.find(d=>d.kind==='item'),action=createCombatAction('use');
 action.conditions=[{source:'inventory',key:item.id,op:'has'}];weapon.combat.actions=[action];project.library.push(weapon);assert.deepEqual(validateProject(project),[]);
 assert(definitionGraph(project).users(item.id).some(r=>r.sourceDefinition?.id==='wand'&&r.path.includes('actions')));
 action.costs=[{source:'variable',key:'missing-energy',amount:1}];assert(validateProject(project).some(e=>e.message.includes('invalid cost')||e.message.includes('Energy costs')));
});
test('runtime uses owned Actions independently from Library and isolates cooldown by source Weapon',()=>{
 const {project,weapon}=legacyWeaponProject();migrateWeaponActions(project);const second=structuredClone(weapon);second.id='rifle';second.combat.damage={min:4,max:5};
 project.library.push(second);const compiled=compileChapter(project),run={variables:{energy:20},inventory:[weapon,second]},encounter=createEncounter({health:10,attacks:[{}]},'fight');
 let choices=playerChoices(compiled,run,encounter);assert.equal(choices.find(c=>c.id==='shoot@rifle').profile.min,5);
 const state=completePlayerTurn(encounter,weapon.combat.actions[0],weapon);choices=playerChoices(compiled,run,state);
 assert(choices.find(c=>c.id==='shoot@pistol').disabled);assert(!choices.find(c=>c.id==='shoot@rifle').disabled);
 choices.find(c=>c.id==='shoot@pistol').action.name='Changed';assert.equal(weapon.combat.actions[0].name,'Shoot');
});
