import test from 'node:test';
import assert from 'node:assert/strict';
import {mountProjectSettingsWindow} from '../studio/project-settings-window.js';

class Element extends EventTarget {
 constructor(doc,tagName='DIV') {
  super();this.ownerDocument=doc;this.tagName=tagName;this.children=[];this.attributes=new Map();this.listeners=new Map();
  this.hidden=false;this.inert=false;this.disabled=false;this.tabIndex=tagName==='BUTTON'?0:-1;this.isConnected=true;this.visible=true;
  const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
 }
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 contains(target){return target===this||this.children.some(child=>child.contains(target));}
 setAttribute(name,value){this.attributes.set(name,value);}
 getAttribute(name){return this.attributes.get(name)??null;}
 closest(){for(let el=this;el;el=el.parentElement)if(el.hidden||el.inert)return el;return null;}
 getClientRects(){return this.visible?[{}]:[];}
 querySelectorAll(){return this.children.flatMap(child=>[...(child.tagName==='BUTTON'||child.tagName==='INPUT'||child.attributes.has('tabindex')?[child]:[]),...child.querySelectorAll()]);}
 focus(){this.ownerDocument.activeElement=this;emit(this.ownerDocument,'focusin',{target:this});}
 addEventListener(name,callback,options){super.addEventListener(name,callback,options);const set=this.listeners.get(name)??new Set();set.add(callback);this.listeners.set(name,set);}
 removeEventListener(name,callback,options){super.removeEventListener(name,callback,options);this.listeners.get(name)?.delete(callback);}
}
function emit(element,name,values={}) {
 const event=new Event(name,{cancelable:true});
 for(const [key,value] of Object.entries(values))Object.defineProperty(event,key,{value});
 element.dispatchEvent(event);return event;
}
function fixture() {
 const doc=new Element(null);doc.ownerDocument=doc;
 const body=doc.body=new Element(doc),background=new Element(doc),alreadyInert=new Element(doc),script=new Element(doc,'SCRIPT');
 const trigger=new Element(doc,'BUTTON'),overlay=new Element(doc),dialog=new Element(doc),closeButton=new Element(doc,'BUTTON'),setting=new Element(doc,'INPUT');
 const preview=new Element(doc),previewFirst=new Element(doc,'BUTTON'),previewLast=new Element(doc,'BUTTON');
 setting.tabIndex=0;dialog.attributes.set('tabindex','-1');overlay.hidden=true;alreadyInert.inert=true;
 background.append(trigger);dialog.append(closeButton,setting);overlay.append(dialog);preview.append(previewFirst,previewLast);
 body.append(background,alreadyInert,overlay,preview,script);
 overlay.querySelector=selector=>({'[role="dialog"]':dialog,'[data-close-project-settings]':closeButton})[selector];
 doc.activeElement=trigger;let opens=0;
 const api=mountProjectSettingsWindow(overlay,{trigger,preview,onOpen:()=>opens++});
 return {doc,body,background,alreadyInert,script,trigger,overlay,dialog,closeButton,setting,preview,previewFirst,previewLast,api,get opens(){return opens;}};
}
function key(f,key,options={}){return emit(f.doc,'keydown',{key,target:f.doc.activeElement,...options});}

test('opening blocks editor siblings, preserves preview interaction and contains outside focus',()=>{
 const f=fixture();emit(f.trigger,'click');
 assert.equal(f.overlay.hidden,false);assert.equal(f.trigger.getAttribute('aria-expanded'),'true');assert.equal(f.opens,1);
 assert.equal(f.background.inert,true);assert.equal(f.alreadyInert.inert,true);assert.equal(f.preview.inert,false);assert.equal(f.script.inert,false);
 assert.equal(f.body.classList.contains('project-settings-open'),true);assert.equal(f.doc.activeElement,f.closeButton);
 f.api.open();assert.equal(f.opens,1,'opening an open window is idempotent');
 f.previewFirst.focus();assert.equal(f.doc.activeElement,f.previewFirst);
 f.trigger.focus();assert.equal(f.doc.activeElement,f.dialog,'outside focus is redirected');
 f.api.destroy();
});

