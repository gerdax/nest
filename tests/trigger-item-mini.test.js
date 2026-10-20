import test from 'node:test';
import assert from 'node:assert/strict';
import { TriggerItemMini, focusedTriggerItem } from '../studio/TriggerItemMini.js';
import { ProjectPreview } from '../studio/ProjectPreview.js';
import { transact } from '../project/state.js';

test('source mini selects the same usable concrete item as tag-trigger consumption', () => {
  const items=[{id:'spent',tagId:'tool',permability:2,remainingTriggers:0},{id:'wedge',inventoryKey:'local:wedge',tagId:'tool',permability:1},{id:'key',tagId:'tool',permability:0}];
  const deck={phase:'choices',index:0,content:{actions:[{contextItemId:'tag:tool'},{contextInventoryKey:'local:wedge'},{}]}},state={collectedItems:items};
  assert.equal(focusedTriggerItem(deck,state),items[1]);
  assert.deepEqual(transact({},items,{triggerItem:'tag:tool'}).inventory.map(i=>i.id),['spent','key']);
  deck.index=1;assert.equal(focusedTriggerItem(deck,state),items[1]);
  deck.index=2;assert.equal(focusedTriggerItem(deck,state),null);
  deck.index=0;assert.equal(focusedTriggerItem(deck,{...state,checking:true}),null);
  assert.equal(focusedTriggerItem(deck,{...state,completed:true}),null);
  deck.phase='closed';assert.equal(focusedTriggerItem(deck,state),null);
});

class Element extends EventTarget {
  constructor(doc){super();this.ownerDocument=doc;this.children=[];this.attrs={};this.style={};this.classList={add(){}};this.captures=new Set();this.textContent='';}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
}
test('mini is artwork-only and inspection ends on release, source changes and teardown',()=>{
  const doc=new EventTarget();doc.defaultView=new EventTarget();doc.createElement=()=>new Element(doc);
  const calls=[],mini=new TriggerItemMini(new Element(doc),{onHold:item=>calls.push(item?.id??null)});
  const a={id:'a',name:'Wedge',image:'wedge.png'},b={id:'b',name:'No artwork'};
  const down={button:0,pointerId:1,preventDefault(){}};
  mini.update(a);assert.equal(mini.root.children[0].textContent,'USING');assert.equal(mini.button.textContent,'');assert.equal(mini.button.children.length,1);
  mini.button.onpointerdown(down);assert.deepEqual(calls,['a']);
  mini.release({type:'pointerup',pointerId:2});assert.ok(mini.held);
  mini.release({type:'pointerup',pointerId:1});assert.deepEqual(calls,['a',null]);assert.equal(mini.button.captures.size,0);
  const key=key=>({key,preventDefault(){}});
  mini.button.onkeydown(key('Enter'));mini.button.onkeyup(key(' '));assert.ok(mini.held);
  mini.button.onkeyup(key('Enter'));assert.equal(mini.held,null);
  mini.button.onpointerdown(down);mini.update(b);assert.equal(mini.held,null);
  assert.equal(mini.button.textContent,'');assert.equal(mini.button.children.length,0,'no name fallback on minis');
  for(const type of ['resize','blur','visibilitychange','pointercancel','lostpointercapture']){
    mini.button.onpointerdown(down);mini.release({type,pointerId:1});assert.equal(mini.held,null);
  }
  mini.update(b,{busy:true});mini.button.onpointerdown(down);assert.equal(mini.held,null);
  mini.update(a);mini.button.onpointerdown(down);mini.destroy();assert.equal(mini.root.hidden,true);assert.equal(calls.at(-1),null);
});

test('fade-out retains artwork while disabling interaction, and can reverse immediately',()=>{
  const doc=new EventTarget();doc.defaultView=new EventTarget();doc.createElement=()=>new Element(doc);
  const mini=new TriggerItemMini(new Element(doc));
  const item={id:'tool',image:'tool.png'};
  mini.update(item);
  assert.equal(mini.root.hidden,false);
  assert.equal(mini.root.attrs['data-visible'],'true');
  assert.equal(mini.root.attrs['aria-hidden'],'false');
  const children=[...mini.root.children];
  mini.update(null);
  assert.equal(mini.root.hidden,false,'exit stays painted for the CSS fade');
  assert.deepEqual(mini.root.children,children);
  assert.equal(mini.root.attrs['data-visible'],'false');
  assert.equal(mini.root.attrs['aria-hidden'],'true');
  assert.equal(mini.button.disabled,true);
  assert.equal(mini.beginHold({key:'Enter'}),false);
  mini.update(item);
  assert.equal(mini.root.attrs['data-visible'],'true');
  assert.equal(mini.button.disabled,false);
  mini.destroy();
  assert.equal(mini.root.hidden,true);
  assert.equal(mini.root.children.length,0);
});

test('positioning changes only the mini and removes camera displacement, including scaled hosts',()=>{
  const deck={bottom:400,height:300},frame={offsetHeight:800,getBoundingClientRect:()=>({top:0,height:800})};
  let cameraY='0px 0px';
  const preview=Object.assign(Object.create(ProjectPreview.prototype),{
    mount:{offsetHeight:300,style:{},getBoundingClientRect:()=>deck},
    inventorySurface:{frame},footer:{getBoundingClientRect:()=>({top:780})},checkDetails:{hidden:true},
    inventoryCardPreview:{plane:{},view:{getComputedStyle:()=>({translate:cameraY})}},
    triggerItemMini:{item:{id:'wedge'},root:{style:{}}},
  });
  preview.positionTriggerMini();assert.deepEqual(preview.triggerItemMini.root.style,{top:'472px',left:'50%',height:'110px',width:'82.5px'});
  assert.deepEqual(preview.mount.style,{},'never modifies deck sizing or position');
  deck.bottom=-100;cameraY='0px -500px';preview.positionTriggerMini();assert.equal(preview.triggerItemMini.root.style.top,'472px');
  frame.getBoundingClientRect=()=>({top:20,height:400});deck.height=150;deck.bottom=-30;
  preview.positionTriggerMini();assert.equal(preview.triggerItemMini.root.style.top,'472px','camera translation and coordinates use host scale');
  preview.footer.getBoundingClientRect=()=>({top:0,height:0});
  preview.positionTriggerMini();assert.equal(preview.triggerItemMini.root.style.height,'110px','standalone hidden footer does not hide the mini');
});

test('short-frame check information shares a row with the mini without moving the deck',()=>{
 const preview=Object.assign(Object.create(ProjectPreview.prototype),{
   mount:{style:{},offsetHeight:420,getBoundingClientRect:()=>({bottom:546,height:420,width:315,right:345})},
   inventorySurface:{frame:{offsetHeight:667,getBoundingClientRect:()=>({top:0,left:0,height:667})}},
   footer:{getBoundingClientRect:()=>({top:623})},
   checkDetails:{hidden:false,style:{},getBoundingClientRect:()=>({bottom:635})},
   inventoryCardPreview:{plane:{},view:{getComputedStyle:()=>({translate:'none'})}},
   triggerItemMini:{item:{id:'wedge'},root:{style:{}}},
 });
 preview.positionTriggerMini();assert.equal(preview.triggerItemMini.root.style.top,'586px');
 assert.equal(preview.triggerItemMini.root.style.height,'29px');assert.equal(preview.checkDetails.style.width,'277.25px');
 assert.deepEqual(preview.mount.style,{});
 preview.triggerItemMini.item=null;preview.positionTriggerMini();assert.equal(preview.checkDetails.style.width,'');
});
