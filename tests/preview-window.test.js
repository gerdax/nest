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
 const root=new Element(),handle=new Element(),close=new Element(),toggle=new Element(),body=new Element(),viewport=new Element(),grip=new Element(),reset=new Element(),sizeReadout=new Element(),bar=new Element();
 viewport.innerWidth=1000;viewport.innerHeight=800;globalThis.window=viewport;
 root.hidden=true;root.style.left='24px';root.style.top='100px';
 root.querySelector=selector=>({'[data-preview-drag]':handle,'[data-preview-close]':close,'[data-preview-minimize]':toggle,'.preview-window-body':body,'[data-preview-resize]':grip,'[data-preview-reset]':reset,'[data-preview-size]':sizeReadout,'.preview-window-bar':bar})[selector];
 bar.getBoundingClientRect=()=>({height:50});
 body.getBoundingClientRect=()=>({width:parseFloat(root.styles.get('--preview-custom-width')||420)-2,height:root.classes.has('minimized')?parseFloat(root.styles.get('--preview-body-height')):parseFloat(root.styles.get('--preview-custom-height')||Math.min(440,viewport.innerHeight-66))});
 root.getBoundingClientRect=()=>({left:parseFloat(root.style.left),top:parseFloat(root.style.top),width:Math.min(parseFloat(root.styles.get('--preview-custom-width')||420),viewport.innerWidth-16),height:root.classes.has('minimized')?50:body.getBoundingClientRect().height+50});
 let closes=0;const api=mountPreviewWindow(root,{onClose:()=>closes++});
 return {root,handle,close,toggle,body,viewport,grip,reset,sizeReadout,bar,api,get closes(){return closes;}};
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

test('expanded close and reopen stays expanded; visible reports host visibility',()=>{
 const f=fixture();assert.equal(f.api.visible,false);f.api.show();assert.equal(f.api.visible,true);
 emit(f.close,'click');assert.equal(f.closes,1);assert.equal(f.api.visible,false);assert.equal(f.api.minimized,false);
 f.api.show();assert.equal(f.api.visible,true);assert.equal(f.api.minimized,false);assert.equal(f.body.inert,false);f.api.destroy();
});

test('manual and autoplay minimized close/reopen preserve state; explicit show restore expands',()=>{
 for(const mode of ['manual','autoplay']){
  const f=fixture();f.api.show();f.api.minimize();assert.equal(f.api.minimized,true);
  if(mode==='manual')emit(f.close,'click');else f.api.hide();
  assert.equal(f.api.visible,false);assert.equal(f.api.minimized,true);assert.equal(f.body.inert,true);
  f.api.show();assert.equal(f.api.visible,true);assert.equal(f.api.minimized,true);assert.equal(f.body.inert,true);assert.equal(f.closes,1);
  assert.equal(f.root.styles.get('--preview-body-height'),'440px');
  f.api.show({restore:true});assert.equal(f.api.minimized,false);assert.equal(f.body.inert,false);assert.equal(f.root.styles.has('--preview-body-height'),false);f.api.destroy();
 }
});

test('toggle API changes minimized state',()=>{
 const f=fixture();f.api.show();f.api.toggle();assert.equal(f.api.minimized,true);f.api.toggle();assert.equal(f.api.minimized,false);f.api.destroy();
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

test('reopening after hidden viewport resize refreshes body height and clamps without restoring',()=>{
 const f=fixture();f.api.show();f.api.minimize();f.api.hide();
 f.viewport.innerWidth=360;f.viewport.innerHeight=300;emit(f.viewport,'resize');
 assert.equal(f.root.styles.get('--preview-body-height'),'440px');assert.equal(f.root.style.top,'100px');
 f.root.style.left='900px';f.root.style.top='700px';f.api.show();
 assert.equal(f.api.minimized,true);assert.equal(f.body.inert,true);assert.equal(f.body.getAttribute('aria-hidden'),'true');
 assert.equal(f.root.styles.get('--preview-body-height'),'234px');assert.equal(f.root.style.left,'8px');assert.equal(f.root.style.top,'242px');assert.equal(f.body.style.visibility,undefined);
 f.api.destroy();
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
 const playfieldCss=readFileSync(new URL('../studio/playfield.css',import.meta.url),'utf8');
 assert.match(playfieldCss,/\.nest-playfield\s*\{[^}]*background:#000/);
 assert.match(css,/\.preview-window-bar\s*\{[^}]*position:relative[^}]*z-index:5001/);
 assert.match(css,/\.preview-window\.minimized \.preview-window-body\s*\{[^}]*position:absolute[^}]*height:var\(--preview-body-height\)[^}]*visibility:hidden/);
 assert.match(css,/\.preview-window\.minimized \.preview-window-body \*\s*\{visibility:hidden!important;/);
 assert.doesNotMatch(css,/\.preview-window\.minimized[^}]*display:none/);
});

