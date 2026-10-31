import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemyAction,parseProject,validateProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {saveProject,loadProject} from '../project/storage.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {definitionInspector} from '../studio/inspectors.js';

const fixture=()=>{const project=createRatCombatProject(),enemy=project.library.find(d=>d.id==='rat');return {project,enemy,action:enemy.actions[0]};};
const edit=(project,enemy,path,value,inputType='text')=>applyDocumentCommand(project,{chapterId:project.chapters[0].id,definitionId:enemy.id},'field',{scope:'definition',path:`actions.0.${path}`,value,inputType});
const prepare=f=>edit(f.project,f.enemy,'type','prepare');

test('Enemy Prepare exposes both parameters and hidden intent help while retaining Attack data',()=>{
 const f=fixture(),{project,enemy,action}=f,original=structuredClone(action);prepare(f);
 const html=definitionInspector(project,enemy);
 for(const path of ['preparationBonus','damageReduction'])assert(html.includes(`data-path="actions.0.${path}"`));
 for(const path of ['attack.source','check.target','resolution','successEffects','failureEffects'])assert(!html.includes(`data-path="actions.0.${path}"`),path);
 assert.match(html,/Secretly prepares either a block against your next Attack or bonus damage on its next successful Attack\. Equal chance; replaces previous preparation\. Spends the turn\./);
 assert.deepEqual(action.attack,original.attack);assert.deepEqual(action.check,original.check);
 edit(project,enemy,'preparationBonus','6','number');edit(project,enemy,'damageReduction','3','number');
 edit(project,enemy,'type','attack');assert.deepEqual(action.attack,original.attack);
 prepare(f);assert.equal(action.preparationBonus,6);assert.equal(action.damageReduction,3);
 assert.deepEqual(validateProject(project),[]);
});

test('Enemy Prepare initializes missing or invalid parameters only when switching type',()=>{
 const f=fixture();f.action.preparationBonus=0;f.action.damageReduction=1.5;prepare(f);
 assert.equal(f.action.preparationBonus,2);assert.equal(f.action.damageReduction,1);
 delete f.action.damageReduction;prepare(f);assert.equal(f.action.damageReduction,undefined);
 assert(validateProject(f.project).some(i=>i.message.includes('Enemy Prepare requires positive safe integer damage reduction')));
 edit(f.project,f.enemy,'type','wait');assert.equal(f.action.damageReduction,undefined);
 prepare(f);assert.equal(f.action.damageReduction,1);
});

test('Enemy Prepare requires positive safe integer bonus and damage reduction and stays direct',()=>{
 for(const field of ['preparationBonus','damageReduction'])for(const value of [undefined,null,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'2',NaN,Infinity]){
  const f=fixture();prepare(f);f.action[field]=value;
  assert(validateProject(f.project).some(i=>i.message.includes(field==='preparationBonus'?'positive safe integer preparation bonus':'positive safe integer damage reduction')),`${field}: ${value}`);
  assert.throws(()=>parseProject(JSON.stringify(f.project)));
 }
 for(const value of [1,2,Number.MAX_SAFE_INTEGER]){const f=fixture();prepare(f);f.action.preparationBonus=value;f.action.damageReduction=value;assert.deepEqual(validateProject(f.project),[]);}
 const f=fixture();prepare(f);f.action.resolution='check';assert(validateProject(f.project).some(i=>i.message.includes('direct Actions')));
});

test('Enemy Prepare keeps Enemy costs, conditions and cooldown restrictions',()=>{
 for(const [key,value,message] of [['costs',[{source:'variable',key:'energy',amount:1}],'Enemy costs are deferred'],['conditions',[{source:'variable',key:'energy',op:'gte',value:1}],'Enemy Action conditions'],['cooldown',1,'Enemy Action cooldown']]){
  const f=fixture();prepare(f);f.action[key]=value;assert(validateProject(f.project).some(i=>i.message.includes(message)));
 }
});

