import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerUI } from '../studio/PlayerUI.js';

// Exercises real child components and ownership. This is not browser layout QA.
class Element extends EventTarget {
  constructor(doc) {
    super();this.ownerDocument=doc;this.elements=new Map();this.children=[];this.attrs=new Map();this.style={};
    const classes=new Set();this.classList={add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value)};
  }
  querySelector(selector){if(!this.elements.has(selector))this.elements.set(selector,new Element(this.ownerDocument));return this.elements.get(selector);}
  setAttribute(key,value){this.attrs.set(key,String(value));}
  getAttribute(key){return this.attrs.get(key)??null;}
  removeAttribute(key){this.attrs.delete(key);}
  getBoundingClientRect(){return {left:0,top:0,width:276,height:368};}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
  appendChild(child){child.remove();child.parentNode=this;this.children.push(child);return child;}
  append(...children){for(const child of children)this.appendChild(child);}
  replaceChildren(...children){for(const child of [...this.children])child.remove();this.append(...children);}
  insertBefore(child,next){child.remove();child.parentNode=this;const index=next?this.children.indexOf(next):this.children.length;this.children.splice(index,0,child);}
}
function fixture() {
  const doc=Object.assign(new EventTarget(),{defaultView:Object.assign(new EventTarget(),{innerWidth:800,innerHeight:1000}),createElement:()=>new Element(doc)});
  doc.body=new Element(doc);globalThis.document=doc;
  globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;}observe(target){this.target=target;}disconnect(){this.disconnected=true;}};
  const root=new Element(doc),mount=new Element(doc),footer=new Element(doc),host=new Element(doc);
  const input={revision:1,run:{idle:true,variables:{health:6},collectedItems:[]},
    card:{phase:'choices',action:{id:'choice',checkInfo:{stat:'Agility: 3',chance:'50%',label:'Medium'}}},interaction:{},feedback:{},definitions:{variables:[{id:'health',type:'number',max:10}]}};
  const ui=new PlayerUI(root,{mount,footer,inventoryHost:host,getInput:()=>input});
  return {ui,input,root,host,footer,doc,mount};
}

test('one owner hosts the drawer, context, HUD and backdrop without owning the host tools',()=>{
  const {ui,input,root,host,footer}=fixture();
  ui.update(input);
  assert.equal(ui.surface.container,host);assert.equal(footer.parentNode,ui.surface.frame);
  assert.equal(ui.healthValue.textContent,6);
  assert.equal(root.querySelector('[data-health]').getAttribute('aria-label'),'Health 6 out of 10');
  assert.equal(ui.actionContext.checkChance.textContent,'50%');
  assert.equal(ui.backdrop.root.getAttribute('data-visible'),'true');
  assert.equal(ui.stateReadout,undefined);assert.equal(ui.goToCardButton,undefined);
  ui.destroy();ui.destroy();assert.equal(ui.footerResize.disconnected,true);
  assert.equal(ui.input,null);assert.equal(ui.getInput,null);
});

test('context-only updates preserve pending dialogs, deposits and inventory DOM until a new run revision',()=>{
  const {ui,input}=fixture();ui.update(input);
  let cancellations=0,refreshes=0;
  ui.inventory.pending=()=>{cancellations++;ui.inventory.pending=null;};
  ui.inventory.deposited={id:'pending-deposit'};
  const update=ui.inventory.update.bind(ui.inventory);
  ui.inventory.update=(...args)=>{refreshes++;return update(...args);};
  input.card.action={id:'other',disabled:true,disabledReason:'Requires: tool'};
  ui.update(input);
  input.interaction.busy=true;ui.update(input);
  input.feedback.result={target:10,total:12,success:true};ui.update(input);
  assert.equal(cancellations,0);assert.equal(refreshes,0);
  assert.equal(ui.inventory.deposited.id,'pending-deposit');
  assert.equal(ui.actionContext.checkChance.textContent,'SUCCESS');
  input.revision++;ui.update(input);
  assert.equal(cancellations,1);assert.equal(refreshes,1);assert.equal(ui.inventory.deposited,null);
  ui.destroy();
});

