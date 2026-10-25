import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability } from '../project/action-availability.js';
import { ProjectController } from '../project/ProjectController.js';

class Deck extends EventTarget {
  reset() {}
  replaceContent(content) { this.content=content; }
  endContent() { this.ended=true; }
}
const action=(extra={})=>({id:'try',kind:'action',name:'Try',resolution:'direct',check:{pool:[{sides:6,count:1}],target:1},...extra});
const story={id:'after',kind:'narrative',name:'After'};
const variable={id:'energy',name:'energy',type:'number',initial:1,min:0};
const item={id:'lockpick',definitionId:'lockpick',inventoryKey:'pick-alias',name:'Lockpick',kind:'item',permability:2,tagId:'tools'};
const compiled={variables:[variable,{id:'flag',name:'Door unlocked',type:'flag',initial:false}],library:[item],itemTags:[{id:'tools',name:'Tools'}]};
function fixture(type,source,mode='disabled',{inventory=[],override,connections,nodeEntryEffects,nodes=[]}={}) {
  const node={id:'start',type,unavailableActions:override,...(type==='fork'?{choices:[source],introEnabled:false}:{cards:[source,story]}),connections:connections??(type==='fork'?{try:null}:{next:null})};
  const document={...compiled,startNode:'start',unavailableActions:mode,nodes:[node,...nodes]};
  const original=structuredClone(document),deck=new Deck();
  const controller=new ProjectController(deck,document,{initialState:{inventory},nodeEntryEffects});
  return {deck,controller,document,original};
}
const commit=({deck,controller})=>controller.commit({contentId:deck.content.id,action:{id:'try'}});

