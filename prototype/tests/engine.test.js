import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,classifyAxis,qualifies,resistance,spring,springStep,settingsWith} from '../engine/motion.js';
import {CardDeck} from '../engine/CardDeck.js';
import * as renderer from '../engine/renderer.js';
import {projectedBounds} from '../engine/geometry.js';
import {readFileSync} from 'node:fs';
class Element extends EventTarget{
 constructor(){super();this.attrs=new Map();this.style={};this.children=[];this.parentNode=null;this.classList={add(){},remove(){}};this.captures=new Set();}
 setAttribute(k,v){this.attrs.set(k,v)} getAttribute(k){return this.attrs.get(k)??null} removeAttribute(k){this.attrs.delete(k)}
 append(...els){for(const el of els){el.remove();el.parentNode=this;this.children.push(el)}} remove(){if(this.parentNode){const children=this.parentNode.children;children.splice(children.indexOf(this),1);this.parentNode=null}} replaceChildren(...els){for(const el of [...this.children])el.remove();this.append(...els)} focus(){} getBoundingClientRect(){return {left:0,top:0,width:340,height:453}}
 setPointerCapture(id){this.captures.add(id)} hasPointerCapture(id){return this.captures.has(id)} releasePointerCapture(id){this.captures.delete(id)}
}
let frames=new Map(),serial=0;
globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial};globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.document=new Element();document.createElement=()=>new Element();document.hidden=false;
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.ResizeObserver=class{constructor(callback){this.callback=callback}observe(){}disconnect(){}};
const fixture=n=>({id:`fixture${n}`,allowClose:true,title:'Situation',text:'Placeholder',actions:Array.from({length:n},(_,i)=>({id:`a${i}`,label:`Action ${i}`}))});
function deck(n=3){return new CardDeck(new Element(),{content:fixture(n)})}
function settle(d){for(let i=0;i<300;i++){cancelAnimationFrame(d.frame);d.tick(performance.now()+i*16)}cancelAnimationFrame(d.frame);d.frame=0;}
function ready(d){d.setOpen(true);settle(d);assert.equal(d.phase,'choices');assert.equal(d.fan.x,1);}
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
test('grabbing settling motion keeps current position and cancellation restores target',()=>{const d=deck();d.p.x=.45;d.p.target=0;d.start();assert.equal(d.drag.p,.45);d.move({axis:'y',x:0,y:10,vx:0,vy:0});assert.ok(Math.abs(d.p.x-.45)<.05);d.cancel();settle(d);assert.equal(d.p.x,0);assert.equal(d.fan.x,0);d.destroy()});
test('commit emits once, queues host content, then reveals next deck',()=>{for(let index=0;index<4;index++){const d=deck(4);ready(d);d.index=index;d.b.x=index;d.b.target=index;let commits=0;d.addEventListener('commit',e=>{commits++;assert.equal(e.detail.index,index);d.replaceContent(fixture(2))});d.commit();d.commit();assert.equal(d.busy,true);d.tick(d.commitMotion.start+1000);settle(d);assert.equal(commits,1);assert.equal(d.content.id,'fixture2');assert.equal(d.open,false);assert.equal(d.busy,false);assert.equal(d.cards.length,2);d.destroy()}});
test('async host content keeps input blocked; reset cancels work',()=>{const d=deck();ready(d);d.commit();d.tick(d.commitMotion.start+1000);assert.equal(d.busy,true);assert.equal(d.start(),false);d.replaceContent(fixture(4));settle(d);assert.equal(d.busy,false);ready(d);d.commit();d.reset();assert.equal(d.busy,false);assert.equal(d.commitMotion,null);assert.equal(d.frame,0);assert.equal(d.cards.length,4);d.destroy()});
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
test('commit completion announces the new situation',()=>{const d=deck();d.addEventListener('commit',()=>d.replaceContent(fixture(2)));ready(d);d.commit();d.tick(d.commitMotion.start+1000);settle(d);assert.equal(d.live.textContent,'Situation');d.destroy()});
test('reduced motion commits without animation or stale status',()=>{const d=deck();d.reduced=true;d.addEventListener('commit',()=>d.replaceContent(fixture(2)));d.setOpen(true);d.schedule();d.commit();assert.equal(d.busy,false);assert.equal(d.content.id,'fixture2');assert.equal(d.live.textContent,'Situation');assert.equal(d.frame,0);d.destroy()});
test('resize cancels an active drag without changing selection',()=>{const d=deck();d.setOpen(true);settle(d);d.index=1;d.b.x=d.b.target=1;pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientX:130,timeStamp:30});d.resize.callback();assert.equal(d.index,1);assert.equal(d.drag,null);assert.equal(d.b.x,1);d.destroy()});
test('tab suspension finishes queued commit and clears animation work',()=>{const d=deck();d.addEventListener('commit',()=>d.replaceContent(fixture(2)));ready(d);d.commit();document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(d.busy,false);assert.equal(d.frame,0);assert.equal(d.content.id,'fixture2');document.hidden=false;d.destroy()});

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
test('rapid reveal input cannot commit or browse before choices are ready',()=>{
 const d=deck();let commits=0;d.addEventListener('commit',()=>commits++);
 const press=name=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:name});d.mount.dispatchEvent(event)};
 press('ArrowUp');d.tick(performance.now());assert.equal(d.phase,'revealing');assert.ok(d.p.x>0&&d.p.x<1);assert.equal(d.fan.x,0);
 const browse=d.b.target;press('ArrowUp');press('ArrowRight');d.commit();assert.equal(commits,0);assert.equal(d.commitMotion,null);assert.equal(d.b.target,browse);
 settle(d);assert.equal(d.phase,'choices');assert.equal(d.fan.x,1);press('ArrowUp');assert.equal(commits,1);assert.equal(d.phase,'committing');assert.ok(d.commitMotion);d.destroy();
});

