import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createCombatAction,createWeapon,createEnemy} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {rules} from '../studio/forms.js';
import {definitionInspector,nodeInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

const effect=()=>({op:'add',key:'energy',value:1});
function assertOutcomes(html,path,scope,{failure=true,success=true}={}) {
 const inputs=[];
 for(const [key,label,checked] of [['onDiceFailure','On dice fail',failure],['onDiceSuccess','On dice success',success]]) {
  const start=html.indexOf(`data-path="${path}.${key}"`);
  assert.ok(start>=0,`Missing ${path}.${key}`);
  const input=html.slice(html.lastIndexOf('<input',start),html.indexOf('>',start)+1);
  assert.ok(input.includes(`data-scope="${scope}"`));assert.ok(input.includes('type="checkbox"'));
  assert.equal(input.includes('checked'),checked);assert.ok(!input.includes('disabled'));
  assert.ok(html.slice(start,html.indexOf('</label>',start)).includes(label));inputs.push(start);
 }
 assert.ok(inputs[0]<inputs[1]);
 const footer=html.slice(html.lastIndexOf('<div class="rule-entry-actions progression-entry-actions">',inputs[0]),html.indexOf('</button>',inputs[1]));
 assert.match(footer,/<div class="progression-outcome-controls">/);
 assert.match(footer,/On dice success<\/label><\/div><button[^>]*data-command="remove-rule"/);
 assert.ok(html.indexOf(`data-path="${path}.value"`)<inputs[0]);
}

test('normal Action progression outcomes default checked and stay visible on Direct and Dice check',()=>{
 const project=createProject(),action={...createDefinition('action','outcomes'),effects:[effect()]};project.library.push(action);
 const before=structuredClone(action);
 assertOutcomes(definitionInspector(project,action),'effects.0','definition');
 assert.deepEqual(action,before,'rendering does not write implicit defaults');
 action.resolution='check';action.effects[0].onDiceFailure=false;
 const html=definitionInspector(project,action);
 assertOutcomes(html,'effects.0','definition',{failure:false});
 assert.ok(html.includes('Direct actions ignore these boxes.'));
});

test('shared, local and placement override Action paths expose outcome flags',()=>{
 const project=createProject(),chapter=project.chapters[0],action={...createDefinition('action','outcomes'),effects:[effect()]};project.library.push(action);
 const placement={id:'outcome-placement',definitionId:action.id},node={id:'outcome-fork',type:'fork',choices:[placement],connections:{}};chapter.nodes=[node];
 action.visibility='local';action.chapterId=chapter.id;
 assertOutcomes(nodeInspector(project,chapter,node),'effects.0','local-definition');
 action.visibility='shared';placement.overrides={effects:[{...effect(),onDiceSuccess:false}]};
 assertOutcomes(nodeInspector(project,chapter,node),'overrides.effects.0','placement',{success:false});
});

test('common Combat Action, Weapon and Enemy progression effects use the shared controls',()=>{
 const project=createProject(),action=createCombatAction('outcomes');action.effects=[effect()];project.library.push(action);
 assertOutcomes(definitionInspector(project,action),'effects.0','definition');
 const weapon=createWeapon('weapon');weapon.combat.actions=[structuredClone(action)];project.library.push(weapon);
 assertOutcomes(definitionInspector(project,weapon),'combat.actions.0.effects.0','definition');
 const enemy=createEnemy('enemy');enemy.actions[0].effects=[effect()];project.library.push(enemy);
 assertOutcomes(definitionInspector(project,enemy),'actions.0.effects.0','definition');
});

test('outcome controls stay off requirements, costs, collection and legacy outcome lists',()=>{
 const project=createProject(),action={...createDefinition('action','outcomes'),resolution:'check',effects:[effect()],conditions:[{source:'variable',key:'energy',op:'gte',value:1}],costs:[{source:'variable',key:'energy',amount:1}],successEffects:[effect()],failureEffects:[effect()]};project.library.push(action);
 const html=definitionInspector(project,action);
 assert.equal((html.match(/\.onDiceFailure"/g)||[]).length,1);
 assert.equal((html.match(/\.onDiceSuccess"/g)||[]).length,1);
 assert.ok(html.includes('data-path="successEffects.0.value"'));assert.ok(html.includes('data-path="failureEffects.0.value"'));
 for(const path of ['onCollect','effects','successEffects','failureEffects'])assert.doesNotMatch(rules(project,[effect()],path,'definition','effects'),/On dice fail|On dice success/);
});

test('item reference links precede the progression checkbox footer',()=>{
 const project=createProject(),item=project.library.find(d=>d.kind==='item');
 const html=rules(project,[{op:'addItem',key:item.id}],'effects','definition','effects',{diceOutcomes:true});
 const links=html.indexOf('<div class="item-effect-reference">'),footer=html.indexOf('<div class="rule-entry-actions progression-entry-actions">');
 assert.ok(links>=0&&links<footer);assert.ok(html.slice(links,footer).includes('Go to definition'));
 assert.match(html.slice(footer),/On dice success<\/label><\/div><button[^>]*data-command="remove-rule"/);
});

test('flag edits remain boolean and survive resolution changes without being cleared',()=>{
 const project=createProject(),action={...createDefinition('action','outcomes'),effects:[effect()]};project.library.push(action);
 const selection={chapterId:project.chapters[0].id,definitionId:action.id};
 for(const key of ['onDiceFailure','onDiceSuccess'])applyDocumentCommand(project,selection,'field',{scope:'definition',path:`effects.0.${key}`,inputType:'checkbox',checked:false});
 for(const resolution of ['check','direct']) {
  applyDocumentCommand(project,selection,'field',{scope:'definition',path:'resolution',value:resolution});
  assert.equal(action.effects[0].onDiceFailure,false);assert.equal(action.effects[0].onDiceSuccess,false);
  assertOutcomes(definitionInspector(project,action),'effects.0','definition',{failure:false,success:false});
 }
});