test('80% editor scale preserves preview drag distance, viewport clamping and minimized body size',()=>{
 const f=fixture(),scale=.8;
 f.root.ownerDocument={documentElement:{},defaultView:{getComputedStyle:()=>({zoom:String(scale)})}};
 f.body.getBoundingClientRect=()=>({height:(f.root.classes.has('minimized')?parseFloat(f.root.styles.get('--preview-body-height')):440)*scale});
 f.root.getBoundingClientRect=()=>({left:parseFloat(f.root.style.left)*scale,top:parseFloat(f.root.style.top)*scale,width:420*scale,height:(f.root.classes.has('minimized')?50:490)*scale});
 f.api.show();assert.equal(f.root.style.left,'400px');assert.equal(f.root.style.top,'100px');
 emit(f.handle,'pointerdown',{button:0,pointerId:1,clientX:330,clientY:90});
 emit(f.handle,'pointermove',{pointerId:1,clientX:410,clientY:130});
 assert.equal(f.root.style.left,'500px');assert.equal(f.root.style.top,'150px');
 emit(f.handle,'pointerup',{pointerId:1});
 f.api.minimize();assert.equal(f.root.styles.get('--preview-body-height'),'440px');assert.equal(f.body.getBoundingClientRect().height,352);
 emit(f.handle,'pointerdown',{button:0,pointerId:2,clientX:410,clientY:130});
 emit(f.handle,'pointermove',{pointerId:2,clientX:2000,clientY:2000});
 assert.equal(f.root.getBoundingClientRect().left+f.root.getBoundingClientRect().width,992);
 assert.equal(f.root.getBoundingClientRect().top+f.root.getBoundingClientRect().height,792);
 f.api.destroy();
});

test('free resizing changes the playfield width and height independently and Reset restores defaults',()=>{
 const f=fixture();f.api.show();
 emit(f.grip,'pointerdown',{button:0,isPrimary:true,pointerId:8,clientX:500,clientY:500});
 assert.equal(f.grip.hasPointerCapture(8),true);
 emit(f.grip,'pointermove',{pointerId:8,clientX:540,clientY:480});
 assert.equal(f.root.styles.get('--preview-custom-width'),'460px');assert.equal(f.root.styles.get('--preview-custom-height'),'420px');
 emit(f.grip,'pointerup',{pointerId:8});assert.equal(f.grip.hasPointerCapture(8),false);
 emit(f.grip,'keydown',{key:'ArrowDown',shiftKey:true});assert.equal(f.root.styles.get('--preview-custom-height'),'460px');
 emit(f.reset,'click');assert.equal(f.root.styles.has('--preview-custom-width'),false);assert.equal(f.root.styles.has('--preview-custom-height'),false);
 assert.equal(f.closes,0);f.api.destroy();
});
test('custom viewport is retained through minimizing/reopening and kept within the desktop',()=>{
 const f=fixture();f.api.show();f.api.setSize(390,600);f.api.minimize();
 assert.equal(f.root.styles.get('--preview-body-height'),'600px');f.api.hide();f.api.show();f.api.restore();
 assert.equal(f.root.styles.get('--preview-custom-width'),'392px');assert.equal(f.root.styles.get('--preview-custom-height'),'600px');
 f.viewport.innerWidth=320;f.viewport.innerHeight=400;emit(f.viewport,'resize');
 assert.equal(f.root.styles.get('--preview-custom-width'),'304px');assert.equal(f.root.styles.get('--preview-custom-height'),'332px');
 f.api.resetSize();assert.equal(f.api.minimized,false);f.api.destroy();
});
test('resize cancellation and destruction release pointer capture without closing playback',()=>{
 const f=fixture();f.api.show();emit(f.grip,'pointerdown',{button:0,pointerId:9,clientX:0,clientY:0});
 emit(f.grip,'pointercancel',{pointerId:9});assert.equal(f.grip.hasPointerCapture(9),false);
 emit(f.grip,'pointerdown',{button:0,pointerId:10,clientX:0,clientY:0});f.api.destroy();assert.equal(f.grip.hasPointerCapture(10),false);
 for(const element of [f.grip,f.reset])for(const listeners of element.listeners.values())assert.equal(listeners.size,0);
 assert.equal(f.closes,0);
});

test('free resize converts pointer movement through editor zoom exactly once',()=>{
 const f=fixture(),scale=.8;
 f.root.ownerDocument={documentElement:{},defaultView:{getComputedStyle:()=>({zoom:String(scale)})}};
 for(const el of [f.root,f.body,f.bar]){const bounds=el.getBoundingClientRect;el.getBoundingClientRect=()=>Object.fromEntries(Object.entries(bounds()).map(([key,value])=>[key,value*scale]));}
 f.api.show();emit(f.grip,'pointerdown',{button:0,pointerId:20,clientX:0,clientY:0});
 emit(f.grip,'pointermove',{pointerId:20,clientX:80,clientY:40});
 assert.equal(f.root.styles.get('--preview-custom-width'),'520px');assert.equal(f.root.styles.get('--preview-custom-height'),'490px');
 emit(f.reset,'click');assert.equal(f.grip.hasPointerCapture(20),false);assert.equal(f.root.styles.has('--preview-custom-width'),false);f.api.destroy();
});
