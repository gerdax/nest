import test from 'node:test';
import assert from 'node:assert/strict';
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

test('Command/Control+Enter outside fields does nothing',()=>{
 for(const modifier of ['metaKey','ctrlKey']){
  const f=fixture();assert.equal(f.key({shiftKey:false,[modifier]:true}).defaultPrevented,false);
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
 const f=fixture({enabled:false,field:true});assert.equal(f.key().defaultPrevented,false);assert.deepEqual(f.calls,[]);f.stop();
});

test('commit shortcut leaves interaction preview alone',()=>{
 const f=fixture({field:true});assert.equal(f.key({shiftKey:false,metaKey:true},'#preview-window').defaultPrevented,false);
 assert.deepEqual(f.calls,[]);f.stop();
});

test('plain Enter, mixed modifiers, composition and repeat keep native behavior',()=>{
 for(const properties of [{shiftKey:false},{key:' '},{metaKey:true},{ctrlKey:true},{altKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true}]){
  const f=fixture({field:true});f.key(properties);assert.deepEqual(f.calls,[]);f.stop();
 }
});

test('play consumes Enter even if playback fails so focused controls cannot change cards',()=>{
 const f=fixture({handled:false});assert.equal(f.key().defaultPrevented,true);f.stop();
});
