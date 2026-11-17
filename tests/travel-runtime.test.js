import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createEnemy} from '../project/combat-model.js';
import {ProjectController} from '../project/ProjectController.js';
import {createTravelVisit,drawTravelStep} from '../project/travel.js';

class Deck extends EventTarget {
 reset(){this.busy=false;this.phase='closed';}
 replaceContent(content,options={}){this.content=content;this.options=options;this.phase=options.presentation==='open'?'choices':'closed';}
 endContent(){this.ended=true;}
 advance(){const event=new Event('commit');event.detail={contentId:this.content.id,action:this.content.actions[0]};this.dispatchEvent(event);}
}

function fixture({min=2,max=4,events=2,repeats=true,eligible=true}={}){
 const project=createProject(),chapter=project.chapters[0],death=chapter.nodes.find(n=>n.type==='death');
 project.variables.push({id:'walked',name:'Walked',type:'number',initial:0},{id:'events',name:'Events',type:'number',initial:0});
 for(const [id,kind] of [['step-a','event'],['step-b','caption'],['encounter','event']])project.library.push({
  ...createDefinition(kind,id),headline:id,effects:[{op:'add',key:id==='encounter'?'events':'walked',value:1}]});
 const auto={id:'travel',type:'randomizer',name:'Travel',x:0,y:0,drawCount:9,noneWeight:999,
  travel:{enabled:true,randomizeStepCards:true,minSteps:min,maxSteps:max,eventCount:events,steps:[{id:'a',definitionId:'step-a'},{id:'b',definitionId:'step-b'}]},
  candidates:[{beatId:'event',weight:1,allowRepeats:repeats,conditions:eligible?[]:[{source:'variable',key:'events',op:'gte',value:99}]}],connections:{next:'end'}};
 chapter.nodes=[death,auto,{id:'event',type:'linear',name:'Event',x:0,y:0,cards:[{id:'event-card',definitionId:'encounter'}],connections:{next:null}},
  {id:'end',type:'linear',name:'End',x:0,y:0,cards:[{id:'end-card',definitionId:'arrival'}],connections:{next:null}}];
 chapter.startNode=auto.id;
 return {project,chapter,auto};
}
function run(f,rng=()=>0,options={}){
 const compiled=compileChapter(f.project),deck=new Deck(),errors=[];let draws=0;
 const controller=new ProjectController(deck,compiled,{rng:()=>{draws++;return rng();},onError:e=>errors.push(e),...options});
 return {controller,deck,errors,compiled,get draws(){return draws;}};
}
function play(game){
 const cards=[];
 for(let count=0;game.controller.state.activeNodeId!=='end'&&count<100;count++){
  cards.push(game.controller.state.cardId);game.deck.advance();
 }
 assert.equal(game.controller.state.activeNodeId,'end',game.errors.map(e=>e.message).join(';'));
 return cards;
}

test('Travel independently draws 2 / 4 / 2 steps around two events, ignoring ordinary None weight',()=>{
 const f=fixture(),draws=[0,0,0,.99,0,0],game=run(f,()=>draws.shift()??0);
 assert.deepEqual(validateProject(f.project),[]);
 const cards=play(game);
 assert.deepEqual(cards,['a','b','event-card','a','b','a','b','event-card','a','b']);
 assert.equal(game.controller.variables.walked,8);assert.equal(game.controller.variables.events,2);
 assert.deepEqual(game.errors,[]);game.controller.destroy();
});

test('Travel reveals between movement steps and retains flips at event and route boundaries',()=>{
 const game=run(fixture({min:2,max:2,events:1}));
 for(const [card,next,transition] of [['a','reveal','reveal'],['b','flip','flip'],['event-card','flip','flip'],['a','reveal','reveal'],['b','flip','flip']]){
  assert.equal(game.controller.state.cardId,card);
  assert.equal(game.deck.content.nextTransition,next);
  game.deck.advance();
  assert.equal(game.deck.options.transition,transition);
 }
 assert.equal(game.controller.state.activeNodeId,'end');
 game.controller.destroy();
});

test('First step caption overrides each segment opening without changing sources or progression',()=>{
 for(const firstKind of ['event','caption']){
  const f=fixture({min:2,max:2,events:1});
  f.project.library.find(card=>card.id==='step-a').kind=firstKind;
  f.auto.travel.firstStepCaption='You move on';
  const original=structuredClone(f.project.library),game=run(f);
  assert.equal(game.deck.content.heading,'You move on');
  assert.equal(game.deck.content.nextCardPreview.heading,'step-b');
  const draws=game.draws;game.controller.content();game.controller.show({restore:true});
  assert.equal(game.draws,draws);assert.equal(game.controller.variables.walked,0);
  game.deck.advance();assert.equal(game.deck.content.heading,'step-b');
  game.deck.advance();assert.equal(game.deck.content.heading,'encounter');
  game.deck.advance();assert.equal(game.deck.content.heading,'You move on');
  game.deck.advance();assert.equal(game.deck.content.heading,'step-b');
  game.deck.advance();assert.equal(game.controller.state.activeNodeId,'end');
  assert.equal(game.controller.variables.walked,4);assert.equal(game.controller.variables.events,1);
  assert.deepEqual(f.project.library,original);game.controller.destroy();
 }
 for(const caption of ['', '  \n ']){
  const f=fixture({events:0});f.auto.travel.firstStepCaption=caption;
  const game=run(f);assert.equal(game.deck.content.heading,'step-a');game.controller.destroy();
 }
});

