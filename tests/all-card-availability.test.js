import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';

// Payload and controller API checks; browser appearance is verified separately.
class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content=content; }
  endContent() { this.ended=true; }
}
const requirement=[{source:'inventory',key:'key',op:'has'}];
const key={id:'key',kind:'item',definitionId:'key',name:'Key'};
const story=(id,kind='event')=>({id,kind,name:id,text:id,effects:[]});
function fixture(nodes,extra={}) {
  const compiled={startNode:nodes[0].id,nodes,variables:[{id:'count',type:'number',initial:0}],library:[key],...extra};
  const original=structuredClone(compiled),deck=new Deck();
  const controller=new ProjectController(deck,compiled);
  return {deck,controller,compiled,original};
}
function commit({deck,controller},id=deck.content.actions[0].id) {
  controller.commit({contentId:deck.content.id,action:{id}});
}
for(const kind of ['event','narrative','caption','item','health','energy'])for(const mode of ['hidden','disabled','triggers-only','disabled-triggers']) {
  test(`${kind}/${mode}: unmet conditions follow project visibility and block normal APIs`,()=>{
    const card={...story('locked',kind),definitionId:'locked',conditions:requirement,effects:[{op:'add',key:'count',value:1}],onCollect:[{op:'add',key:'count',value:1}]};
    const f=fixture([{id:'linear',type:'linear',cards:[card,story('after')],connections:{next:null}}],{unavailableActions:mode});
    if(['hidden','triggers-only'].includes(mode))assert.equal(f.controller.state.cardId,'after');
    else {
      assert.equal(f.controller.state.cardId,'locked');
      const action=f.deck.content.actions[0];
      assert.equal(action.disabled,true);assert.equal(action.disabledReason,'Requires: Key');
      assert.equal(f.deck.content.nextDeckPreview,undefined);assert.equal(f.deck.content.nextCardPreview,undefined);
      if(['event','narrative','caption'].includes(kind))assert.equal(f.deck.content.advanceDisabled,true);
      const before=f.controller.state;
      commit(f);
      f.controller.resolveItem({contentId:f.deck.content.id,action,final:true},'collect');
      f.controller.resolveItem({contentId:f.deck.content.id,action,all:true,final:true},'discard');
      assert.equal(f.controller.authorizeCollection(action,{}),false);
      assert.deepEqual(f.controller.state,before);
      assert.equal(f.controller.pendingItem,null);
      f.controller.inventory=[key];f.controller.show({restore:true});
      assert.equal(f.deck.content.actions[0].disabled,false);
      if(kind!=='item'){commit(f);assert.equal(f.controller.state.cardId,'after');assert.equal(f.controller.state.variables.count,1);}
    }
    assert.deepEqual(f.compiled,f.original);f.controller.destroy();
  });
}
for(const mode of ['hidden','disabled','triggers-only','disabled-triggers'])test(`container/${mode}: item conditions use project policy`,()=>{
  const card={...key,id:'locked',definitionId:'prize',conditions:requirement};
  const f=fixture([{id:'box',type:'container',introEnabled:false,items:[card],connections:{next:'after'}},{id:'after',type:'linear',cards:[story('after')],connections:{next:null}}],{unavailableActions:mode});
  if(['hidden','triggers-only'].includes(mode))assert.equal(f.controller.state.activeNodeId,'after');
  else {
    assert.equal(f.controller.state.activeNodeId,'box');const action=f.deck.content.actions[0];
    assert.equal(action.disabled,true);assert.equal(action.collectDisabled,true);assert.equal(action.discardDisabled,true);assert.equal(action.disabledReason,'Requires: Key');
    const before=f.controller.state;
    for(const transition of ['collect','discard'])f.controller.resolveItem({contentId:f.deck.content.id,action,all:true,final:true},transition);
    assert.deepEqual(f.controller.state,before);assert.equal(f.controller.pendingItem,null);
    f.controller.inventory=[key];f.controller.show({restore:true});assert.equal(f.deck.content.actions[0].disabled,false);
  }
  assert.deepEqual(f.compiled,f.original);f.controller.destroy();
});
for(const mode of ['hidden','disabled','disabled-triggers'])test(`Shoot enters visible disabled Rat before its unlinked Next, policy=${mode}`,()=>{
  const shoot={id:'shoot',kind:'action',name:'Shoot',effects:[]};
  const f=fixture([{id:'fork',type:'fork',introEnabled:false,choices:[shoot],connections:{shoot:'rat'}},{id:'rat',type:'linear',cards:[{...story('rat'),conditions:requirement,effects:[{op:'add',key:'count',value:1}]}],connections:{next:false}}],{unavailableActions:mode});
  assert.equal(f.deck.content.actions[0].disabled,mode==='hidden');
  if(mode==='hidden')assert.equal(f.deck.content.actions[0].disabledReason,'Route unavailable');
  else {
    commit(f,'shoot');assert.equal(f.controller.state.cardId,'rat');assert.equal(f.deck.content.advanceDisabled,true);assert.equal(f.deck.content.actions[0].disabledReason,'Requires: Key');
    const before=f.controller.state;commit(f);assert.deepEqual(f.controller.state,before);assert.equal(f.controller.variables.count,0);
  }
  f.controller.destroy();
});
for(const [project,override,visible] of [['hidden','project',false],['hidden','disabled',true],['disabled','hidden',false]])test(`story project inheritance ${project}/${override}`,()=>{
  const f=fixture([{id:'linear',type:'linear',unavailableActions:override,cards:[{...story('locked'),conditions:requirement},story('after')],connections:{next:null}}],{unavailableActions:project});
  assert.equal(f.controller.state.cardId,visible?'locked':'after');f.controller.destroy();
});
for(const kind of ['event','caption','health','energy'])test(`${kind}: legacy costs remain payable and unavailable costs explained`,()=>{
  const card={...story('legacy',kind),costs:[{source:'variable',key:'count',amount:1}]};
  const f=fixture([{id:'linear',type:'linear',cards:[card],connections:{next:null}}]);
  assert.equal(f.deck.content.actions[0].disabled,true);assert.equal(f.deck.content.actions[0].disabledReason,'Requires: 1 count');
  f.controller.variables.count=2;f.controller.show({restore:true});assert.equal(f.deck.content.actions[0].disabled,false);
  commit(f);assert.equal(f.controller.completed,true);assert.equal(f.controller.variables.count,1);f.controller.destroy();
});
