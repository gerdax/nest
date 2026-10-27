import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DiceService } from '../dice/DiceService.js';

for (const color of ['black', 'light']) for (const throwSide of ['top', 'bottom']) {
  test(`explicit appearance reaches the transport: ${color}, ${throwSide}`, async () => {
    let received;
    const service = new DiceService({ appearance: { color, throwSide }, transportFactory: (_, options) => {
      received = options;
      return { ready: Promise.resolve(), roll: async () => [], destroy() {} };
    } }).mount({ appendChild() {} });
    await service.roll([{ sides: 6 }]);
    assert.deepEqual(received, { sizeMultiplier: 1, color, throwSide });
    service.destroy();
  });
}
test('appearance validates explicit enums and leaves omitted overrides absent', () => {
  for (const [key, invalid] of [['color', ['white', '', null, 1, false]], ['throwSide', ['left', '', null, 1, false]]]) {
    for (const value of invalid) assert.throws(() => new DiceService({ appearance: { [key]: value } }), RangeError);
  }
  assert.deepEqual(new DiceService().appearance, { sizeMultiplier: 1 });
  assert.deepEqual(new DiceService({ appearance: { color: undefined, throwSide: undefined } }).appearance, { sizeMultiplier: 1 });
});
for (const appearance of [{}, { color: 'black', throwSide: 'top' }, { color: 'light', throwSide: 'bottom' }]) {
  test(`local iframe URL transports only supplied overrides ${JSON.stringify(appearance)}`, async () => {
    const listeners = {};
    const frame = { style: {}, addEventListener: (name, callback) => { listeners[name] = callback; }, contentWindow: { NestDiceFrame: { init: async () => {}, roll: async () => [], dispose() {} } }, remove() {} };
    const service = new DiceService({ appearance }).mount({ ownerDocument: { createElement: () => frame }, appendChild() {} });
    const pending = service.roll([{ sides: 6 }]);
    const url = new URL(frame.src);
    for (const key of ['color', 'throwSide']) assert.equal(url.searchParams.get(key), appearance[key] ?? null);
    await listeners.load();
    await pending;
    service.destroy();
  });
}

async function frameConfig(search) {
  const url = new URL('../dice/frame.js', import.meta.url);
  const source = await readFile(url, 'utf8');
  let config;
  class FakeDiceBox { constructor(options) { config = options; } async init() {} }
  const window = { location: { search }, Worker: class {}, addEventListener() {} };
  const context = vm.createContext({ window, URL, URLSearchParams, FakeDiceBox,
    document: { createElement: () => ({ getContext: () => ({ getExtension: () => null }) }), getElementById: () => ({ clientWidth: 200, clientHeight: 120 }) },
    ResizeObserver: class { observe() {} }
  });
  vm.runInContext(source.replaceAll('import.meta.url', JSON.stringify(url.href)).replace("import(new URL('dice-box.es.js', base).href)", 'Promise.resolve({ default: FakeDiceBox })'), context);
  await window.NestDiceFrame.init();
  return config;
}
test('frame maps local themes and keeps default random-edge configuration', async () => {
  for (const [search, theme, side] of [['', 'nest', undefined], ['?color=light', 'nest', undefined], ['?color=black&throwSide=top', 'nest-black', 'top'], ['?color=light&throwSide=bottom', 'nest', 'bottom'], ['?throwSide=invalid', 'nest', undefined]]) {
    const config = await frameConfig(search);
    assert.equal(config.theme, theme);
    assert.equal(config.throwSide, side);
    assert.equal(Object.hasOwn(config, 'throwSide'), side !== undefined);
    assert.match(config.externalThemes[theme], new RegExp(`/dice/themes/${theme}$`));
  }
  const config = JSON.parse(await readFile(new URL('../dice/themes/nest-black/theme.config.json', import.meta.url)));
  assert.equal(config.systemName, 'nest-black');
  assert.deepEqual(config.diceAvailable, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  const png = await readFile(new URL(`../dice/themes/nest-black/${config.material.diffuseTexture}`, import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('embedded Ammo spawn branch uses requested edges and preserves all default random branches', async () => {
  const source = await readFile(new URL('../dice/vendor/dice-box/dice-box.es.js', import.meta.url), 'utf8');
  const worker = Buffer.from(source.match(/const ml = "([^"]+)"/)[1], 'base64').toString();
  const spawn = worker.match(/fe=(\(\)=>\{.*?\}),Il=/)[1];
  const sequences = [
    [0.2, 0.3, 0.1, 0.1, 0.1], [0.8, 0.4, 0.9, 0.9, 0.1],
    [0.4, 0.7, 0.1, 0.1, 0.9], [0.6, 0.2, 0.9, 0.9, 0.9]
  ];
  for (const randoms of sequences) for (const side of [undefined, 'top', 'bottom']) {
    const p = { size: 20, startingHeight: 8, ...(side ? { throwSide: side } : {}) };
    let draws = 0;
    const math = Object.create(Math); math.random = () => randoms[draws++];
    const context = vm.createContext({ p, yt: 1.5, dt: (a, b, t) => a + (b - a) * t, Math: math });
    vm.runInContext(`(${spawn})()`, context);
    const [rX, rZ, rG, rV, rQ] = randoms;
    const x = 14.5 - 29 * rX, z = 9.5 - 19 * rZ;
    const expected = side === 'top' ? [x, 8, -9.5] : side === 'bottom' ? [x, 8, 9.5] : [Math.round(rQ) ? x : Math.round(rV) ? -14.5 : 14.5, 8, Math.round(rQ) ? Math.round(rG) ? -9.5 : 9.5 : z];
    assert.deepEqual([...p.startPosition], expected);
    assert.equal(draws, 5, 'retain random consumption for unchanged later impulses');
  }
});
