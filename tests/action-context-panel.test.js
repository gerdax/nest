import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionContextPanel } from '../studio/ActionContextPanel.js';

class Element extends EventTarget {
  constructor(doc, tag) {
    super(); this.ownerDocument = doc; this.tagName = tag; this.children = [];
    this.attrs = {}; this.style = {}; this.textContent = ''; this.layouts = [];
    this.classList = { add: name => { this.className = name; } };
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() {
    this.layouts.push({ hidden: this.hidden, visible: this.attrs['data-visible'] });
    return {};
  }
}

function setup(options) {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  doc.createElement = tag => new Element(doc, tag);
  return new ActionContextPanel(new Element(doc, 'section'), options);
}
const item = { id: 'wedge', name: 'Wedge', image: 'wedge.png' };
const info = { stat: 'LUCK', chance: '63.7', label: 'Lucky escape', formula: 'D20 + luck', rules: 'At least 12' };

test('odds colors use five steps from the unrounded percentage', () => {
  const panel = setup();
  for (const [chance, level] of [[0,'very-low'],[19.9,'very-low'],[20,'low'],[39.9,'low'],
    [40,'medium'],[59.9,'medium'],[60,'high'],[79.9,'high'],[80,'very-high'],[100,'very-high']]) {
    panel.update({info:{...info,chance:`${chance}%`}});
    assert.equal(panel.checkDetails.attrs['data-odds-level'],level);
  }
  panel.update({item});
  assert.equal(panel.checkDetails.attrs['data-odds-level'],undefined);
  panel.update({info});panel.clear();
  assert.equal(panel.checkDetails.attrs['data-odds-level'],undefined);
  panel.destroy();
});

test('one caption and content container switch between item and check modes', () => {
  const panel = setup();
  const caption = panel.caption;
  assert.equal(panel.root.className, 'action-context-panel');
  assert.equal(panel.root.attrs['aria-live'], 'polite');
  assert.equal(panel.root.attrs['aria-atomic'], 'true');
  assert.equal(panel.checkDetails.attrs['aria-live'], undefined);
  assert.deepEqual(panel.root.children, [panel.blend]);
  assert.deepEqual(panel.blend.children, [panel.view]);
  assert.deepEqual(panel.view.children, [caption, panel.content]);
  assert.deepEqual(panel.content.children, [panel.checkDetails, panel.mini.root]);
  panel.update({ item });
  assert.equal(panel.caption.textContent, 'USING');
  assert.equal(panel.checkDetails.hidden, true);
  assert.equal(panel.mini.item, item);
  assert.equal(panel.root.attrs['data-mode'], 'item');
  assert.equal(panel.root.attrs['data-visible'], 'true');
  assert.equal(panel.root.attrs['aria-hidden'], 'false');
  assert.equal(panel.root.attrs.inert, undefined);
  assert.deepEqual(panel.root.layouts, [{ hidden: false, visible: 'false' }]);
  panel.update({ info, item });
  assert.equal(panel.caption, caption);
  assert.equal(caption.textContent, 'LUCK');
  assert.equal(panel.root.attrs['data-mode'], 'check');
  assert.equal(panel.checkDetails.hidden, false);
  assert.equal(panel.checkChance.textContent, '64%');
  assert.equal(panel.checkRules.textContent, info.label);
  assert.equal(panel.checkDetails.title, 'D20 + luck · At least 12');
  assert.equal(panel.mini.item, null, 'check wins when both are supplied');
  panel.update({ info: { stat: 'SKILL', chance: 0 } });
  assert.equal(caption.textContent, 'SKILL');
  assert.equal(panel.checkChance.textContent, '0%');
  assert.equal(panel.checkRules.hidden, true);
  assert.equal(panel.checkDetails.title, '');
  panel.update({ item });
  assert.equal(caption.textContent, 'USING');
  assert.equal(panel.checkChance.textContent, '');
  panel.destroy();
});

function animationsFor(panel) {
  const animations=[];
  const animate=function(frames,options) {
    const animation={target:this,frames,options,cancelled:false,cancel(){this.cancelled=true;}};
    animations.push(animation);return animation;
  };
  const copy=node=>{
    const clone=new Element(node.ownerDocument,node.tagName);
    clone.textContent=node.textContent;clone.attrs={...node.attrs};clone.children=node.children.map(copy);
    return clone;
  };
  panel.view.animate=animate;
  panel.view.cloneNode=()=>{
    const clone=copy(panel.view);clone.animate=animate;clone.remove=()=>{clone.removed=true;};return clone;
  };
  panel.mini.view.getComputedStyle=()=>({opacity:'.6'});
  return animations;
}

test('odds switch immediately while outgoing content crossfades without interaction',()=>{
  const panel=setup(),animations=animationsFor(panel);
  panel.update({item,selectionKey:'tool'});
  panel.update({info,selectionKey:'check'});
  assert.equal(panel.caption.textContent,info.stat,'live content never waits for fade-out');
  assert.equal(panel.checkChance.textContent,'64%');
  assert.equal(panel.visible,true);
  assert.equal(panel.outgoing.node.children[0].textContent,'USING');
  assert.equal(panel.outgoing.node.attrs['aria-hidden'],'true');
  assert.equal(panel.outgoing.node.attrs.inert,'');
  assert.deepEqual(animations.map(a=>a.options),[{duration:140,easing:'ease'},{duration:140,easing:'ease'}]);
  assert.deepEqual(animations[0].frames,[{opacity:0},{opacity:1}]);
  assert.deepEqual(animations[1].frames,[{opacity:1},{opacity:0}]);
  const outgoing=panel.outgoing.node;animations[1].onfinish();
  assert.equal(outgoing.removed,true);
  assert.equal(panel.outgoing,null);
  panel.update({info:{...info,stat:'Agility: 7'},selectionKey:'second-check'});
  assert.equal(panel.caption.textContent,'Agility: 7');
  assert.equal(animations.length,4,'checked actions also crossfade');
  panel.destroy();
});

test('rapid selection preserves painted layers; exit fades them and teardown clears them',()=>{
  const panel=setup(),animations=animationsFor(panel);
  panel.update({item});panel.update({info});
  const outgoing=panel.outgoing.node;
  panel.update({item});
  assert.equal(panel.caption.textContent,'USING');
  assert.equal(animations[0].cancelled,true);
  assert.equal(animations[1].cancelled,true,'older layer is retimed without removing its visual');
  assert.notEqual(outgoing.removed,true);
  assert.equal(panel.outgoingLayers.size,2,'rapid input preserves the painted composite');
  panel.update();
  assert.equal(panel.visible,false);
  assert.equal(panel.outgoingLayers.size,2,'root fade-out retains the painted contents');
  const weights=[...panel.outgoingLayers].map(layer=>layer.animation.frames[0].opacity);
  assert.equal(weights.reduce((sum,weight)=>sum+weight,0),1,'retimed outgoing weights preserve brightness');
  for(const layer of [...panel.outgoingLayers])layer.animation.onfinish();
  assert.equal(panel.outgoingLayers.size,0);
  assert.equal(outgoing.removed,true);
  panel.update({item});panel.update({info});panel.clear();
  assert.equal(panel.root.hidden,true);
  assert.equal(panel.outgoing,null);
  assert.equal(panel.outgoingLayers.size,0);
  assert.equal(panel.caption.textContent,'');
  panel.destroy();
});

test('reduced motion updates odds immediately without crossfade animations',()=>{
  const panel=setup(),animations=animationsFor(panel);
  panel.mini.view.matchMedia=()=>({matches:true});
  panel.update({item});panel.update({info});
  assert.equal(panel.caption.textContent,info.stat);
  assert.equal(animations.length,0);
  panel.destroy();
});

test('sustained browsing bounds retained copies and preserves normalized brightness',()=>{
  const panel=setup();animationsFor(panel);
  panel.update({item});
  for(let index=0;index<100;index++) {
    panel.update({info:{...info,stat:`Composure: ${index}`},selectionKey:index});
    assert.ok(panel.outgoingLayers.size<=12);
    const total=[...panel.outgoingLayers].reduce((sum,layer)=>sum+layer.animation.frames[0].opacity,0);
    assert.ok(Math.abs(total-1)<1e-10);
  }
  panel.destroy();
  assert.equal(panel.outgoingLayers.size,0);
});

test('empty context fades painted content but immediately ends and prevents inspection', () => {
  const calls = [];
  let canHold = true;
  const panel = setup({ onHold: value => calls.push(value), canHold: () => canHold });
  panel.update({ item });
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), true);
  const button = panel.mini.button;
  panel.update();
  assert.equal(panel.root.hidden, false);
  assert.equal(panel.root.attrs['data-visible'], 'false');
  assert.equal(panel.root.attrs['aria-hidden'], 'true');
  assert.equal(panel.root.attrs.inert, '');
  assert.equal(panel.caption.textContent, 'USING');
  assert.equal(panel.mini.button, button);
  assert.equal(button.disabled, true);
  assert.equal(panel.mini.held, null);
  assert.deepEqual(calls, [item, null]);
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ item });
  assert.equal(panel.root.attrs['data-visible'], 'true');
  assert.equal(button.disabled, false, 'same item is enabled after interrupted exit');
  assert.equal(panel.root.layouts.length, 2);
  canHold = false;
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ item, busy: true });
  canHold = true;
  assert.equal(panel.mini.button.disabled, true);
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ info });
  panel.update();
  assert.equal(panel.caption.textContent, 'LUCK');
  assert.equal(panel.checkChance.textContent, '64%');
  assert.equal(panel.checkDetails.hidden, false);
  panel.destroy();
});

