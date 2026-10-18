import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectController } from '../project/ProjectController.js';
import { addInventory, transact } from '../project/state.js';

class Deck extends EventTarget {
  reset() { this.busy=false; }
  replaceContent(content) { this.content=content; }
  endContent() {}
  accept(id) {
    const event=new Event('commit');
    event.detail={contentId:this.content.id,action:this.content.actions.find(action=>action.id===id)};
    this.dispatchEvent(event);
  }
}
function fixture(permability, options={}, extra={}) {
  const deck=new Deck(), errors=[];
  const item={id:'key',definitionId:'key',inventoryKey:'alias',kind:'item',permability};
  const actions=['open','unlock'].map(id=>({id,kind:'action',name:id,resolution:'direct',contextItemId:'key',contextInventoryKey:'alias',...extra}));
  actions.push({id:'leave',kind:'action',name:'Leave',resolution:'direct'});
  const connections=Object.fromEntries(actions.flatMap(action=>action.resolution==='check'
    ?[[`${action.id}:success`,'door'],[`${action.id}:failure`,'door']]:[[action.id,'door']]));
  const compiled={startNode:'door',variables:[],library:[item],nodes:[{id:'door',type:'fork',introEnabled:false,choices:actions,connections}]};
  const controller=new ProjectController(deck,compiled,{onError:error=>errors.push(error),...options});
  controller.inventory=addInventory([],item);controller.show({restore:true});
  return {controller,deck,item,errors};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('permanent items trigger repeatedly, finite counts are shared across Actions and final use removes ownership',()=>{
  for(const limit of [0,1,3]) {
    const {controller,deck,errors}=fixture(limit);
    for(let i=0;i<(limit||5);i++) {
      // Rendering, availability checks and route preflight never spend a use.
      controller.content();controller.content();
      assert.equal(controller.inventory[0].remainingTriggers,limit?limit-i:undefined);
      deck.accept(i%2?'unlock':'open');
    }
    assert.equal(controller.inventory.length,limit?0:1);
    assert.deepEqual(errors,[]);
    if(limit)assert.deepEqual(deck.content.actions.map(action=>action.id),['leave']);
    controller.destroy();
  }
});

test('merely owning an item or progressing unrelated Actions does not spend its triggers',()=>{
  const {controller,deck}=fixture(2);
  deck.accept('leave');
  assert.equal(controller.inventory[0].remainingTriggers,2);
  assert.equal(controller.useItem,undefined);
  controller.restart();
  assert.equal(controller.inventory.length,0);
  controller.destroy();
});

test('blocked and invalid Action transactions do not consume item uses',()=>{
  const {controller,deck}=fixture(2);
  const action=controller.compiled.nodes[0].choices[0];
  controller.compiled.nodes[0].connections.open=false;
  controller.show({restore:true});deck.accept('open');
  assert.equal(controller.inventory[0].remainingTriggers,2);
  controller.compiled.nodes[0].connections.open='door';
  action.effects=[{op:'set',key:'unknown',value:1}];
  controller.show({restore:true});deck.accept('open');
  assert.equal(controller.inventory[0].remainingTriggers,2);
  controller.destroy();
});

test('committed checks spend once after feedback for either outcome',async()=>{
  for(const roll of [1,6]) {
    let resolveFeedback;
    const {controller,deck}=fixture(2,{rollCheck:async()=>roll,onCheckResult:()=>new Promise(resolve=>{resolveFeedback=resolve;})},
      {resolution:'check',check:{pool:[{sides:6,count:1}],target:4,modifier:0}});
    deck.accept('open');await flush();
    assert.equal(controller.inventory[0].remainingTriggers,2);
    resolveFeedback();await flush();
    assert.equal(controller.inventory[0].remainingTriggers,1);
    assert.equal(controller.checking,null);
    controller.destroy();
  }
});

test('canceled checks and stale completions do not spend triggers',async()=>{
  let resolveRoll;
  const {controller,deck}=fixture(1,{rollCheck:()=>new Promise(resolve=>{resolveRoll=resolve;})},
    {resolution:'check',check:{pool:[{sides:6,count:1}],target:4,modifier:0}});
  deck.accept('open');controller.cancelCheck();resolveRoll(6);await flush();
  assert.equal(controller.inventory[0].remainingTriggers,1);
  controller.destroy();
});

test('exhaustion is included in routing predictions before a contextual Action commits',()=>{
  const {controller,deck}=fixture(1);
  controller.compiled.nodes[0].connections.open='route';
  controller.nodes.set('route',{id:'route',type:'random',routes:[{id:'has-key',weight:1,target:false,conditions:[{source:'inventory',key:'alias',op:'has'}]}],fallback:null});
  controller.show({restore:true});
  assert.equal(deck.content.actions.find(action=>action.id==='open').disabled,false);
  assert.equal(controller.inventory[0].remainingTriggers,1);
  deck.accept('open');
  assert.equal(controller.completed,true);
  assert.equal(controller.inventory.length,0);
  controller.destroy();
});

test('trigger transactions preserve aliases and counters atomically, and regrant fresh uses after exhaustion',()=>{
  const item={id:'key',kind:'item',inventoryKey:'alias',permability:2};
  const original=addInventory([],item),before=structuredClone(original);
  const once=transact({},original,{triggerItem:'alias'}).inventory;
  assert.equal(once[0].remainingTriggers,1);
  assert.deepEqual(original,before);
  assert.equal(addInventory(once,item)[0].remainingTriggers,1,'duplicate grants do not refill an owned item');
  const regranted=transact({},once,{triggerItem:'key',effects:[{op:'removeItem',key:'key'},{op:'addItem',key:'key'}]},[],[item]).inventory;
  assert.equal(regranted[0].remainingTriggers,2);
  const paid=transact({},original,{triggerItem:'key',costs:[{source:'inventory',key:'key'}]}).inventory;
  assert.deepEqual(paid,[],'explicit ownership costs do not double-remove the triggering item');
  assert.deepEqual(transact({},once,{triggerItem:'key',effects:[{op:'removeItem',key:'alias'}]}).inventory,[]);
  assert.deepEqual(transact({},once,{triggerItem:'key',effects:[{op:'addItem',key:'key'}]},[],[item]).inventory,[], 'duplicate grants do not refill the last use');
  assert.equal(addInventory([],once[0])[0].remainingTriggers,1,'returned items retain their remaining uses');
  assert.throws(()=>addInventory([],{...item,remainingTriggers:3}), /remaining item triggers/);
  assert.throws(()=>addInventory([],{...item,remainingTriggers:0}), /remaining item triggers/);
  assert.equal(addInventory([],{...item,permability:0,remainingTriggers:1})[0].remainingTriggers,undefined);
  assert.throws(()=>transact({},original,{triggerItem:'key',effects:[{op:'set',key:'unknown',value:1}]}));
  assert.deepEqual(original,before);
});
