import test from 'node:test';
import assert from 'node:assert/strict';
import {mountViewShortcuts,typingControls} from '../studio/view-shortcuts.js';

function fixture({enabled=true,visible=true,windowCapture=false}={}) {
 const calls=[],root=new EventTarget(),host=windowCapture?new EventTarget():root;
 if(windowCapture)root.defaultView=host;
 const stop=mountViewShortcuts(root,{
  enabled:()=>enabled,
  switchView:()=>calls.push('view'),
  togglePreview:()=>{if(!visible)return false;calls.push('preview');},
  toggleAutoplay:()=>calls.push('autoplay'),
 });
 function key(key,properties={},context=null){
  host.closest=selector=>context&&selector.split(',').includes(context)?{}:null;
  const event=new Event('keydown',{cancelable:true});
  Object.assign(event,{key,...properties});host.dispatchEvent(event);return event;
 }
 return {calls,stop,key};
}

test('assigned keys work from buttons, summaries, panels and preview without native activation',()=>{
 for(const context of [null,'button','a[href]','summary','label','[role="button"]','[role="checkbox"]','[role="slider"]','#library-panel','#preview-window','dialog','[role="dialog"]']){
  const f=fixture();
  for(const key of ['Tab',' ','/'])assert.equal(f.key(key,{},context).defaultPrevented,true,context);
  assert.deepEqual(f.calls,['view','preview','autoplay']);f.stop();
 }
});

test('typing fields retain native editing and do not run editor shortcuts',()=>{
 for(const context of typingControls.split(',')){
  const f=fixture();
  for(const key of ['Tab',' ','/'])assert.equal(f.key(key,{},context).defaultPrevented,false,context);
  assert.deepEqual(f.calls,[]);f.stop();
 }
});

test('disabled actions, repeats, and Shift variants cannot fall through to focus traversal or clicks',()=>{
 for(const options of [{enabled:false},{}])for(const properties of [{},{repeat:true},{shiftKey:true}]){
  const f=fixture(options);
  for(const key of ['Tab',' ','/'])assert.equal(f.key(key,properties,'button').defaultPrevented,true);
  if(options.enabled===false||properties.repeat||properties.shiftKey)assert.deepEqual(f.calls,[]);
  f.stop();
 }
 const f=fixture({visible:false});assert.equal(f.key(' ').defaultPrevented,true);assert.deepEqual(f.calls,[]);
});

test('browser modifiers and IME composition remain untouched',()=>{
 for(const key of ['Tab',' ','/'])for(const flag of ['ctrlKey','metaKey','altKey','isComposing']){
  const f=fixture();assert.equal(f.key(key,{[flag]:true}).defaultPrevented,false);assert.deepEqual(f.calls,[]);f.stop();
 }
});

test('capture uses the document window before panel handlers and cleanup removes it',()=>{
 const f=fixture({windowCapture:true});
 assert.equal(f.key('Tab').defaultPrevented,true);assert.deepEqual(f.calls,['view']);
 f.stop();assert.equal(f.key('Tab').defaultPrevented,false);assert.equal(f.key(' ').defaultPrevented,false);
 assert.deepEqual(f.calls,['view']);
});

test('already handled and unrelated keys never trigger view actions',()=>{
 const root=new EventTarget(),calls=[];
 root.addEventListener('keydown',event=>event.preventDefault());
 mountViewShortcuts(root,{switchView:()=>calls.push('view'),togglePreview:()=>calls.push('preview')});
 for(const key of ['Tab',' ']){const event=new Event('keydown',{cancelable:true});Object.assign(event,{key});root.dispatchEvent(event);}
 assert.deepEqual(calls,[]);
 const f=fixture();assert.equal(f.key('Enter').defaultPrevented,false);assert.deepEqual(f.calls,[]);
});
