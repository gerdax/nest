import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model-data.js';
import {createEnemy,createEnemyAction,createCombatAction,createWeapon,ensureEnemyPreparationCards,ensureCombatDefaults,migrateEnemyPreparedActions} from '../project/combat-model.js';
import {validateProject} from '../project/validation.js';

function legacy(){
 const project=createProject(),enemy=createEnemy('enemy');enemy.mechanics='opposed-preparation';
 const prepare={...createEnemyAction('prepare'),type:'prepare',resolution:'direct',preparationBonus:2,damageReduction:4};
 enemy.actions.push(prepare);ensureEnemyPreparationCards(enemy);
 enemy.preparationCards.block.text='A custom dodge';enemy.preparationCards.block.imageScale=140;
 enemy.preparationCards.charge.kind='caption';enemy.preparationCards.charge.check.target=15;
 project.library.push(enemy);return {project,enemy,prepare};
}
function migrated(){const fixture=legacy();migrateEnemyPreparedActions(fixture.project);return fixture;}
const messages=project=>validateProject(project).map(error=>error.message).join('\n');

test('legacy prepared cards become Enemy-owned independent profiles with original presentations archived',()=>{
 const {project,enemy,prepare}=legacy(),cards=structuredClone(enemy.preparationCards),attack=structuredClone(enemy.actions[0]);
 migrateEnemyPreparedActions(project);
 assert.deepEqual(enemy.preparationCards,cards);assert.deepEqual(enemy.actions[0],attack);
 assert.equal(prepare.preparedActions.length,2);assert.deepEqual(prepare.preparedActions.map(e=>[e.weight,e.trigger]),[[1,'incoming-hit'],[1,'after-player-action']]);
 const [dodge,rush]=prepare.preparedActions.map(e=>enemy.preparedActions.find(d=>d.id===e.actionId));
 const skip=enemy.preparedActions.find(d=>d.id===prepare.preparedActions[0].fallback.actionId);
 assert.equal(dodge.protection,'all');assert.equal(dodge.damageReduction,1);assert.equal(dodge.text,'A custom dodge');assert.equal(dodge.imageScale,140);
 assert.deepEqual(dodge.check,cards.block.check);assert.equal(dodge.presentationKind,'event');assert.equal(rush.presentationKind,'caption');
 assert.deepEqual(rush.attack,{...attack.attack,damage:{min:3,max:4},minBonus:0,maxBonus:0});assert.deepEqual(rush.check,cards.charge.check);
 assert.equal(skip.type,'wait');assert.equal(skip.resolution,'direct');assert.deepEqual(prepare.preparedActions[0].fallback.when,['defend','wait']);
 enemy.actions[0].attack.damage.max=9;prepare.preparationBonus=6;assert.equal(rush.attack.damage.max,4);assert.equal(rush.attack.maxBonus,0);
 for(const action of [dodge,rush,skip]){assert.deepEqual(action.costs,[]);assert.deepEqual(action.conditions,[]);assert.equal(action.cooldown,0);assert(!enemy.actions.includes(action));}
 assert.deepEqual(validateProject(project),[]);
});

test('migration allocates unique IDs and remains idempotent through defaults and validation',()=>{
 const {project,prepare}=legacy();project.library.push({...createCombatAction('prepare-prepared-rush'),name:'Existing'});
 migrateEnemyPreparedActions(project);assert.equal(prepare.preparedActions[1].actionId,'prepare-prepared-rush-2');
 ensureCombatDefaults(project);const before=structuredClone(project);ensureCombatDefaults(project);migrateEnemyPreparedActions(project);
 assert.deepEqual(project,before);assert.deepEqual(validateProject(project),[]);assert.deepEqual(project,before);
});

test('new Enemy Prepare needs only prepared references, and checked all-protection defense is valid',()=>{
 const {project,enemy,prepare}=migrated();delete prepare.preparationBonus;delete prepare.damageReduction;delete enemy.preparationCards;
 assert.deepEqual(validateProject(project),[]);ensureCombatDefaults(project);assert.equal(enemy.preparationCards,undefined);assert.deepEqual(validateProject(project),[]);
 const defend=enemy.preparedActions.find(d=>d.id===prepare.preparedActions[0].actionId);defend.protection=undefined;
 assert.match(messages(project),/direct Actions|incoming-hit requires/);
});

