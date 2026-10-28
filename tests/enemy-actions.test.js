import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createEnemyAction,parseProject,validateProject,compileChapter,exportChapter,importChapter,migrateEnemyActions} from '../project/model.js';
import {createEncounter,completeEnemyTurn} from '../project/combat-rules.js';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {definitionInspector} from '../studio/inspectors.js';

function legacy(){
 const p=createProject(),enemy=createEnemy('rat');
 const first={id:'bite',kind:'combatAction',name:'Bite',text:'An old bite',image:'rat.png',imageScale:120,flipImage:true,check:{pool:[{sides:6,count:3}],modifier:0,target:11},damage:{min:1,max:2},costs:[],effects:[]};
 const second={...structuredClone(first),id:'claw',name:'Claw',damage:{min:2,max:3}};
 delete enemy.actions;enemy.attacks=[first,second];p.library.push(enemy);return p;
}
test('legacy attacks migrate to typed Enemy Actions, preserving identity, content and order',()=>{
 const old=legacy(),original=JSON.stringify(old),p=parseProject(original),enemy=p.library.find(d=>d.id==='rat');
 assert.equal(enemy.attacks,undefined);assert.deepEqual(enemy.actions.map(action=>action.id),['bite','claw']);assert.deepEqual(enemy.actions.map(action=>action.attack.damage),[{min:1,max:2},{min:2,max:3}]);assert.equal(enemy.actions[0].text,'An old bite');assert.equal(enemy.actions[0].imageScale,120);assert.equal(enemy.actions[0].flipImage,true);assert.deepEqual(enemy.actions[0].check,old.library.find(d=>d.id==='rat').attacks[0].check);
 assert.equal(JSON.stringify(old),original);assert.deepEqual(validateProject(p),[]);assert.deepEqual(parseProject(JSON.stringify(p)),p);
 assert.deepEqual(compileChapter(old).library.find(d=>d.id==='rat').actions,enemy.actions);
 // Keep Enemy reachable in a chapter package.
 old.chapters[0].nodes.push({id:'combat',name:'Combat',type:'combat',x:0,y:0,enemy:{definitionId:'rat'},connections:{victory:false}});
 const exported=exportChapter(old),imported=importChapter(createProject(),exported);
 assert.deepEqual(validateProject(imported),[]);assert(imported.library.find(d=>d.id==='rat').actions.every(a=>a.type==='attack'));
});
test('new Enemy Actions expose the Attack type and perform their authored repeating order',()=>{
 const p=createProject(),enemy=createEnemy('enemy');enemy.actions.push(createEnemyAction('second'));p.library.push(enemy);
 assert.equal(enemy.actions[0].type,'attack');assert.equal(enemy.attacks,undefined);
 const html=definitionInspector(p,enemy);assert(html.includes('<h3>Actions</h3>'));assert(html.includes('Performed in order, then repeated.'));assert(html.includes('Action type'));assert(html.includes('data-path="actions.0.type"'));assert(html.includes('>Attack</option>'));assert(!html.includes('Add attack'));
 let encounter=createEncounter(enemy,'encounter');assert.equal(encounter.actionIndex,0);
 encounter=completeEnemyTurn(encounter,enemy);assert.equal(encounter.actionIndex,1);
 encounter=completeEnemyTurn(encounter,enemy);assert.equal(encounter.actionIndex,0);
});
test('unknown Action types and conflicting old/new lists are preserved and diagnosed',()=>{
 const p=createProject(),enemy=createEnemy('enemy');p.library.push(enemy);enemy.actions[0].type='dance';
 assert(validateProject(p).some(e=>e.message.includes('unsupported Combat Action type')));assert.throws(()=>createEncounter(enemy,'enc'),/Unsupported Enemy Action/);
 enemy.actions[0].type='attack';enemy.attacks=[{id:'preserve'}];const before=structuredClone(enemy);
 migrateEnemyActions(p);assert.deepEqual(enemy,before);assert(validateProject(p).some(e=>e.message.includes('conflict')));
});
test('enemy Action dispatcher routes Attack explicitly and rejects unsupported types',async()=>{
 const calls=[],context={attack:(...args)=>calls.push(args)};
 const action=createEnemyAction('bite');await CombatCoordinator.prototype.performEnemyAction.call(context,action);
 assert.deepEqual(calls,[['enemy',action]]);
 await assert.rejects(CombatCoordinator.prototype.performEnemyAction.call(context,{type:'dance'}),/Unsupported Enemy Action/);assert.equal(calls.length,1);
});

test('legacy kindless Enemy attacks gain the canonical Action kind without losing their presentation',()=>{
 const p=legacy(),old=p.library.find(d=>d.id==='rat').attacks[0];delete old.kind;
 const migrated=parseProject(JSON.stringify(p)).library.find(d=>d.id==='rat').actions[0];
 assert.equal(migrated.kind,'combatAction');assert.equal(migrated.type,'attack');for(const key of ['id','name','text','image','imageScale','flipImage','check'])assert.deepEqual(migrated[key],old[key]);assert.deepEqual(migrated.attack.damage,old.damage);assert.equal(migrated.damage,undefined);
});
