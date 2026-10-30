import test from 'node:test';
import assert from 'node:assert/strict';
import {progressionEffects,createDefinition} from '../project/cards.js';
import {ProjectController} from '../project/ProjectController.js';
import {createProject,validateProject,exportChapter,importChapter,createWeapon} from '../project/model.js';

const effects=()=>[
 {op:'add',key:'score',value:1},
 {op:'add',key:'score',value:2,onDiceFailure:false,onDiceSuccess:true},
 {op:'add',key:'score',value:4,onDiceFailure:true,onDiceSuccess:false},
 {op:'add',key:'score',value:8,onDiceFailure:false,onDiceSuccess:false},
];
const definitions=[{id:'health',type:'number',initial:10},{id:'energy',type:'number',initial:5},{id:'score',type:'number',initial:0}];
const action=()=>({...createDefinition('action','try'),resolution:'check',check:{pool:[{sides:6,count:1}],modifier:0,target:4},costs:[{source:'variable',key:'energy',amount:1}],effects:effects()});

test('each progression effect independently selects success, failure, either or neither',()=>{
 const card=action(),before=structuredClone(card);
 assert.deepEqual(progressionEffects(card,true).map(e=>e.value),[1,2]);
 assert.deepEqual(progressionEffects(card,false).map(e=>e.value),[1,4]);
 card.resolution='direct';assert.deepEqual(progressionEffects(card).map(e=>e.value),[1,2,4,8]);
 card.resolution='check';assert.deepEqual(card,before);
});

test('absent flags mean checked and non-action collection effects retain their ordinary semantics',()=>{
 const card=action();card.effects=[{op:'add',key:'score',value:1,onDiceFailure:false},{op:'add',key:'score',value:2,onDiceSuccess:false}];
 assert.deepEqual(progressionEffects(card,true).map(e=>e.value),[1]);assert.deepEqual(progressionEffects(card,false).map(e=>e.value),[2]);
 const item={...createDefinition('item','token'),onCollect:[{op:'add',key:'score',value:3,onDiceSuccess:false,onDiceFailure:false}]};
 assert.deepEqual(item.onCollect.map(e=>e.value),[3]);
});

for(const success of [true,false])test(`ordinary checked action applies filtered progression on real completion, success=${success}`,async()=>{
 class Deck extends EventTarget {reset(){}replaceContent(content){this.content=content;}endContent(){}}
 const source=action();source.successEffects=[{op:'add',key:'score',value:16}];source.failureEffects=[{op:'add',key:'score',value:32}];
 let rolls=0;const deck=new Deck(),controller=new ProjectController(deck,{startNode:'fork',variables:definitions,library:[],nodes:[{id:'fork',type:'fork',introEnabled:false,choices:[source],connections:{'try:success':null,'try:failure':null}}]},{rollCheck:async()=>{rolls++;return {dice:[{sides:6,value:success?6:1}]};}});
 await controller.runCheck(source);
 assert.equal(rolls,1);assert.equal(controller.variables.energy,4);assert.equal(controller.variables.score,success?19:37);assert.equal(controller.completed,true);controller.destroy();
});

test('direct completion ignores saved outcome boxes even when both are unchecked',()=>{
 const source={...action(),resolution:'direct',effects:[{op:'add',key:'score',value:2,onDiceFailure:false,onDiceSuccess:false}]};
 const host={variables:{health:10,energy:5,score:0},inventory:[],compiled:{variables:definitions,library:[]}};
 const result=ProjectController.prototype.transaction.call(host,source);
 assert.equal(result.variables.score,2);assert.equal(result.variables.energy,4);
});

test('speculative route checks use the same filtered effects for each dice branch',()=>{
 const seen=[],host={compiled:{variables:definitions,library:[]},location:{},type:()=> 'fork',deathDestination:()=>null,destination(source,outcome,values){seen.push([outcome,values.score]);},discardedReturns:()=>[],key:()=> 'fork',routingReason:error=>{throw error;}};
 const values={health:10,energy:5,score:0};
 assert.equal(ProjectController.prototype.departureReason.call(host,action(),{},values,[]),'');
 assert.deepEqual(seen,[[true,3],[false,5]]);assert.equal(values.score,0);
});

test('outcome booleans validate and travel with progression item references through packages',()=>{
 const project=createProject(),source=project.library.find(d=>d.kind==='action'),reward=createWeapon('gated-reward');project.library.push(reward);
 source.effects=[{op:'addItem',key:reward.id,onDiceSuccess:false,onDiceFailure:true}];
 assert.deepEqual(validateProject(project),[]);
 const imported=importChapter(createProject(),exportChapter(project));
 assert(imported.library.some(d=>d.effects?.some(e=>e.onDiceSuccess===false&&e.onDiceFailure===true)));
 source.effects[0].onDiceSuccess='false';assert(validateProject(project).some(i=>i.message.includes('outcome options must be booleans')));
});