test('authorization that synchronously replaces playback cannot return an accepted old decision',async()=>{
  const {ui}=fixture();let active=true;
  ui.inventory.authorize=async()=>({slot:0});
  const adapter=ui.inventoryAdapter({active:()=>active,authorize:()=>{active=false;return true;},exchange:()=>true});
  assert.equal(await adapter.authorize({},{}),false);
  ui.destroy();
});

test('trigger hold rechecks live interaction input between selection notifications',()=>{
  const {ui,input}=fixture();
  input.run.collectedItems=[{id:'tool',definitionId:'tool',kind:'item',name:'Tool'}];
  input.card.action.contextItemId='tool';ui.update(input);
  const mini=ui.actionContext.mini;
  input.interaction.dragging=true;assert.equal(mini.beginHold({key:'Enter'}),false);
  input.interaction.dragging=false;input.interaction.busy=true;assert.equal(mini.beginHold({key:'Enter'}),false);
  input.interaction.busy=false;assert.equal(mini.beginHold({key:'Enter'}),true);
  ui.endInteractions();assert.equal(mini.held,null);
  assert.equal(mini.beginHold({key:'Enter'}),false);
  ui.destroy();
});

test('old-run adapter callbacks cannot mutate replacement UI or authorize a late answer',async()=>{
  const {ui}=fixture();let active=true,answer;
  let authorizations=0,exchanges=0,previews=0;
  ui.inventory.authorize=()=>new Promise(resolve=>answer=resolve);
  ui.inventory.preview=()=>{previews++;};
  const adapter=ui.inventoryAdapter({active:()=>active,authorize:()=>{authorizations++;return true;},exchange:()=>{exchanges++;return true;}});
  const pending=adapter.authorize({id:'item'},{});
  active=false;answer({slot:1});
  assert.equal(await pending,false);assert.equal(authorizations,0);
  adapter.preview({});adapter.stageDeposit({},{});adapter.clearDeposit();adapter.setContext(true);adapter.cancelPending();
  assert.equal(previews,0);assert.equal(exchanges,0);assert.equal(adapter.exchange({},{}),false);
  assert.equal(adapter.getTarget({}),null);assert.equal(adapter.slotTarget(0),null);
  assert.equal(await adapter.authorize({},{}),false);
  ui.destroy();
});

test('reset settles visibility, cancels holds/dialogs and permits restart; destroy is terminal',()=>{
  const {ui,input}=fixture();ui.update(input);ui.setInventoryContext(true);
  let cancellations=0;ui.inventory.pending=()=>{cancellations++;ui.inventory.pending=null;};
  ui.reset();
  assert.equal(cancellations,1);assert.equal(ui.inventory.visible,false);
  assert.equal(ui.actionContext.root.hidden,true);assert.equal(ui.resources.hidden,true);
  assert.equal(ui.backdrop.root.getAttribute('data-visible'),'false');assert.equal(ui.status.hidden,true);
  input.revision++;ui.update(input);assert.equal(ui.actionContext.visible,true);
  ui.destroy();ui.update(input);ui.setInventoryContext(true);ui.reset();
  assert.equal(ui.actionContext.root.hidden,true);
});

test('action information column follows the real card width through resize and editor zoom',()=>{
 const {ui,mount,doc}=fixture();assert.equal(ui.actionContext.root.style.width,'276px');assert.equal(ui.contextResize.target,mount);
 doc.documentElement={};doc.defaultView.getComputedStyle=()=>({zoom:'.8'});
 mount.getBoundingClientRect=()=>({width:192,height:256});ui.contextResize.callback();
 assert.equal(ui.actionContext.root.style.width,'240px');
 mount.getBoundingClientRect=()=>({width:252,height:336});ui.contextResize.callback();assert.equal(ui.actionContext.root.style.width,'315px');
 ui.destroy();assert.equal(ui.contextResize.disconnected,true);
 mount.getBoundingClientRect=()=>({width:100,height:133});ui.contextResize.callback();assert.equal(ui.actionContext.root.style.width,'315px');
});
