import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DiceService } from '../DiceService.js';

test('appearance defaults and allowed values reach transport', async () => {
  for (const throwSide of ['top', 'bottom']) for (const color of ['black', 'light']) {
    let received;
    const service = new DiceService({ appearance: { throwSide, color }, transportFactory: (_, appearance) => {
      received = appearance;
      return { ready: Promise.resolve(), roll: async () => [{ sides: 6, value: 3 }], destroy() {} };
    }});
    service.mount({ appendChild() {} });
    assert.deepEqual(await service.roll([{ sides: 6 }]), { dice: [{ sides: 6, value: 3 }] });
    assert.equal(received.throwSide, throwSide);
    assert.equal(received.color, color);
    service.destroy();
  }
  const defaults = new DiceService();
  assert.equal(defaults.appearance.throwSide, 'bottom');
  assert.equal(defaults.appearance.color, 'light');
  for (const appearance of [{ throwSide: 'left' }, { color: '#fff' }, { sizeMultiplier: 0 }]) {
    assert.throws(() => new DiceService({ appearance }), RangeError);
  }
});

test('actual embedded worker starts at requested physical edge with inward velocity', async () => {
  const bundle = await readFile(new URL('../vendor/dice-box/dice-box.es.js', import.meta.url), 'utf8');
  const worker = Buffer.from(bundle.match(/const ml = "([^"]+)"/)[1], 'base64').toString();
  const start = worker.match(/fe=\(\)=>\{(.*?)\},Il=/s)[1];
  const velocity = worker.match(/,ge=_=>\{(.*?)const t=Math.random\(\)>/s)[1];
  for (const throwSide of ['top', 'bottom']) for (const random of [0, 0.25, 0.5, 0.999]) {
    const p = { size: 9.5, startingHeight: 8, throwForce: 4, throwSide };
    const context = { p, yt: 1.6, Math: Object.assign(Object.create(Math), { random: () => random }), dt: (a,b,t) => a*(1-t)+b*t, P: (...xyz) => xyz };
    vm.runInNewContext(`(() => {${start}})()`, context);
    assert.equal(p.startPosition[1], 8);
    assert.equal(p.startPosition[2], throwSide === 'top' ? -4.25 : 4.25);
    assert.ok(Math.abs(p.startPosition[0]) <= 7.100001);
    let result;
    context._ = { setLinearVelocity: v => { result = v; } };
    vm.runInNewContext(`(() => {${velocity}})()`, context);
    assert.ok(result[2] * p.startPosition[2] < 0);
  }
});

test('frame maps color and side without rotating canvas', async () => {
  const source = await readFile(new URL('../frame.js', import.meta.url), 'utf8');
  assert.match(source, /appearance.get\('color'\) === 'black' \? 'nest-black' : 'nest'/);
  assert.match(source, /throwSide: appearance.get\('throwSide'\) === 'top' \? 'top' : 'bottom'/);
  const black = JSON.parse(await readFile(new URL('../themes/nest-black/theme.config.json', import.meta.url)));
  assert.equal(black.material.diffuseTexture, 'numbers.png');
  assert.deepEqual(black.diceAvailable, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
});
