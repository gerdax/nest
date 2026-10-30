import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createEnemyAction,createCombatAction,migrateEnemyActions,validateProject} from '../project/model.js';

const fixture=()=>{const project=createProject(),enemy=createEnemy('guard');project.library.push(enemy);return {project,enemy,action:enemy.actions[0]};};
const messages=project=>validateProject(project).map(issue=>issue.message).join('\n');

test('player and Enemy factories expose one CombatAction schema with actor-neutral targets',()=>{
 const player=createCombatAction('player'),enemy=createEnemyAction('enemy');
 assert.deepEqual(Object.keys(enemy).sort(),Object.keys(player).sort());
 assert.deepEqual(Object.keys(enemy.attack).sort(),Object.keys(player.attack).sort());
 assert.equal(player.target,'opponent');assert.equal(enemy.target,'opponent');
 assert.deepEqual(enemy.attack,{source:'self',damage:{min:1,max:2},minBonus:0,maxBonus:0});
 assert.deepEqual(enemy.check,{pool:[{sides:6,count:3}],modifier:0,target:11});
 assert.equal(enemy.damage,undefined);
});

test('existing Enemy actions gain only absent shared fields and migrate once',()=>{
 const {project,enemy}=fixture();
 enemy.actions=[{id:'old',kind:'combatAction',name:'Bite',text:'Bite text',image:'bite.png',damage:{min:2,max:4},check:{pool:[{sides:6,count:2}],modifier:1,target:7},costs:[],effects:[]}];
 migrateEnemyActions(project);
 assert.deepEqual(enemy.actions[0],{id:'old',kind:'combatAction',name:'Bite',text:'Bite text',image:'bite.png',attack:{source:'self',damage:{min:2,max:4},minBonus:0,maxBonus:0},check:{pool:[{sides:6,count:2}],modifier:1,target:7},costs:[],effects:[],type:'attack',conditions:[],resolution:'check',successEffects:[],failureEffects:[],cooldown:0,target:'opponent'});
 const before=structuredClone(project);migrateEnemyActions(project);assert.deepEqual(project,before);assert.deepEqual(validateProject(project),[]);
});

test('Enemy Defend and Wait share player rules and default their missing resolution to direct',()=>{
 for(const type of ['defend','wait']){
  const {project,action}=fixture();action.type=type;delete action.resolution;
  if(type==='defend')action.damageReduction=2;
  migrateEnemyActions(project);assert.equal(action.resolution,'direct');assert.deepEqual(validateProject(project),[]);
  action.resolution='check';assert.match(messages(project),/Defend and Wait are direct/);
 }
 const {project,action}=fixture();action.type='defend';action.resolution='direct';action.damageReduction=0;assert.match(messages(project),/positive integer damage reduction/);
});

test('Enemy validation rejects unsupported availability and inventory mechanics',()=>{
 const cases=[
  [a=>a.costs=[{source:'variable',key:'energy',amount:1}],/Enemy costs are deferred/],
  [a=>a.conditions=[{source:'variable',key:'health',op:'gte',value:1}],/Enemy Action conditions/],
  [a=>a.cooldown=1,/Enemy Action cooldown/],
  [a=>a.attack.source='weapon',/cannot use a Weapon attack source/],
 ];
 for(const [mutate,expected] of cases){const {project,action}=fixture();mutate(action);assert.match(messages(project),expected);}
 const {project,action}=fixture();action.attack={source:'none'};assert.deepEqual(validateProject(project),[]);
});

test('migration preserves explicit malformed shared fields and conflicting damage profiles',()=>{
 for(const [key,value] of [['type',null],['conditions',null],['resolution',null],['successEffects',null],['failureEffects',null],['cooldown',null],['target',null],['attack',null],['costs',null],['effects',null]]){
  const {project,action}=fixture();action[key]=value;const before=structuredClone(action);migrateEnemyActions(project);assert.deepEqual(action,before,key);assert.notEqual(messages(project),'',key);
 }
 const {project,action}=fixture();action.damage={min:5,max:8};const before=structuredClone(action);migrateEnemyActions(project);assert.deepEqual(action,before);assert.match(messages(project),/legacy Enemy damage conflicts/);
});

test('legacy migration does not invent required Enemy cost/effect lists or repair an explicit wrong type',()=>{
 const {project,action}=fixture();delete action.costs;delete action.effects;action.type='dance';migrateEnemyActions(project);
 assert.equal(action.type,'dance');assert.equal(action.costs,undefined);assert.equal(action.effects,undefined);assert.match(messages(project),/unsupported Combat Action type/);assert.match(messages(project),/costs\/effects must be lists/);
});
