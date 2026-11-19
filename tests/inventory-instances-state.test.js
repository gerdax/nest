import test from 'node:test';
import assert from 'node:assert/strict';
import {addInventory, transact, selectTriggerItem, inventoryQuantity, conditionsMet, affordCosts} from '../project/state.js';

const tool = {id:'tool',kind:'item',inventoryKey:'tools',tagId:'equipment',permability:4};
const instance = (instanceId,remainingTriggers=4,extra={}) => ({...tool,definitionId:'tool',instanceId,remainingTriggers,...extra});

test('multiple collection creates deterministic distinct identities without mutating sources',()=>{
  const original = [instance('item-instance:tool:1',2)];
  const before = structuredClone(original);
  const added = addInventory(original,tool,{allowMultiple:true});
  assert.equal(added.length,2);
  assert.equal(added[1].instanceId,'item-instance:tool:2');
  assert.equal(added[1].id,'tool');
  assert.equal(added[1].definitionId,'tool');
  assert.deepEqual(addInventory(original,tool,{allowMultiple:true}),added);
  assert.equal(addInventory(added,tool).length,2);
  assert.equal(addInventory(added,instance('another')).length,2);
  assert.equal(addInventory([],tool)[0].instanceId,undefined);
  assert.deepEqual(original,before);
  assert.equal(tool.instanceId,undefined);
});

test('restored explicit instances retain separate uses, deduplicate physical identity and discard quantity',()=>{
  const inventory = [instance('first',1),instance('second',3),instance('first',4)];
  const restored = transact({},inventory).inventory;
  assert.deepEqual(restored.map(item=>[item.instanceId,item.remainingTriggers]),[['first',1],['second',3]]);
  assert.deepEqual(addInventory(restored,{...instance('first',4),quantity:99}),restored);
  assert.equal(addInventory(restored,instance('third',2),{allowMultiple:true}).length,3);
  assert.deepEqual(transact({},[{...tool,quantity:2},{...tool,quantity:5}]).inventory,[tool]);
  const mixed = addInventory([tool],tool,{allowMultiple:true});
  assert.equal(mixed.length,2);
  assert.equal(transact({},mixed).inventory.length,2);
});

test('triggers exhaust the least remaining positive uses with stable ties and exact instance priority',()=>{
  const inventory = [instance('full'),instance('low',1),instance('tie',1),instance('spent',0)];
  assert.equal(selectTriggerItem(inventory,'tool').instanceId,'low');
  assert.equal(selectTriggerItem(inventory,'tools').instanceId,'low');
  assert.equal(selectTriggerItem(inventory,'full').instanceId,'full');
  assert.equal(selectTriggerItem(inventory,'spent'),undefined);
  const next = transact({},inventory,{triggerItem:'tool'}).inventory;
  assert.deepEqual(next.map(item=>item.instanceId),['full','tie','spent']);
  const exact = transact({},inventory,{triggerItem:'full'}).inventory;
  assert.equal(exact[0].remainingTriggers,3);
  assert.equal(exact[1].remainingTriggers,1);
  assert.equal(inventory[0].remainingTriggers,4);
});

test('tag triggers retain first matching definition before choosing its least remaining instance',()=>{
  const inventory = [instance('a',3),instance('other',1,{id:'other',definitionId:'other',inventoryKey:'other'}),instance('b',2)];
  assert.equal(selectTriggerItem(inventory,'tag:equipment').instanceId,'b');
  const permanent = [instance('permanent',4,{permability:0}),instance('finite',3)];
  assert.equal(selectTriggerItem(permanent,'tool').instanceId,'finite');
});

test('costs and removal effects consume one least-used instance and exact identities override aliases',()=>{
  const inventory = [instance('full'),instance('low',1),instance('middle',2)];
  for (const rules of [{costs:[{source:'inventory',key:'tool'}]},{effects:[{op:'removeItem',key:'tools'}]}]) {
    assert.deepEqual(transact({},inventory,rules).inventory.map(item=>item.instanceId),['full','middle']);
  }
  assert.deepEqual(transact({},inventory,{costs:[{source:'inventory',key:'full'}]}).inventory.map(item=>item.instanceId),['low','middle']);
  assert.equal(affordCosts({},inventory,Array.from({length:3},()=>({source:'inventory',key:'tool'}))),true);
  assert.equal(affordCosts({},inventory,Array.from({length:4},()=>({source:'inventory',key:'tool'}))),false);
  assert.throws(()=>transact({},inventory,{effects:[{op:'removeItem',key:'tag:equipment'}]}),/concrete item/);
  assert.equal(inventoryQuantity(inventory,'tool'),1);
  assert.equal(inventoryQuantity(inventory,'low'),1);
  assert.equal(conditionsMet([{source:'inventory',key:'tool',op:'eq',value:1}],{},inventory),true);
});

test('trigger tracking survives cloning and spends only the original instance after effects',()=>{
  const inventory = [instance('full'),instance('low',2)];
  const granted = transact({},inventory,{triggerItem:'low',effects:[{op:'addItem',key:'tool'}]},[],[tool],{allowMultiple:true}).inventory;
  assert.equal(granted.length,3);
  assert.deepEqual(granted.map(item=>item.remainingTriggers),[4,1,4]);
  const removedOther = transact({},inventory,{triggerItem:'full',effects:[{op:'removeItem',key:'tool'}]}).inventory;
  assert.deepEqual(removedOther.map(item=>[item.instanceId,item.remainingTriggers]),[['full',3]]);
  const replaced = transact({},inventory,{triggerItem:'low',effects:[{op:'removeItem',key:'low'},{op:'addItem',key:'tool'}]},[],[tool],{allowMultiple:true}).inventory;
  assert.deepEqual(replaced.map(item=>item.remainingTriggers),[4,4]);
  assert.deepEqual(transact({},[instance('last',1)],{triggerItem:'last',costs:[{source:'inventory',key:'last'}]}).inventory,[]);
});

test('transaction previews are deterministic and failed transactions leave all counters intact',()=>{
  const inventory = [instance('full'),instance('low',2)];
  const before = structuredClone(inventory);
  const rules = {triggerItem:'tool',effects:[{op:'addItem',key:'tool'}]};
  const args = [{},inventory,rules,[],[tool],{allowMultiple:true}];
  assert.deepEqual(transact(...args),transact(...args));
  assert.throws(()=>transact({},inventory,{triggerItem:'tool',effects:[{op:'set',key:'unknown',value:1}]}));
  assert.deepEqual(inventory,before);
});
