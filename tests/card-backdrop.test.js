import test from 'node:test';
import assert from 'node:assert/strict';
import { CardBackdrop } from '../studio/CardBackdrop.js';

test('backdrop clears the stationary card area in scaled hosts and releases its observer', () => {
  const previous = globalThis.ResizeObserver;
  let callback, disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(cb) { callback = cb; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const document = { defaultView: { getComputedStyle: () => ({position:'relative'}) } };
  document.createElement = () => ({ ownerDocument:document, style:{}, className:'',
    attrs:{}, setAttribute(k,v){this.attrs[k]=v;}, appendChild(){}, remove(){},
    clientHeight:800, getBoundingClientRect:()=>({top:40,height:640}) });
  const host = document.createElement();
  let bottom = 440;
  const backdrop = new CardBackdrop({getBoundingClientRect:()=>({bottom})}, {container:host});
  try {
    assert.equal(backdrop.fill.style.top, '524px'); // (440 - 40) / .8 + 24
    backdrop.setVisible(true);
    assert.equal(backdrop.root.attrs['data-visible'], 'true');
    bottom = 360; callback();
    assert.equal(backdrop.fill.style.top, '424px');
    backdrop.setVisible(false);
    assert.equal(backdrop.root.attrs['data-visible'], 'false');
    backdrop.destroy();
    assert.equal(disconnected, true);
  } finally { globalThis.ResizeObserver = previous; }
});
