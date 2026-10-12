import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountPreviewWindow} from '../studio/preview-window.js';

class Element extends EventTarget {
 constructor(){super();this.attributes=new Map();this.styles=new Map();this.classes=new Set();this.listeners=new Map();this.hidden=false;this.focused=false;this.captures=new Set();this.inert=false;
  this.style={setProperty:(name,value)=>this.styles.set(name,value),removeProperty:name=>{this.styles.delete(name);delete this.style[name];}};
  this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
 }
 setAttribute(name,value){this.attributes.set(name,value);}
 removeAttribute(name){this.attributes.delete(name);}
 getAttribute(name){return this.attributes.get(name)??null;}
 focus(){this.focused=true;}
 addEventListener(name,callback){super.addEventListener(name,callback);const set=this.listeners.get(name)??new Set();set.add(callback);this.listeners.set(name,set);}
 removeEventListener(name,callback){super.removeEventListener(name,callback);this.listeners.get(name)?.delete(callback);}
 setPointerCapture(id){this.captures.add(id);}
 hasPointerCapture(id){return this.captures.has(id);}
 releasePointerCapture(id){this.captures.delete(id);emit(this,'lostpointercapture',{pointerId:id});}
}
function emit(element,name,values={}){const event=new Event(name,{cancelable:true});Object.assign(event,values);element.dispatchEvent(event);return event;}
function fixture(){
 const root=new Element(),handle=new Element(),close=new Element(),toggle=new Element(),body=new Element(),viewport=new Element();
 viewport.innerWidth=1000;viewport.innerHeight=800;globalThis.window=viewport;
 root.hidden=true;root.style.left='24px';root.style.top='100px';
 root.querySelector=selector=>({'[data-preview-drag]':handle,'[data-preview-close]':close,'[data-preview-minimize]':toggle,'.preview-window-body':body})[selector];
 body.getBoundingClientRect=()=>({height:root.classes.has('minimized')?parseFloat(root.styles.get('--preview-body-height')):Math.min(440,viewport.innerHeight-66)});
 root.getBoundingClientRect=()=>({left:parseFloat(root.style.left),top:parseFloat(root.style.top),width:Math.min(420,viewport.innerWidth-16),height:root.classes.has('minimized')?50:body.getBoundingClientRect().height+50});
 let closes=0;const api=mountPreviewWindow(root,{onClose:()=>closes++});
 return {root,handle,close,toggle,body,viewport,api,get closes(){return closes;}};
}

test('minimization keeps layout dimensions, hides interactions and focuses its toggle',()=>{
 const f=fixture();f.api.show();const before=f.body.getBoundingClientRect().height;
 emit(f.toggle,'click');assert.equal(f.api.minimized,true);assert.equal(f.root.hidden,false);
 assert.equal(f.root.styles.get('--preview-body-height'),`${before}px`);assert.equal(f.body.getBoundingClientRect().height,before);
 assert.equal(f.root.getBoundingClientRect().height,50);assert.equal(f.body.inert,true);assert.equal(f.body.getAttribute('aria-hidden'),'true');
 assert.equal(f.toggle.getAttribute('aria-expanded'),'false');assert.equal(f.toggle.getAttribute('aria-label'),'Restore interaction preview');assert.equal(f.toggle.focused,true);assert.equal(f.closes,0);
 f.api.minimize();assert.equal(f.root.styles.get('--preview-body-height'),`${before}px`);
 emit(f.toggle,'click');assert.equal(f.api.minimized,false);assert.equal(f.body.inert,false);assert.equal(f.body.getAttribute('aria-hidden'),null);assert.equal(f.root.styles.has('--preview-body-height'),false);assert.equal(f.toggle.getAttribute('aria-expanded'),'true');assert.equal(f.closes,0);f.api.destroy();
});

test('automatic show preserves minimization; manual show restores; close resets and calls onClose',()=>{
 const f=fixture();f.api.minimize();assert.equal(f.api.minimized,false);
 f.api.show();f.api.minimize();f.api.show({restore:false});assert.equal(f.api.minimized,true);assert.equal(f.body.inert,true);assert.equal(f.closes,0);
 f.api.show();assert.equal(f.api.minimized,false);assert.equal(f.body.inert,false);
 f.api.minimize();emit(f.close,'click');assert.equal(f.closes,1);assert.equal(f.root.hidden,true);assert.equal(f.api.minimized,false);assert.equal(f.body.inert,false);assert.equal(f.root.styles.has('--preview-body-height'),false);
 f.api.show({restore:false});assert.equal(f.root.hidden,false);assert.equal(f.api.minimized,false);f.api.destroy();assert.equal(f.closes,1);
});

