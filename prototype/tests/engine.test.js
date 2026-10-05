import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,classifyAxis,qualifies,resistance,spring,springStep,settingsWith} from '../engine/motion.js';
import {CardDeck} from '../engine/CardDeck.js';
import * as renderer from '../engine/renderer.js';
class Element extends EventTarget{
 constructor(){super();this.attrs=new Map();this.style={};this.children=[];this.classList={add(){},remove(){}};this.captures=new Set();}
 setAttribute(k,v){this.attrs.set(k,v)} getAttribute(k){return this.attrs.get(k)??null} removeAttribute(k){this.attrs.delete(k)}
 append(...els){this.children.push(...els)} replaceChildren(...els){this.children=els} focus(){} getBoundingClientRect(){return {left:0,top:0,width:340,height:453}}
 setPointerCapture(id){this.captures.add(id)} hasPointerCapture(id){return this.captures.has(id)} releasePointerCapture(id){this.captures.delete(id)}
}
let frames=new Map(),serial=0;
globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial};globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.document=new Element();document.createElement=()=>new Element();document.hidden=false;
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.ResizeObserver=class{constructor(callback){this.callback=callback}observe(){}disconnect(){}};
const fixture=n=>({id:`fixture${n}`,title:'Situation',text:'Placeholder',actions:Array.from({length:n},(_,i)=>({id:`a${i}`,label:`Action ${i}`}))});
function deck(n=3){return new CardDeck(new Element(),{content:fixture(n)})}
function settle(d){for(let i=0;i<300;i++){cancelAnimationFrame(d.frame);d.tick(performance.now()+i*16)}cancelAnimationFrame(d.frame);d.frame=0;}
function gesture(d,g){d.start();d.move(g);d.end(g);settle(d)}
test('axis waits for threshold and locks to dominant direction',()=>{assert.equal(classifyAxis(4,4),null);assert.equal(classifyAxis(30,12),'x');assert.equal(classifyAxis(12,-30),'y')});
test('distance and directional flick acceptance',()=>{assert.equal(qualifies(84,0,340),false);assert.equal(qualifies(85,0,340),true);assert.equal(qualifies(-25,-800,453),true);assert.equal(qualifies(-25,800,453),false);assert.equal(qualifies(23,900,453),false)});
test('resistance and settings validation',()=>{assert.equal(resistance(-1,0,2),-.22);assert.equal(resistance(3,0,2),2.22);assert.equal(settingsWith({mass:-1,stiffness:NaN}).stiffness,280);assert.ok(settingsWith({mass:0}).mass>0)});
test('spring converges and long pauses stay finite',()=>{const s=spring(1);s.target=0;springStep(s,50,DEFAULT_SETTINGS);assert.ok(Number.isFinite(s.x));for(let i=0;i<300;i++)springStep(s,1/60,DEFAULT_SETTINGS);assert.equal(s.x,0);assert.equal(s.v,0)});
test('partial reveal returns closed; full reveal emits once',()=>{const d=deck();let reveals=0;d.addEventListener('reveal',()=>reveals++);gesture(d,{axis:'y',x:0,y:-60,vx:0,vy:0});assert.equal(d.open,false);assert.equal(d.p.x,0);gesture(d,{axis:'y',x:0,y:-130,vx:0,vy:0});assert.equal(d.open,true);assert.equal(d.p.x,1);assert.equal(reveals,1);d.destroy()});
function key(d,name){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:name});d.mount.dispatchEvent(event);settle(d)}
const modulo=(value,n)=>((value%n)+n)%n;
for(const count of [2,3,4]){
 test(`${count} actions browse indefinitely by mouse and keyboard in both directions`,()=>{
  for(const input of ['mouse','keyboard']){
   const d=deck(count);d.setOpen(true);settle(d);let cursor=0;
   for(const direction of [1,-1,-1,1])for(let i=0;i<count*4+1;i++){
    if(input==='mouse')gesture(d,{axis:'x',x:-direction*100,y:0,vx:0,vy:0});else key(d,direction>0?'ArrowRight':'ArrowLeft');
    cursor+=direction;assert.equal(d.b.target,cursor);assert.equal(d.b.x,cursor);assert.equal(d.index,modulo(cursor,count));
   }
   d.destroy();
  }
 });
 test(`${count} action carousel poses remain continuous through wraps`,()=>{
  const d=deck(count);d.setOpen(true);settle(d);
  for(const boundary of [-count,-1,0,count-1,count,count*3])for(let i=0;i<count;i++){
   d.b.x=boundary-.0001;const before=renderer.cardPose(d,i);
   d.b.x=boundary+.0001;const after=renderer.cardPose(d,i);
   for(const field of ['x','y','z','rx','ry','rz'])assert.ok(Math.abs(after[field]-before[field])<1,`${field} jumps at ${boundary}`);
   d.b.x=boundary;const current=renderer.cardPose(d,i);
   d.b.x=boundary+count;const repeated=renderer.cardPose(d,i);
   for(const field of ['x','y','z','rx','ry','rz'])assert.ok(Math.abs(repeated[field]-current[field])<1e-7,`${field} fails to repeat after a full cycle`);
  }
  d.destroy();
 });
}
test('close and reopen preserve the unbounded carousel cursor',()=>{
 const d=deck();d.setOpen(true);settle(d);for(let i=0;i<8;i++)key(d,'ArrowLeft');
 const cursor=d.b.target,selected=d.index;assert.equal(cursor,-8);gesture(d,{axis:'y',x:0,y:130,vx:0,vy:0});assert.equal(d.open,false);
 assert.equal(d.b.target,cursor);gesture(d,{axis:'y',x:0,y:-130,vx:0,vy:0});assert.equal(d.index,selected);assert.equal(d.b.x,cursor);assert.equal(d.b.target,cursor);d.destroy();
});
test('grabbing settling motion keeps current position and cancellation restores target',()=>{const d=deck();d.setOpen(true);d.p.x=.45;d.start();assert.equal(d.drag.p,.45);d.move({axis:'y',x:0,y:10,vx:0,vy:0});assert.ok(Math.abs(d.p.x-.45)<.05);d.cancel();settle(d);assert.equal(d.p.x,1);d.destroy()});
test('commit emits once, queues host content, then reveals next deck',()=>{for(let index=0;index<4;index++){const d=deck(4);d.setOpen(true);d.index=index;d.b.x=index;d.b.target=index;let commits=0;d.addEventListener('commit',e=>{commits++;assert.equal(e.detail.index,index);d.replaceContent(fixture(2))});d.commit();d.commit();assert.equal(d.busy,true);d.tick(d.commitMotion.start+1000);settle(d);assert.equal(commits,1);assert.equal(d.content.id,'fixture2');assert.equal(d.open,false);assert.equal(d.busy,false);assert.equal(d.cards.length,2);d.destroy()}});
test('async host content keeps input blocked; reset cancels work',()=>{const d=deck();d.setOpen(true);d.commit();d.tick(d.commitMotion.start+1000);assert.equal(d.busy,true);assert.equal(d.start(),false);d.replaceContent(fixture(4));settle(d);assert.equal(d.busy,false);d.setOpen(true);d.commit();d.reset();assert.equal(d.busy,false);assert.equal(d.commitMotion,null);assert.equal(d.frame,0);assert.equal(d.cards.length,4);d.destroy()});
test('replacement cancels dragging, reduced motion completes, destroy restores mount',()=>{const d=deck();d.start();d.replaceContent(fixture(2));assert.equal(d.drag,null);d.reduced=true;d.setOpen(true);d.schedule();assert.equal(d.p.x,1);d.destroy();assert.equal(d.mount.children.length,0);assert.equal(d.mount.getAttribute('role'),null);assert.equal(d.frame,0);assert.equal(d.input.active,null);d.updateSettings({mass:2});d.replaceContent(fixture(3));assert.equal(d.mount.children.length,0)});
test('low mass, critical damping, and tuning extremes remain stable',()=>{
 for(const config of [{mass:.01},{mass:.25,stiffness:600,damping:80},{mass:3,stiffness:60,damping:5},{mass:1,stiffness:100,damping:20}]){
  const s=spring(1);s.target=0;for(let i=0;i<3000;i++){springStep(s,1/60,settingsWith(config));assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.v));}assert.equal(s.x,0);
 }
});
function pointer(el,type,props){const e=new Event(type,{cancelable:true});for(const [key,value]of Object.entries({isPrimary:true,button:0,pointerId:1,clientX:170,clientY:300,timeStamp:0,...props}))Object.defineProperty(e,key,{value});el.dispatchEvent(e)}
test('pointer capture, cancellation, and lost capture restore stable state',()=>{
 const d=deck();pointer(d.mount,'pointerdown');assert.equal(d.mount.hasPointerCapture(1),true);pointer(d.mount,'pointermove',{clientY:200,timeStamp:100});assert.ok(d.p.x>0);pointer(d.mount,'pointercancel',{timeStamp:110});settle(d);assert.equal(d.p.x,0);assert.equal(d.input.active,null);assert.equal(d.mount.hasPointerCapture(1),false);
 pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientY:180,timeStamp:150});pointer(d.mount,'lostpointercapture');settle(d);assert.equal(d.p.x,0);assert.equal(d.drag,null);d.destroy();pointer(d.mount,'pointerdown');assert.equal(d.input.active,null);
});
test('paused pointer release cannot use stale flick velocity',()=>{const d=deck();pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientY:270,timeStamp:20});pointer(d.mount,'pointerup',{clientY:270,timeStamp:200});settle(d);assert.equal(d.open,false);d.destroy()});
test('commit completion announces the new situation',()=>{const d=deck();d.addEventListener('commit',()=>d.replaceContent(fixture(2)));d.setOpen(true);d.commit();d.tick(d.commitMotion.start+1000);settle(d);assert.equal(d.live.textContent,'Situation');d.destroy()});
test('reduced motion commits without animation or stale status',()=>{const d=deck();d.reduced=true;d.addEventListener('commit',()=>d.replaceContent(fixture(2)));d.setOpen(true);d.schedule();d.commit();assert.equal(d.busy,false);assert.equal(d.content.id,'fixture2');assert.equal(d.live.textContent,'Situation');assert.equal(d.frame,0);d.destroy()});
test('resize cancels an active drag without changing selection',()=>{const d=deck();d.setOpen(true);settle(d);d.index=1;d.b.x=d.b.target=1;pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientX:130,timeStamp:30});d.resize.callback();assert.equal(d.index,1);assert.equal(d.drag,null);assert.equal(d.b.x,1);d.destroy()});
test('tab suspension finishes queued commit and clears animation work',()=>{const d=deck();d.addEventListener('commit',()=>d.replaceContent(fixture(2)));d.setOpen(true);d.commit();document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(d.busy,false);assert.equal(d.frame,0);assert.equal(d.content.id,'fixture2');document.hidden=false;d.destroy()});

