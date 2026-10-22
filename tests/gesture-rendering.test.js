import test from 'node:test';
import assert from 'node:assert/strict';
import {CardDeck} from '../engine/CardDeck.js';
import {scenePose} from '../engine/renderer.js';

// Count writes as well as render calls, so staging and drawer side effects
// cannot silently move back into high-frequency pointer handlers.
let writes=0,now=1000,serial=0;
const frames=new Map();
class Element extends EventTarget {
  constructor(){
    super();this.attrs=new Map();this.children=[];this.captures=new Set();
    this.style=new Proxy({}, {set(target,key,value){writes++;target[key]=value;return true;}});
    this.classList={add(){writes++;},remove(){writes++;},toggle(){writes++;}};
  }
  set className(value){writes++;this._className=value;}
  get className(){return this._className;}
  set textContent(value){writes++;this._text=value;}
  get textContent(){return this._text;}
  set innerHTML(value){writes++;this._html=value;}
  setAttribute(key,value){writes++;this.attrs.set(key,String(value));}
  getAttribute(key){return this.attrs.get(key)??null;}
  removeAttribute(key){writes++;this.attrs.delete(key);}
  append(...nodes){for(const node of nodes){node.remove();writes++;node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of [...this.children])node.remove();this.append(...nodes);}
  remove(){if(this.parentNode){writes++;this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  focus(){}
  getBoundingClientRect(){return {left:0,top:0,width:340,height:453};}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
}
Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.document=new Element();document.createElement=()=>new Element();document.body=new Element();document.hidden=false;
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});
globalThis.ResizeObserver=class {observe(){}disconnect(){}};
function step(){now+=16;const work=[...frames.values()];frames.clear();for(const fn of work)fn(now);}
function settle(){for(let i=0;frames.size&&i<2000;i++)step();assert.equal(frames.size,0);}
const gesture=(y,extra={})=>({axis:'y',x:0,y,vx:0,vy:0,clientX:120,clientY:600,...extra});
function make({open=false,interaction='choice',inventoryDrawer=null,...content}={}){
  const deck=new CardDeck(new Element(),{inventoryDrawer,content:{id:'source',interaction,
    actions:[{id:'one',label:'One'},{id:'two',label:'Two'}],...content}});
  if(open){deck.setOpen(true);deck.schedule();settle();}
  const render=deck.render.bind(deck);deck.paintCount=0;
  deck.render=(...args)=>{deck.paintCount++;return render(...args);};
  return deck;
}
function adapter(){
  const previews=[],hits=[];
  const drawer={previews,hits,preview(target){writes++;previews.push(target);},setContext(){writes++;},
    cancelPending(){},clearDeposit(){},slotTarget:()=>({slot:0,rect:{left:80,top:550,width:75,height:100},snapped:true}),
    getTarget(options){hits.push(options);return options.clientY>500?{...drawer.slotTarget(),clientX:options.clientX,clientY:options.clientY}:null;},
    authorize:async()=>false};
  return drawer;
}

for(const open of [false,true])test(`gesture burst paints once with latest synchronous state, open=${open}`,()=>{
  const deck=make({open});assert.equal(deck.start(),true);writes=0;
  for(const y of [-40,-65,-90])deck.move(gesture(y));
  assert.equal(writes,0);assert.equal(deck.paintCount,0);assert.equal(frames.size,1);
  assert.ok(open?deck.l.x>0:deck.p.x>0);
  step();assert.equal(deck.paintCount,1);assert.ok(writes>0);
  if(!open)assert.ok(deck.scene.style.transform.includes(`,${scenePose(deck,now).y}px,`));
  else assert.ok(deck.underlayBack,'reverse is prepared in the paint');
  deck.cancel();settle();deck.destroy();
});

for(const open of [false,true])test(`blocked downward movement uses the same frame scheduler, open=${open}`,()=>{
  const deck=make({open,allowClose:false});deck.start();writes=0;
  for(const y of [40,60,90])deck.move(gesture(y));
  assert.equal(writes,0);assert.equal(deck.paintCount,0);assert.equal(frames.size,1);
  step();assert.equal(deck.paintCount,1);deck.cancel();settle();deck.destroy();
});

