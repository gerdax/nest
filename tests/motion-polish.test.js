import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDeck, DEFAULT_SETTINGS } from '../engine/CardDeck.js';
import { MovementHistory } from '../engine/MovementHistory.js';
import { cardPose, scenePose, backPose } from '../engine/renderer.js';
import { projectedBounds, turningBounds } from '../engine/geometry.js';
import { departureDistance, settingsWith } from '../engine/motion.js';
class Element extends EventTarget {
  constructor() { super(); this.attrs = new Map(); this.style = {}; this.children = []; this.classList = { add() {}, remove() {} }; }
  setAttribute(k,v) { this.attrs.set(k,v); } getAttribute(k) { return this.attrs.get(k) ?? null; } removeAttribute(k) { this.attrs.delete(k); }
  append(...els) { for (const el of els) { el.remove(); el.parentNode=this; this.children.push(el); } }
  remove() { if(this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this),1); this.parentNode=null; } }
  replaceChildren(...els) { this.children.forEach(el=>el.parentNode=null); this.children=[]; this.append(...els); }
  focus() {} getBoundingClientRect() { return { left:0, top:this.top ?? 300, width:340, height:453 }; }
}
let now=1000, serial=0; const frames=new Map();
Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;}; globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.document=new Element(); document.hidden=false; document.createElement=()=>new Element();
globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false}); globalThis.ResizeObserver=class { constructor(callback){this.callback=callback;} observe(){} disconnect(){} };
const fixture=(n,id='choices')=>({id,actions:Array.from({length:n},(_,i)=>({id:`a${i}`,label:`Choice ${i}`}))});
function step(ms=16) { now+=ms; const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now)); }
function settle() { for(let i=0;frames.size && i<2500;i++)step();assert.equal(frames.size,0); }
function make(n=4) { const d=new CardDeck(new Element(),{content:fixture(n)}); d.setOpen(true);d.schedule();settle();return d; }
const g=y=>({axis:'y',x:0,y,vx:0,vy:0});
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-8,`${message}: ${a} != ${b}`);

test('chosen defaults and signed/zero motion tuning are complete',()=>{
  const expected={stiffness:360,damping:56,mass:1.15,maxTilt:12,lidAngle:75,lidCloseDelay:100,axisThreshold:34,distanceThreshold:.14,flickVelocity:325,flickDistance:26,commitDuration:210,perspective:1200,stackDepth:22,liftHeight:56,angularStiffness:350,angularDamping:65,gravity:800,choiceStaggerMs:30,flipLeadMs:100,flipAxisTilt:-1,revealStartScale:.915,revealFullScaleAt:0.167054298371648};
  assert.deepEqual(DEFAULT_SETTINGS,expected);assert.deepEqual(JSON.parse(JSON.stringify(settingsWith())),expected);
  const settings=settingsWith({choiceStaggerMs:0,flipLeadMs:0,flipAxisTilt:-9});assert.equal(settings.choiceStaggerMs,0);assert.equal(settings.flipLeadMs,0);assert.equal(settings.flipAxisTilt,-9);
  assert.equal(settingsWith({lidAngle:0}).lidAngle,0);assert.equal(settingsWith({lidAngle:100}).lidAngle,85);
});
test('movement samples interpolate and remain bounded after a long gesture',()=>{
  const h=new MovementHistory(0,0);h.record(20,20);near(h.at(9),9,'interpolation');assert.equal(h.at(-5),0);assert.equal(h.at(30),20);
  for(let t=21;t<5000;t++)h.record(t,t);assert.ok(h.samples.length<505);near(h.at(4973.5),4973.5,'recent samples');
});
for(const count of [2,3,4]) test(`${count} choices follow at exact rank delays through gradual drag, reverse, cancel and re-grab`,()=>{
  const d=make(count);const rest=d.cards.map((_,i)=>cardPose(d,i,now));d.start();d.move(g(-1));const origin=now;
  for(let t=10;t<=140;t+=10) { step(10);d.move(g(-t)); }
  for(let i=0;i<count;i++) { const rank=d.choiceRanks.get(d.content.actions[i].id);near(d.choiceLift(i,now),140-rank*30,'30ms per position');near(cardPose(d,i,now).y,rest[i].y-(140-rank*30),'physical pose'); }
  const before=d.cards.map((_,i)=>cardPose(d,i,now));d.cancel();
  d.cards.forEach((_,i)=>near(cardPose(d,i,now).y,before[i].y,'cancel boundary'));
  step(10); const settling=d.cards.map((_,i)=>cardPose(d,i,now));d.start();d.move(g(0));
  d.cards.forEach((_,i)=>near(cardPose(d,i,now).y,settling[i].y,'re-grab boundary'));
  for(let t=0;t<100;t+=10) { step(10);d.move(g(-80+t)); }
  assert.ok(d.choiceHistory.samples.length>3);d.cancel();settle();assert.equal(d.l.x,0);assert.equal(d.choiceHistory,null);d.destroy();
});
for(const count of [2,3,4]) for(const stagger of [0,30]) test(`${count} keyboard choices continue ${stagger}ms stagger throughout departure`,()=>{
  const d=make(count);d.updateSettings({choiceStaggerMs:stagger});const rest=d.cards.map((_,i)=>cardPose(d,i,now));d.commit();const motion=d.commitMotion;
  for(const elapsed of [10,60,150,210])for(let i=0;i<count;i++) {
    const delay=d.choiceRanks.get(d.content.actions[i].id)*stagger;
    near(cardPose(d,i,motion.start+elapsed).y,rest[i].y-departureDistance(motion,motion.start+elapsed-delay),'delayed departure');
  }
  step(motion.duration);if(stagger) { assert.ok(d.commitMotion);assert.equal(d.start(),false);step((count-1)*stagger); }
  assert.equal(d.commitMotion,null);assert.equal(d.busy,true);d.reset();assert.equal(d.choiceHistory,null);assert.equal(d.frame,0);d.destroy();
});