function descendants(el){return [el,...el.children.flatMap(descendants)]}
function textOf(el){return [el.textContent||'',...el.children.map(textOf)].join(' ')}
function assertOpaque(d){for(const el of descendants(d.mount))assert.ok(!Object.hasOwn(el.style,'opacity'),`${el.className||'element'} assigns opacity`)}
test('physical motion defaults include depth, lift, angular springs and gravity',()=>{
 for(const [key,value]of Object.entries({perspective:1000,stackDepth:10,liftHeight:28,angularStiffness:180,angularDamping:22,gravity:2200}))assert.equal(DEFAULT_SETTINGS[key],value);
 assert.ok(!Object.hasOwn(DEFAULT_SETTINGS,'scatterDuration'));
});
test('opening lifts the situation off preexisting action cards without fading',()=>{
 const d=deck();const cards=[...d.cards];const initial=cards.map((_,i)=>renderer.cardPose(d,i));const closedScene=renderer.scenePose(d);
 assertOpaque(d);d.start();d.move({axis:'y',x:0,y:-180,vx:0,vy:0});const liftedScene=renderer.scenePose(d);
 assert.ok(liftedScene.y<closedScene.y-100);assert.equal(d.open,false);assert.deepEqual(d.cards,cards);
 for(let i=0;i<cards.length;i++){
  const pose=renderer.cardPose(d,i);assert.ok(pose.visible);assert.ok(Math.abs(pose.y-initial[i].y)<100,'action must not enter from below');
  assert.ok(pose.y>liftedScene.y);for(const field of ['rx','ry','rz','x','y','z'])assert.ok(Number.isFinite(pose[field]));assert.ok(!Object.hasOwn(pose,'opacity'));
 }
 assertOpaque(d);d.cancel();settle(d);assertOpaque(d);d.destroy();
});
test('commit moves all action cards upward together without sideways scatter',()=>{
 for(const count of [2,3,4]){
  const d=deck(count);d.setOpen(true);settle(d);key(d,'ArrowLeft');d.commit();
  const start=d.commitMotion.start;const before=d.cards.map((_,i)=>renderer.cardPose(d,i,start));const during=d.cards.map((_,i)=>renderer.cardPose(d,i,start+d.settings.commitDuration*.5));
  const displacement=during[0].y-before[0].y;assert.ok(displacement<0);
  for(let i=0;i<count;i++){
   assert.ok(Math.abs((during[i].y-before[i].y)-displacement)<1e-7);assert.equal(during[i].x,before[i].x);
   assert.ok(!Object.hasOwn(during[i],'opacity'));
  }
  d.render(start+d.settings.commitDuration*.5);assertOpaque(d);d.destroy();
 }
});
test('host replacement stages the next situation while outgoing cards remain onscreen',()=>{
 const d=deck();d.setOpen(true);settle(d);const outgoing=[...d.cards],scene=d.scene;
 const next={...fixture(2),id:'next',title:'Next situation',text:'Already beneath the deck'};
 d.addEventListener('commit',()=>d.replaceContent(next));d.commit();
 assert.equal(d.pending.id,'next');assert.equal(d.content.id,'fixture3');assert.equal(d.scene,scene);
 assert.ok(textOf(d.mount).includes('Next situation'));for(const card of outgoing)assert.ok(descendants(d.mount).includes(card));
 for(let i=0;i<outgoing.length;i++)assert.ok(renderer.cardPose(d,i,d.commitMotion.start).visible);
 assertOpaque(d);const underlayTransform=d.underlay.style.transform;d.tick(d.commitMotion.start+1000);assert.equal(d.content.id,'next');assert.equal(d.open,false);
 const installed=renderer.scenePose(d);assert.ok(installed.visible);assert.equal(Math.abs(installed.y),0);assert.ok(underlayTransform.startsWith(`translate3d(${installed.x}px,${installed.y}px,${installed.z}px)`),'installed scene matches the prepared underlay depth');
 assertOpaque(d);settle(d);assert.equal(Math.abs(renderer.scenePose(d).y),0);assert.ok(renderer.scenePose(d).visible);assert.equal(d.busy,false);assert.equal(d.frame,0);d.destroy();
});
test('grab location changes angular targets and release springs back to rest',()=>{
 const samples=[];
 for(const grab of [{clientX:30,clientY:60},{clientX:310,clientY:390}]){
  const d=deck();pointer(d.mount,'pointerdown',grab);pointer(d.mount,'pointermove',{clientX:grab.clientX,clientY:grab.clientY-60,timeStamp:40});
  const rotations=[d.rotationX,d.rotationY,d.rotationZ];
  for(const state of rotations){assert.ok(state);assert.ok(Number.isFinite(state.x));assert.ok(Number.isFinite(state.target));}
  samples.push(rotations.map(state=>state.target));
  pointer(d.mount,'pointercancel',{timeStamp:50});settle(d);
  for(const state of rotations){assert.equal(state.target,0);assert.equal(state.x,0);assert.equal(state.v,0);}
  d.destroy();
 }
 assert.ok(samples[0].some((target,i)=>Math.abs(target-samples[1][i])>.01),'different grab points must produce different rotation');
});
test('rapid keyboard commit keeps a partially lifted situation on its continuous upward path',()=>{
 const d=deck();const source=d.scene;d.addEventListener('commit',()=>d.replaceContent({...fixture(2),title:'Rapid next'}));
 const press=name=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:name});d.mount.dispatchEvent(event)};
 press('ArrowUp');d.tick(performance.now());assert.ok(d.p.x>0&&d.p.x<1);
 const before=renderer.scenePose(d);press('ArrowUp');assert.ok(d.commitMotion);assert.equal(d.scene,source);
 const start=d.commitMotion.start,atRelease=renderer.scenePose(d,start);assert.ok(atRelease.visible);assert.equal(atRelease.y,before.y);
 const after=renderer.scenePose(d,start+40);assert.ok(after.visible);assert.ok(after.y<atRelease.y);assert.ok(descendants(d.mount).includes(source));
 d.render(start+40);assert.equal(source.style.visibility,'visible');assertOpaque(d);
 d.tick(start+1000);assert.equal(d.content.title,'Rapid next');assert.ok(renderer.scenePose(d).visible);assert.equal(Math.abs(renderer.scenePose(d).y),0);
 assert.equal(d.operation,'commit');assert.equal(d.busy,true);
 for(let i=0;i<d.cards.length;i++){assert.ok(renderer.cardPose(d,i).visible);assert.equal(d.cards[i].style.visibility,'visible');}
 settle(d);assert.equal(d.busy,false);assertOpaque(d);d.destroy();
});
