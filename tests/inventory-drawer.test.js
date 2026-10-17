import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryView } from '../studio/InventoryView.js';
class Element {
 constructor(){this.nodes={};this.children=[];this.style={};const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,v)=>v?classes.add(c):classes.delete(c),contains:c=>classes.has(c)};this.rect={left:0,top:500,width:340,height:100};}
 querySelector(s){return this.nodes[s]??=new Element();}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(){}
 getBoundingClientRect(){return this.rect;}
 showModal(){this.open=true;}
 close(){this.open=false;this.onclose?.();}
}
test('inventory drawer keeps slots stable and authorizes exact destinations without dropping overflow',async()=>{
const previousDocument=globalThis.document;
try {
globalThis.document={createElement:()=>new Element(),body:new Element()};
const root=new Element(), view=new InventoryView(root);
assert.equal(root.hidden,true); view.setContext(true);
const items=['a','b','c','d'].map(id=>({id,definitionId:id,name:id}));
const elements=[...view.slotElements];
view.update(items.slice(0,2));
view.stageDeposit({id:'c',name:'c'},{slot:3});
assert.equal(root.querySelector('[data-count]').textContent,'3');
assert.equal(view.slotElements[3].children[0].disabled,true);
assert.doesNotMatch(view.slotElements[3].className,/is-empty/);
assert.equal(view.items.length,2,'visual acceptance does not prematurely commit ownership');
view.clearDeposit();
assert.equal(root.querySelector('[data-count]').textContent,'2');
assert.match(view.slotElements[3].className,/is-empty/);
assert.deepEqual(view.slotElements,elements);
view.slotElements.forEach((element,i)=>element.rect={left:i*85,top:500,width:75,height:100});
assert.equal(view.getTarget({clientX:310,clientY:550}).slot,3);
assert.equal(view.getTarget({clientX:310,clientY:410}),null);
assert.equal(view.getTarget({clientX:310,clientY:460}),null,'large card stays until close to the mini row');
assert.equal(view.getTarget({clientX:310,clientY:480}).snapped,false);
assert.equal(view.getTarget({clientX:310,clientY:535}).snapped,true);
assert.equal(view.getTarget({clientX:310,clientY:525,snapped:true}).snapped,true);
assert.equal(view.getTarget({clientX:310,clientY:510,snapped:true}).snapped,false);
assert.equal(view.getTarget({clientX:310,clientY:465,active:true}).slot,3);
assert.deepEqual(await view.authorize({id:'c'},view.slotTarget(3)),{slot:3});
view.update(items.slice(0,3)); assert.equal(view.slots[3].id,'c'); assert.equal(view.slots[2],null);
view.update(items); assert.equal(view.slots[2].id,'d');
view.preview(view.slotTarget(1));assert.equal(root.classList.contains('is-full-drag'),true);
assert.match(view.slotElements[1].children[0].style.transform,/translateY\(-28px\)/);
assert.equal(view.slotElements[0].children[0].style.transform,'');
view.preview(null);assert.equal(root.classList.contains('is-full-drag'),false);
assert.equal(view.slotElements[1].children[0].style.transform,'');
assert.deepEqual(await view.authorize(items[0]),{slot:0},'duplicate ownership must not replace another item');
assert.equal(view.getTarget({keyboard:true,action:items[0]}).duplicate,true);
let decision=view.authorize({id:'e',name:'e'},view.slotTarget(1));
assert.deepEqual(await decision,{slot:1,replacementId:'b',returnToStack:true});
assert.equal(view.collectDialog.open,undefined,'targeted drop bypasses confirmation');
view.update([items[0],items[2],items[3],{id:'e',name:'e'}]); assert.equal(view.slots[1].id,'e');
decision=view.authorize({id:'f',name:'f'});
assert.equal(root.querySelector('[data-slot-picker]').children.length,4);
view.cancelPending();assert.equal(await decision,false);
view.update([...items,{id:'e',name:'e'}]);assert.equal(view.overflow.length,1);
assert.equal(view.getTarget({clientX:310,clientY:550}).slot,3,'overflow does not disable mini drag targets');
decision=view.authorize({id:'f',name:'f'},{slot:1});
assert.match(root.querySelector('[data-collect-message]').textContent,/Replace/);
root.querySelector('[data-confirm]').onclick();
assert.deepEqual(await decision,{slot:1,replacementId:view.slots[1].id});
assert.equal(view.items.length,5,'authorization preserves all ownership until commit');
view.selected=view.overflow[0].id;view.showDetails();assert.equal(root.querySelector('.nest-inventory-overflow').children.length,1);
view.destroy();assert.equal(root.children.length,0);
} finally { globalThis.document=previousDocument; }
});