function footprint(d,pose){const {width,height}=d.mount.getBoundingClientRect();return projectedBounds(pose,width,height,d.settings.perspective)}
test('closed decks contain exactly the actual scene and action cards in distinct layers',()=>{
 for(const count of [2,3,4]){
  const d=deck(count);assert.equal(d.phase,'closed');assert.equal(d.fan.x,0);assert.equal(d.underlay,null);
  const articles=descendants(d.mount).filter(el=>(el.className||'').split(' ').includes('nest-card'));
  assert.equal(articles.length,count+2);assert.ok(textOf(d.sceneBack).includes('NEST'));
  assert.ok(d.sceneLayer.children.includes(d.sceneBack));assert.ok(d.sceneBack.className.includes('nest-card-back'));
  assert.equal(descendants(d.mount).filter(el=>(el.className||'').split(' ').includes('nest-card-back')).length,1);
  assert.equal(d.cardLayers.length,count);assert.equal(new Set([...d.cardLayers,d.sceneLayer]).size,count+1);
  for(let i=0;i<count;i++){assert.ok(d.cardLayers[i].className.includes('nest-card-layer'));assert.ok(d.cardLayers[i].children.includes(d.cards[i]));assert.ok(d.mount.children.includes(d.cardLayers[i]));}
  assert.ok(d.sceneLayer.children.includes(d.scene));d.destroy();
 }
 const css=readFileSync(new URL('../engine/card-deck.css',import.meta.url),'utf8');
 assert.ok(!css.includes('preserve-3d'),'card layers must flatten independently to allow whole-card painter ordering');
});
test('compressed actions stay centered and inside the projected source at tuning extremes',()=>{
 for(const count of [2,3,4])for(const width of [249,340])for(const perspective of [650,1600])for(const maxTilt of [0,18])for(const stackDepth of [1,30]){
  const d=deck(count);d.mount.getBoundingClientRect=()=>({left:0,top:0,width,height:width*4/3});d.updateSettings({perspective,maxTilt,stackDepth});
  d.b.x=3.5;d.rotationX.x=maxTilt;d.rotationY.x=-maxTilt;d.rotationZ.x=maxTilt;
  // Source at rest has no angular rotation; compressed choices suppress their
  // angular spring response even if previous browsing left a nonzero cursor.
  d.rotationX.x=d.rotationY.x=d.rotationZ.x=0;
  const source=footprint(d,renderer.scenePose(d));
  for(let i=0;i<count;i++){
   const pose=renderer.cardPose(d,i);for(const key of ['x','y','rx','ry','rz'])assert.equal(Math.abs(pose[key]),0);
   assert.ok(pose.z<renderer.scenePose(d).z);const bounds=footprint(d,pose);
   assert.ok(bounds.left>=source.left&&bounds.right<=source.right&&bounds.top>=source.top&&bounds.bottom<=source.bottom);
  }d.destroy();
 }
});
test('partial reveal keeps choices compressed, then accepted reveal waits for projected clearance',()=>{
 const d=deck();d.start();d.move({axis:'y',x:0,y:-60,vx:0,vy:0});assert.equal(d.fan.x,0);assert.equal(d.fan.target,0);assert.equal(d.phase,'closed');
 d.end({axis:'y',x:0,y:-60,vx:0,vy:0});settle(d);assert.equal(d.open,false);assert.equal(d.fan.x,0);
 d.setOpen(true);let sawExpansion=false;let time=performance.now();
 for(let i=0;i<300;i++){
  cancelAnimationFrame(d.frame);d.tick(time+i*16);
  if(d.fan.target>0||d.fan.x>0){assert.ok(footprint(d,renderer.scenePose(d)).bottom<-8,'fan expansion starts only once source is clear');sawExpansion=true;}
  if(d.phase==='choices')break;
 }
 assert.ok(sawExpansion);assert.equal(d.phase,'choices');assert.equal(d.fan.x,1);d.destroy();
});
test('closing compresses the fan before returning the source',()=>{
 const d=deck();ready(d);const lifted=d.p.x;d.setOpen(false);assert.equal(d.phase,'closing');assert.equal(d.fan.target,0);
 assert.equal(d.p.target,lifted);let time=performance.now();let sawCompression=false;
 for(let i=0;i<300;i++){
  cancelAnimationFrame(d.frame);d.tick(time+i*16);
  if(d.fan.x>0){assert.equal(d.p.x,lifted);sawCompression=true;}
  if(d.p.x<lifted)assert.equal(d.fan.x,0);
  if(d.phase==='closed')break;
 }
 assert.ok(sawCompression);assert.equal(d.phase,'closed');assert.equal(d.p.x,0);assert.equal(d.fan.x,0);d.destroy();
});
test('crossover swaps whole-card foreground order only with projected horizontal clearance',()=>{
 for(const count of [2,3,4])for(const width of [249,340])for(const perspective of [650,1000])for(const maxTilt of [6,18])for(const stackDepth of [10,30]){
  const d=deck(count);d.mount.getBoundingClientRect=()=>({left:0,top:0,width,height:width*4/3});d.updateSettings({perspective,maxTilt,stackDepth});ready(d);
  for(const rx of [-maxTilt,0,maxTilt])for(const ry of [-maxTilt,0,maxTilt])for(const rz of [-maxTilt,0,maxTilt]){
   d.rotationX.x=rx;d.rotationY.x=ry;d.rotationZ.x=rz;
   d.b.x=.5;const poses=[renderer.cardPose(d,0),renderer.cardPose(d,1)];const bounds=poses.map(pose=>footprint(d,pose));
   const left=poses[0].x<poses[1].x?0:1,right=1-left;
   assert.ok(bounds[right].left-bounds[left].right>=8-1e-7,`crossover gap count${count}, width${width}`);
   d.b.x=.49999;d.render();const before=d.cardLayers.slice(0,2).map(layer=>Number(layer.style.zIndex));
   d.b.x=.50001;d.render();const after=d.cardLayers.slice(0,2).map(layer=>Number(layer.style.zIndex));
   assert.ok(before[0]>before[1]);assert.ok(after[1]>after[0]);
  }d.destroy();
 }
});
test('motion defaults are unchanged',()=>{
 assert.equal(DEFAULT_SETTINGS.stiffness,280);assert.equal(DEFAULT_SETTINGS.damping,30);assert.equal(DEFAULT_SETTINGS.mass,1);assert.equal(DEFAULT_SETTINGS.maxTilt,6);
 assert.equal(DEFAULT_SETTINGS.distanceThreshold,.25);assert.equal(DEFAULT_SETTINGS.flickVelocity,700);assert.equal(DEFAULT_SETTINGS.commitDuration,420);
});

