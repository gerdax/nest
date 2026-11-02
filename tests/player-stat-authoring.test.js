import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,createEnemy,parseProject,validateProject} from '../project/model.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {definitionInspector} from '../studio/inspectors.js';
const edit=(project,definition,path,value)=>applyDocumentCommand(project,{chapterId:project.chapters[0].id,definitionId:definition.id},'field',{scope:'definition',path,value,inputType:'text'});
const check=stat=>({mode:'stat',modifierVariable:stat,difficulty:3});

for(const context of ['common','weapon'])test(`${context} player conversions default to the relevant stat and preserve custom checks`,()=>{
 const project=createProject(),action=createCombatAction('stat-action');
 const definition=context==='weapon'?createWeapon('stat-weapon'):action;
 if(context==='weapon')definition.combat.actions=[action];
 project.library.push(definition);const prefix=context==='weapon'?'combat.actions.0.':'';
 const initialCheck=structuredClone(action.check);
 edit(project,definition,prefix+'type','prepare');assert.equal(action.resolution,'direct');assert.deepEqual(action.check,initialCheck);
 edit(project,definition,prefix+'resolution','check');edit(project,definition,prefix+'check.mode','stat');assert.deepEqual(action.check,check('composure'));
 edit(project,definition,prefix+'type','attack');assert.deepEqual(action.check,check('agility'));
 const custom={mode:'custom',pool:[{sides:8,count:2}],modifier:2,target:13};action.check=structuredClone(custom);
 edit(project,definition,prefix+'type','prepare');assert.deepEqual(action.check,custom);
 edit(project,definition,prefix+'type','attack');assert.deepEqual(action.check,custom);
 action.check={};edit(project,definition,prefix+'check.mode','stat');assert.deepEqual(action.check,check('agility'));
 edit(project,definition,prefix+'type','prepare');edit(project,definition,prefix+'resolution','check');action.check={};edit(project,definition,prefix+'check.mode','stat');assert.deepEqual(action.check,check('composure'));
 const html=definitionInspector(project,definition);assert(html.includes(`data-path="${prefix}check.modifierVariable"`));assert.match(html,/failed Prepare clears it/);
 assert.deepEqual(validateProject(project),[]);assert.deepEqual(parseProject(JSON.stringify(project)),project);
});

test('Defend and enemy Prepare expose no check selector and keep legacy resolution and data',()=>{
 const project=createProject(),action=createCombatAction('defending'),enemy=createEnemy('unchanged-enemy');project.library.push(action,enemy);
 const oldCheck=structuredClone(action.check);edit(project,action,'type','defend');assert.equal(action.resolution,'direct');assert.deepEqual(action.check,oldCheck);
 const defend=definitionInspector(project,action);assert(!defend.includes('data-path="check.mode"'));assert(!defend.includes('check-diagnostic'));
 const enemyCheck=structuredClone(enemy.actions[0].check);edit(project,enemy,'actions.0.type','prepare');assert.equal(enemy.actions[0].resolution,'direct');assert.deepEqual(enemy.actions[0].check,enemyCheck);
 const html=definitionInspector(project,enemy);assert(!html.includes('data-path="actions.0.check.mode"'));assert(!html.includes('data-path="stats.'));assert.equal(enemy.stats,undefined);
 assert.deepEqual(validateProject(project),[]);enemy.actions[0].resolution='check';assert(validateProject(project).some(issue=>issue.message.includes('direct Actions')));
});

test('player stat-mode defaults do not change generic story or enemy defaults',()=>{
 const project=createProject(),story=project.library.find(d=>d.kind==='action'),enemy=createEnemy('generic-enemy');project.library.push(enemy);
 story.check={};edit(project,story,'check.mode','stat');assert.equal(story.check.difficulty,1);assert.equal(story.check.modifierVariable,'agility');
 enemy.actions[0].check={};edit(project,enemy,'actions.0.check.mode','stat');assert.equal(enemy.actions[0].check.difficulty,1);
 const before=JSON.stringify(project);parseProject(before);assert.equal(JSON.stringify(project),before);
});


test('player Prepare validates both checked modes and keeps existing direct documents unchanged',()=>{
 const project=createProject(),action=project.library.find(d=>d.kind==='combatAction'&&d.type==='prepare');
 const original=structuredClone(project);assert.equal(action.resolution,'direct');assert.deepEqual(parseProject(JSON.stringify(project)),original);
 action.resolution='check';action.check=check('composure');assert.deepEqual(validateProject(project),[]);
 for(const invalid of [undefined,{}, {...check('composure'),difficulty:0}, {...check('energy')}, {pool:[],modifier:0,target:10}]){
  action.check=invalid;assert(validateProject(project).length>0);
 }
 action.check={mode:'custom',pool:[{sides:8,count:2}],modifier:1,target:8};assert.deepEqual(validateProject(project),[]);
 action.resolution=undefined;assert(validateProject(project).some(issue=>issue.message.includes('requires direct or check resolution')));
});
