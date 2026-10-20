import test from 'node:test';
import assert from 'node:assert/strict';
import {mountViewShortcuts} from '../studio/view-shortcuts.js';

function fixture({enabled=true,selection='',visible=true,libraryActive}={}) {
 const calls=[],root=new EventTarget();
 root.getSelection=()=>({toString:()=>selection});
 const stop=mountViewShortcuts(root,{
  ...(libraryActive===undefined?{}:{libraryActive:()=>libraryActive}),
  enabled:()=>enabled,
  switchView:()=>{calls.push('view');},
  togglePreview:()=>{if(!visible)return false;calls.push('preview');},
  toggleAutoplay:()=>{calls.push('autoplay');},
 });
 function key(key,properties={},context=null){
  // Use the event target's ancestor lookup, as browser events do.
  const contexts=Array.isArray(context)?context:[context];
  root.closest=selector=>contexts.some(context=>context&&selector.split(',').includes(context))?{}:null;
  const event=new Event('keydown',{cancelable:true});
  Object.assign(event,{key,...properties});root.dispatchEvent(event);return event;
 }
 return {calls,stop,key};
}

test('Tab switches views and Space toggles a visible preview; cleanup removes both shortcuts',()=>{
 const f=fixture();
 assert.equal(f.key('Tab').defaultPrevented,true);
 assert.equal(f.key(' ').defaultPrevented,true);
 assert.deepEqual(f.calls,['view','preview']);
 f.stop();assert.equal(f.key('Tab').defaultPrevented,false);assert.equal(f.key(' ').defaultPrevented,false);
 assert.deepEqual(f.calls,['view','preview']);
});

test('editing fields, native activation controls, widgets and dialogs retain Tab and Space',()=>{
 for(const context of ['input','textarea','select','button','a[href]','summary','label','audio','video','iframe',
  '[contenteditable]:not([contenteditable="false"])','[role="textbox"]','[role="button"]','[role="checkbox"]',
  '[role="radio"]','[role="switch"]','[role="slider"]','[role="spinbutton"]','[role="combobox"]',
  '[role="listbox"]','[role="menu"]','[role="tablist"]','[role="tree"]','[role="grid"]','dialog','[role="dialog"]']){
  const f=fixture();
  assert.equal(f.key('Tab',{},context).defaultPrevented,false,context);
  assert.equal(f.key(' ',{},context).defaultPrevented,false,context);
  assert.deepEqual(f.calls,[],context);f.stop();
 }
});

test('preview Tab navigation stays native while its non-interactive deck can collapse with Space',()=>{
 const f=fixture();
 assert.equal(f.key('Tab',{},'#preview-window').defaultPrevented,false);
 assert.equal(f.key(' ',{},'#preview-window').defaultPrevented,true);
 assert.deepEqual(f.calls,['preview']);
});

test('Library Tab switches views after buttons, cards, checkboxes and other simple controls receive focus',()=>{
 for(const context of ['button','input','a[href]','summary','label','[role="button"]','[role="checkbox"]','[role="radio"]','[role="switch"]']){
  const f=fixture(),contexts=['#library-panel',context];
  assert.equal(f.key('Tab',{},contexts).defaultPrevented,true,context);
  assert.deepEqual(f.calls,['view'],context);
  assert.equal(f.key(' ',{},contexts).defaultPrevented,false,context);
  assert.deepEqual(f.calls,['view'],context);f.stop();
 }
});

test('Library editing and compound widgets retain native Tab navigation',()=>{
 for(const context of ['input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'textarea','select','[contenteditable]:not([contenteditable="false"])','[role="textbox"]','[role="slider"]',
  '[role="spinbutton"]','[role="combobox"]','[role="listbox"]','[role="menu"]','[role="tablist"]','[role="tree"]',
  '[role="grid"]','dialog','[role="dialog"]']){
  const f=fixture();
  assert.equal(f.key('Tab',{},['#library-panel',context]).defaultPrevented,false,context);
  assert.deepEqual(f.calls,[],context);f.stop();
 }
});

test('Library mode keeps Tab switching after toolbar or inspector controls outside its panel',()=>{
 const f=fixture({libraryActive:true});
 assert.equal(f.key('Tab',{},'button').defaultPrevented,true);
 assert.equal(f.key('Tab',{},'input').defaultPrevented,true);
 assert.equal(f.key('Tab',{},'textarea').defaultPrevented,false);
 assert.equal(f.key('Tab',{},'#preview-window').defaultPrevented,false);
 assert.deepEqual(f.calls,['view','view']);
});

test('modifiers, composition, repeats, text selections and active gestures leave keys alone',()=>{
 for(const key of ['Tab',' ','/'])for(const flag of ['ctrlKey','metaKey','altKey','shiftKey','repeat','isComposing']){
  const f=fixture();assert.equal(f.key(key,{[flag]:true}).defaultPrevented,false);assert.deepEqual(f.calls,[]);
 }
 for(const options of [{enabled:false},{selection:'selected text'}]){
  const f=fixture(options);
  assert.equal(f.key('Tab').defaultPrevented,false);assert.equal(f.key(' ').defaultPrevented,false);assert.deepEqual(f.calls,[]);
 }
});

test('hidden preview does not consume Space or open the preview',()=>{
 const f=fixture({visible:false});assert.equal(f.key(' ').defaultPrevented,false);assert.deepEqual(f.calls,[]);
 assert.equal(f.key('Tab').defaultPrevented,true);assert.deepEqual(f.calls,['view']);
});

test('already handled events and unrelated keys never trigger view actions',()=>{
 const root=new EventTarget(),calls=[];
 root.addEventListener('keydown',event=>event.preventDefault());
 mountViewShortcuts(root,{switchView:()=>calls.push('view'),togglePreview:()=>calls.push('preview')});
 for(const key of ['Tab',' ']){const event=new Event('keydown',{cancelable:true});Object.assign(event,{key});root.dispatchEvent(event);}
 assert.deepEqual(calls,[]);
 const f=fixture();assert.equal(f.key('Enter').defaultPrevented,false);assert.deepEqual(f.calls,[]);
});

test('slash toggles Autoplay from graph or buttons and cleanup removes the shortcut',()=>{
 const f=fixture();
 assert.equal(f.key('/').defaultPrevented,true);
 assert.equal(f.key('/',{},'button').defaultPrevented,true);
 assert.deepEqual(f.calls,['autoplay','autoplay']);f.stop();
 assert.equal(f.key('/').defaultPrevented,false);assert.deepEqual(f.calls,['autoplay','autoplay']);
});

test('slash preserves typing, dialogs, selected text and disabled contexts',()=>{
 for(const context of ['input','textarea','select','[contenteditable]:not([contenteditable="false"])','[role="textbox"]','dialog','[role="dialog"]']){
  const f=fixture();assert.equal(f.key('/',{},context).defaultPrevented,false,context);assert.deepEqual(f.calls,[]);f.stop();
 }
 for(const options of [{enabled:false},{selection:'selected text'}]){
  const f=fixture(options);assert.equal(f.key('/').defaultPrevented,false);assert.deepEqual(f.calls,[]);f.stop();
 }
});