test('authored Rat Prepare survives save, parse, compile and chapter package round trips without hidden runtime state',()=>{
 const f=fixture();prepare(f);Object.assign(f.action,{name:'Rat prepares…',text:'The rat prepares its next move.',preparationBonus:5,damageReduction:3});
 const before=structuredClone(f.project),saved=new Map(),storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 assert.equal(saveProject(f.project,storage).ok,true);
 const loaded=loadProject(storage).project,parsed=parseProject(JSON.stringify(loaded));
 assert.deepEqual(parsed.library.find(d=>d.id==='rat').actions[0],f.action);
 assert.deepEqual(compileChapter(parsed).library.find(d=>d.id==='rat').actions[0],f.action);
 const imported=importChapter(createProject(),exportChapter(parsed));
 assert.deepEqual(imported.library.find(d=>d.id==='rat').actions[0],f.action);assert.deepEqual(validateProject(imported),[]);
 assert.deepEqual(f.project,before);
});

test('an old Attack named Prepare remains an Attack without new parameters',()=>{
 const f=fixture();f.action.name='Prepare';f.action.text='The rat prepares its next move.';
 const loaded=parseProject(JSON.stringify(f.project)).library.find(d=>d.id==='rat').actions[0];
 assert.equal(loaded.type,'attack');assert.equal(loaded.preparationBonus,undefined);assert.equal(loaded.damageReduction,undefined);assert.deepEqual(loaded,f.action);
});

test('Enemy Prepare validates the safe damage boundary for later Attacks, including cyclic order',()=>{
 for(const cyclic of [false,true]){
  const f=fixture();prepare(f);const attack=createEnemyAction('later-attack');attack.name='Later bite';
  f.enemy.actions=cyclic?[attack,f.action]:[f.action,attack];
  f.action.preparationBonus=Number.MAX_SAFE_INTEGER-2;
  assert.deepEqual(validateProject(f.project),[]);
  f.action.preparationBonus++;
  assert(validateProject(f.project).some(i=>i.message.includes('Enemy preparation bonus exceeds supported damage range for Later bite')));
  assert.throws(()=>parseProject(JSON.stringify(f.project)),/Enemy preparation bonus exceeds supported damage range/);
 }
});

test('Enemy Prepare considers later misses and stops at the next replacement Prepare',()=>{
 const f=fixture();prepare(f);f.action.preparationBonus=Number.MAX_SAFE_INTEGER-1;
 const small=createEnemyAction('small');small.attack.damage={min:1,max:1};
 const large=createEnemyAction('large');large.attack.damage={min:1,max:2};
 const replacement={...createEnemyAction('replacement'),type:'prepare',resolution:'direct',preparationBonus:2,damageReduction:1};
 f.enemy.actions=[f.action,small,large,replacement];
 assert(validateProject(f.project).some(i=>i.message.includes('Enemy preparation bonus exceeds supported damage range')));
 f.enemy.actions=[f.action,small,replacement,large];
 assert.deepEqual(validateProject(f.project),[]);
});

test('Enemy Prepare permits maximum bonus without a damaging Attack and tolerates malformed actions',()=>{
 const f=fixture();prepare(f);f.action.preparationBonus=Number.MAX_SAFE_INTEGER;
 const none=createEnemyAction('no-damage');none.attack={source:'none'};
 const zero=createEnemyAction('zero-damage');zero.attack.damage={min:0,max:0};
 f.enemy.actions=[f.action,none,zero];assert.deepEqual(validateProject(f.project),[]);
 f.enemy.actions=[f.action];assert.deepEqual(validateProject(f.project),[]);
 for(const malformed of [null,{}, {...createEnemyAction('bad'),attack:null}, {...createEnemyAction('bad'),attack:{source:'self',damage:null}}, {...createEnemyAction('bad'),attack:{source:'self',damage:{min:0,max:'bad'}}}]){
  f.enemy.actions=[f.action,malformed];
  assert.doesNotThrow(()=>validateProject(f.project));
  assert(validateProject(f.project).length>0);
 }
});