test('occupied-slot hover shifts only the queue toward the nearest gap and commits its layout',async()=>{
  const previousDocument=globalThis.document;
  try {
    globalThis.document={createElement:()=>new Element(),body:new Element()};
    const view=new InventoryView(new Element()); view.setContext(true);
    const [a,b,c,d]=['a','b','c','d'].map(id=>({id,definitionId:id,name:id}));
    const set=(slots)=>{view.items=slots.filter(Boolean);view.slots=slots;view.renderSlots();view.slotElements.forEach((el,i)=>el.rect={left:i*85,top:500,width:75,height:100});};
    const transforms=()=>view.slotElements.map(el=>el.children[0]?.style.transform||'');
    set([a,b,null,null]);
    view.preview(view.slotTarget(2)); assert.deepEqual(transforms(),['','','',''],'empty target leaves stored cards still');
    view.preview({...view.slotTarget(0),snapped:false}); assert.deepEqual(transforms(),['','','',''],'floating above row does not push');
    assert.equal(view.getTarget({clientX:35,clientY:550}).slot,0,'target follows x even when occupied');
    assert.equal(view.getTarget({clientX:80,clientY:550}).snapped,false,'gap between cards is not an occupied-card hover');
    view.preview(view.slotTarget(0)); assert.deepEqual(transforms(),['translateX(85px)','translateX(85px)','','']);
    assert.match(view.slotElements[2].className,/is-queue-destination/,'hide empty-slot plus under the shifted card');
    assert.deepEqual(view.slots,[a,b,null,null],'hover never commits queue order');
    view.preview(null); assert.deepEqual(transforms(),['','','','']);
    view.slotElements.forEach((el,i)=>{el.offsetWidth=75;el.rect={left:i*42.5,top:500,width:37.5,height:50};});
    view.preview(view.slotTarget(0));assert.deepEqual(transforms(),['translateX(85px)','translateX(85px)','',''],'scaled host uses local CSS displacement');
    view.slotElements.forEach((el,i)=>{delete el.offsetWidth;el.rect={left:i*85,top:500,width:75,height:100};});
    set([null,a,b,c]); view.preview(view.slotTarget(2));
    assert.deepEqual(transforms(),['','translateX(-85px)','translateX(-85px)','']);
    set([null,a,null,c]); view.preview(view.slotTarget(1));
    assert.deepEqual(transforms(),['','translateX(85px)','',''],'tie chooses right gap and leaves unrelated cards still');
    set([a,b,c,d]); view.preview(view.slotTarget(1));
    assert.deepEqual(transforms(),['','translateY(-28px)','',''],'full row lifts only the hovered card toward the stack');
    set([a,b,null,null]);
    const decision=await view.authorize(c,view.slotTarget(0));
    assert.deepEqual(decision,{slot:0,layout:['c','a','b',null]});
    assert.equal(view.pending,undefined,'available gap does not ask for replacement');
    view.stageDeposit(c,decision);
    assert.equal(view.root.querySelector('[data-count]').textContent,'3');
    assert.deepEqual(view.displaySlots(),[c,a,b,null]);
    view.update([a,b,c]); assert.deepEqual(view.slots,[c,a,b,null]);
    view.update([a,b,c]); assert.deepEqual(view.slots,[c,a,b,null],'later updates preserve inserted order');
    set([a,b,null,null]);
    const cancelled=await view.authorize(c,view.slotTarget(0)); view.stageDeposit(c,cancelled); view.clearDeposit();
    view.update([a,b]); assert.deepEqual(view.slots,[a,b,null,null],'rollback restores previous layout');
    view.destroy();
  } finally {globalThis.document=previousDocument;}
});


test('embedded drawer rejects drops outside its own surface and respects inert hosts',()=>{
  const previousDocument=globalThis.document;
  try {
    globalThis.document={createElement:()=>new Element(),body:new Element()};
    let bounds={left:100,top:100,width:340,height:520};
    const root=new Element(),view=new InventoryView(root,{getBounds:()=>bounds});
    view.setContext(true); view.update([]);
    view.list.rect={left:100,top:500,width:340,height:100};
    view.slotElements.forEach((el,i)=>el.rect={left:100+i*85,top:500,width:75,height:100});
    assert.equal(view.getTarget({clientX:140,clientY:550}).slot,0);
    assert.equal(view.getTarget({clientX:140,clientY:650}),null,'browser space below host is not a drop zone');
    assert.equal(view.getTarget({clientX:90,clientY:550,active:true}),null,'hysteresis cannot escape the host');
    bounds={...bounds,top:200,height:0};assert.equal(view.getTarget({keyboard:true}),null);
    bounds={left:100,top:100,width:340,height:520};root.closest=()=>({inert:true});
    assert.equal(view.getTarget({keyboard:true}),null);
    view.destroy();
  } finally {globalThis.document=previousDocument;}
});


test('view does not restart entrances and preserves the outgoing painted cards during exit',async()=>{
 const previousDocument=globalThis.document;
 try {
  globalThis.document={createElement:()=>new Element(),body:new Element()};
  const root=new Element(),view=new InventoryView(root),animations=[];
  root.ownerDocument={defaultView:{getComputedStyle:()=>({opacity:'1',transform:'none'}),matchMedia:()=>({matches:false})}};
  root.animate=(frames,options)=>{
   let finish,reject;const finished=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
   const animation={frames,options,finished,finish,cancel(){reject(new Error('cancelled'));}};animations.push(animation);return animation;
  };
  view.setContext(true);view.update([{id:'a',name:'A'}]);view.setContext(true);
  assert.equal(animations.length,1);assert.equal(root.hidden,false);
  animations[0].finish();await Promise.resolve();
  const button=view.slotElements[0].children[0];
  view.setContext(false);assert.equal(view.visible,false);assert.equal(root.hidden,false,'paint remains for asynchronous exit');
  assert.equal(root.inert,true,'outgoing inventory cannot be used');
  view.update([{id:'b',name:'B'}]);
  assert.equal(view.items[0].id,'b','ownership model remains current');
  assert.equal(view.slotElements[0].children[0],button,'outgoing painted contents remain stable');
  animations[1].finish();await Promise.resolve();
  assert.equal(root.hidden,true);assert.notEqual(view.slotElements[0].children[0],button);
  view.setContext(true);assert.equal(animations.length,3);assert.equal(root.hidden,false);
  view.setContext(false,{immediate:true});assert.equal(root.hidden,true);
  view.destroy();
 } finally {globalThis.document=previousDocument;}
});
