import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectController} from '../project/ProjectController.js';
import {chapterEntryState} from '../project/chapter-entry.js';
import {createProject} from '../project/model.js';

class Deck extends EventTarget {
 reset(){this.busy=false;this.phase='closed';}
 replaceContent(content,options={}){this.content=content;this.phase=options.presentation==='open'?'choices':'closed';}
 endContent(){this.ended=true;}
 emit(name,detail={}){const event=new Event(name);event.detail={contentId:this.content.id,...detail};this.dispatchEvent(event);}
 choose(id){this.emit('commit',{action:this.content.actions.find(action=>action.id===id)});}
}
const action=(id,extra={})=>({id,kind:'action',headline:id,resolution:'direct',effects:[],...extra});
function fixture({single=false,check=false,target='return',...options}={}){
 const once=action('once',{hideAfterUse:true,effects:[{op:'add',key:'count',value:1}],...(check?{resolution:'check',check:{pool:[{sides:6,count:1}],modifier:0,target:4}}:{})});
 const fork={id:'fork',type:'fork',introEnabled:false,choices:[once,...(single?[]:[action('again')])],connections:{once:target,'once:success':target,'once:failure':target,again:'return'}};
 const compiled={id:'chapter',startNode:'fork',variables:[{id:'count',type:'number',initial:0}],library:[],nodes:[fork,
  {id:'return',type:'linear',cards:[{id:'back',kind:'caption',headline:'Back'}],connections:{next:'fork'}}]};
 const deck=new Deck(),errors=[];
 const controller=new ProjectController(deck,compiled,{onError:error=>errors.push(error),...options});
 return {controller,deck,errors,compiled};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('used Fork choices hide per placement, keep other options and reset with a fresh run',()=>{
 const game=fixture(),{controller,deck}=game;
 for(let i=0;i<4;i++){controller.content();controller.departureReason(controller.choices()[0]);controller.notify();}
 assert.equal(controller.variables.count,0);assert.equal(controller.usedForkChoices.size,0);
 deck.choose('once');assert.equal(controller.variables.count,1);assert.equal(controller.state.activeNodeId,'return');
 deck.choose('continue');assert.equal(controller.state.activeNodeId,'fork');
 assert.deepEqual(deck.content.actions.map(action=>action.id),['again']);
 deck.choose('again');deck.choose('continue');assert.deepEqual(deck.content.actions.map(action=>action.id),['again']);
 controller.restart();assert.deepEqual(deck.content.actions.map(action=>action.id),['once','again']);assert.equal(controller.variables.count,0);
 controller.destroy();
});

test('an exhausted Fork remains a blocked destination instead of skipping or completing',()=>{
 const {controller,deck}=fixture({single:true});
 deck.choose('once');deck.choose('continue');
 assert.equal(controller.state.activeNodeId,'fork');assert.equal(controller.state.completed,false);
 assert.equal(deck.content.actions.length,1);assert.equal(deck.content.actions[0].id,'unavailable');assert.equal(deck.content.actions[0].disabled,true);
 deck.choose('unavailable');assert.equal(controller.state.activeNodeId,'fork');controller.destroy();
});

for(const result of [1,6])test(`a resolved check hides its choice after ${result===1?'failure':'success'}`,async()=>{
 const {controller,deck}=fixture({check:true,rollCheck:async()=>[result]});
 deck.choose('once');await tick();
 assert.equal(controller.state.activeNodeId,'return');assert.equal(controller.variables.count,1);
 deck.choose('continue');assert.deepEqual(deck.content.actions.map(action=>action.id),['again']);controller.destroy();
});

test('canceled or failed checks and blocked routes never consume a choice',async()=>{
 let finish;
 const game=fixture({check:true,rollCheck:()=>new Promise(resolve=>finish=resolve)});
 game.deck.choose('once');assert(game.controller.cancelCheck());finish([6]);await tick();
 assert.equal(game.controller.usedForkChoices.size,0);assert.equal(game.controller.variables.count,0);
 assert(game.deck.content.actions.some(action=>action.id==='once'));game.controller.destroy();
 const failed=fixture({check:true,rollCheck:async()=>{throw new Error('No roller');}});
 failed.deck.choose('once');await tick();assert.equal(failed.controller.usedForkChoices.size,0);failed.controller.destroy();
 const blocked=fixture({target:false});blocked.deck.choose('once');
 assert.equal(blocked.controller.usedForkChoices.size,0);assert.equal(blocked.controller.variables.count,0);blocked.controller.destroy();
});

test('used choice memory does not leak to another Fork and is detached across chapter entry',()=>{
 const {controller,deck,compiled}=fixture();
 deck.choose('once');
 const other={...compiled.nodes[0],id:'other'};compiled.nodes.push(other);controller.nodes.set(other.id,other);
 const destination=controller.locate('other');controller.adopt(destination,false);controller.show();
 assert.deepEqual(deck.content.actions.map(action=>action.id),['once','again']);
 const project=createProject(),entry=chapterEntryState(project,project.chapters[0].id,controller.state);
 assert.deepEqual(entry.usedForkChoices,controller.state.usedForkChoices);
 entry.usedForkChoices.push('different');assert.equal(controller.usedForkChoices.size,1);controller.destroy();
});
