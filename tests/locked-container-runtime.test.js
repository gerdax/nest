import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {createProject,compileChapter} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {chapterEntryState} from '../project/chapter-entry.js';
import {playerUIState} from '../studio/player-ui-state.js';
import {previewCardTarget} from '../studio/preview-card-target.js';

class Deck extends EventTarget {
 reset(){this.busy=false;this.phase='closed';this.open=false;}
 replaceContent(content,{presentation,selectedId}){
  this.content=content;this.open=presentation==='open';this.phase=this.open?'choices':'closed';
  this.index=Math.max(0,content.actions.findIndex(action=>action.id===selectedId));
 }
 endContent(){this.phase='ended';}
 emit(name,detail={}){this.dispatchEvent(new CustomEvent(name,{detail:{contentId:this.content.id,...detail}}));}
 choose(id){this.emit('commit',{action:this.content.actions.find(action=>action.id===id)});}
 reveal(){this.open=true;this.phase='choices';this.emit('reveal');this.emit('transitioncomplete',{transition:'reveal'});}
}

function fixture({intro=false,inventory=[],rolls=[],allowForcing=true,items=true,next='return',travel=false,assistTool,allowBareHanded,forceCheck,...options}={}){
 const project=createProject(),chapter=project.chapters[0];
 project.itemTags=[{id:'lockpick',name:'Lockpick'},{id:'prying',name:'Prying'}];
 project.unavailableActions='disabled-triggers';
 project.variables.find(variable=>variable.id==='energy').initial=5;
 project.variables.push({id:'introduced',type:'number',initial:0});
 const check={pool:[{sides:6,count:1}],modifier:0,target:4};
 const energyCost={source:'variable',key:'energy',amount:2};
 const pick={...createDefinition('item','pick'),tagId:'lockpick'};
 const crowbar={...createDefinition('item','crowbar'),name:'Crowbar',headline:'Crowbar',tagId:'prying',inventoryKey:'prying-crowbar',forcingBonus:2};
 const rod={...createDefinition('item','rod'),name:'Rusty Rod',headline:'Rusty Rod',tagId:'prying',permability:1,forcingBonus:3};
 const blank={...createDefinition('item','blank-tool'),name:'Blank tool',tagId:'prying'};
 project.library.push(pick,crowbar,rod,blank,
  {...createDefinition('event','locked-intro'),headline:'The crate is locked.',effects:[{op:'add',key:'introduced',value:1}]},
  {...createDefinition('action','pick-action'),headline:'Pick the lock',resolution:'check',check},
  {...createDefinition('action','force-action'),headline:'Force it open',resolution:'check',check:forceCheck??check,costs:[energyCost]},
  {...createDefinition('action','leave-action'),headline:'Leave it',image:'./assets/img/leave.png',resolution:'check',check,
   conditions:[{source:'variable',key:'energy',op:'gte',value:100}],costs:[energyCost],effects:[{op:'add',key:'introduced',value:1}]});
 const crate={id:'crate',type:'container',locked:true,allowForcing,introEnabled:intro,
  intro:{id:'intro',definitionId:'locked-intro'},items:items?[{id:'loot',definitionId:'flashlight'}]:[],
  choices:[{id:'lockpick',definitionId:'pick-action',lockMethod:'lockpick',contextItemId:'tag:lockpick'},
   {id:'force',definitionId:'force-action',lockMethod:'force',...(assistTool?{assistTool}:{}),
    ...(allowBareHanded===undefined?{}:{allowBareHanded})},
   {id:'leave',definitionId:'leave-action',lockMethod:'leave'}],connections:{next}};
 chapter.nodes=[...chapter.nodes.filter(node=>node.type==='death'),crate,
  {id:'return',type:'linear',cards:[{id:'return-card',definitionId:'arrival'}],connections:{next:'crate'}}];
 chapter.startNode=crate.id;
 if(travel){
  const auto={id:'travel',type:'randomizer',candidates:[{beatId:crate.id,weight:1}],connections:{next:'return'},
   travel:{enabled:true,minSteps:1,maxSteps:1,eventCount:1,steps:[{id:'step',definitionId:'arrival'}]}};
  chapter.nodes.push(auto);chapter.startNode=auto.id;
 }
 const deck=new Deck(),errors=[];
 const controller=new ProjectController(deck,compileChapter(project),{
  initialState:{inventory:inventory.map(item=>({...project.library.find(d=>d.id===(item.definitionId??pick.id)),...item}))},
  rollCheck:async()=>[rolls.shift()??6],
  onError:error=>errors.push(error),...options});
 return {project,chapter,deck,controller,errors};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const action=(deck,id)=>deck.content.actions.find(candidate=>candidate.id===id);

test('forcing can be retried until the Energy cost is unaffordable, and a shared Leave card remains free',async()=>{
 const {deck,controller,errors}=fixture({rolls:[1,1]});
 assert.equal(deck.content.interaction,'choice');
 assert.equal(action(deck,'force').actionEnergyCost,2);
 assert.equal(action(deck,'lockpick').disabled,true);
 for(const energy of [3,1]){
  deck.choose('force');await settle();
  assert.equal(controller.state.variables.energy,energy);
  assert.equal(controller.containerLocked(),true);
 }
 assert.equal(action(deck,'force').disabled,true);
 assert.match(action(deck,'force').disabledReason,/2 Energy/);
 assert.equal(action(deck,'leave').label,'Leave it');
 assert.equal(action(deck,'leave').image,'./assets/img/leave.png');
 assert.equal(action(deck,'leave').disabled,false);
 assert.equal(action(deck,'leave').checkInfo,undefined);
 deck.choose('leave');
 assert.equal(controller.state.activeNodeId,'return');
 assert.equal(controller.state.variables.energy,1);
 assert.equal(controller.state.variables.introduced,0);
 deck.choose('continue');
 assert.equal(controller.containerLocked(),true);
 assert.deepEqual(errors,[]);
 controller.destroy();
});

test('a failed lockpick attempt breaks exactly the selected instance, and a successful one preserves it',async()=>{
 const {deck,controller,chapter,project,errors}=fixture({intro:true,allowForcing:false,rolls:[1,6],
  inventory:[{instanceId:'permanent'},{instanceId:'limited',permability:3,remainingTriggers:2}]});
 assert.equal(deck.phase,'closed');
 assert.equal(deck.content.heading,'The crate is locked.');
 deck.choose('lockpick');
 assert.equal(controller.state.checking,false);
 deck.reveal();
 assert.equal(controller.state.variables.introduced,1);
 assert.deepEqual(deck.content.actions.map(card=>card.id),['lockpick','leave']);
 assert.equal(previewCardTarget({project,chapterId:chapter.id,controller,deck})?.placementId,'lockpick');
 const context=playerUIState({run:controller.state,card:{phase:'choices',action:action(deck,'lockpick')}}).context;
 assert.equal(context.item.instanceId,'limited');
 assert.equal(context.itemUsageLabel,'LOST ON FAILURE');
 deck.choose('lockpick');await settle();
 assert.deepEqual(controller.state.collectedItems.map(item=>item.instanceId),['permanent']);
 assert.equal(controller.state.variables.introduced,1);
 assert.equal(controller.containerLocked(),true);
 deck.choose('lockpick');await settle();
 assert.deepEqual(controller.state.collectedItems.map(item=>item.instanceId),['permanent']);
 assert.equal(deck.content.interaction,'container');
 assert.deepEqual(deck.content.actions.map(card=>card.id),['loot']);
 assert.equal(deck.phase,'choices');
 assert.equal(previewCardTarget({project,chapterId:chapter.id,controller,deck})?.placementId,'loot');
 assert.equal(controller.state.variables.introduced,1);
 const nextEntry=chapterEntryState(project,chapter.id,controller.state);
 assert.deepEqual(nextEntry.unlockedContainers,controller.state.unlockedContainers);
 nextEntry.unlockedContainers.length=0;
 assert.equal(controller.state.unlockedContainers.length,1);
 controller.adopt(controller.locate('return'));controller.show();deck.choose('continue');
 assert.equal(controller.containerLocked(),false);
 assert.equal(deck.phase,'choices');
 controller.restart();
 assert.equal(controller.containerLocked(),true);
 assert.equal(deck.phase,'closed');
 assert.deepEqual(errors,[]);
 controller.destroy();
});

test('canceled or stale rolls restore Energy, and a successful force attempt charges it once',async()=>{
 const pending=[];
 const {deck,controller}=fixture({rollCheck:()=>new Promise(resolve=>pending.push(resolve))});
 deck.choose('force');
 assert.equal(controller.state.variables.energy,3);
 assert.equal(controller.cancelCheck(),true);
 assert.equal(controller.state.variables.energy,5);
 pending[0]([6]);await settle();
 assert.equal(controller.containerLocked(),true);
 deck.choose('force');pending[1]([6]);await settle();
 assert.equal(controller.state.variables.energy,3);
 assert.equal(controller.containerLocked(),false);
 assert.equal(deck.content.actions[0].id,'loot');
 controller.destroy();
});

test('an item preview skips the lock locally, while a failed pick consumes a normal unlimited-use item',async()=>{
 const preview=fixture({startPlacementId:'loot'});
 assert.equal(preview.deck.content.interaction,'container');
 assert.equal(preview.controller.state.unlockedContainers,undefined);
 preview.controller.adopt(preview.controller.locate('return'));preview.controller.show();preview.deck.choose('continue');
 assert.equal(preview.controller.containerLocked(),true);
 preview.controller.destroy();

 const played=fixture({items:false,next:null,rolls:[1,6],inventory:[{instanceId:'only-pick'}]});
 played.deck.choose('lockpick');await settle();
 assert.equal(played.controller.state.collectedItems.length,0);
 assert.equal(action(played.deck,'lockpick').disabled,true);
 assert.equal(played.controller.containerLocked(),true);
 played.deck.choose('force');await settle();
 assert.equal(played.controller.state.completed,true);
 assert.equal(played.controller.state.variables.energy,3);
 assert.deepEqual(played.errors,[]);
 played.controller.destroy();
});

test('retry stays in a Travel event and Leave returns to the remaining steps',async()=>{
 const {deck,controller,errors}=fixture({travel:true,rolls:[1]});
 assert.equal(controller.state.cardId,'step');
 deck.choose('continue');
 assert.equal(controller.state.activeNodeId,'crate');
 deck.choose('force');await settle();
 assert.equal(controller.state.activeNodeId,'crate');
 assert.equal(controller.state.variables.energy,3);
 deck.choose('leave');
 assert.equal(controller.state.cardId,'step');
 deck.choose('continue');
 assert.equal(controller.state.activeNodeId,'return');
 assert.deepEqual(errors,[]);
 controller.destroy();
});

for(const selector of ['crowbar','tag:prying'])test(`Force open shows and rolls one Assist bonus for ${selector}`,async()=>{
 // Old forced placements may still carry a bonus. The item's score is authoritative.
 const assistTool={source:'inventory',key:selector,bonus:9};
 const unaided=fixture({assistTool,rolls:[2]});
 assert.equal(action(unaided.deck,'force').checkInfo.chance,'50.0%');
 assert.equal(playerUIState({run:unaided.controller.state,card:{phase:'choices',action:action(unaided.deck,'force')}}).context.item,null);
 unaided.deck.choose('force');await settle();
 assert.equal(unaided.controller.containerLocked(),true);
 assert.equal(unaided.controller.state.variables.energy,3);
 unaided.controller.destroy();

 const tools=[{definitionId:'crowbar',instanceId:'one'},{definitionId:'crowbar',instanceId:'two'}];
 const results=[];
 const aided=fixture({assistTool,rolls:[1,2],inventory:tools,onCheckResult:result=>results.push(result)});
 const force=action(aided.deck,'force');
 assert.equal(force.checkInfo.chance,'83.3%');
 assert.equal(force.checkTarget,2);
 assert.equal(force.checkInfo.label,'Very high');
 const context=playerUIState({run:aided.controller.state,card:{phase:'choices',action:force}}).context;
 assert.equal(context.item.instanceId,'one');
 assert.equal(context.itemUsageLabel,undefined);
 assert.equal(context.assist,true);
 assert.equal(force.actionEnergyCost,2);
 assert.equal(aided.deck.content.actions.filter(card=>card.lockMethod==='force').length,1);
 for(const [energy,locked] of [[3,true],[1,false]]){
  aided.deck.choose('force');await settle();
  assert.equal(aided.controller.containerLocked(),locked);
  assert.equal(aided.controller.state.variables.energy,energy);
  assert.deepEqual(aided.controller.state.collectedItems.map(item=>item.instanceId),['one','two']);
 }
 assert.deepEqual(results.map(result=>[result.modifier,result.total,result.success]),[[2,3,false],[2,4,true]]);
 assert.deepEqual(aided.errors,[]);
 aided.controller.destroy();
});

test('an assisted Stat check uses the unmodified stat plus the tool for odds, badge and roll',async()=>{
 const results=[];
 const {deck,controller,errors}=fixture({assistTool:{source:'inventory',key:'crowbar',bonus:2},
  forceCheck:{mode:'stat',modifierVariable:'agility',difficulty:4},inventory:[{definitionId:'crowbar'}],
  rollCheck:async()=>[3,3,3],onCheckResult:result=>results.push(result)});
 const force=action(deck,'force');
 assert.equal(force.checkInfo.chance,'74.1%');
 assert.equal(force.checkInfo.formula,'3d6 + 5 ≥ 14');
 assert.equal(force.checkTarget,9);
 deck.choose('force');await settle();
 assert.equal(results[0].total,14);
 assert.equal(controller.state.variables.agility,3);
 assert.equal(controller.state.variables.energy,3);
 assert.equal(controller.containerLocked(),false);
 assert.equal(controller.state.collectedItems[0].definitionId,'crowbar');
 assert.deepEqual(errors,[]);
 controller.destroy();
});

const prying={source:'inventory',key:'tag:prying'};
const forceAt=target=>({pool:[{sides:6,count:1}],modifier:0,target});
const shownTool=({controller,deck})=>playerUIState({run:controller.state,card:{phase:'choices',action:action(deck,'force')}}).context.item;

for(const roll of [1,6])test(`Force open spends the displayed finite instance after a resolved roll of ${roll}`,async()=>{
 const game=fixture({assistTool:prying,forceCheck:forceAt(5),rolls:[roll],inventory:[
  {definitionId:'crowbar',instanceId:'bar'}, {definitionId:'rod',instanceId:'first'}, {definitionId:'rod',instanceId:'second'}]});
 assert.equal(shownTool(game).instanceId,'first');
 assert.equal(action(game.deck,'force').checkInfo.chance,'83.3%');
 game.deck.choose('force');
 assert.equal(game.controller.state.collectedItems.length,3);
 await settle();
 assert.deepEqual(game.controller.state.collectedItems.map(item=>item.instanceId),['bar','second']);
 assert.equal(game.controller.state.variables.energy,3);
 assert.equal(game.controller.containerLocked(),roll===1);
 if(roll===1)assert.equal(shownTool(game).instanceId,'second');
 assert.deepEqual(game.errors,[]);
 game.controller.destroy();
});

test('equal real chances prefer a permanent tool even when its forcing bonus is smaller',async()=>{
 const game=fixture({assistTool:prying,forceCheck:forceAt(3),rolls:[1],inventory:[
  {definitionId:'rod',instanceId:'single'}, {definitionId:'crowbar'},
  {definitionId:'crowbar',instanceId:'limited-copy',permability:1}]});
 assert.equal(action(game.deck,'force').checkInfo.chance,'100.0%');
 assert.equal(shownTool(game).definitionId,'crowbar');
 assert.equal(shownTool(game).instanceId,undefined);
 game.deck.choose('force');await settle();
 assert.equal(game.controller.containerLocked(),false);
 assert.equal(game.controller.state.collectedItems.length,3);
 assert.equal(game.controller.state.collectedItems.find(item=>item.instanceId==='limited-copy').remainingTriggers,1);
 assert.deepEqual(game.errors,[]);
 game.controller.destroy();
});

test('the last use falls back to bare hands only when enabled, and a blank score does not qualify',async()=>{
 for(const allowBareHanded of [true,false]){
  const game=fixture({assistTool:prying,allowBareHanded,forceCheck:forceAt(5),rolls:[1],inventory:[
   {definitionId:'rod',instanceId:'single'}, {definitionId:'blank-tool',instanceId:'blank'}]});
  assert.equal(shownTool(game).instanceId,'single');
  game.deck.choose('force');await settle();
  assert.equal(game.controller.containerLocked(),true);
  assert.deepEqual(game.controller.state.collectedItems.map(item=>item.instanceId),['blank']);
  assert.equal(shownTool(game),null);
  if(allowBareHanded)assert.equal(action(game.deck,'force').checkInfo.chance,'33.3%');
  else assert.equal(action(game.deck,'force'),undefined);
  assert.equal(action(game.deck,'leave').disabled,false);
  assert.deepEqual(game.errors,[]);
  game.controller.destroy();
 }
});

test('canceling a Force open roll refunds Energy and keeps the selected tool use',async()=>{
 let finish;
 const game=fixture({assistTool:prying,allowBareHanded:false,inventory:[{definitionId:'rod',instanceId:'single'}],
  rollCheck:()=>new Promise(resolve=>finish=resolve)});
 game.deck.choose('force');
 assert.equal(game.controller.state.variables.energy,3);
 assert.equal(game.controller.cancelCheck(),true);
 finish([6]);await settle();
 assert.equal(game.controller.state.variables.energy,5);
 assert.equal(shownTool(game).remainingTriggers,1);
 assert.equal(game.controller.containerLocked(),true);
 game.controller.destroy();
});
