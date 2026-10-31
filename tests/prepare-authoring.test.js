import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createWeapon,createCombatAction,parseProject,validateProject} from '../project/model.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {combatActionSummary,commonLibrary} from '../studio/common-library.js';
import {combatReferenceList} from '../studio/combat-authoring.js';

const edit=(project,definition,path,value,inputType='text')=>applyDocumentCommand(project,{chapterId:project.chapters[0].id,definitionId:definition.id},'field',{scope:'definition',path,value,inputType});
const typeOptions=(html,path='type')=>html.match(new RegExp(`<select[^>]*data-path="${path.replaceAll('.','\\.')}"[^>]*>(.*?)</select>`,'s'))?.[1];

for(const context of ['common','weapon'])test(`${context} Prepare edits and roundtrips with hidden Attack fields and shared rules preserved`,()=>{
 const project=createProject(),action=createCombatAction('preparable');
 action.attack={source:context==='weapon'?'weapon':'self',damage:{min:1,max:3},minBonus:0,maxBonus:0};
 action.conditions=[{source:'variable',key:'energy',op:'gte',value:1}];
 action.costs=[{source:'variable',key:'energy',amount:1}];
 action.effects=[{op:'add',key:'energy',value:1}];
 action.successEffects=[{op:'add',key:'energy',value:2}];
 action.failureEffects=[{op:'add',key:'energy',value:-1}];
 action.cooldown=2;
 let definition=action,prefix='';
 if(context==='weapon'){definition=createWeapon('preparing-weapon');definition.combat.actions=[action];prefix='combat.actions.0.';}
 project.library.push(definition);
 const saved=structuredClone(action);
 edit(project,definition,prefix+'type','prepare');
 assert.equal(action.preparationBonus,2);assert.equal(action.resolution,'direct');
 edit(project,definition,prefix+'preparationBonus','5','number');
 const html=definitionInspector(project,definition),options=typeOptions(html,prefix+'type');
 assert.match(options,/value="prepare" selected/);assert.doesNotMatch(options,/value="wait"/);
 for(const key of ['attack.source','check.target','resolution','successEffects','failureEffects'])assert(!html.includes(`data-path="${prefix}${key}"`),key);
 for(const key of ['preparationBonus','cooldown','conditions.0.key','costs.0.amount','effects.0.value'])assert(html.includes(`data-path="${prefix}${key}"`),key);
 for(const key of ['attack','check','successEffects','failureEffects','conditions','costs','effects','cooldown'])assert.deepEqual(action[key],saved[key],key);
 assert.deepEqual(validateProject(project),[]);
 const loaded=parseProject(JSON.stringify(project));
 const restored=loaded.library.find(d=>d.id===definition.id);
 const loadedAction=context==='weapon'?restored.combat.actions[0]:restored;
 assert.deepEqual(loadedAction,action);
 edit(loaded,restored,prefix+'type','attack');
 assert.deepEqual(loadedAction.attack,saved.attack);assert.deepEqual(loadedAction.check,saved.check);
 edit(loaded,restored,prefix+'type','prepare');assert.equal(loadedAction.preparationBonus,5);
 assert.deepEqual(validateProject(loaded),[]);
});

test('Common Prepare summary and assignment use its bonus despite retained Weapon attack fields',()=>{
 const project=createProject(),action=createCombatAction('common-prepare');
 action.attack.source='weapon';project.library.push(action);edit(project,action,'type','prepare');
 edit(project,action,'preparationBonus','4','number');
 applyDocumentCommand(project,{},'use-common-action',{id:action.id});
 assert(project.combat.defaultActions.some(ref=>ref.definitionId===action.id));
 assert.match(combatActionSummary(project,action).join(' '),/\+4 damage to your next Attack/);
 assert.match(commonLibrary(project),/>Prepare<\/span>/);
 assert.match(combatReferenceList(project,project.combat.defaultActions,'combat.defaultActions','Actions'),/value="common-prepare" selected/);
 assert.deepEqual(validateProject(project),[]);
});

test('Prepare validates its direct resolution and positive safe integer bonus',()=>{
 const project=createProject(),action=createCombatAction('prepare-validation');project.library.push(action);
 edit(project,action,'type','prepare');
 for(const bonus of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'2',NaN,Infinity]){
  action.preparationBonus=bonus;
  assert(validateProject(project).some(issue=>issue.message.includes('positive safe integer preparation bonus')),String(bonus));
 }
 for(const bonus of [1,2,Number.MAX_SAFE_INTEGER]){action.preparationBonus=bonus;assert.deepEqual(validateProject(project),[]);}
 action.resolution='check';assert(validateProject(project).some(issue=>issue.message.includes('direct Actions')));
});

test('Enemy selector offers Prepare and commands initialize its direct hidden preparation',()=>{
 const project=createProject(),enemy=createEnemy('enemy');project.library.push(enemy);
 const options=typeOptions(definitionInspector(project,enemy),'actions.0.type');
 for(const type of ['attack','defend','prepare','wait'])assert(options.includes(`value="${type}"`));
 edit(project,enemy,'actions.0.type','prepare');
 assert.equal(enemy.actions[0].resolution,'direct');
 assert.equal(enemy.actions[0].preparationBonus,2);assert.equal(enemy.actions[0].damageReduction,1);
 assert.deepEqual(validateProject(project),[]);
 assert.deepEqual(parseProject(JSON.stringify(project)).library.find(d=>d.id===enemy.id),enemy);
});

test('Existing player Wait and legacy Attack migration preserve saved content and do not add Prepare',()=>{
 const project=createProject(),wait=createCombatAction('old-wait');
 Object.assign(wait,{type:'wait',resolution:'direct',text:'Keep waiting',preparationBonus:7});project.library.push(wait);
 const original=JSON.stringify(project),loaded=parseProject(original),action=loaded.library.find(d=>d.id===wait.id);
 assert.deepEqual(action,wait);
 assert.match(typeOptions(definitionInspector(loaded,action)),/value="wait" selected/);
 assert.equal(JSON.stringify(project),original);
 const old=createProject();
 const priorActions=old.library.filter(d=>d.kind==='combatAction'&&d.type==='attack');
 const ids=new Set(priorActions.map(d=>d.id));
 old.library=old.library.filter(d=>d.kind!=='combatAction'||ids.has(d.id));
 old.combat.defaultActions=old.combat.defaultActions.filter(ref=>ids.has(ref.definitionId));
 const expected=structuredClone(old);
 for(const action of priorActions)delete action.type;
 const migrated=parseProject(JSON.stringify(old));
 assert.deepEqual(migrated,expected);
 assert.deepEqual(migrated.combat.defaultActions,old.combat.defaultActions);
 assert(migrated.library.filter(d=>d.kind==='combatAction').every(d=>d.type==='attack'));
 assert.deepEqual(parseProject(JSON.stringify(migrated)),migrated);
 assert.equal(migrated.library.length,old.library.length);
});