test('reversing a closing drag raises the source before expanding choices again',()=>{
 const d=deck();ready(d);d.start();
 d.move({axis:'y',x:0,y:500,vx:0,vy:0});assert.equal(d.fan.x,0);assert.ok(footprint(d,renderer.scenePose(d)).bottom>0);
 d.move({axis:'y',x:0,y:50,vx:0,vy:0});
 const safelyReversed=d.fan.x===0||footprint(d,renderer.scenePose(d)).bottom<=-8;
 d.cancel();d.destroy();
 assert.ok(safelyReversed,'reverse drag expanded choices while the source still overlapped them');
});

test('resizing during fan expansion preserves projected source clearance',()=>{
 const d=deck();d.updateSettings({stiffness:60,damping:80,mass:3});let width=249;d.mount.getBoundingClientRect=()=>({left:0,top:0,width,height:width*4/3});
 d.setOpen(true);const time=performance.now();
 for(let i=0;i<300&&d.fan.x===0;i++){cancelAnimationFrame(d.frame);d.tick(time+i*16);}
 assert.ok(d.fan.x>0);width=340;d.resize.callback();
 const safe=d.fan.x===0||footprint(d,renderer.scenePose(d)).bottom<=-8;
 d.destroy();assert.ok(safe,'resize returned the source over already expanding choices');
});