test('clear resets immediately and destroy removes hold listeners', () => {
  const calls = [];
  const panel = setup({ onHold: value => calls.push(value) });
  panel.update({ info });
  panel.clear();
  assert.equal(panel.root.hidden, true);
  assert.equal(panel.caption.textContent, '');
  assert.equal(panel.checkChance.textContent, '');
  assert.equal(panel.checkRules.textContent, '');
  assert.equal(panel.checkDetails.title, '');
  assert.equal(panel.checkDetails.hidden, true);
  assert.equal(panel.mini.item, null);
  assert.equal(panel.root.attrs['data-mode'], undefined);
  panel.update({ item });
  panel.mini.beginHold({ key: 'Enter' });
  const view = panel.mini.view;
  const doc = panel.root.ownerDocument;
  const removed = [];
  view.removeEventListener = type => removed.push(type);
  doc.removeEventListener = type => removed.push(type);
  panel.destroy();
  assert.equal(panel.root.hidden, true);
  assert.equal(panel.root.attrs['data-visible'], 'false');
  assert.equal(panel.root.attrs['aria-hidden'], 'true');
  assert.equal(panel.root.attrs.inert, '');
  assert.equal(panel.mini.item, null);
  assert.equal(panel.mini.root.children.length, 0);
  assert.deepEqual(calls, [item, null]);
  assert.deepEqual(removed, ['pointerup', 'pointercancel', 'blur', 'resize', 'visibilitychange']);
});


