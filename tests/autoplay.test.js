import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAutoplay } from '../studio/autoplay.js';

class Checkbox extends EventTarget {checked=false;change(value){this.checked=value;this.dispatchEvent(new Event('change'));}}
function setup(saved=null) {
 const checkbox=new Checkbox(),calls=[],writes=[];
 let selected='selected';
 const storage={getItem:()=>saved,setItem:(key,value)=>writes.push([key,value])};
 const autoplay=mountAutoplay(checkbox,{storage,getSelected:()=>selected,onPlay:id=>calls.push(id)});
 return {checkbox,autoplay,calls,writes,select:id=>selected=id};
}
test('autoplay defaults on without playing on initialization, and repeated selection restarts',()=>{
 const s=setup();assert.equal(s.checkbox.checked,true);assert.deepEqual(s.calls,[]);
 s.autoplay.select('one');s.autoplay.select('one');s.autoplay.select('two');s.autoplay.select(undefined);
 assert.deepEqual(s.calls,['one','one','two']);s.autoplay.destroy();
});
test('saved preference restores, enabling plays selected, disabling preserves playback',()=>{
 const s=setup('false');assert.equal(s.checkbox.checked,false);s.autoplay.select('one');assert.deepEqual(s.calls,[]);
 s.checkbox.change(true);assert.deepEqual(s.calls,['selected']);s.checkbox.change(false);s.autoplay.select('two');
 assert.deepEqual(s.calls,['selected']);assert.deepEqual(s.writes,[['nest.editor.autoplay','true'],['nest.editor.autoplay','false']]);
 s.select(undefined);s.checkbox.change(true);assert.deepEqual(s.calls,['selected']);s.autoplay.destroy();
});
test('unavailable or failing storage leaves autoplay usable and listener teardown is terminal',()=>{
 for(const storage of [null,{getItem(){throw Error('blocked');},setItem(){throw Error('quota');}}]) {
  const checkbox=new Checkbox(),calls=[];
  const autoplay=mountAutoplay(checkbox,{storage,getSelected:()=> 'selected',onPlay:id=>calls.push(id)});
  assert.equal(checkbox.checked,true);checkbox.change(false);checkbox.change(true);assert.deepEqual(calls,['selected']);
  autoplay.destroy();checkbox.change(true);assert.deepEqual(calls,['selected']);
 }
});
test('a failed playback attempt does not disable later autoplay selections',()=>{
 const checkbox=new Checkbox();let error='';const calls=[];
 const autoplay=mountAutoplay(checkbox,{storage:null,getSelected:()=> 'invalid',onPlay:id=>{
  calls.push(id);if(id==='invalid'){error='Fix validation errors';return false;}
  return true;
 }});
 checkbox.change(true);assert.equal(error,'Fix validation errors');autoplay.select('valid');
 assert.deepEqual(calls,['invalid','valid']);assert.equal(autoplay.enabled,true);autoplay.destroy();
});

test('slash keeps toggling after enabling Autoplay moves focus from graph into preview',async()=>{
 const {mountViewShortcuts}=await import('../studio/view-shortcuts.js');
 const root=new EventTarget(),checkbox=new Checkbox();let focus='graph';
 const autoplay=mountAutoplay(checkbox,{storage:{getItem:()=> 'false',setItem(){}},getSelected:()=> 'selected',onPlay:()=>{focus='preview';}});
 root.closest=selector=>focus==='preview'&&selector.split(',').includes('#preview-window')?{}:null;
 const stop=mountViewShortcuts(root,{toggleAutoplay:()=>checkbox.change(!checkbox.checked)});
 for(const expected of [true,false,true,false]){
  const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'/'});
  root.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.equal(autoplay.enabled,expected);assert.equal(checkbox.checked,expected);
 }
 stop();autoplay.destroy();
});