for(const method of ['button','backdrop','Escape','api'])test(`${method} close restores prior inert state and focus`,()=>{
 const f=fixture();f.api.open();f.setting.focus();
 emit(f.overlay,'click',{target:f.setting});assert.equal(f.overlay.hidden,false,'content click keeps window open');
 if(method==='button')emit(f.closeButton,'click');
 else if(method==='backdrop')emit(f.overlay,'click');
 else if(method==='Escape'){const event=key(f,'Escape');assert.equal(event.defaultPrevented,true);}
 else f.api.close();
 assert.equal(f.overlay.hidden,true);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');
 assert.equal(f.background.inert,false);assert.equal(f.alreadyInert.inert,true);assert.equal(f.preview.inert,false);
 assert.equal(f.doc.activeElement,f.trigger);assert.equal(f.body.classList.contains('project-settings-open'),false);
 f.api.close();assert.equal(f.doc.activeElement,f.trigger);f.api.destroy();
});

test('Escape in the preview leaves settings open so preview handlers can respond',()=>{
 const f=fixture();f.api.open();f.previewFirst.focus();
 assert.equal(key(f,'Escape').defaultPrevented,false);assert.equal(f.overlay.hidden,false);
 f.api.destroy();
});

test('Tab wraps across the settings and visible preview controls in both directions',()=>{
 const f=fixture();f.api.open();
 const shift=key(f,'Tab',{shiftKey:true});assert.equal(shift.defaultPrevented,true);assert.equal(f.doc.activeElement,f.previewLast);
 const forward=key(f,'Tab');assert.equal(forward.defaultPrevented,true);assert.equal(f.doc.activeElement,f.closeButton);
 f.setting.focus();assert.equal(key(f,'Tab').defaultPrevented,false,'interior Tab keeps native traversal');
 f.dialog.focus();assert.equal(key(f,'Tab').defaultPrevented,true);assert.equal(f.doc.activeElement,f.closeButton);
 f.api.destroy();
});

test('Tab ignores hidden, inert, disabled, negative-tabindex and unrendered controls',()=>{
 const f=fixture();
 for(const kind of ['hidden','inert','disabled','negative','unrendered']) {
  const control=new Element(f.doc,'BUTTON');
  if(kind==='negative')control.tabIndex=-1;
  else if(kind==='unrendered')control.visible=false;
  else control[kind]=true;
  f.preview.append(control);
 }
 const hiddenParent=new Element(f.doc),hiddenChild=new Element(f.doc,'BUTTON');hiddenParent.hidden=true;hiddenParent.append(hiddenChild);f.preview.append(hiddenParent);
 f.api.open();f.previewLast.focus();assert.equal(key(f,'Tab').defaultPrevented,true);assert.equal(f.doc.activeElement,f.closeButton);
 f.closeButton.focus();key(f,'Tab',{shiftKey:true});assert.equal(f.doc.activeElement,f.previewLast);
 f.preview.hidden=true;f.setting.focus();assert.equal(key(f,'Tab').defaultPrevented,true);assert.equal(f.doc.activeElement,f.closeButton);
 f.closeButton.disabled=true;f.setting.disabled=true;assert.equal(key(f,'Tab').defaultPrevented,true);assert.equal(f.doc.activeElement,f.dialog,'empty focus list falls back to dialog');
 f.api.destroy();
});

test('destroy closes the window and removes every registered listener',()=>{
 const f=fixture();f.api.open();f.api.destroy();
 assert.equal(f.overlay.hidden,true);assert.equal(f.background.inert,false);assert.equal(f.alreadyInert.inert,true);assert.equal(f.doc.activeElement,f.trigger);
 for(const element of [f.trigger,f.closeButton,f.overlay,f.doc])for(const listeners of element.listeners.values())assert.equal(listeners.size,0);
 emit(f.trigger,'click');assert.equal(f.overlay.hidden,true);assert.equal(f.opens,1);
 f.setting.focus();assert.equal(f.doc.activeElement,f.setting);assert.equal(key(f,'Tab').defaultPrevented,false);assert.equal(key(f,'Escape').defaultPrevented,false);
 f.api.destroy();
});

test('closing skips focus restoration when the previous element was disconnected',()=>{
 const f=fixture();f.api.open();f.trigger.isConnected=false;f.api.close();assert.equal(f.doc.activeElement,f.closeButton);f.api.destroy();
});