test('only completed outcomes show the result caption and replace minis', () => {
  const panel = setup();
  panel.update({info});
  const caption = panel.caption;
  panel.update({result:{target:8}});
  assert.equal(panel.caption, caption);
  assert.equal(panel.visible, false, 'pending roll has no target caption');
  assert.equal(caption.textContent, info.stat, 'previous odds remain painted only for fade-out');
  for (const success of [true,false]) {
    panel.update({item, result:{target:8,total:success?10:6,success}});
    assert.equal(caption.textContent, `TARGET: 8  CHECK: ${success?10:6}`);
    assert.equal(panel.checkChance.textContent, success?'SUCCESS':'FAILURE');
    assert.equal(panel.checkDetails.attrs['data-outcome'], success?'success':'failure');
    assert.equal(panel.root.attrs['data-mode'], 'result');
    assert.equal(panel.view.attrs['data-mode'], 'result');
    assert.equal(panel.mini.item, null);
    assert.equal(panel.checkRules.hidden, true);
  }
  panel.update({info});
  assert.equal(panel.checkDetails.attrs['data-outcome'], undefined);
  assert.equal(panel.checkDetails.attrs['data-presentation'], 'odds');
  assert.equal(panel.caption.textContent, info.stat);
  assert.equal(panel.view.attrs['data-mode'], 'check');
  panel.destroy();
});