test('minimized header drags and keyboard movement clamps to its own bounds',()=>{
 const f=fixture();f.api.show();f.api.minimize();
 const down=emit(f.handle,'pointerdown',{button:0,isPrimary:true,pointerId:1,clientX:20,clientY:20});assert.equal(down.defaultPrevented,true);assert.equal(f.handle.hasPointerCapture(1),true);
 emit(f.handle,'pointermove',{pointerId:2,clientX:2000,clientY:2000});assert.equal(f.root.style.top,'100px');
 emit(f.handle,'pointermove',{pointerId:1,clientX:2000,clientY:2000});assert.equal(f.root.style.left,'572px');assert.equal(f.root.style.top,'742px');
 emit(f.handle,'pointerup',{pointerId:1});assert.equal(f.handle.hasPointerCapture(1),false);assert.equal(f.root.classList.contains('dragging'),false);
 emit(f.handle,'keydown',{key:'ArrowLeft',shiftKey:true});assert.equal(f.root.style.left,'532px');
 emit(f.handle,'pointerdown',{button:0,pointerId:3,clientX:20,clientY:20});emit(f.handle,'pointermove',{pointerId:3,clientX:-2000,clientY:-2000});assert.equal(f.root.style.left,'8px');assert.equal(f.root.style.top,'8px');
 emit(f.handle,'pointercancel',{pointerId:3});assert.equal(f.handle.hasPointerCapture(3),false);f.api.destroy();
});

test('resize keeps minimized state and body height current; restore clamps expanded window',()=>{
 const f=fixture();f.api.show();f.api.minimize();f.root.style.left='900px';f.root.style.top='700px';f.viewport.innerWidth=360;f.viewport.innerHeight=300;
 emit(f.viewport,'resize');assert.equal(f.api.minimized,true);assert.equal(f.body.inert,true);assert.equal(f.root.styles.get('--preview-body-height'),'234px');assert.equal(f.root.style.left,'8px');assert.equal(f.root.style.top,'242px');assert.equal(f.body.style.visibility,undefined);
 f.api.restore();assert.equal(f.root.style.top,'8px');assert.equal(f.body.inert,false);assert.equal(f.root.styles.has('--preview-body-height'),false);
 f.api.hide();f.root.style.top='123px';emit(f.viewport,'resize');assert.equal(f.root.style.top,'123px');f.api.destroy();
});

test('non-primary input is ignored and close/destroy safely release capture and remove listeners',()=>{
 const f=fixture();f.api.show();emit(f.handle,'pointerdown',{button:2,pointerId:1});emit(f.handle,'pointerdown',{button:0,isPrimary:false,pointerId:2});assert.equal(f.handle.captures.size,0);
 emit(f.handle,'pointerdown',{button:0,pointerId:3,clientX:20,clientY:20});f.api.hide();assert.equal(f.handle.captures.size,0);assert.equal(f.closes,1);
 f.api.show();emit(f.handle,'pointerdown',{button:0,pointerId:4,clientX:20,clientY:20});f.api.destroy();assert.equal(f.handle.captures.size,0);assert.equal(f.root.classList.contains('dragging'),false);
 for(const element of [f.handle,f.close,f.toggle,f.viewport])for(const listeners of element.listeners.values())assert.equal(listeners.size,0);
 emit(f.toggle,'click');emit(f.close,'click');assert.equal(f.api.minimized,false);assert.equal(f.closes,1);
});

test('CSS collapses only the host and suppresses fixed descendant overlays without display:none',()=>{
 const css=readFileSync(new URL('../studio/editor.css',import.meta.url),'utf8');
 assert.match(css,/\.preview-window-body\s*\{[^}]*background:#000/);
 assert.match(css,/\.preview-window #preview\s*\{[^}]*background:#000/);
 assert.match(css,/\.preview-window-bar\s*\{[^}]*position:relative[^}]*z-index:5001/);
 assert.match(css,/\.preview-window\.minimized \.preview-window-body\s*\{[^}]*position:absolute[^}]*height:var\(--preview-body-height\)[^}]*visibility:hidden/);
 assert.match(css,/\.preview-window\.minimized \.preview-window-body \*\s*\{visibility:hidden!important;/);
 assert.doesNotMatch(css,/\.preview-window\.minimized[^}]*display:none/);
});