test('zero events produces one segment; unavailable or exhausted events end after the present segment',()=>{
 for(const options of [{events:0},{eligible:false},{repeats:false}]){
  const game=run(fixture({min:2,max:2,...options}));
  assert.deepEqual(play(game),options.repeats===false?['a','b','event-card','a','b']:['a','b']);
  assert.deepEqual(game.errors,[]);game.controller.destroy();
 }
});

test('Travel without step cards plays only events or follows Next when none remain',()=>{
 for(const options of [{events:2},{events:0},{events:2,eligible:false},{events:2,repeats:false}]){
  const f=fixture(options);f.auto.travel.steps=[];
  assert.deepEqual(validateProject(f.project),[]);
  const game=run(f);
  const expected=options.events===0||options.eligible===false?[]:options.repeats===false?['event-card']:['event-card','event-card'];
  assert.deepEqual(play(game),expected);
  assert.equal(game.controller.variables.walked,0);
  assert.deepEqual(game.errors,[]);game.controller.destroy();
 }
 const f=fixture({events:2});f.auto.travel.steps=[];f.chapter.nodes.find(n=>n.id==='event').cards=[];
 const game=run(f);assert.equal(game.controller.state.activeNodeId,'end');assert.deepEqual(game.errors,[]);game.controller.destroy();
});

test('preflight, content rendering and notifications never redraw Travel or mutate its visit',()=>{
 const game=run(fixture()),before=structuredClone(game.controller.location.travelVisit),draws=game.draws;
 for(let i=0;i<8;i++){
  game.controller.content();game.controller.presentation();game.controller.departureReason(game.controller.card());game.controller.notify();
 }
 assert.equal(game.draws,draws);assert.deepEqual(game.controller.location.travelVisit,before);
 assert.equal(game.controller.variables.walked,0);
 game.controller.restart();assert.equal(game.controller.variables.walked,0);assert.equal(game.controller.location.travelVisit.stepNumber,1);
 game.controller.destroy();
});

test('a changed eligible step pool falls back to a physical back without drawing in refresh',()=>{
 const f=fixture({min:3,max:3,events:0});
 f.auto.travel.steps[1].conditions=[{source:'variable',key:'walked',op:'gte',value:2}];
 const game=run(f),draws=game.draws;
 assert(game.deck.content.nextCardPreview);
 game.controller.variables.walked=1;game.controller.show();
 assert.equal(game.draws,draws);
 assert.equal(game.deck.content.nextCardPreview,undefined);
 assert.equal(game.deck.content.nextTransition,'flip');
 game.deck.advance();assert.equal(game.controller.variables.walked,2);
 assert.equal(game.deck.content.nextTransition,'reveal');assert(game.deck.content.nextCardPreview);
 game.controller.destroy();
});

test('event conditions use effects committed by the movement cards',()=>{
 const f=fixture({min:2,max:2,events:1});
 f.auto.candidates[0].conditions=[{source:'variable',key:'walked',op:'gte',value:2}];
 const game=run(f);assert.deepEqual(play(game),['a','b','event-card','a','b']);
 assert.equal(game.controller.variables.events,1);game.controller.destroy();
});

test('selected Travel card preview starts on the authored card and death interrupts movement',()=>{
 const f=fixture({min:1,max:1,events:0}),selected=run(f,()=>0,{startPlacementId:'b'});
 assert.equal(selected.controller.card().id,'b');selected.deck.advance();assert.equal(selected.controller.state.activeNodeId,'end');selected.controller.destroy();
 f.project.library.find(d=>d.id==='step-a').effects=[{op:'set',key:'health',value:0}];
 const game=run(f);game.deck.advance();assert.equal(game.controller.location.node.type,'death');assert.equal(game.controller.variables.health,0);
 assert.deepEqual(game.errors,[]);game.controller.destroy();
});

test('step bag exhausts before refilling, avoids identical neighbors and supports one card',()=>{
 for(const count of [1,2,4]){
  const cards=Array.from({length:count},(_,i)=>({id:`card-${i}`})),config={minSteps:20,maxSteps:20,eventCount:0,randomizeStepCards:true};
  let visit=createTravelVisit(config);const seen=[];
  for(let i=0;i<20;i++){const result=drawTravelStep(config,visit,cards,()=>.99);visit=result.visit;seen.push(result.card.id);}
  assert.equal(new Set(seen.slice(0,count)).size,count);
  if(count>1)assert(seen.every((id,i)=>!i||id!==seen[i-1]));
 }
});