test('a closing drag can reverse through zero into an upward commit',()=>{
 const d=deck();ready(d);let commits=0;d.addEventListener('commit',()=>commits++);d.start();
 d.move({axis:'y',x:0,y:500,vx:0,vy:0});assert.equal(d.fan.x,0);
 d.move({axis:'y',x:0,y:0,vx:0,vy:0});assert.equal(d.fan.x,1);assert.ok(footprint(d,renderer.scenePose(d)).bottom<=-8);
 const gesture={axis:'y',x:0,y:-130,vx:0,vy:0};d.move(gesture);d.end(gesture);
 assert.equal(commits,1);assert.equal(d.phase,'committing');assert.equal(d.fan.x,1);assert.ok(d.commitMotion);d.destroy();
});

for(const count of [2,3,4])test(`${count} actions complete the captured preset reveal, browse, close, reopen and commit loop`,()=>{
 const d=deck(count);assert.deepEqual(d.settings,DEFAULT_SETTINGS);d.updateSettings({axisThreshold:27,distanceThreshold:.21,flickVelocity:375,commitDuration:190,perspective:1100});let commits=0;
 d.addEventListener('commit',()=>{commits++;d.replaceContent({...fixture(count),id:'next-preset',title:'Next preset situation'})});
 gesture(d,{axis:'y',x:0,y:-130,vx:0,vy:0});assert.equal(d.phase,'choices');
 for(let i=0;i<count+1;i++)key(d,'ArrowRight');for(let i=0;i<count+2;i++)key(d,'ArrowLeft');
 assert.equal(d.b.target,-1);assert.equal(d.index,count-1);
 key(d,'ArrowDown');assert.equal(d.phase,'closed');assert.equal(d.fan.x,0);
 key(d,'ArrowUp');assert.equal(d.phase,'choices');assert.equal(d.index,count-1);
 key(d,'ArrowUp');assert.equal(commits,1);assert.equal(d.busy,false);assert.equal(d.phase,'closed');assert.equal(d.content.id,'next-preset');assert.equal(d.underlay,null);assert.equal(d.live.textContent,'Next preset situation');d.destroy();
});

test('resizing while closing an unfinished reveal keeps the cover above the remaining fan',()=>{
 const d=deck();d.updateSettings({stiffness:60,damping:80,mass:3});let width=249;d.mount.getBoundingClientRect=()=>({left:0,top:0,width,height:width*4/3});
 d.setOpen(true);const time=performance.now();
 for(let i=0;i<300&&d.fan.x===0;i++){cancelAnimationFrame(d.frame);d.tick(time+i*16);}
 d.setOpen(false);assert.equal(d.phase,'closing');assert.ok(d.fan.x>0);width=340;d.resize.callback();
 const safe=d.fan.x===0||footprint(d,renderer.scenePose(d)).bottom<=-8;d.destroy();
 assert.ok(safe,'resizing brought the closing source back before the fan compressed');
});

test('two choices form a visible idle fan after either action is selected',()=>{
 const d=deck(2);
 for(let i=0;i<2;i++){
  const compressed=renderer.cardPose(d,i);assert.equal(compressed.x,0);assert.equal(compressed.rz,0);
 }
 ready(d);
 for(const direction of ['ArrowRight','ArrowLeft','ArrowLeft','ArrowRight']){
  key(d,direction);
  const front=renderer.cardPose(d,d.index),rear=renderer.cardPose(d,1-d.index);
  assert.ok(Math.abs(front.x)<1e-7);assert.ok(Math.abs(front.rz)<1e-7);
  assert.ok(rear.x>=15,'rear choice must protrude sideways at rest');
  assert.ok(rear.rz>1,'rear choice must have a visible fan angle');
 }
 d.destroy();
});


