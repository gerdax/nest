import test from 'node:test';
import assert from 'node:assert/strict';
import {typingControls} from '../studio/view-shortcuts.js';
import {mountPlayShortcuts} from '../studio/play-shortcuts.js';

function fixture({enabled=true,handled=true,field=false}={}) {
 const root=new EventTarget(),calls=[];
 const stop=mountPlayShortcuts(root,{enabled:()=>enabled,
  commitField:()=>{if(!field)return false;calls.push('commit');return true;},
  playSelected:()=>{calls.push('play');return handled;}});
 const key=(properties={},context=null)=>{
  root.closest=selector=>context&&selector.split(',').includes(context)?{}:null;
  const event=new Event('keydown',{cancelable:true});
  const {defaultPrevented,...keys}=properties;
  Object.assign(event,{key:'Enter',shiftKey:true,...keys});
  if(defaultPrevented)event.preventDefault();
  root.dispatchEvent(event);return event;
 };
 return {key,calls,stop};
}

for(const modifier of ['metaKey','ctrlKey'])test(`${modifier}+Enter commits a field without playing, even outside chapter view`,()=>{
 const f=fixture({field:true,enabled:false});
 assert.equal(f.key({shiftKey:false,[modifier]:true}).defaultPrevented,true);
 assert.deepEqual(f.calls,['commit']);f.stop();
});

test('Command/Control+Enter outside fields is reserved without acting',()=>{
 for(const modifier of ['metaKey','ctrlKey']){
  const f=fixture();assert.equal(f.key({shiftKey:false,[modifier]:true}).defaultPrevented,true);
  assert.deepEqual(f.calls,[]);f.stop();
 }
});

test('Shift+Enter plays without committing the field; cleanup removes the shortcut',()=>{
 const f=fixture({field:true});assert.equal(f.key().defaultPrevented,true);
 assert.deepEqual(f.calls,['play']);f.stop();
 assert.equal(f.key().defaultPrevented,false);assert.deepEqual(f.calls,['play']);
});

test('Shift+Enter also plays when no field is focused',()=>{
 const f=fixture();assert.equal(f.key().defaultPrevented,true);
 assert.deepEqual(f.calls,['play']);f.stop();
});

test('play works in fields, dialogs and preview without committing',()=>{
 for(const context of ['input','textarea','summary','dialog','[role="dialog"]','#preview-window']){
  const f=fixture({field:true});assert.equal(f.key({},context).defaultPrevented,true);
  assert.deepEqual(f.calls,['play']);f.stop();
 }
 const f=fixture({enabled:false,field:true});assert.equal(f.key().defaultPrevented,true);assert.deepEqual(f.calls,[]);f.stop();
});

test('commit shortcut leaves interaction preview alone',()=>{
 const f=fixture({field:true});assert.equal(f.key({shiftKey:false,metaKey:true},'#preview-window').defaultPrevented,true);
 assert.deepEqual(f.calls,[]);f.stop();
});

test('unassigned keys, mixed modifiers, composition and repeats never run play',()=>{
 for(const properties of [{shiftKey:false},{key:' '},{metaKey:true},{ctrlKey:true},{altKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true}]){
  const f=fixture({field:true});f.key(properties);assert.deepEqual(f.calls,[]);f.stop();
 }
});

test('play consumes Enter even if playback fails so focused controls cannot change cards',()=>{
 const f=fixture({handled:false});assert.equal(f.key().defaultPrevented,true);f.stop();
});


test('plain Enter cannot activate a focused panel button or summary',()=>{
 for(const context of ['button','summary','input[type="checkbox"]',null]){
  const f=fixture();assert.equal(f.key({shiftKey:false},context).defaultPrevented,true);
  assert.deepEqual(f.calls,[]);f.stop();
 }
 for(const context of typingControls.split(',')){
  const f=fixture();assert.equal(f.key({shiftKey:false},context).defaultPrevented,false);f.stop();
 }
});

test('preview transport routes from any panel once and preserves text editing',()=>{
 const root=new EventTarget(),host=new EventTarget(),calls=[];root.defaultView=host;
 let context=null;host.closest=selector=>context&&selector.split(',').includes(context)?{}:null;
 const stop=mountPlayShortcuts(root,{playSelected:()=>calls.push('play'),playbackDeck:()=>({key:event=>calls.push(event.key)})});
 const key=(key,properties={})=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key,...properties});host.dispatchEvent(event);return event;};
 for(context of [null,'button','summary','#preview-window'])for(const name of ['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])assert.equal(key(name).defaultPrevented,true);
 assert.equal(calls.length,20);
 context='textarea';assert.equal(key('ArrowLeft').defaultPrevented,false);assert.equal(key('Enter').defaultPrevented,false);assert.equal(calls.length,20);
 context=null;key('Enter',{shiftKey:true});assert.equal(calls.at(-1),'play');
 stop();assert.equal(key('ArrowRight').defaultPrevented,false);
});


test('unavailable and repeating Enter commands cannot leak into playback or native clicks',()=>{
 const f=fixture({enabled:false});
 for(const properties of [{},{repeat:true},{shiftKey:false,ctrlKey:true},{shiftKey:false,metaKey:true,repeat:true}]){
  assert.equal(f.key(properties,'button').defaultPrevented,true);assert.deepEqual(f.calls,[]);
 }
 f.stop();
});

test('global playback does not steal assigned slider and preview movement arrows',()=>{
 const root=new EventTarget();let context,calls=0;
 root.closest=selector=>selector.split(',').includes(context)?{}:null;
 mountPlayShortcuts(root,{playSelected:()=>{},playbackDeck:()=>({key:()=>calls++})});
 for(context of ['input[type="range"]','[role="slider"]','[data-preview-drag]','[role="menu"]','[role="tree"]','[role="listbox"]']){
  const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'ArrowRight'});root.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);assert.equal(calls,0);
 }
});
