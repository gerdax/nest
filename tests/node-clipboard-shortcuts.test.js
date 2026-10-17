import test from 'node:test';
import assert from 'node:assert/strict';
import {mountNodeClipboardShortcuts} from '../studio/node-clipboard-shortcuts.js';

function fixture({enabled=true,selection='',handled=true}={}){
 let listener;const calls=[];
 const root={getSelection:()=>({toString:()=>selection}),addEventListener:(name,fn)=>{listener=fn;},removeEventListener:(name,fn)=>{assert.equal(fn,listener);listener=null;}};
 const destroy=mountNodeClipboardShortcuts(root,{enabled:()=>enabled,...Object.fromEntries(['copy','cut','paste','duplicate'].map(action=>[action,()=>{calls.push(action);return handled;}]))});
 const key=values=>{const event={key:'c',metaKey:true,target:{closest:()=>null},preventDefault(){this.prevented=true;},...values};listener(event);return event;};
 return {key,calls,destroy,get listener(){return listener;}};
}

for(const [key,action] of [['c','copy'],['x','cut'],['v','paste'],['d','duplicate']])for(const modifier of ['metaKey','ctrlKey']){
 test(`${modifier} ${key} invokes beat ${action}`,()=>{
  const f=fixture(),event=f.key({key:key.toUpperCase(),metaKey:false,[modifier]:true});
  assert.deepEqual(f.calls,[action]);assert.equal(event.prevented,true);f.destroy();
 });
}

test('node shortcuts preserve typing, selections, preview, composition and other key combinations',()=>{
 for(const guard of [{target:{closest:()=>({})}},{defaultPrevented:true},{repeat:true},{isComposing:true},{altKey:true},{shiftKey:true},{metaKey:false},{key:'z'}]){
  const f=fixture(),event=f.key(guard);assert.deepEqual(f.calls,[]);assert.equal(event.prevented,undefined);f.destroy();
 }
 for(const options of [{enabled:false},{selection:'Selected text'}]){
  const f=fixture(options),event=f.key({});assert.deepEqual(f.calls,[]);assert.equal(event.prevented,undefined);f.destroy();
 }
});

test('unavailable clipboard actions do not consume shortcuts and cleanup removes the listener',()=>{
 const f=fixture({handled:false});assert.equal(f.key({key:'v'}).prevented,undefined);
 f.destroy();assert.equal(f.listener,null);
});
