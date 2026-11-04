import test from 'node:test';
import assert from 'node:assert/strict';
import {showProjectFileDialog, askUnsavedProjectChoice} from '../studio/project-file-dialog.js';

class Element extends EventTarget {
  constructor(doc, tag = 'div') {
    super(); this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = [];
    this.attributes = new Map(); this.style = {}; this.hidden = false; this.disabled = false; this.inert = false;
    this.value = ''; this.textContent = ''; this.tabIndex = ['BUTTON','INPUT','SELECT'].includes(this.tagName) ? 0 : -1;
    this.isConnected = true;
    const classes = new Set();
    this.classList = {add:value=>classes.add(value), remove:value=>classes.delete(value), contains:value=>classes.has(value)};
  }
  append(...nodes) {for (const node of nodes) {node.parentElement = this; this.children.push(node);}}
  replaceChildren(...nodes) {this.children = []; this.append(...nodes);}
  remove() {this.parentElement.children = this.parentElement.children.filter(node=>node !== this); this.isConnected = false;}
  setAttribute(name, value) {this.attributes.set(name, value);}
  getAttribute(name) {return this.attributes.get(name) ?? null;}
  contains(target) {return target === this || this.children.some(node=>node.contains(target));}
  closest() {for (let node = this; node; node = node.parentElement) if (node.hidden || node.inert) return node; return null;}
  querySelectorAll() {return descendants(this).filter(node=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(node.tagName));}
  focus() {this.ownerDocument.activeElement = this; emit(this.ownerDocument, 'focusin', {target:this});}
  select() {this.selected = true;}
}
const descendants = node => node.children.flatMap(child=>[child, ...descendants(child)]);
function emit(node, name, values = {}) {
  const event = new Event(name, {cancelable:true});
  for (const [key,value] of Object.entries(values)) Object.defineProperty(event,key,{value});
  node.dispatchEvent(event); return event;
}
function fixture() {
  const doc = new Element(null); doc.ownerDocument = doc; doc.createElement = tag=>new Element(doc,tag);
  doc.body = new Element(doc); const background = new Element(doc); const trigger = new Element(doc,'button');
  const inert = new Element(doc); inert.inert = true;
  background.append(trigger); doc.body.append(background,inert); doc.activeElement = trigger;
  return {doc,background,trigger,inert};
}
const find = (doc, predicate) => descendants(doc.body).find(predicate);
const button = (doc, text) => find(doc,node=>node.tagName === 'BUTTON' && node.textContent === text);
const form = doc => find(doc,node=>node.tagName === 'FORM');
const input = doc => find(doc,node=>node.tagName === 'INPUT' && node.type === 'text');
const alert = doc => find(doc,node=>node.getAttribute('role') === 'alert');
const settle = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve};};

test('save-as defaults, validates filenames, preserves modal on cancellation and closes on success', async()=>{
  const f = fixture(); let calls = []; let result = {ok:false,cancelled:true};
  const pending = showProjectFileDialog({mode:'save-as', document:f.doc, currentFilename:'Story.json', onSubmit:async name=>{calls.push(name); return result;}});
  const field = input(f.doc);
  assert.equal(field.value,'Story-copy.json'); assert.equal(f.doc.activeElement,field);
  assert.equal(f.background.inert,true); assert.equal(f.inert.inert,true);
  assert.equal(find(f.doc,node=>node.getAttribute('role') === 'dialog').getAttribute('aria-modal'),'true');
  field.value = '../bad.json'; emit(form(f.doc),'submit'); await settle();
  assert.equal(calls.length,0); assert.equal(alert(f.doc).hidden,false);
  field.value = 'New story.json'; emit(form(f.doc),'submit'); await settle();
  assert.deepEqual(calls,['New story.json']); assert.match(alert(f.doc).textContent,/cancelled/);
  assert.ok(button(f.doc,'Save as'));
  result = {ok:true}; emit(form(f.doc),'submit');
  assert.equal(await pending,true); assert.equal(f.background.inert,false); assert.equal(f.inert.inert,true);
  assert.equal(f.doc.activeElement,f.trigger);
});

test('busy disables every control and Escape, and suppresses duplicate submissions', async()=>{
  const f = fixture(), action = deferred(); let calls = 0;
  const pending = showProjectFileDialog({mode:'save-as', document:f.doc, suggestedName:'explicit.json', onSubmit:()=>{calls++; return action.promise;}});
  const currentForm = form(f.doc);
  emit(currentForm,'submit'); emit(currentForm,'submit');
  assert.equal(calls,1);
  for (const node of currentForm.querySelectorAll()) assert.equal(node.disabled,true);
  emit(f.doc,'keydown',{key:'Escape'}); assert.ok(button(f.doc,'Cancel'));
  action.resolve({ok:false,error:'Disk full'}); await settle();
  assert.equal(alert(f.doc).textContent,'Disk full'); assert.equal(button(f.doc,'Cancel').disabled,false);
  emit(f.doc,'keydown',{key:'Escape'}); assert.equal(await pending,false);
});

