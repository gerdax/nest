import test from 'node:test';
import assert from 'node:assert/strict';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {createWeapon,createProject,validateProject,exportChapter,importChapter} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';

for(const context of ['common','weapon','enemy'])test(`${context} combat outcome lists validate, render and retain item dependencies in packages`,()=>{
 const project=createRatCombatProject(),reward=createWeapon('outcome-reward');project.library.push(reward);
 const owner=project.library.find(d=>d.id===(context==='common'?project.combat.defaultActions[0].definitionId:context==='weapon'?'pistol':'rat'));
 const action=context==='common'?owner:context==='weapon'?owner.combat.actions[0]:owner.actions[0];
 const prefix=context==='common'?'':context==='weapon'?'combat.actions.0.':'actions.0.';
 action.successEffects=[{op:'addItem',key:reward.id}];action.failureEffects=[{op:'add',key:'energy',value:-1}];
 assert.deepEqual(validateProject(project),[]);
 const html=definitionInspector(project,owner);
 for(const path of ['successEffects.0.key','failureEffects.0.value'])assert(html.includes(`data-path="${prefix}${path}"`));
 assert(html.includes('On success effects · 1'));assert(html.includes('On failure effects · 1'));
 assert(!html.includes('On dice fail'));assert(!html.includes('On dice success'));
 const imported=importChapter(createProject(),exportChapter(project));assert.deepEqual(validateProject(imported),[]);assert(imported.library.some(d=>d.name===reward.name));
 action.resolution='direct';const direct=definitionInspector(project,owner);
 assert(!direct.includes(`data-path="${prefix}successEffects.0.key"`));assert(!direct.includes(`data-path="${prefix}failureEffects.0.value"`));
 assert.equal(action.successEffects.length,1);assert.equal(action.failureEffects.length,1);
 action.resolution='check';action.failureEffects=[{op:'add',key:'health',value:-.5}];
 assert(validateProject(project).some(issue=>issue.message.includes('integer Health values')));
});