test('earlier flip waits for the full swept plane, then overlaps departure and carries position and velocity into adoption',()=>{
  const d=make(4);d.updateSettings({choiceStaggerMs:18,flipLeadMs:30,flipAxisTilt:-3});d.mount.top=500;d.addEventListener('commit',()=>d.replaceContent(fixture(2,'next')));let complete=0;d.addEventListener('transitioncomplete',e=>{if(e.detail.transition==='commit')complete++;});
  d.commit();const start=now;step(179);assert.equal(d.nextFlip.target,1);step(1);assert.equal(d.nextFlip.target,0,JSON.stringify({poses:d.cards.map((_,i)=>projectedBounds(cardPose(d,i,now),340,453,1200)),area:turningBounds({z:-24,turnAxis:-3},340,453,1200),time:now-start}));assert.ok(d.commitMotion);assert.ok(d.nextFlip.x<1);
  const area=turningBounds({z:-24,turnAxis:-3},340,453,1200);
  d.cards.forEach((_,i)=>assert.ok(projectedBounds(cardPose(d,i,now),340,453,1200).bottom<=area.top-8));
  step(20);const outgoing=d.cards.slice();assert.ok(outgoing.every(card=>card.parentNode));assert.equal(d.start(),false);
  step(start+210+54-1-now);const carried={...d.nextFlip};step(1);
  assert.equal(d.content.id,'next');assert.deepEqual(d.flip,carried);assert.equal(d.flip.v,carried.v);assert.equal(scenePose(d).z,-24);
  const front=scenePose(d),reverse=backPose(front);for(const field of ['top','bottom','left','right'])near(projectedBounds(front,340,453,1200)[field],projectedBounds(reverse,340,453,1200)[field],'coincident face planes');
  assert.ok(outgoing.every(card=>!card.parentNode?.parentNode));settle();assert.equal(d.busy,false);assert.equal(complete,1);d.destroy();
});
test('early timing never permits overlapping the turn area; late content can start during outgoing flight',()=>{
  const d=make(4);d.mount.top=0;d.updateSettings({flipLeadMs:100});d.commit();step(110);assert.equal(d.nextFlip.target,1);
  d.replaceContent(fixture(2,'late'));step(1);assert.equal(d.nextFlip.target,1,'unsafe overlap gates flip despite available content');
  while(d.commitMotion && d.nextFlip.target===1)step(4);
  assert.equal(d.nextFlip.target,0);assert.ok(d.commitMotion,'flip begins before lagging stack adoption');settle();assert.equal(d.content.id,'late');d.destroy();
});
for(const action of ['reset','destroy']) test(`${action} cancels stagger and staged turning work`,()=>{
  const d=make(4);d.addEventListener('commit',()=>d.replaceContent(fixture(2,'next')));d.start();step(20);d.move(g(-100));d.end({...g(-100),vy:-800});step(190);assert.ok(d.choiceHistory);d[action]();assert.equal(d.frame,0);assert.equal(d.choiceHistory,null);step(500);assert.equal(d.frame,0);if(action==='reset')d.destroy();
});

test('a newly selected former follower becomes the direct leader without a pose jump',()=>{
  const d=make(4);d.start();step(30);d.move(g(-140));step(10);d.cancel();
  const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'ArrowRight'});d.key(event);
  const before=d.cards.map((_,i)=>cardPose(d,i,now));d.start();d.move(g(0));
  d.cards.forEach((_,i)=>{for(const field of ['x','y','z','rx','ry','rz'])near(cardPose(d,i,now)[field],before[i][field],'ownership boundary');});
  assert.equal(d.choiceRanks.get(d.content.actions[d.index].id),0);const leader=cardPose(d,d.index,now);d.move(g(-80));
  near(cardPose(d,d.index,now).y,leader.y-80,'new selection directly tracks pointer');d.cancel();settle();d.destroy();
});
for(const moment of ['before-turn','during-turn']) test(`resize ${moment} safely finishes choreography at the new dimensions`,()=>{
  const d=make(4);d.mount.top=500;d.addEventListener('commit',()=>d.replaceContent(fixture(2,'resized')));d.commit();step(moment==='during-turn'?240:100);
  if(moment==='during-turn')assert.equal(d.nextFlip.target,0);
  d.mount.getBoundingClientRect=()=>({left:0,top:500,width:680,height:906});d.resize.callback();
  assert.equal(d.content.id,'resized');assert.equal(d.commitMotion,null);assert.equal(d.busy,false);assert.equal(d.flip.x,0);assert.equal(d.frame,0);d.destroy();
});
test('live camera and axis edits during the overlapping turn adopt safely',()=>{
  const d=make(4);d.mount.top=500;d.addEventListener('commit',()=>d.replaceContent(fixture(2,'tuned')));d.commit();step(240);assert.equal(d.nextFlip.target,0);
  d.updateSettings({flipAxisTilt:-10,perspective:650});assert.equal(d.content.id,'tuned');assert.equal(d.flip.x,0);assert.equal(d.settings.flipAxisTilt,-10);assert.equal(d.busy,false);d.destroy();
});