function yaw(element){return Number(element.style.transform.match(/rotateY\(([-\d.]+)deg\)/)[1])}
function commitNext(d,next={...fixture(2),id:'flip-next',title:'Next face'}){
 d.addEventListener('commit',()=>d.replaceContent(next),{once:true});ready(d);d.commit();return d.commitMotion.start;
}
function installCommitted(d,start){cancelAnimationFrame(d.frame);d.tick(start+d.settings.commitDuration+1);}
test('the next situation stages face down beneath departing choices without a placeholder',()=>{
 const d=deck();ready(d);
 assert.equal(d.underlay,null);assert.equal(d.underlayBack,null);assert.equal(d.flip.x,0);assert.equal(renderer.scenePose(d).ry,0);
 const outgoing=[...d.cards],source=d.scene;
 d.addEventListener('commit',()=>d.replaceContent({...fixture(2),id:'staged',title:'Future front'}));d.commit();
 assert.equal(d.content.id,'fixture3');assert.equal(d.scene,source);assert.equal(d.pending.id,'staged');
 assert.deepEqual(d.underlayLayer.children,[d.underlay,d.underlayBack]);
 assert.equal(yaw(d.underlay),180);assert.equal(yaw(d.underlayBack),360);
 assert.equal(d.underlay.style.visibility,'visible');assert.equal(d.underlayBack.style.visibility,'visible');
 assert.equal(d.underlay.getAttribute('aria-hidden'),'true');assert.equal(d.underlayBack.getAttribute('aria-hidden'),'true');
 assert.ok(textOf(d.underlay).includes('Future front'));assert.ok(textOf(d.underlayBack).includes('NEST'));
 for(const fraction of [0,.5,.99]){
  const time=d.commitMotion.start+d.settings.commitDuration*fraction;d.render(time);
  assert.equal(d.scene,source);assert.equal(yaw(d.underlay),180);assert.equal(yaw(d.underlayBack),360);
  outgoing.forEach((card,index)=>{assert.ok(descendants(d.mount).includes(card));assert.ok(renderer.cardPose(d,index,time).visible)});
 }
 assertOpaque(d);d.destroy();
});
test('incoming situation turns its two faces through back, edge and front with no fading',()=>{
 const d=deck();const start=commitNext(d);installCommitted(d,start);
 assert.equal(d.flip.x,1);assert.equal(d.flip.target,0);assert.equal(d.n.x,1);assert.equal(d.n.target,0);
 assert.equal(d.underlay,null);assert.equal(d.underlayBack,null);assert.deepEqual(d.sceneLayer.children,[d.scene,d.sceneBack]);
 for(const [progress,angle]of [[1,180],[.5,90],[0,0],[1.2,180],[-.2,0]]){
  d.flip.x=progress;d.render();assert.equal(renderer.scenePose(d).ry,angle);
  assert.equal(yaw(d.scene),angle);assert.equal(yaw(d.sceneBack),angle+180);
  assert.equal(d.scene.style.visibility,'visible');assert.equal(d.sceneBack.style.visibility,'visible');assertOpaque(d);
 }
 d.destroy();
});
test('future choices remain compressed and hidden until the incoming flip completes',()=>{
 const d=deck(4);const start=commitNext(d,fixture(4));installCommitted(d,start);
 for(const progress of [1,.5,.001]){
  d.flip.x=progress;d.fan.x=0;d.render();
  d.cards.forEach((card,index)=>{
   const pose=renderer.cardPose(d,index);assert.equal(pose.visible,false);assert.equal(card.style.visibility,'hidden');
   for(const field of ['x','y','rx','ry','rz'])assert.equal(Math.abs(pose[field]),0);
   assert.equal(d.cardLayers[index].children.length,1);assert.equal(d.cardLayers[index].children[0],card);
  });
  assert.equal(descendants(d.mount).filter(el=>(el.className||'').split(' ').includes('nest-card-back')).length,1);
 }
 d.flip.x=0;d.flip.v=0;settle(d);assert.equal(d.busy,false);assert.equal(d.phase,'closed');
 d.cards.forEach((card,index)=>{assert.ok(renderer.cardPose(d,index).visible);assert.equal(card.style.visibility,'visible')});d.destroy();
});
test('commit completion waits for both flip and depth, gates input and emits once',()=>{
 const d=deck();let complete=0;d.addEventListener('transitioncomplete',event=>{if(event.detail.transition==='commit')complete++});
 const start=commitNext(d);installCommitted(d,start);
 function blocked(){
  assert.equal(d.busy,true);assert.equal(d.start(),false);const cursor=d.b.target;
  for(const name of ['ArrowUp','ArrowRight','ArrowLeft','ArrowDown']){const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value:name});d.mount.dispatchEvent(e)}
  d.commit();assert.equal(d.open,false);assert.equal(d.b.target,cursor);assert.equal(d.commitMotion,null);assert.equal(complete,0);
 }
 blocked();d.n.x=d.n.target;d.n.v=0;d.tick(performance.now());blocked();
 d.flip.x=d.flip.target;d.flip.v=0;d.n.x=1;d.tick(performance.now());blocked();
 settle(d);assert.equal(d.busy,false);assert.equal(d.phase,'closed');assert.equal(complete,1);
 d.tick(performance.now()+1000);d.finishMotion();assert.equal(complete,1);d.destroy();
});
test('incoming flip advances with the angular spring settings',()=>{
 const d=deck();d.updateSettings({stiffness:600,damping:80,angularStiffness:60,angularDamping:5});
 const start=commitNext(d);installCommitted(d,start);const expected=spring(1);expected.target=0;
 springStep(expected,1/60,d.angularSettings());d.tick(performance.now());
 assert.equal(d.flip.x,expected.x);assert.equal(d.flip.v,expected.v);d.destroy();
});
test('delayed host keeps the departed deck blocked before installing the next back face',()=>{
 const d=deck();ready(d);let complete=0;d.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')complete++});
 d.commit();installCommitted(d,d.commitMotion.start);assert.equal(d.busy,true);assert.equal(d.start(),false);assert.equal(d.underlay,null);assert.equal(complete,0);
 d.replaceContent({...fixture(2),id:'delayed'});assert.equal(d.content.id,'delayed');assert.equal(d.flip.x,1);assert.equal(yaw(d.scene),180);assert.equal(d.busy,true);
 settle(d);assert.equal(d.flip.x,0);assert.equal(d.n.x,0);assert.equal(complete,1);d.destroy();
});
test('reset and destroy cancel the incoming flip and remove its back face work',()=>{
 for(const action of ['reset','destroy']){
  const d=deck();const start=commitNext(d);installCommitted(d,start);let complete=0;
  d.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')complete++});d[action]();
  assert.equal(d.frame,0);assert.equal(complete,0);
  if(action==='reset'){assert.equal(d.flip.x,0);assert.equal(d.flip.v,0);assert.equal(d.flip.target,0);assert.equal(d.busy,false);assert.equal(d.phase,'closed');assert.equal(yaw(d.scene),0);assert.equal(yaw(d.sceneBack),180);assert.equal(d.underlay,null);d.destroy()}
  else {const stopped={...d.flip};assert.equal(d.mount.children.length,0);d.tick(performance.now()+1000);d.media.matches=true;d.media.dispatchEvent(new Event('change'));document.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(d.flip,stopped);assert.equal(d.mount.children.length,0);assert.equal(complete,0)}
 }
});
test('reduced motion and hidden tabs finish the incoming flip face up immediately',()=>{
 for(const mode of ['reduced','hidden'])for(const moment of ['departure','flip']){
  const d=deck();const start=commitNext(d);let complete=0;d.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')complete++});
  if(moment==='flip')installCommitted(d,start);
  if(mode==='reduced'){d.media.matches=true;d.media.dispatchEvent(new Event('change'))}
  else {document.hidden=true;document.dispatchEvent(new Event('visibilitychange'))}
  assert.equal(d.busy,false);assert.equal(d.flip.x,0);assert.equal(d.flip.v,0);assert.equal(d.n.x,0);assert.equal(d.frame,0);
  assert.equal(yaw(d.scene),0);assert.equal(yaw(d.sceneBack),180);assert.equal(complete,1);assertOpaque(d);
  document.hidden=false;d.destroy();
 }
});