test('validation rejects invalid prepared references, weights, triggers and fallback',()=>{
 for(const [edit,pattern] of [
  [(p,a)=>a.preparedActions[0].actionId='missing',/expected owned prepared Action missing/],
  [(p,a)=>a.preparedActions[0].weight=0,/positive safe integer/],
  [(p,a)=>a.preparedActions.forEach(e=>e.weight=Number.MAX_SAFE_INTEGER),/weight sum/],
  [(p,a)=>a.preparedActions[0].trigger='later',/invalid prepared Action trigger/],
  [(p,a)=>a.preparedActions[1].trigger='incoming-hit',/incoming-hit requires/],
  [(p,a)=>a.preparedActions[0].fallback.actionId=a.preparedActions[1].actionId,/fallback requires Wait/],
  [(p,a)=>a.preparedActions[0].fallback.when=['wait','wait'],/distinct player Action types/],
  [(p,a)=>a.preparedActions=[],/nonempty list/],
  [(p,a)=>a.preparedActions[1].fallback=a.preparedActions[0].fallback,/fallback requires incoming-hit/],
  [(p,a)=>a.preparedActions[0].fallback.when=['attack'],/distinct player Action types/],
  [(p,a)=>p.library.find(d=>d.kind==='enemy').mechanics=undefined,/requires opposed-preparation/],
 ]){
  const {project,prepare}=migrated();edit(project,prepare);assert.match(messages(project),pattern);
 }
});

test('owned Actions reject unsupported Enemy features and recursion',()=>{
 for(const [edit,pattern] of [
  [a=>a.costs=[{source:'variable',key:'health',amount:1}],/costs must be empty/],
  [a=>a.conditions=[{source:'variable',key:'health',op:'gte',value:1}],/conditions must be empty/],
  [a=>a.cooldown=1,/cooldown must be 0/],
  [a=>a.attack.source='weapon',/cannot use a Weapon/],
  [a=>a.type='prepare',/recursive prepared Actions/],
  [a=>a.check.pool=[],/Invalid Check|invalid check/i],
  [a=>a.effects=[{op:'add',key:'unknown',value:1}],/Invalid variable effect|invalid variable effect/i],
 ]){
  const {project,enemy,prepare}=migrated(),rush=enemy.preparedActions.find(d=>d.id===prepare.preparedActions[1].actionId);edit(rush);assert.match(messages(project),pattern);
 }
});

test('malformed legacy preparation remains unmigrated and visibly invalid',()=>{
 for(const edit of [f=>f.prepare.preparationBonus=0,f=>f.enemy.preparationCards.block.resolution='unknown',f=>f.enemy.preparationCards.charge.check.pool=[],f=>f.enemy.actions[0].attack.damage.max=Infinity]){
  const fixture=legacy();edit(fixture);const before=structuredClone(fixture.project);migrateEnemyPreparedActions(fixture.project);
  assert.deepEqual(fixture.project,before);assert.equal(fixture.prepare.preparedActions,undefined);assert(validateProject(fixture.project).length>0);
 }
});

test('each legacy Prepare gets its own bonus profile and authored references stay untouched',()=>{
 const {project,enemy,prepare}=legacy();
 const second={...structuredClone(prepare),id:'second-prepare',preparationBonus:4};enemy.actions.push(second);
 migrateEnemyPreparedActions(project);
 const rush=action=>enemy.preparedActions.find(d=>d.id===action.preparedActions[1].actionId);
 assert.equal(rush(prepare).attack.damage.max,4);assert.equal(rush(second).attack.damage.max,6);assert.notEqual(rush(prepare).id,rush(second).id);
 prepare.preparedActions[0].weight=7;prepare.preparedActions[0].fallback.when=['prepare','wait'];
 const before=structuredClone(project);migrateEnemyPreparedActions(project);ensureCombatDefaults(project);
 assert.deepEqual(project,before);assert.deepEqual(validateProject(project),[]);
});

test('validation migrates a copy and preserves the authored legacy source document',()=>{
 const {project,prepare}=legacy(),before=structuredClone(project);
 assert.deepEqual(validateProject(project),[]);assert.deepEqual(project,before);assert.equal(prepare.preparedActions,undefined);
});

test('migrated Rush preserves the borrowed Attack progression and outcome effects independently',()=>{
 const {project,enemy,prepare}=legacy(),attack=enemy.actions[0];
 attack.effects=[{op:'add',key:'energy',value:-1}];
 attack.successEffects=[{op:'add',key:'energy',value:1}];
 attack.failureEffects=[{op:'add',key:'energy',value:-2}];
 migrateEnemyPreparedActions(project);
 const rush=enemy.preparedActions.find(d=>d.id===prepare.preparedActions[1].actionId);
 for(const key of ['effects','successEffects','failureEffects']){assert.deepEqual(rush[key],attack[key]);assert.notEqual(rush[key],attack[key]);}
 assert.deepEqual(validateProject(project),[]);
});