for(const type of ['fork','linear'])for(const mode of ['hidden','disabled','triggers-only','disabled-triggers'])for(const resolution of ['direct','check']) {
  test(`${type}/${mode}/${resolution}: unmet rules and costs follow visibility and cannot execute`,()=>{
    const source=action({resolution,conditions:[{source:'variable',key:'flag',op:'eq',value:true}],costs:[{source:'variable',key:'energy',amount:2}]});
    const f=fixture(type,source,mode);
    const shown=f.deck.content.actions.find(a=>a.id==='try');
    assert.equal(!!shown,['disabled','disabled-triggers'].includes(mode));
    if(shown){assert.equal(shown.disabled,true);assert.equal(shown.disabledReason,'Requires: Door unlocked = true · Requires: 2 energy');}
    const before=f.controller.state;commit(f);assert.deepEqual(f.controller.state,before);
    assert.deepEqual(f.document,f.original);f.controller.destroy();
  });
}
for(const type of ['fork','linear'])for(const mode of ['hidden','disabled','triggers-only','disabled-triggers'])for(const key of ['lockpick','pick-alias','tag:tools'])for(const exhausted of [false,true]) {
  test(`${type}/${mode}: ${key} ${exhausted?'exhausted':'missing'} trigger`,()=>{
    const f=fixture(type,action({contextItemId:key,contextInventoryKey:key}),mode);
    // A depleted externally supplied state can still occur during live edits.
    if(exhausted){f.controller.inventory=[{...item,remainingTriggers:0}];f.controller.location={...f.controller.location,index:0};f.controller.location=f.controller.seek(f.controller.location);f.controller.show();}
    const shown=f.deck.content.actions.find(a=>a.id==='try');
    assert.equal(!!shown,['triggers-only','disabled-triggers'].includes(mode));
    if(shown){assert.equal(shown.disabled,true);assert.equal(shown.disabledReason,`${exhausted?'':'Requires: '}${key==='tag:tools'?'Tag: Tools':'Lockpick'}${exhausted?' exhausted':''}`);}
    const before=f.controller.state;commit(f);assert.deepEqual(f.controller.state,before);f.controller.destroy();
  });
}
test('usable aliases and tags remain enabled; depleted tag member does not hide usable member',()=>{
  for(const key of ['lockpick','pick-alias','tag:tools']){
    const status=actionAvailability(action({contextItemId:key}),{},[{...item,remainingTriggers:1}],compiled,'disabled-triggers');
    assert.equal(status.disabled,false);assert.equal(status.hidden,false);assert.equal(status.disabledReason,'');
  }
  assert.equal(actionAvailability(action({contextItemId:'tag:tools'}),{},[{...item,remainingTriggers:0},{...item,id:'other',definitionId:'other',remainingTriggers:1}],compiled).disabled,false);
});
test('reasons cover human inventory labels, missing ownership, comparisons and combined cost totals',()=>{
  const source=action({conditions:[{source:'inventory',key:'pick-alias',op:'has'},{source:'inventory',key:'tag:tools',op:'missing'},{source:'variable',key:'energy',op:'gte',value:3},{source:'variable',key:'flag',op:'neq',value:false}],costs:[{source:'variable',key:'energy',amount:1},{source:'variable',key:'energy',amount:1}]});
  const status=actionAvailability(source,{energy:1,flag:false},[],compiled);
  assert.equal(status.disabledReason,'Requires: Lockpick · Requires: energy ≥ 3 · Requires: Door unlocked ≠ false · Requires: 2 energy');
  assert.equal(actionAvailability(action({conditions:[{source:'inventory',key:'pick-alias',op:'missing'}]}),{},[item],compiled).disabledReason,'Requires: Without Lockpick');
  assert.equal(actionAvailability(action({contextItemId:'lockpick',contextInventoryKey:'pick-alias',conditions:[{source:'inventory',key:'pick-alias',op:'has'}]}),{},[],compiled).disabledReason,'Requires: Lockpick');
});
test('project inheritance, explicit overrides and legacy default remain stable',()=>{
  for(const [mode,override,visible] of [['hidden','project',false],['hidden','disabled',true],['disabled-triggers','disabled',false]]){
    const f=fixture('fork',action({...(['triggers-only','disabled-triggers'].includes(mode)?{contextItemId:'lockpick'}:{}),conditions:[{source:'variable',key:'flag',op:'eq',value:true}]}),mode,{override});
    assert.equal(f.deck.content.actions.some(a=>a.id==='try'),visible);f.controller.destroy();
  }
  const f=fixture('fork',action({costs:[{source:'variable',key:'energy',amount:2}]}),undefined);delete f.controller.compiled.unavailableActions;
  assert.equal(f.controller.content().actions[0].disabledReason,'Requires: 2 energy');f.controller.destroy();
});
test('departure explanations inspect both check paths and automatic routing without executing',()=>{
  for(const [resolution,connections,nodes,reason] of [
    ['direct',{},[],'No connected destination'],
    ['check',{'try:success':null},[],'No connected destination'],
    ['direct',{try:'cycle'},[{id:'cycle',type:'random',routes:[],fallback:'cycle'}],'Automatic routing cycle'],
    ['direct',{try:'missing'},[],'Connected destination is missing'],
  ]){
    const f=fixture('fork',action({resolution}),'disabled-triggers',{connections,nodes});
    assert.equal(f.deck.content.actions[0].disabledReason,reason);assert.equal(f.controller.state.completed,false);assert.deepEqual(f.document,f.original);f.controller.destroy();
  }
});
test('preflight uses entry effects and arrival state while preserving current state and documents',()=>{
  const f=fixture('fork',action(),'disabled-triggers',{
    connections:{try:'entry'},nodeEntryEffects:{entry:[{op:'set',key:'energy',value:4}]},nodes:[
      {id:'entry',type:'linear',cards:[],connections:{next:'target'}},
      {id:'target',type:'linear',cards:[action({costs:[{source:'variable',key:'energy',amount:3}]})],connections:{next:null}},
    ],
  });
  assert.equal(f.deck.content.actions[0].disabled,false);assert.equal(f.controller.state.variables.energy,1);
  commit(f);assert.equal(f.controller.state.activeNodeId,'target');assert.equal(f.controller.state.variables.energy,4);assert.equal(f.deck.content.actions[0].disabled,false);
  assert.deepEqual(f.document,f.original);f.controller.destroy();
});
test('hidden linear trigger actions participate safely in preflight routing and cycles',()=>{
  const f=fixture('fork',action(),'disabled',{
    connections:{try:'target'},nodes:[{id:'target',type:'linear',cards:[action({contextItemId:'lockpick'})],connections:{next:'target'}}],
  });
  assert.equal(f.deck.content.actions[0].disabledReason,'Automatic routing cycle');f.controller.destroy();
});