test('the next reverse is exposed during a held upward gesture without committing',()=>{
 for(const count of [2,3,4]){
  const d=deck(count);ready(d);let commits=0;d.addEventListener('commit',()=>commits++);
  pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientY:220,timeStamp:100});
  assert.ok(d.input.active);assert.ok(d.drag);assert.ok(d.l.x>0);
  assert.ok(d.underlayBack);assert.equal(yaw(d.underlay),180);assert.equal(yaw(d.underlayBack),360);
  assert.equal(d.underlayBack.style.visibility,'visible');assert.ok(textOf(d.underlayBack).includes('NEST'));
  assert.equal(d.pending,null);assert.equal(d.busy,false);assert.equal(d.flip.x,0);assert.equal(d.content.id,`fixture${count}`);assert.equal(commits,0);
  pointer(d.mount,'pointercancel');settle(d);
  assert.equal(d.underlayBack.style.visibility,'hidden');assert.equal(d.phase,'choices');assert.equal(commits,0);assertOpaque(d);d.destroy();
 }
});
test('an incomplete lift returns the stack over its preview without flipping or advancing',()=>{
 const d=deck();ready(d);let commits=0;d.addEventListener('commit',()=>commits++);
 pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientY:260,timeStamp:100});
 assert.equal(d.underlayBack.style.visibility,'visible');
 pointer(d.mount,'pointerup',{clientY:260,timeStamp:250});
 assert.equal(commits,0);assert.equal(d.flip.x,0);assert.equal(d.commitMotion,null);assert.equal(d.pending,null);
 settle(d);assert.equal(d.l.x,0);assert.equal(d.underlayBack.style.visibility,'hidden');assert.equal(d.open,true);
 key(d,'ArrowRight');assert.equal(d.underlayBack.style.visibility,'hidden');d.destroy();
});
test('accepting the lift reuses the already visible reverse without a release-time pop',()=>{
 const d=deck();ready(d);let commits=0;
 d.addEventListener('commit',()=>{commits++;d.replaceContent({...fixture(2),id:'from-preview',title:'Selected consequence'})});
 pointer(d.mount,'pointerdown');pointer(d.mount,'pointermove',{clientY:150,timeStamp:100});
 const reverse=d.underlayBack,layer=d.underlayLayer,transform=reverse.style.transform;
 assert.equal(reverse.style.visibility,'visible');assert.equal(d.pending,null);
 pointer(d.mount,'pointerup',{clientY:150,timeStamp:250});
 assert.equal(commits,1);assert.equal(d.underlayBack,reverse);assert.equal(d.underlayLayer,layer);
 assert.equal(reverse.style.transform,transform);assert.equal(reverse.style.visibility,'visible');assert.equal(d.pending.id,'from-preview');
 const start=d.commitMotion.start;installCommitted(d,start);assert.equal(d.flip.x,1);settle(d);
 assert.equal(d.flip.x,0);assert.equal(d.content.id,'from-preview');assert.equal(d.busy,false);assert.equal(commits,1);d.destroy();
});


