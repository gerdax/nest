import test from 'node:test';
import assert from 'node:assert/strict';
import {syncCardContentScale,cardLayoutSettings} from '../engine/cardSizing.js';
import {DEFAULT_SETTINGS,carouselPose,flipLift} from '../engine/motion.js';
import {projectedBounds,handoffRadius} from '../engine/geometry.js';
import {CardDeck} from '../engine/CardDeck.js';

function mount(width,zoom=1,reference='273.6'){
 const styles=new Map(),root={};
 return {styles,style:{setProperty:(key,value)=>styles.set(key,value)},getBoundingClientRect:()=>({width:width*zoom,height:width*4/3*zoom}),ownerDocument:{documentElement:root,defaultView:{getComputedStyle:element=>element===root?{zoom:String(zoom)}:{getPropertyValue:()=>reference}}}};
}
test('card composition uses the reset preview reference at every physical size and root zoom',()=>{
 for(const zoom of [1,.8])for(const factor of [.5,.8,1,1.25]){
  const element=mount(273.6*factor,zoom);syncCardContentScale(element);
  assert(Math.abs(Number(element.styles.get('--card-content-scale'))-factor)<1e-10);
 }
});
test('unconfigured engine hosts and hidden mounts retain their existing composition',()=>{
 for(const element of [mount(273.6,1,''),mount(0),mount(273.6,1,'invalid')]){
  syncCardContentScale(element);assert.equal(element.styles.size,0);
 }
});

test('configured playfield geometry and projected fans scale from baseline settings without compounding',()=>{
 const base={...DEFAULT_SETTINGS};
 for(const factor of [.5,1,1.5,2,.75,1]){
  const element=mount(273.6*factor,1,String(factor));
  const settings=cardLayoutSettings(element,base);
  assert.equal(settings.perspective,base.perspective*factor);
  assert.equal(base.perspective,DEFAULT_SETTINGS.perspective);
  for(const count of [2,3,5])for(const cursor of [0,.25,.5,1])for(let index=0;index<count;index++){
   const radius=handoffRadius(count,273.6,364.8,base);
   const baseline=carouselPose(index,cursor,count,273.6,base,radius);
   const scaledRadius=handoffRadius(count,273.6*factor,364.8*factor,settings);
   const scaled=carouselPose(index,cursor,count,273.6*factor,settings,scaledRadius);
   for(const field of ['x','y','z'])assert(Math.abs(scaled[field]-baseline[field]*factor)<1e-9);
   const a=projectedBounds(baseline,273.6,364.8,base.perspective),b=projectedBounds(scaled,273.6*factor,364.8*factor,settings.perspective);
   for(const field of ['left','right','top','bottom'])assert(Math.abs(b[field]-a[field]*factor)<1e-9);
  }
  assert.equal(flipLift(.5,settings),flipLift(.5,base)*factor);
 }
 const unconfigured=cardLayoutSettings(mount(273.6,1,''),base);
 for(const key of Object.keys(base))assert.equal(unconfigured[key],base[key]);
});

test('live deck settings patch design values before deriving the current viewport geometry',()=>{
 let factor=.5;
 const element=mount(273.6);
 element.ownerDocument.defaultView.getComputedStyle=()=>({getPropertyValue:()=>String(factor)});
 const deck={mount:element,baseSettings:{...DEFAULT_SETTINGS},schedule(){}};
 CardDeck.prototype.updateSettings.call(deck,{perspective:1400});
 assert.equal(deck.settings.perspective,700);assert.equal(deck.baseSettings.perspective,1400);
 factor=2;CardDeck.prototype.updateSettings.call(deck,{});assert.equal(deck.settings.perspective,2800);
 factor=.5;CardDeck.prototype.updateSettings.call(deck,{});assert.equal(deck.settings.perspective,700);
});

test('taking the last item preserves the staged successor depth at each composition scale',()=>{
 for(const factor of [.5,1,1.5,2]){
  let adopted;
  const deck={phase:'committing',nextTakeDepth:120*factor,settings:{layoutScale:factor},content:{id:'outgoing'},
   pending:{decisionOnly:true},pendingPresentation:'open',pendingTransition:'flip',nextFlip:{x:1},fan:{},
   install(next,options){adopted=options;},render(){},schedule(){}};
  CardDeck.prototype.completeCommit.call(deck);
  assert.equal(adopted.stagedDepth,4);
  assert.equal(adopted.stagedDepth*40*factor,40*factor+adopted.takeRecession);
 }
});
