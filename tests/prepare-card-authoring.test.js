import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {ensureCombatDefaults} from '../project/combat-model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

function fixture(){
 const project=ensureCombatDefaults(createAlternativeRatCombatProject()),chapter=project.chapters[0],enemy=project.library.find(d=>d.id==='rat');
 const index=enemy.actions.findIndex(action=>action.type==='prepare'),prepare=enemy.actions[index];
 const action=type=>enemy.preparedActions.find(d=>prepare.preparedActions.some(ref=>ref.actionId===d.id)&&d.type===type);
 return {project,chapter,enemy,index,prepare,action};
}
test('alternative Enemy exposes owned prepared selections and archives legacy card controls',()=>{
 const {project,enemy,index,prepare}=fixture(),original=structuredClone(enemy),html=definitionInspector(project,enemy);
 assert(html.includes('<h3>Prepared actions</h3>'));
 assert.match(html,/One action is selected each enemy turn using Random weights\./);
 assert.match(html,/Prepare secretly picks one/);
 assert.match(html,/Equal weights mean equal chances/);
 for(const [i,ref] of prepare.preparedActions.entries()){
  for(const key of ['actionId','weight','trigger'])assert(html.includes(`data-path="actions.${index}.preparedActions.${i}.${key}"`));
  assert(!html.includes(`data-definition="${ref.actionId}"`));
 }
 assert(!html.includes('data-path="preparationCards.'));
 assert(!html.includes(`data-path="actions.${index}.preparationBonus"`));
 assert(!html.includes(`data-path="actions.${index}.damageReduction"`));
 assert.deepEqual(enemy,original);
 const classic=createRatCombatProject(),classicHtml=definitionInspector(classic,classic.library.find(d=>d.id==='rat'));
 assert(classicHtml.includes('Actions play from top to bottom, then repeat. Random weights are ignored.'));
 assert(!classicHtml.includes('<h3>Prepared actions</h3>'));
});

test('Dodge and Rush edit their independent owned checks through normal field and dice commands',()=>{
 const {project,chapter,enemy,action}=fixture(),actions=structuredClone(enemy.actions),archive=structuredClone(enemy.preparationCards);
 for(const type of ['defend','attack']){
  const definition=action(type),selection={chapterId:chapter.id,definitionId:enemy.id},prefix=`preparedActions.${enemy.preparedActions.indexOf(definition)}.`;
  definition.resolution='check';definition.check={pool:[{sides:6,count:3}],modifier:0,target:10};
  const edit=(path,value,inputType='text')=>applyDocumentCommand(project,selection,'field',{scope:'definition',path:prefix+path,value,inputType});
  const dice=(command,index)=>applyDocumentCommand(project,selection,'inspector',{scope:'definition',command,path:prefix+'check.pool',ruleKind:'dice',index});
  let html=definitionInspector(project,enemy);
  for(const suffix of ['mode','pool.0.sides','pool.0.count','modifier','modifierVariable','target'])assert(html.includes(`data-path="${prefix}check.${suffix}"`));
  for(const path of ['conditions','costs','cooldown'])assert(!html.includes(`data-path="${prefix}${path}"`));
  for(const path of ['effects','successEffects','failureEffects'])assert(html.includes(`data-path="${prefix}${path}"`));
  assert(html.includes('Enemy preparation requires no costs/requirements and zero cooldown.'));
  edit('check.target','14','number');assert.equal(definition.check.target,14);
  dice('add-rule');edit('check.pool.1.sides','8','number');assert.equal(definition.check.pool[1].sides,8);dice('remove-rule',1);assert.equal(definition.check.pool.length,1);
  edit('check.mode','stat');edit('check.modifierVariable','agility');edit('check.difficulty','4','number');
  html=definitionInspector(project,enemy);assert(html.includes(`data-path="${prefix}check.difficulty"`));assert(!html.includes(`data-path="${prefix}check.pool.0.count"`));
  edit('check.mode','custom');
  const check=structuredClone(definition.check);
  edit('resolution','direct');assert(!definitionInspector(project,enemy).includes(`data-path="${prefix}check.mode"`));
  edit('resolution','check');assert.deepEqual(definition.check,check);
 }
 assert.deepEqual(enemy.actions,actions);assert.deepEqual(enemy.preparationCards,archive);
});

test('legacy classic Enemy Prepare and player Prepare retain numeric fields',()=>{
 const {project,enemy,index,prepare}=fixture();delete enemy.mechanics;delete prepare.preparedActions;delete enemy.preparedActions;
 const html=definitionInspector(project,enemy);
 for(const key of ['preparationBonus','damageReduction'])assert(html.includes(`data-path="actions.${index}.${key}"`));
 assert(!html.includes('<h3>Prepared actions</h3>'));
 const player=project.library.find(d=>d.kind==='combatAction'&&d.type==='prepare'),playerHtml=definitionInspector(project,player);
 assert(playerHtml.includes('data-path="preparationBonus"'));assert(!playerHtml.includes('data-path="damageReduction"'));
 for(const key of ['cooldown','conditions','costs','resolution'])assert(playerHtml.includes(`data-path="${key}"`));
});

test('prepared presentation and artwork edit owned action without changing archival source cards',()=>{
 const {project,chapter,enemy,prepare}=fixture(),archive=structuredClone(enemy.preparationCards);
 const definition=enemy.preparedActions.find(d=>d.id===prepare.preparedActions[0].fallback.actionId),selection={chapterId:chapter.id,definitionId:enemy.id},prefix=`preparedActions.${enemy.preparedActions.findIndex(d=>d.id===prepare.preparedActions[0].fallback.actionId)}.`;
 const edit=(path,value,inputType='text')=>applyDocumentCommand(project,selection,'field',{scope:'definition',path:prefix+path,value,inputType});
 edit('presentationKind','event');edit('name','Shield clash');edit('text','A custom block.');edit('image','custom-block.png');edit('imageScale','145','range');
 assert.equal(definition.name,'Shield clash');assert.equal(definition.text,'A custom block.');assert.equal(definition.image,'custom-block.png');assert.equal(definition.imageScale,145);
 const html=definitionInspector(project,enemy);assert(html.includes(`data-path="${prefix}presentationKind"`));assert(html.includes(`data-path="${prefix}image"`));assert(html.includes(`data-path="${prefix}imageScale"`));
 assert.deepEqual(enemy.preparationCards,archive);
});
