import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {selectTriggerItem,addInventory} from '../project/state.js';
import {createRatCombatProject} from '../project/combat-fixture.js';
import {compileChapter,createProject,parseProject,validateProject} from '../project/model.js';
import {chapterEntryState} from '../project/chapter-entry.js';
import {createEncounter,playerChoices} from '../project/combat-rules.js';
import {projectSettingsInspector} from '../studio/inspectors.js';

class Deck extends EventTarget {
 reset(){this.busy=false;this.phase='choices';}
 replaceContent(content,options={}){if(this.busy)this.pending=content;else this.content=content;this.phase=options.presentation==='open'?'choices':'closed';}
 emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
 collect(id,final){this.busy=true;this.emit('collect',{action:{id},final});this.busy=false;this.emit('transitioncomplete',{transition:'collect'});if(this.pending){this.content=this.pending;this.pending=null;}this.phase='choices';this.emit('transitioncomplete',{transition:'commit'});}
 choose(){this.emit('commit',{action:this.content.actions[0]});}
 endContent(){}
}
function fixture(mode='multiple'){
 const item={kind:'item',id:'source',definitionId:'source',inventoryKey:'same',headline:'Key',permability:3,onCollect:[]};
 const compiled={id:'chapter',startNode:'find',ownedItemsVisibility:mode,variables:[],library:[item],nodes:[
  {id:'find',type:'container',introEnabled:false,items:[{...item,id:'first'},{...item,id:'second'}],connections:{next:'use'}},
  {id:'use',type:'fork',introEnabled:false,choices:[{id:'open',kind:'action',headline:'Open',resolution:'direct',contextInventoryKey:'same'}],connections:{open:'use'}}]};
 const deck=new Deck(),errors=[],controller=new ProjectController(deck,compiled,{onError:error=>errors.push(error)});
 return {controller,deck,errors};
}

for(const mode of ['multiple','disabled'])test(`duplicate pickups have distinct stable physical IDs and least-use triggering (${mode})`,()=>{
 const {controller,deck,errors}=fixture(mode);
 const first=deck.content.actions[0].instanceId,second=deck.content.actions[1].instanceId;
 assert(first&&second&&first!==second);assert.equal(deck.content.actions[0].usesRemaining,3);
 deck.collect('first',false);
 assert.equal(controller.inventory[0].instanceId,first);
 assert.equal(deck.content.actions.find(action=>action.id==='second').instanceId,second);
 assert.equal(deck.content.actions.find(action=>action.id==='second').alreadyOwned,false);
 deck.collect('second',true);
 assert.equal(controller.state.activeNodeId,'use');assert.equal(controller.inventory.length,2);
 assert.deepEqual(controller.inventory.map(item=>item.instanceId),[first,second]);
 controller.inventory=[controller.inventory[1],{...controller.inventory[0],remainingTriggers:2}];
 const snapshot=structuredClone(controller.inventory);
 controller.content();controller.departureReason(controller.choices()[0]);
 assert.deepEqual(controller.inventory,snapshot);
 assert.equal(selectTriggerItem(controller.inventory,'same').instanceId,first);
 deck.choose();assert.deepEqual(controller.inventory.map(item=>item.remainingTriggers),[3,1]);
 deck.choose();assert.deepEqual(controller.inventory.map(item=>item.instanceId),[second]);
 assert.equal(selectTriggerItem(controller.inventory,'same').remainingTriggers,3);
 assert.deepEqual(errors,[]);controller.destroy();
});

test('full drawer replacement removes exactly the requested physical instance',()=>{
 const {controller}=fixture();
 controller.inventory=[{id:'source',definitionId:'source',instanceId:'a',permability:3,remainingTriggers:2},
  {id:'source',definitionId:'source',instanceId:'b',permability:3,remainingTriggers:3},
  {id:'other',instanceId:'c'},{id:'other',instanceId:'d'}];
 const result=controller.collectionInventory(controller.items()[0],'b');
 assert.deepEqual(result.map(item=>item.instanceId),['a','c','d']);
 assert.equal(controller.inventory.length,4);controller.destroy();
});