test('choice fans reject closing by default and explicit allowClose restores the cover',()=>{
 for(const close of ['drag','ArrowDown','Escape','api']){
  const content=fixture(3);delete content.allowClose;
  const d=new CardDeck(new Element(),{content});ready(d);const source=renderer.scenePose(d);const cards=d.cards.map((_,i)=>renderer.cardPose(d,i));
  if(close==='drag'){const g={axis:'y',x:0,y:180,vx:0,vy:1000};d.start();d.move(g);assert.equal(d.fan.x,1);assert.equal(renderer.scenePose(d).y,source.y);d.end(g);settle(d)}
  else if(close==='api'){d.setOpen(false);settle(d)}else key(d,close);
  assert.equal(d.open,true);assert.equal(d.phase,'choices');assert.equal(d.fan.x,1);
  assert.equal(renderer.scenePose(d).y,source.y);
  for(let i=0;i<d.cards.length;i++)for(const field of ['x','y','z','rx','ry','rz'])assert.equal(renderer.cardPose(d,i)[field],cards[i][field]);
  d.replaceContent({...content,allowClose:true});ready(d);d.setOpen(false);settle(d);
  assert.equal(d.phase,'closed');assert.equal(d.fan.x,0);assert.equal(d.p.x,0);d.destroy();
 }
});