test('ordered Travel cycles through the authored list across events without drawing card randomness',()=>{
 const f=fixture({min:2,max:2,events:1});
 delete f.auto.travel.randomizeStepCards;
 f.auto.travel.steps.push({id:'c',definitionId:'step-a'});
 const game=run(f);
 assert.deepEqual(play(game),['a','b','event-card','c','a']);
 assert.equal(game.draws,1,'only the event selection draws randomness');
 game.controller.restart();assert.equal(game.controller.state.cardId,'a');game.controller.destroy();
 const config={minSteps:5,maxSteps:5,eventCount:0,randomizeStepCards:false,steps:[{id:'a'},{id:'b'},{id:'c'}]};
 let visit=createTravelVisit(config);
 const draw=available=>{const result=drawTravelStep(config,visit,available,()=>assert.fail('Ordered steps must not draw'));visit=result.visit;return result.card.id;};
 assert.equal(draw([config.steps[0],config.steps[2]]),'a');
 assert.equal(draw([config.steps[0],config.steps[2]]),'c');
 assert.equal(draw(config.steps),'a');
 assert.equal(draw(config.steps),'b');
 assert.equal(draw([config.steps[1]]),'b');
});

test('invalid randomness and unavailable step pools fail without charging movement effects',()=>{
 const f=fixture(),game=run(f,()=>1);
 assert(game.errors.some(e=>/random source/.test(e.message)));assert.equal(game.controller.variables.walked,0);game.controller.destroy();
 const empty=fixture();empty.auto.travel.steps.forEach(card=>card.conditions=[{source:'variable',key:'events',op:'gte',value:99}]);
 const blocked=run(empty);assert(blocked.errors.some(e=>/no available step/.test(e.message)));assert.equal(blocked.controller.variables.walked,0);blocked.controller.destroy();
});

test('once-per-run group limits survive event returns and an explicit outside exit abandons Travel',()=>{
 for(const escape of [false,true]){
  const f=fixture({min:1,max:1,events:3}),event=f.chapter.nodes.find(n=>n.id==='event');
  f.auto.candidates=[{groupId:'scene',weight:1,allowRepeats:true,conditions:[]}];
  f.chapter.beatGroups=[{id:'scene',name:'Scene',collapsed:false,memberIds:['event'],entryId:'event',incoming:[],
   outgoing:escape?[]:[{nodeId:'event',output:'next'}],destination:{nodeId:'end'},oncePerRun:true}];
  event.connections.next=escape?'end':false;
  const game=run(f);
  assert.deepEqual(play(game),escape?['a','event-card']:['a','event-card','b']);
  assert.equal(game.controller.variables.events,1);assert.deepEqual(game.errors,[]);game.controller.destroy();
 }
});

test('automatically empty event still counts and returns to a final movement segment',()=>{
 const f=fixture({min:1,max:1,events:1}),event=f.chapter.nodes.find(n=>n.id==='event');
 event.cards=[];event.entryEffects=[{op:'add',key:'events',value:1}];
 const game=run(f);assert.deepEqual(play(game),['a','b']);assert.equal(game.controller.variables.events,1);
 assert.deepEqual(game.errors,[]);game.controller.destroy();
});

test('an effect that leaves no eligible future step blocks atomically with an explanation',()=>{
 const f=fixture({min:2,max:2,events:0});
 f.auto.travel.steps.forEach(card=>card.conditions=[{source:'variable',key:'walked',op:'eq',value:0}]);
 const game=run(f);
 assert.equal(game.deck.content.actions[0].disabled,true);assert.match(game.deck.content.actions[0].disabledReason,/no available step/);
 game.deck.advance();assert.equal(game.controller.variables.walked,0);assert.equal(game.controller.state.cardId,'a');
 game.controller.destroy();
});

test('a Library Enemy event returns to the final Travel leg after victory',()=>{
 const f=fixture({min:1,max:1,events:1});f.project.library.push({...createEnemy('travel-rat'),name:'Rat',introEnabled:true});
 f.auto.candidates=[{enemy:{definitionId:'travel-rat'},weight:1,conditions:[],introEnabled:true}];
 const game=run(f);game.deck.advance();
 assert.equal(game.controller.state.combat.enemyName,'Rat');assert.equal(game.controller.combatVictoryReason(),'');
 assert.equal(game.controller.completeCombatVictory(),true);assert.equal(game.controller.state.cardId,'b');
 game.deck.advance();assert.equal(game.controller.state.activeNodeId,'end');assert.deepEqual(game.errors,[]);game.controller.destroy();
});

test('duplicate old commit events never apply movement effects or advance Travel twice',()=>{
 const game=run(fixture({min:2,max:2,events:0}));
 const detail={contentId:game.deck.content.id,action:game.deck.content.actions[0]};
 game.deck.advance();assert.equal(game.controller.variables.walked,1);const state=structuredClone(game.controller.location.travelVisit);
 const event=new Event('commit');event.detail=detail;game.deck.dispatchEvent(event);
 assert.equal(game.controller.variables.walked,1);assert.deepEqual(game.controller.location.travelVisit,state);
 assert.deepEqual(game.errors,[]);game.controller.destroy();
});