test('weapon actions use a single least-used physical source for equivalent weapons',()=>{
 const project=createRatCombatProject(),compiled=compileChapter(project),weapon=compiled.library.find(card=>card.id==='pistol');
 weapon.permability=3;
 let inventory=addInventory([],{...weapon,remainingTriggers:3},{allowMultiple:true});
 inventory=addInventory(inventory,{...weapon,remainingTriggers:2},{allowMultiple:true});
 const encounter=createEncounter(compiled.library.find(card=>card.id==='rat'),'encounter');
 const choices=playerChoices(compiled,{variables:{health:10,energy:10,agility:5},inventory},encounter).filter(choice=>choice.source);
 assert.equal(choices.length,weapon.combat.actions.length);
 assert(choices.every(choice=>choice.source.instanceId===inventory[1].instanceId));
});

test('settings expose Allow multiple instead of Show unavailable for owned items',()=>{
 const project=createProject(),html=projectSettingsInspector(project);
 assert.match(html,/value="multiple" selected[^>]*>Allow multiple/);
 assert.doesNotMatch(html,/Show unavailable/);
 project.ownedItemsVisibility='hidden';assert.match(projectSettingsInspector(project),/value="hidden" selected[^>]*>Skip \/ hide/);
 project.ownedItemsVisibility='multiple';const restored=parseProject(JSON.stringify(project));
 assert.equal(compileChapter(restored).ownedItemsVisibility,'multiple');assert.deepEqual(validateProject(restored),[]);
});

test('chapter continuation and restart preserve both physical copies with their individual counters',()=>{
 const project=createProject(),item=project.library.find(card=>card.id==='flashlight');item.permability=3;
 let inventory=addInventory([],{...item,remainingTriggers:2},{allowMultiple:true});
 inventory=addInventory(inventory,item,{allowMultiple:true});
 const initialState=chapterEntryState(project,project.chapters[0].id,{variables:{health:10,energy:3},collectedItems:inventory});
 assert.deepEqual(initialState.inventory.map(item=>[item.instanceId,item.remainingTriggers]),inventory.map(item=>[item.instanceId,item.remainingTriggers]));
 const compiled=compileChapter(project),deck=new Deck(),controller=new ProjectController(deck,compiled,{initialState});
 controller.inventory[0].remainingTriggers=1;controller.inventory.pop();controller.restart();
 assert.deepEqual(controller.inventory.map(item=>[item.instanceId,item.remainingTriggers]),inventory.map(item=>[item.instanceId,item.remainingTriggers]));
 controller.destroy();
});

test('canceling a paid check refunds the exact instance even when duplicate collection is hidden',async()=>{
 const {controller,deck}=fixture('hidden');
 controller.compiled.variables.push({id:'energy',type:'number',initial:3});controller.variables.energy=3;
 controller.inventory=[{id:'source',definitionId:'source',inventoryKey:'same',instanceId:'a',permability:3,remainingTriggers:1},
  {id:'source',definitionId:'source',inventoryKey:'same',instanceId:'b',permability:3,remainingTriggers:3}];
 const fork=controller.nodes.get('use'),action=fork.choices[0];
 Object.assign(action,{resolution:'check',check:{pool:[{sides:6,count:1}],modifier:0,target:4},costs:[{source:'inventory',key:'same',amount:1}]});
 fork.connections={'open:success':'use','open:failure':'use'};
 let finish;controller.rollCheck=()=>new Promise(resolve=>finish=resolve);
 controller.adopt(controller.locate('use'),false);controller.show();deck.choose();
 assert.deepEqual(controller.inventory.map(item=>item.instanceId),['b']);
 controller.variables.energy=2;assert(controller.cancelCheck());finish([6]);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(controller.inventory.map(item=>item.instanceId).sort(),['a','b']);
 assert.equal(controller.inventory.find(item=>item.instanceId==='a').remainingTriggers,1);
 assert.equal(controller.variables.energy,2);controller.destroy();
});
