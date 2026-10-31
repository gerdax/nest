import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createEnemyAction} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
const setup=()=>{const project=createProject(),enemy=createEnemy('enemy');project.library.push(enemy);return {project,enemy,selection:{chapterId:project.activeChapterId,selected:project.chapters[0].startNode,definitionId:enemy.id}};};
const field=(s,path,value)=>applyDocumentCommand(s.project,s.selection,'field',{scope:'definition',path,value,inputType:'text'},new LocalCardDrafts());
const addDie=(s,path)=>applyDocumentCommand(s.project,s.selection,'inspector',{command:'add-rule',scope:'definition',path,ruleKind:'dice'},new LocalCardDrafts());
test('new Enemy Actions and newly added dice default to three d6',()=>{
 const s=setup();assert.deepEqual(s.enemy.actions[0].check.pool,[{sides:6,count:3}]);
 applyDocumentCommand(s.project,s.selection,'inspector',{command:'combat-add',scope:'definition',path:'actions',factory:'enemy-action'},new LocalCardDrafts());
 assert.deepEqual(s.enemy.actions[1].check.pool,[{sides:6,count:3}]);
 addDie(s,'actions.0.check.pool');assert.deepEqual(s.enemy.actions[0].check.pool,[{sides:6,count:3},{sides:6,count:3}]);
});
for(const check of [undefined,{pool:[{sides:20,count:1}],modifier:0,target:10}])test(`enabling an Enemy dice check initializes three d6 from ${check?'the unused stock template':'missing settings'}`,()=>{
 const s=setup();Object.assign(s.enemy.actions[0],{resolution:'direct',check});field(s,'actions.0.resolution','check');
 assert.deepEqual(s.enemy.actions[0].check,createEnemyAction('default').check);
});
test('Enemy custom-check fallback uses three d6 and preserves authored pools',()=>{
 const s=setup();s.enemy.actions[0].check={mode:'stat',modifierVariable:'agility',difficulty:1};field(s,'actions.0.check.mode','custom');
 assert.deepEqual(s.enemy.actions[0].check.pool,[{sides:6,count:3}]);assert.equal(s.enemy.actions[0].check.target,11);
 const authored={pool:[{sides:8,count:2}],modifier:1,target:12};s.enemy.actions[0].check=structuredClone(authored);field(s,'actions.0.resolution','check');assert.deepEqual(s.enemy.actions[0].check,authored);
});
test('ordinary story Actions retain their existing die defaults',()=>{
 const s=setup(),action=createDefinition('action','story');s.project.library.push(action);s.selection.definitionId=action.id;
 addDie(s,'check.pool');assert.deepEqual(action.check.pool,[{sides:20,count:1},{sides:20,count:1}]);
});
