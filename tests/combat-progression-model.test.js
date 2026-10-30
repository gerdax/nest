import test from 'node:test';
import assert from 'node:assert/strict';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {createWeapon,validateProject,compileChapter,exportChapter,importChapter,createProject} from '../project/model.js';
import {deleteDefinition} from '../project/dependencies.js';

for(const context of ['common','weapon','enemy'])for(const type of ['attack','defend','wait'])test(`${context} ${type} supports validated portable progression effects`,()=>{
 const project=createRatCombatProject(),reward=createWeapon('progression-reward');project.library.push(reward);
 const action=context==='common'?project.library.find(d=>d.id===project.combat.defaultActions[0].definitionId)
  :context==='weapon'?project.library.find(d=>d.id==='pistol').combat.actions[0]:project.library.find(d=>d.id==='rat').actions[0];
 action.type=type;if(type!=='attack')action.resolution='direct';if(type==='defend')action.damageReduction=1;
 action.effects=[{op:'add',key:'energy',value:1},{op:'addItem',key:reward.id}];
 assert.deepEqual(validateProject(project),[]);
 const compiled=compileChapter(project);assert(compiled.library.some(d=>d.id===reward.id));
 const imported=importChapter(createProject(),exportChapter(project));assert.deepEqual(validateProject(imported),[]);
 assert.throws(()=>deleteDefinition(project,reward.id));
 action.effects.push({op:'add',key:'missing-variable',value:1});assert(validateProject(project).length>0);
});

test('progression support does not enable independent Feedback or outcome-specific combat effects',()=>{
 const project=createRatCombatProject(),action=project.library.find(d=>d.id===project.combat.defaultActions[0].definitionId);
 action.successEffects=[{op:'add',key:'energy',value:1}];assert(validateProject(project).some(i=>i.message.includes('outcome-specific combat effects')));
 action.successEffects=[];project.library.find(d=>d.id===project.combat.playerHit.definitionId).effects=[{op:'add',key:'energy',value:1}];
 assert(validateProject(project).some(i=>i.message.includes('presentation only')));
});

test('combat Health progression keeps the existing integer Health contract',()=>{
 for(const context of ['common','weapon','enemy']){
  const project=createRatCombatProject();
  const action=context==='common'?project.library.find(d=>d.id===project.combat.defaultActions[0].definitionId)
   :context==='weapon'?project.library.find(d=>d.id==='pistol').combat.actions[0]:project.library.find(d=>d.id==='rat').actions[0];
  action.effects=[{op:'add',key:'health',value:-.5}];assert(validateProject(project).some(i=>i.message.includes('integer Health values')));
  action.effects=[{op:'add',key:'energy',value:.5}];assert.deepEqual(validateProject(project),[]);
 }
});

test('player combat costs allow Health and Energy and preserve hidden-badge flags in packages',()=>{
 const project=createRatCombatProject(),punch=project.library.find(d=>d.id===project.combat.defaultActions[0].definitionId);
 punch.costs=[{source:'variable',key:'health',amount:1,hideBadge:true},{source:'variable',key:'energy',amount:1,hideBadge:false}];
 assert.deepEqual(validateProject(project),[]);
 const imported=importChapter(createProject(),exportChapter(project));
 const copy=imported.library.find(d=>d.id!==punch.id&&d.name===punch.name)||imported.library.find(d=>d.id===punch.id);
 assert(copy);assert(imported.library.some(d=>d.costs?.some(c=>c.key==='health'&&c.hideBadge===true)));
 punch.costs[0].hideBadge='true';assert(validateProject(project).some(i=>i.message.includes('invalid cost')));
 punch.costs[0].hideBadge=true;punch.costs[0].amount=.5;assert(validateProject(project).some(i=>i.message.includes('Health costs require integer')));
});
