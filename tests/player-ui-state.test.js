import test from 'node:test';
import assert from 'node:assert/strict';
import { playerUIState } from '../studio/player-ui-state.js';

function fixture() {
  const item={id:'owned-tool',definitionId:'tool',inventoryKey:'old-tool',kind:'item',permability:2,remainingTriggers:1};
  const info={stat:'Agility: 3',chance:'37.5%',label:'Low',formula:'3d6 + 3 ≥ 15'};
  return {revision:1,run:{idle:true,variables:{health:8,energy:2},collectedItems:[item]},
    card:{phase:'choices',action:{id:'try',contextInventoryKey:'old-tool',checkInfo:info}},
    interaction:{busy:false,dragging:false},feedback:{},definitions:{variables:[{id:'health',type:'number',max:10},{id:'energy',type:'number',max:5}]}};
}

test('player presentation combines existing odds and concrete trigger without changing gameplay data',()=>{
  const input=fixture(),before=structuredClone(input),view=playerUIState(input);
  assert.equal(view.context.info,input.card.action.checkInfo);
  assert.equal(view.context.item,input.run.collectedItems[0]);
  assert.equal(view.inventory.items,input.run.collectedItems);
  assert.equal(view.canInspect,true);
  assert.deepEqual(input,before);
  assert.deepEqual(view.resources,[{id:'health',label:'Health',visible:true,value:8,max:10},{id:'energy',label:'Energy',visible:true,value:2,max:5}]);
});

test('results override requirements, which override odds and using, without hiding inventory',()=>{
  const input=fixture();
  input.card.action.disabled=true;input.card.action.disabledReason='Requires: 3 Energy';
  input.card.action.disabledReasonParts=[{text:'Requires: 3 Energy',resource:'energy',amount:3}];
  let view=playerUIState(input);
  assert.equal(view.context.info,null);assert.equal(view.context.item,null);
  assert.equal(view.context.disabledReason,'Requires: 3 Energy');
  assert.equal(view.inventory.items.length,1);
  input.feedback.result={target:15,total:16,success:true};
  view=playerUIState(input);
  assert.equal(view.context.result,input.feedback.result);
  assert.equal(view.context.disabledReason,null);assert.equal(view.context.disabledReasonParts,null);
  assert.equal(view.context.info,null);assert.equal(view.context.item,null);
  input.feedback.result={target:15};
  assert.equal(playerUIState(input).context.result,null,'an incomplete dice result is never presented');
});

test('context follows card faces and clears on checking/completion while direct disabled fronts remain explained',()=>{
  for(const phase of ['revealing','committing','closing','closed']) {
    const input=fixture();input.card.phase=phase;
    const view=playerUIState(input);
    assert.equal(view.context.info,null);assert.equal(view.context.item,null);
  }
  for(const field of ['checking','completed']) {
    const input=fixture();input.run[field]=true;
    assert.equal(playerUIState(input).context.info,null);
    assert.equal(playerUIState(input).context.item,null);
  }
  const input=fixture();input.card={phase:'closed',directAdvance:true,action:{disabled:true,disabledReason:'Requires: tool'}};
  assert.equal(playerUIState(input).context.disabledReason,'Requires: tool');
  input.card.directAdvance=false;assert.equal(playerUIState(input).context.disabledReason,null);
});

test('inspection and context busy state are independent of drawer refresh readiness',()=>{
  const input=fixture();
  input.interaction.dragging=true;
  let view=playerUIState(input);
  assert.equal(view.canInspect,false);assert.equal(view.context.info,input.card.action.checkInfo);
  assert.equal(view.inventory.busy,false);
  input.interaction.busy=true;
  view=playerUIState(input);assert.equal(view.context.busy,true);assert.equal(view.inventory.busy,false);
  input.run.idle=false;
  view=playerUIState(input);assert.equal(view.inventory.busy,true);
});

test('resource presentation is typed, arbitrary variables stay out, and no-run input has no ordinary context',()=>{
  const input=fixture();input.definitions.variables=[{id:'health',type:'flag'},{id:'unrelated',type:'number',max:10}];
  assert.ok(playerUIState(input).resources.every(resource=>!resource.visible));
  input.run=null;
  const view=playerUIState(input);
  assert.equal(view.context.info,null);assert.equal(view.context.item,null);assert.equal(view.canInspect,false);
  assert.deepEqual(view.inventory.items,[]);
});