test('shared draft migration owns copies per Enemy, reuses a source locally and preserves remaining users',()=>{
 const {project,enemy,prepare}=migrated();
 const source=structuredClone(enemy.preparedActions.find(a=>a.type==='attack'));source.id='common-rush';source.text='Authored rush';source.imageScale=133;
 project.library.push(source);project.combat.defaultActions.push({definitionId:source.id});
 prepare.preparedActions=[{definitionId:source.id,weight:2,trigger:'after-player-action'},{definitionId:source.id,weight:3,trigger:'after-player-action'}];
 delete enemy.preparedActions;
 const second=structuredClone(enemy);second.id='enemy-two';project.library.push(second);
 migrateEnemyPreparedActions(project);
 assert.equal(enemy.preparedActions.length,1);assert.equal(second.preparedActions.length,1);
 assert.equal(prepare.preparedActions[0].actionId,prepare.preparedActions[1].actionId);
 assert.notEqual(enemy.preparedActions[0].id,second.preparedActions[0].id);
 assert.equal(enemy.preparedActions[0].text,'Authored rush');assert.equal(enemy.preparedActions[0].imageScale,133);
 assert(project.library.includes(source));enemy.preparedActions[0].text='Changed';assert.equal(source.text,'Authored rush');assert.equal(second.preparedActions[0].text,'Authored rush');
 const before=structuredClone(project);migrateEnemyPreparedActions(project);assert.deepEqual(project,before);
 project.combat.defaultActions=project.combat.defaultActions.filter(r=>r.definitionId!==source.id);
 // Existing copies are never treated as permission to remove an unrelated common card.
 migrateEnemyPreparedActions(project);assert(project.library.includes(source));
});

test('shared draft sources remain available as player definitions after enemy copying',()=>{
 for(const remaining of [false,true]){
  const {project,enemy,prepare}=migrated(),source=enemy.preparedActions.find(a=>a.type==='attack');
  project.library.push(source);delete enemy.preparedActions;prepare.preparedActions=[{definitionId:source.id,weight:1,trigger:'after-player-action'}];
  if(remaining)project.custom={definitionId:source.id};
  migrateEnemyPreparedActions(project);assert.equal(project.library.includes(source),true);
  assert.notEqual(enemy.preparedActions[0],source);
 }
});

test('prepared references cannot resolve through the Library or another Enemy, and owned IDs cannot collide',()=>{
 const {project,enemy,prepare}=migrated(),other=createEnemy('other');project.library.push(other);
 other.preparedActions=[{...createCombatAction('foreign'),type:'wait',resolution:'direct'}];
 prepare.preparedActions[1].actionId='foreign';assert.match(messages(project),/expected owned prepared Action foreign/);
 prepare.preparedActions[1].actionId=enemy.preparedActions.find(a=>a.type==='attack').id;
 enemy.preparedActions[0].id=enemy.hit.id;assert.match(messages(project),/duplicate embedded identity/);
});

test('save, compile and portable import keep owned Actions detached from Common and other Enemies',async()=>{
 const {saveProject,loadProject}=await import('../project/storage.js');
 const {compileChapter,exportChapter,importChapter}=await import('../project/model.js');
 const {project,enemy}=migrated();
 const chapter=project.chapters[0];chapter.nodes.push({id:'owned-fight',name:'Fight',type:'combat',enemy:{definitionId:enemy.id},x:0,y:0,connections:{}});
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 assert.deepEqual(saveProject(project,storage),{ok:true});
 const loaded=loadProject(storage);const saved=loaded.project??loaded;
 const savedEnemy=saved.library.find(d=>d.id===enemy.id);assert.deepEqual(savedEnemy.preparedActions,enemy.preparedActions);
 const compiled=compileChapter(saved),compiledEnemy=compiled.library.find(d=>d.id===enemy.id);compiledEnemy.preparedActions[0].text='Compiled';assert.notEqual(savedEnemy.preparedActions[0].text,'Compiled');
 const pkg=exportChapter(saved),imported=importChapter(createProject(),pkg);
 const importedEnemy=imported.library.find(d=>d.kind==='enemy');assert.deepEqual(importedEnemy.preparedActions,savedEnemy.preparedActions);
 importedEnemy.preparedActions[0].text='Imported';assert.notEqual(savedEnemy.preparedActions[0].text,'Imported');
 assert(!imported.library.some(d=>d.kind==='combatAction'&&enemy.preparedActions.some(a=>a.id===d.id)));
});