test('keyboard wraps focus, contains outside focus, restores listeners and focus on cancel', async()=>{
  const f = fixture(); const pending = showProjectFileDialog({mode:'save-as',document:f.doc,onSubmit:async()=>({ok:true})});
  input(f.doc).focus(); emit(f.doc,'keydown',{key:'Tab',shiftKey:true}); assert.equal(f.doc.activeElement,button(f.doc,'Cancel'));
  emit(f.doc,'keydown',{key:'Tab'}); assert.equal(f.doc.activeElement,input(f.doc));
  f.trigger.focus(); assert.equal(f.doc.activeElement.getAttribute('role'),'dialog');
  emit(button(f.doc,'Cancel'),'click'); assert.equal(await pending,false);
  f.trigger.focus(); assert.equal(f.doc.activeElement,f.trigger);
  assert.equal(emit(f.doc,'keydown',{key:'Tab'}).defaultPrevented,false);
});

test('open list failures remain visible and can retry, current item selected and submitted', async()=>{
  const f = fixture(); let lists = 0, chosen;
  const backend = {list:async()=>{if (++lists === 1) throw Error('Offline'); return {available:true,files:[{name:'Other.json'},{name:'Current.json'}]};}};
  const pending = showProjectFileDialog({mode:'open',document:f.doc,backend,currentFilename:'Current.json',onSubmit:async name=>{chosen=name;return {ok:true};}});
  await settle(); assert.equal(alert(f.doc).textContent,'Offline'); assert.equal(button(f.doc,'Open Studio project').disabled,true);
  assert.equal(button(f.doc,'Retry list').hidden,false);
  emit(button(f.doc,'Retry list'),'click'); await settle();
  const select = find(f.doc,node=>node.tagName === 'SELECT');
  assert.equal(select.value,'Current.json'); assert.equal(select.children[1].textContent,'Current.json (current)');
  emit(form(f.doc),'submit'); assert.equal(await pending,true); assert.equal(chosen,'Current.json');
});

test('empty list allows import and failed imports remain retryable', async()=>{
  const f = fixture(); let imported, succeeds = false;
  const pending = showProjectFileDialog({mode:'open',document:f.doc,backend:{list:async()=>({available:true,files:[]})},
    onImport:async file=>{imported=file;return succeeds ? {ok:true} : {ok:false,error:'Invalid JSON'};}});
  await settle(); assert.equal(button(f.doc,'Open Studio project').disabled,true);
  const field = find(f.doc,node=>node.tagName === 'INPUT' && node.type === 'file');
  assert.equal(field.accept,'.json,application/json');
  const file = {name:'external.json'}; field.files = [file]; emit(field,'change'); await settle();
  assert.equal(imported,file); assert.equal(alert(f.doc).textContent,'Invalid JSON');
  succeeds = true; field.files = [file]; emit(field,'change'); assert.equal(await pending,true);
});

for (const [label,choice] of [['Save changes','save'],['Discard changes','discard'],['Cancel','cancel']]) {
  test(`unsaved choice resolves ${choice} and restores surrounding modal state`,async()=>{
    const f = fixture(); const pending = askUnsavedProjectChoice({document:f.doc});
    assert.equal(f.background.inert,true); emit(button(f.doc,label),'click'); assert.equal(await pending,choice);
    assert.equal(f.background.inert,false); assert.equal(f.doc.activeElement,f.trigger);
  });
}
test('unsaved Escape means cancel',async()=>{
  const f = fixture(); const pending = askUnsavedProjectChoice({document:f.doc});
  emit(f.doc,'keydown',{key:'Escape'}); assert.equal(await pending,'cancel');
});

test('nested unsaved dialog contains focus and Escape without closing the outer file dialog',async()=>{
  const f = fixture();
  const outer = showProjectFileDialog({mode:'save-as',document:f.doc,onSubmit:async()=>({ok:true})});
  const originalField = input(f.doc);
  const inner = askUnsavedProjectChoice({document:f.doc});
  assert.equal(f.doc.activeElement,button(f.doc,'Save changes'));
  emit(f.doc,'keydown',{key:'Escape'}); assert.equal(await inner,'cancel');
  assert.equal(f.doc.activeElement,originalField);
  assert.ok(button(f.doc,'Save as'));
  emit(f.doc,'keydown',{key:'Escape'}); assert.equal(await outer,false);
});

test('submit can await a nested unsaved choice while parent remains busy, then resume', async()=>{
  const f = fixture(); let choice;
  const pending = showProjectFileDialog({mode:'save-as',document:f.doc,onSubmit:async()=>{
    choice = await askUnsavedProjectChoice({document:f.doc});
    return {ok:false,cancelled:true};
  }});
  emit(form(f.doc),'submit');
  assert.equal(button(f.doc,'Save as').disabled,true);
  button(f.doc,'Save changes').focus();
  emit(f.doc,'keydown',{key:'Tab',shiftKey:true});
  assert.equal(f.doc.activeElement,descendants(f.doc.body).filter(node=>node.tagName === 'BUTTON' && node.textContent === 'Cancel').at(-1));
  emit(f.doc,'keydown',{key:'Escape'}); await settle();
  assert.equal(choice,'cancel'); assert.equal(button(f.doc,'Save as').disabled,false);
  assert.match(alert(f.doc).textContent,/cancelled/);
  emit(f.doc,'keydown',{key:'Escape'}); assert.equal(await pending,false);
});
