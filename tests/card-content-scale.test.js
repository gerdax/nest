import test from 'node:test';
import assert from 'node:assert/strict';
import {syncCardContentScale} from '../engine/cardSizing.js';

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
