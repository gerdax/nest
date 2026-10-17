import test from 'node:test';
import assert from 'node:assert/strict';
import { DiceLayer, floatingDiceAppearance } from '../studio/DiceLayer.js';

for (const popover of [true,false]) test(`dice escape the card stack and follow its fixed anchor, topLayer=${popover}`,()=>{
  const previousRequest=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
  const frames=new Map();let serial=0;
  globalThis.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const doc={};
  doc.createElement=()=>({style:{},attrs:{},classes:new Set(),setAttribute(key,value){this.attrs[key]=value;},
    classList:{add(value){this.owner.classes.add(value);}},
    append(child){child.parentNode=this;},remove(){this.removed=true;},
    ...(popover?{showPopover(){this.topLayer=true;},hidePopover(){this.topLayer=false;}}:{})});
  const make=doc.createElement;doc.createElement=()=>{const e=make();e.classList.owner=e;return e;};
  doc.body={appendChild(child){child.parentNode=this;}};
  let rect={left:100,top:120,width:250,height:200};
  const anchor={ownerDocument:doc,getBoundingClientRect:()=>rect};
  let layer;
  try {
    layer=new DiceLayer(anchor);
    assert.equal(layer.host.parentNode,doc.body);
    assert.equal(layer.host.style.pointerEvents,'none');
    assert.equal(layer.host.style.colorScheme,'dark','iframe transparency uses the same color scheme in editor and player');
    assert.equal(layer.host.style.zIndex,'2147483647');
    assert.equal(layer.host.topLayer, popover?true:undefined);
    assert.deepEqual(layer.appearance,{sizeMultiplier:1.2,renderOverscan:2,referenceWidth:250,referenceHeight:200});
    assert.deepEqual([layer.tray.style.left,layer.tray.style.top,layer.tray.style.width,layer.tray.style.height],['-175px','-80px','800px','600px']);
    const stable={...layer.tray.style};layer.fade();
    assert.deepEqual(layer.tray.style,stable,'result fade changes opacity, not canvas geometry');
    assert.equal(layer.host.classes.has('dice-fading'),true);
    rect={...rect,left:160,top:90};const callback=frames.get(layer.frame);frames.delete(layer.frame);callback();
    assert.equal(layer.tray.style.left,'-115px');assert.equal(layer.tray.style.top,'-110px');
    doc.documentElement={clientWidth:320,clientHeight:568};
    const resize=frames.get(layer.frame);frames.delete(layer.frame);resize();
    assert.equal(layer.tray.style.width,'640px');assert.equal(layer.tray.style.left,'-160px');
    assert.deepEqual(layer.appearance,{sizeMultiplier:1.2,renderOverscan:2,referenceWidth:250,referenceHeight:200},'viewport clamping cannot change captured dice size');
    layer.destroy();layer.destroy();assert.equal(frames.size,0);assert.equal(layer.host.removed,true);
    if(popover)assert.equal(layer.host.topLayer,false);
  } finally {layer?.destroy();globalThis.requestAnimationFrame=previousRequest;globalThis.cancelAnimationFrame=previousCancel;}
});

test('expanded canvas preserves a 20 percent physical size increase over the original reference',()=>{
  const originalHeight=200,expandedHeight=originalHeight*1.5;
  const scale=12*originalHeight/expandedHeight*floatingDiceAppearance.sizeMultiplier;
  assert.ok(Math.abs(scale*expandedHeight/(12*originalHeight)-1.2)<1e-12);
});
