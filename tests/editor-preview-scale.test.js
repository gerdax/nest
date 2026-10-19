import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck } from '../engine/CardDeck.js';
import { cardPose, scenePose } from '../engine/renderer.js';
import { cssScale, layoutBounds } from '../engine/cssScale.js';

// Exercise the real deck/renderer with deterministic DOM measurements. This is
// coordinate and physics verification, not a substitute for browser CSS layout.
class Element extends EventTarget {
 constructor(scale=1) {
  super();this.scale=scale;this.attrs=new Map();this.style={};this.children=[];this.classList={add(){},remove(){}};
  this.ownerDocument={documentElement:{},defaultView:{getComputedStyle:()=>({zoom:String(scale)})}};
 }
 setAttribute(key,value){this.attrs.set(key,String(value));}
 getAttribute(key){return this.attrs.get(key)??null;}
 removeAttribute(key){this.attrs.delete(key);}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 remove(){if(this.parentNode){const nodes=this.parentNode.children;nodes.splice(nodes.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of [...this.children])node.remove();this.append(...nodes);}
 focus(){}
 getBoundingClientRect(){const s=this.scale;return {left:100*s,top:150*s,width:340*s,height:450*s,right:440*s,bottom:600*s};}
}
let frame=0;
globalThis.requestAnimationFrame=()=>++frame;
globalThis.cancelAnimationFrame=()=>{};
globalThis.document=new Element();document.hidden=false;document.createElement=()=>new Element();
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
function make(scale, count=1) {
 const deck=new CardDeck(new Element(scale),{content:{id:'preview',interaction:'container',title:'Chest',actions:Array.from({length:count},(_,i)=>({id:`item-${i}`,label:`Item ${i}`}))}});
 deck.open=true;deck.phase='choices';deck.skipCover=true;deck.p.x=deck.p.target=1;deck.fan.x=deck.fan.target=1;deck.entrances.clear();
 return deck;
}
const gesture=(x,y,vx=0,vy=0)=>({axis:Math.abs(x)>Math.abs(y)?'x':'y',x,y,vx,vy,clientX:200,clientY:300});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('engine CSS scale defaults to 1 and returns unzoomed deck geometry',()=>{
 assert.equal(cssScale({}),1);assert.equal(cssScale(new Element(.8)),.8);
 assert.deepEqual(layoutBounds(new Element(.8)),{left:100,top:150,width:340,height:450,right:440,bottom:600});
});

test('resting carousel and cover geometry are unchanged in layout pixels at .8 zoom',()=>{
 const full=make(1,3),small=make(.8,3);
 full.b.x=small.b.x=.25;
 for(let i=0;i<3;i++)assert.deepEqual(cardPose(small,i,1000),cardPose(full,i,1000));
 full.p.x=small.p.x=.35;
 assert.deepEqual(scenePose(small,1000),scenePose(full,1000));
 assert.equal(small.departureTravel(),full.departureTravel());
 full.destroy();small.destroy();
});

for(const scale of [1,.8])test(`item card follows physical pointer travel at root zoom ${scale}`,()=>{
 const deck=make(scale),before=cardPose(deck,0,1000);
 deck.start();deck.move(gesture(0,100));
 const after=cardPose(deck,0,1000);
 close((after.y-before.y)*scale,100);
 close(deck.l.x,-100/(450*scale));
 assert.match(deck.cards[0].style.transform,new RegExp(`translate3d\\(0px,${after.y}px,`));
 deck.destroy();
});

test('closed cover follows pointer travel before reveal at .8 editor zoom',()=>{
 const deck=make(.8);deck.open=false;deck.phase='closed';deck.p.x=deck.p.target=0;deck.fan.x=deck.fan.target=0;
 const before=scenePose(deck,1000);deck.start();deck.move(gesture(0,-60));
 close((scenePose(deck,1000).y-before.y)*.8,-60);
 deck.destroy();
});

test('proportional browse gestures and tilt have identical layout poses across scales',()=>{
 const full=make(1,3),small=make(.8,3);
 full.start({clientX:270,clientY:375});small.start({clientX:216,clientY:300});
 full.move(gesture(100,0));small.move(gesture(80,0));
 close(full.b.x,small.b.x);close(full.rotationY.target,small.rotationY.target);
 for(let i=0;i<3;i++)assert.deepEqual(cardPose(small,i,1000),cardPose(full,i,1000));
 full.destroy();small.destroy();
});

test('release thresholds stay in screen space and departure velocity converts to layout units',()=>{
 for(const scale of [1,.8]){
  const deck=make(scale),velocities=[];deck.collect=velocity=>velocities.push(velocity);
  deck.start();deck.end(gesture(0,450*scale*.6,0,800));
  assert.deepEqual(velocities,[800/scale]);deck.destroy();
 }
 const full=make(1,3),small=make(.8,3);
 full.start();small.start();full.end(gesture(0,-200));small.end(gesture(0,-160));
 assert.equal(full.commitMotion,null);assert.equal(small.commitMotion,null);
 full.destroy();small.destroy();
});

test('inventory adapter retains screen pointer coordinates during normalized deck movement',()=>{
 const deck=make(.8),seen=[];deck.pickup={mix:{x:0},move:value=>seen.push(value),pose:value=>value,render(){},reset(){},adapter:{setContext(){}}};
 const input=gesture(0,100);deck.start();deck.move(input);
 assert.equal(seen[0],input);assert.equal(seen[0].y,100);assert.equal(seen[0].clientY,300);
 deck.destroy();
});
