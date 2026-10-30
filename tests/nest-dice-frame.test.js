import {diceAppearanceScale} from '../dice/appearance-scale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

for (const floating of [false,true,'game']) test(`compact sizing and resize preserve physical scale without reroll, floating=${floating}`, async () => {
  const url = new URL('../dice/frame.js', import.meta.url);
  const source = await readFile(url, 'utf8');
  const tray = { clientWidth: floating ? 400 : 200, clientHeight: floating ? 240 : 120 };
  const canvas = {}, camera = {fov: .25};
  const otherCamera = {fov: .4};
  const FakeEngine = {Instances:[{getRenderingCanvas:()=>({}),scenes:[{activeCamera:otherCamera}]},{getRenderingCanvas:()=>canvas,scenes:[{activeCamera:camera}]}]};
  const calls = { rolls: [], updates: [], resize: 0 };
  const frames = new Map();
  let observer, box, nextFrame = 1;
  class FakeDiceBox {
    constructor(config) { this.config = config; this.canvas = canvas; box = this; }
    async init() {}
    async updateConfig(config) { calls.updates.push(config); }
    async roll(pool) { calls.rolls.push(pool); return []; }
  }
  const window = {
    location: { search: floating ? '?sizeMultiplier=1.2&referenceWidth=125&referenceHeight=80&renderOverscan=2'+(floating==='game'?'&referenceViewportHeight=120':'') : '' },
    Worker: class {},
    addEventListener() {},
    dispatchEvent(event) { if (event.type === 'resize') calls.resize++; }
  };
  const context = vm.createContext({
    diceAppearanceScale, window, URL, URLSearchParams, Event, FakeDiceBox, FakeEngine,
    document: {
      getElementById: () => tray,
      createElement: () => ({ getContext: () => ({ getExtension: () => null }) }),
      querySelectorAll: () => []
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe(target) { assert.equal(target, tray); }
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  // Keep browser globals and lifecycle intact, replacing only the vendor import.
  const vendorImport = "import(new URL('dice-box.es.js', base).href)";
  assert.ok(source.includes(vendorImport));
  vm.runInContext(source.replace(/^import .*appearance-scale.*;\n/,'').replaceAll('import.meta.url', JSON.stringify(url.href)).replace(vendorImport, 'Promise.resolve({ default: FakeDiceBox })').replace("import(new URL('Dice.js', base).href)",'Promise.resolve({E:FakeEngine})'), context);
  await window.NestDiceFrame.init();
  assert.equal(box.config.theme, 'nest');
  assert.equal(box.config.size, undefined, 'retain original physics arena');
  assert.equal(box.config.startingHeight, undefined, 'retain original throw height');
  assert.equal(camera.fov, floating ? 2*Math.atan(Math.tan(.25/2)*2) : .25);
  assert.equal(otherCamera.fov,.4,'other WebGL scenes are untouched');
  assert.match(box.config.externalThemes.nest, /\/dice\/themes\/nest$/);
  assert.equal(box.config.scale, floating ? 9.6 : 12);
  tray.clientWidth = floating ? 1800 : 900;
  tray.clientHeight = floating ? 1200 : 600;
  observer.callback();
  observer.callback();
  assert.equal(frames.size, 1, 'resize callbacks are coalesced');
  [...frames.values()][0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.updates.at(-1).scale, floating==='game'?box.config.scale:floating ? 12 * 80 / 600 * 1.2 : (4400 / 1.5) / 600);
  if(floating&&floating!=='game')assert.equal(calls.updates.at(-1).scale*1200,box.config.scale*240);
  assert.equal(camera.fov, floating ? 2*Math.atan(Math.tan(.25/2)*2) : .25, 'resize never compounds camera widening');
  assert.equal(calls.rolls.length, 0);
  assert.equal(calls.resize, 1);
  await window.NestDiceFrame.roll([{ sides: 6, count: 3 }]);
  assert.equal(JSON.stringify(calls.rolls), '[["3d6"]]');
  window.NestDiceFrame.dispose();
  assert.equal(observer.disconnected, true);
  assert.equal(frames.size, 0);
});