test('shared player and Weapon sources remain independent of owned Enemy copies',()=>{
 const {project,enemy,prepare}=migrated(),source=structuredClone(enemy.preparedActions.find(a=>a.type==='attack'));
 source.id='player-and-enemy';project.library.push(source);
 const weapon=createWeapon('shared-weapon');weapon.combat.actions=[{definitionId:source.id}];project.library.push(weapon);
 prepare.preparedActions=[{definitionId:source.id,weight:1,trigger:'after-player-action'}];delete enemy.preparedActions;
 project.combat.defaultActions.push({definitionId:source.id});ensureCombatDefaults(project);
 const copy=enemy.preparedActions[0],weaponCopy=weapon.combat.actions[0];assert(project.library.includes(source));
 assert.notEqual(copy,source);assert.notEqual(copy,weaponCopy);copy.attack.maxBonus=7;
 assert.notEqual(source.attack.maxBonus,7);assert.notEqual(weaponCopy.attack.maxBonus,7);
 assert.deepEqual(validateProject(project),[]);
});


test('invalid local draft sources retain their authored reference for diagnosis',()=>{
 const {project,enemy,prepare}=migrated(),source=enemy.preparedActions.find(a=>a.type==='attack');
 source.visibility='local';source.chapterId=project.chapters[0].id;project.library.push(source);delete enemy.preparedActions;
 prepare.preparedActions=[{definitionId:source.id,weight:1,trigger:'after-player-action'}];
 const before=structuredClone(project);migrateEnemyPreparedActions(project);assert.deepEqual(project,before);
 assert.match(messages(project),/expected owned prepared Action/);
});

test('existing owned Rush bonuses fold into minimum and maximum damage without changing damage or player profiles',async()=>{
 const {parseProject,compileChapter}=await import('../project/model.js');
 const {combatDefinitionFields}=await import('../studio/combat-authoring.js');
 const {attackDamageRange}=await import('../project/combat-rules.js');
 const {project,enemy}=migrated(),rush=enemy.preparedActions.find(a=>a.type==='attack');
 rush.attack={source:'self',damage:{min:2,max:2},minBonus:2,maxBonus:2};
 const player=project.library.find(d=>d.kind==='combatAction');player.attack.minBonus=2;player.attack.maxBonus=2;
 const playerBefore=structuredClone(player),raw=JSON.stringify(project),loaded=parseProject(raw),owned=loaded.library.find(d=>d.id===enemy.id);
 const simplified=owned.preparedActions.find(a=>a.id===rush.id);
 assert.deepEqual(simplified.attack,{source:'self',damage:{min:4,max:4},minBonus:0,maxBonus:0});
 assert.equal(attackDamageRange(simplified).min,4);assert.equal(attackDamageRange(simplified).max,4);
 assert.deepEqual(loaded.library.find(d=>d.id===player.id),playerBefore);
 assert.equal(JSON.stringify(project),raw);
 const html=combatDefinitionFields(loaded,owned);assert(!html.includes('Minimum damage bonus'));assert(!html.includes('Maximum damage bonus'));
 const compiled=compileChapter(loaded).library.find(d=>d.id===enemy.id).preparedActions.find(a=>a.id===rush.id);
 assert.deepEqual(compiled.attack,simplified.attack);
 ensureCombatDefaults(loaded);assert.deepEqual(owned.preparedActions.find(a=>a.id===rush.id).attack,simplified.attack);
});

test('legacy enemy-only shared checked Dodge is archived per owner without changing valid player sources',()=>{
 const {project,enemy,prepare}=migrated(),source={...createCombatAction('legacy-shared-dodge'),type:'defend',protection:'all',damageReduction:1,resolution:'check',text:'Preserve this Dodge'};
 project.library.push(source);prepare.preparedActions=[{definitionId:source.id,weight:1,trigger:'incoming-hit'}];
 const second=structuredClone(enemy);second.id='second-owner';project.library.push(second);
 migrateEnemyPreparedActions(project);
 assert(!project.library.some(d=>d.id===source.id));
 for(const owner of [enemy,second]){assert.deepEqual(owner.legacyPreparedActionSources,[source]);assert.notEqual(owner.legacyPreparedActionSources[0],source);}
 assert.deepEqual(validateProject(project),[]);
 const before=structuredClone(project);ensureCombatDefaults(project);assert.deepEqual(project,before);
});

test('incompatible legacy Dodge still used by a player is preserved and diagnosed rather than rewritten',()=>{
 const {project,prepare}=migrated(),source={...createCombatAction('legacy-player-dodge'),type:'defend',protection:'all',damageReduction:1,resolution:'check'};
 project.library.push(source);project.combat.defaultActions.push({definitionId:source.id});
 prepare.preparedActions=[{definitionId:source.id,weight:1,trigger:'incoming-hit'}];
 const before=structuredClone(source);migrateEnemyPreparedActions(project);
 assert.deepEqual(project.library.find(d=>d.id===source.id),before);
 assert.match(messages(project),/Defend, Enemy Prepare and Wait are direct Actions/);
});