test('drawer samples update target and hysteresis immediately but paint only the latest reversal',()=>{
  const drawer=adapter(),deck=make({open:true,interaction:'container',inventoryDrawer:drawer});
  deck.start();writes=0;drawer.previews.length=0;
  deck.move(gesture(180));deck.move(gesture(120));
  assert.ok(deck.pickup.target);assert.equal(deck.pickup.mix.x,1);
  assert.equal(drawer.hits.at(-1).active,true);assert.equal(drawer.hits.at(-1).snapped,true);
  deck.move(gesture(-70,{clientY:400}));
  assert.equal(deck.pickup.target,null);assert.equal(deck.pickup.mix.x,0);
  assert.equal(writes,0);assert.equal(drawer.previews.length,0);
  step();assert.deepEqual(drawer.previews,[null]);assert.equal(deck.pickup.layer,null);
  deck.move(gesture(180));step();assert.ok(deck.pickup.layer);
  const layer=deck.pickup.layer;
  writes=0;deck.move(gesture(70,{clientY:420}));deck.move(gesture(190));
  assert.equal(writes,0);assert.equal(deck.pickup.layer,layer);
  step();assert.equal(deck.pickup.layer,layer);assert.ok(layer.parentNode);
  deck.cancel();settle();assert.equal(deck.pickup.layer,null);deck.destroy();
});

test('release before the first frame prepares the preview and accepts exactly once',()=>{
  const deck=make({open:true});let commits=0;
  deck.addEventListener('commit',()=>{commits++;deck.replaceContent({id:'next',actions:[{id:'next',label:'Next'}]});});
  deck.start();deck.move(gesture(-190));assert.equal(deck.underlay,null);
  deck.end(gesture(-190));assert.equal(commits,1);assert.ok(deck.underlayBack);
  settle();assert.equal(commits,1);assert.equal(deck.content.id,'next');deck.destroy();
});

for(const paintFirst of [false,true])test(`switching a real staged action preview waits for paint or release, paintFirst=${paintFirst}`,()=>{
  const deck=make({open:true});
  for(const id of ['one','two'])deck.setActionPreview(id,{id:`preview-${id}`,actions:[{id:`child-${id}`,label:id}]});
  assert.equal(deck.forwardOwner,'one');
  deck.index=1;deck.b.x=deck.b.target=1;deck.render();deck.paintCount=0;
  deck.start();writes=0;deck.move(gesture(-190));deck.move(gesture(-200));
  assert.equal(writes,0);assert.equal(deck.forwardOwner,'one');
  if(paintFirst){step();assert.equal(deck.paintCount,1);assert.equal(deck.forwardOwner,'two');}
  deck.end(gesture(-200));
  assert.equal(deck.forwardOwner,'two');assert.equal(deck.forwardDeck.content.id,'preview-two');
  deck.reset();settle();deck.destroy();
});

test('snapped spring origins depend on logical entry rather than deferred mini creation',()=>{
  const drawer=adapter();
  drawer.getTarget=({clientX,clientY})=>clientY>500
    ? {slot:clientX>200?1:0,snapped:true,rect:{left:clientX>200?220:80,top:550,width:75,height:100}}:null;
  const deck=make({open:true,interaction:'container',inventoryDrawer:drawer});deck.start();
  deck.move(gesture(180));deck.move(gesture(180,{clientX:250}));
  assert.equal(deck.pickup.x.x,80);assert.equal(deck.pickup.x.target,220);
  step();const layer=deck.pickup.layer;
  deck.move(gesture(70,{clientY:420}));deck.move(gesture(180,{clientX:250}));
  assert.equal(deck.pickup.layer,layer);assert.equal(deck.pickup.x.x,220,'fresh logical entry resets the spring even if the old layer is retained');
  deck.cancel();settle();deck.destroy();
});

for(const action of ['cancel','reset','destroy'])test(`${action} before a queued paint cannot revive a pickup`,()=>{
  const drawer=adapter(),deck=make({open:true,interaction:'container',inventoryDrawer:drawer});
  deck.start();deck.move(gesture(190));assert.ok(deck.pickup.target);
  deck[action]();settle();assert.equal(deck.pickup.target,null);assert.equal(deck.pickup.layer,null);
  if(action==='destroy')assert.equal(deck.mount.children.length,0);else deck.destroy();
});

for(const mode of ['reduced','hidden'])test(`${mode} mode paints synchronously without scheduling a gesture frame`,()=>{
  const drawer=adapter(),deck=make({open:true,interaction:'container',inventoryDrawer:drawer});
  deck.reduced=mode==='reduced';document.hidden=mode==='hidden';
  deck.start();deck.move(gesture(190));
  assert.ok(deck.paintCount>0);assert.ok(deck.pickup.layer);assert.equal(frames.size,0);
  deck.cancel();deck.destroy();document.hidden=false;
});
