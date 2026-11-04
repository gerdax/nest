import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,createEnemy,createEnemyAction,createCombatAction,createWeapon,parseProject,validateProject} from '../project/model.js';
import {enemyActionSelection} from '../project/combat-rules.js';
import {combatDefinitionFields} from '../studio/combat-authoring.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

function fixture(){
 const project=createProject(),enemy=createEnemy('enemy');project.library.push(enemy);
 const field=(path,value,inputType='text',definition=enemy)=>applyDocumentCommand(project,{definitionId:definition.id},'field',{scope:'definition',path,value,inputType});
 return {project,enemy,field};
}
test('Enemy action selection defaults read without injecting fields and explicit modes round trip',()=>{
 const {project,enemy,field}=fixture(),before=structuredClone(project);
 assert.equal(enemyActionSelection(enemy),'order');
 const html=combatDefinitionFields(project,enemy);
 assert.match(html,/<h3>Combat Actions<\/h3><label class="field">Action selection<select/);
 assert.match(html,/<option value="order" selected/);
 assert(html.includes('Actions play from top to bottom, then repeat. Random weights are ignored.'));
 assert.deepEqual(project,before);
 enemy.mechanics='opposed-preparation';assert.equal(enemyActionSelection(enemy),'random');
 assert.match(combatDefinitionFields(project,enemy),/<option value="random" selected/);
 assert(combatDefinitionFields(project,enemy).includes('One action is selected each enemy turn using Random weights. Equal weights mean equal chances.'));
 delete enemy.mechanics;
 for(const mode of ['random','order']){
  field('actionSelection',mode);field('actions.0.weight','3','number');
  const restored=parseProject(JSON.stringify(project)),copy=restored.library.find(d=>d.id===enemy.id);
  assert.equal(copy.actionSelection,mode);assert.equal(copy.actions[0].weight,3);
  assert.deepEqual(validateProject(restored),[]);
 }
 assert.equal(enemy.actions[0].weight,3);
});
test('normal actions alone have Random weight, while prepared-choice weights remain independent',()=>{
 const {project,enemy}=fixture();enemy.mechanics='opposed-preparation';
 enemy.actions=[{...createEnemyAction('prepare'),type:'prepare',preparedActions:[{actionId:'response',weight:4,trigger:'after-player-action'}]}];
 enemy.preparedActions=[{...createCombatAction('response'),type:'wait',resolution:'direct'}];
 const before=structuredClone(enemy),html=combatDefinitionFields(project,enemy);
 assert.match(html,/Random weight<input[^>]+data-path="actions.0.weight"[^>]+step="1" min="1"[^>]+value="1"/);
 assert(html.includes('Ignored in Order; kept when switching modes.'));
 assert(html.includes('data-path="actions.0.preparedActions.0.weight"'));
 assert(!html.includes('data-path="preparedActions.0.weight"'));
 assert.equal((html.match(/>Random weight</g)||[]).length,1);
 assert.equal((html.match(/>Add prepared action<\/button>/g)||[]).length,1);
 assert(html.indexOf('<h3>Prepared actions</h3>')>html.indexOf('<h3>Combat Actions</h3>'));
 assert(html.includes('data-enemy-action-type="prepare"'));assert(html.includes('data-enemy-action-type="wait"'));
 assert.deepEqual(enemy,before);
});
test('field commands reject invalid modes and non-positive or unsafe weights without changing the Enemy',()=>{
 const {project,enemy,field}=fixture();
 for(const mode of ['', 'weighted','Random',undefined])assert.throws(()=>field('actionSelection',mode),/random or order/);
 for(const value of ['', '0','-1','1.5','Infinity','NaN','9007199254740992'])assert.throws(()=>field('actions.0.weight',value,'number'),/positive integer/);
 assert(!Object.hasOwn(enemy,'actionSelection'));assert(!Object.hasOwn(enemy.actions[0],'weight'));
 const player=createCombatAction('player');project.library.push(player);
 assert.throws(()=>field('actionSelection','random','text',player),/only available for Enemy/);
 assert(!Object.hasOwn(player,'actionSelection'));
});
test('Enemy validation rejects invalid selection, weights and unsafe total in both modes',()=>{
 for(const mode of ['random','order']){
  const {project,enemy}=fixture();enemy.actionSelection=mode;
  assert.deepEqual(validateProject(project),[]);
  for(const weight of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined]){
   enemy.actions[0].weight=weight;
   assert(validateProject(project).some(error=>error.message.includes('Enemy Action weight must be a positive safe integer')),String(weight));
  }
  enemy.actions[0].weight=Number.MAX_SAFE_INTEGER;enemy.actions.push(createEnemyAction('second'));
  assert(validateProject(project).some(error=>error.message.includes('Enemy Action weight sum')));
  enemy.actions.pop();delete enemy.actions[0].weight;
  for(const value of ['',null,undefined,'weighted']){
   enemy.actionSelection=value;assert(validateProject(project).some(error=>error.message.includes('Enemy actionSelection')));
  }
 }
});
test('player and weapon controls remain free of enemy mode, weights and type tints',()=>{
 const {project}=fixture(),player=createCombatAction('player'),weapon=createWeapon('weapon');
 weapon.combat.actions=[createCombatAction('weapon-action')];
 for(const definition of [player,weapon]){
  const before=structuredClone(definition),html=combatDefinitionFields(project,definition);
  for(const value of ['actionSelection','Random weight','data-enemy-action-type'])assert(!html.includes(value));
  assert.deepEqual(definition,before);
 }
 const css=readFileSync(new URL('../studio/editor.css',import.meta.url),'utf8');
 for(const type of ['attack','defend','prepare','wait'])assert(css.includes(`.card-panel[data-card-type="enemy"] [data-enemy-action-type="${type}"]`));
});

test('invalid Enemy selection drafts render without mutating the invalid saved value',()=>{
 const {project,enemy}=fixture();
 for(const value of ['broken',null,undefined]){
  enemy.actionSelection=value;const before=structuredClone(enemy);
  assert.doesNotThrow(()=>combatDefinitionFields(project,enemy));assert.deepEqual(enemy,before);
 }
});