for (const type of ['fork','linear']) for (const mode of ['hidden','disabled','triggers-only','disabled-triggers']) {
  test(`${type}/${mode}: inventory costs using different aliases cannot double-charge ownership`,()=>{
    for (const keys of [['lockpick','pick-alias'],['pick-alias','lockpick'],['lockpick','lockpick']]) {
      const source=action({costs:keys.map(key=>({source:'inventory',key,amount:1}))});
      const inventory=[{...item,remainingTriggers:2}];
      const status=actionAvailability(source,{energy:1},inventory,compiled,mode);
      assert.equal(status.disabled,true);assert.equal(status.disabledReason,'Requires: Lockpick');
      const f=fixture(type,source,mode,{inventory});
      const shown=f.deck.content.actions.find(a=>a.id==='try');
      assert.equal(!!shown,['disabled','disabled-triggers'].includes(mode));
      if (shown) {assert.equal(shown.disabled,true);assert.equal(shown.disabledReason,'Requires: Lockpick');}
      const before=f.controller.state;commit(f);assert.deepEqual(f.controller.state,before);
      assert.deepEqual(f.document,f.original);f.controller.destroy();
    }
  });
}

test('inventory and variable requirements resolve names in their own namespaces',()=>{
  const collision={...compiled,variables:[{...variable,name:'Stamina'}],library:[{id:'energy',kind:'item',name:'Battery',permability:1}]};
  const source=action({contextItemId:'energy',conditions:[{source:'inventory',key:'energy',op:'has'},{source:'variable',key:'energy',op:'gte',value:3}],costs:[{source:'inventory',key:'energy',amount:1},{source:'variable',key:'energy',amount:2}]});
  const status=actionAvailability(source,{energy:1},[],collision,'disabled-triggers');
  assert.equal(status.disabledReason,'Requires: Battery · Requires: Stamina ≥ 3 · Requires: 2 Stamina');
  assert.equal(actionAvailability(action({contextItemId:'energy'}),{},[{id:'energy',name:'Battery',permability:1,remainingTriggers:0}],collision,'disabled-triggers').disabledReason,'Battery exhausted');
  assert.equal(actionAvailability(action({conditions:[{source:'inventory',key:'energy',op:'missing'}]}),{},[{id:'energy'}],collision).disabledReason,'Requires: Without Battery');
});

for(const type of ['fork','linear'])for(const key of ['pick-alias','tag:tools'])for(const missingRule of [false,true])for(const missingTrigger of [false,true])test(`${type}: trigger-only visibility separates compiled ${key} ownership from authored rules (${missingRule}/${missingTrigger})`,()=>{
 const rules=[{source:'variable',key:'flag',op:'eq',value:missingRule}];
 const source=action({contextItemId:key,contextInventoryKey:key,explicitConditions:rules,conditions:[...rules,{source:'inventory',key,op:'has'}]});
 const f=fixture(type,source,'triggers-only',{inventory:missingTrigger?[]:[{...item,remainingTriggers:1}]});
 const shown=f.deck.content.actions.find(a=>a.id==='try');
 assert.equal(!!shown,!missingRule);
 if(shown)assert.equal(shown.disabled,missingTrigger);
 if(missingRule||missingTrigger){const before=f.controller.state;commit(f);assert.deepEqual(f.controller.state,before);}
 f.controller.destroy();
});

test('trigger-only still hides explicit ownership requirements on the trigger item',()=>{
 const rule={source:'inventory',key:'pick-alias',op:'has'};
 const source=action({contextInventoryKey:'pick-alias',explicitConditions:[rule],conditions:[rule,rule]});
 assert.equal(actionAvailability(source,{},[],compiled,'triggers-only').hidden,true);
});
