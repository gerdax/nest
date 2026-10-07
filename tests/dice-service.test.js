import test from 'node:test';
import assert from 'node:assert/strict';
import { DiceService, validatePool } from '../dice/DiceService.js';
const container = { appendChild() {} };
function fixture(overrides = {}, options = {}) {
  const transports = [];
  const service = new DiceService({ ...options, transportFactory: () => {
    const transport = { ready: Promise.resolve(), roll: async () => [{ sides: 6, value: 4, groupId: 0 }], destroy() { this.closed = true; }, ...overrides };
    transports.push(transport);
    return transport;
  } }).mount(container);
  return { service, transports };
}
test('validates a bounded physical pool without expressions or game rules', () => {
  assert.deepEqual(validatePool([{ sides: 12 }, { sides: 6, count: 2 }]), [{ sides: 12, count: 1 }, { sides: 6, count: 2 }]);
  for (const pool of [[], '2d6+4', [{ sides: 3 }], [{ sides: 6, count: 0 }], [{ sides: 6, count: 1.5 }], [{ sides: 6, count: 31 }]]) assert.throws(() => validatePool(pool));
});
test('returns raw settled values and reuses a settled tray', async () => {
  const { service, transports } = fixture();
  assert.deepEqual(await service.roll([{ sides: 6 }]), { dice: [{ sides: 6, value: 4 }] });
  await service.roll([{ sides: 6 }]);
  assert.equal(transports.length, 1);
  service.destroy();
  assert.equal(transports[0].closed, true);
  await assert.rejects(service.roll([{ sides: 6 }]), /destroyed/);
});
test('clear cancels a live roll and a later roll gets a fresh world', async () => {
  const { service, transports } = fixture({ roll: () => new Promise(() => {}) });
  const pending = service.roll([{ sides: 6 }]);
  await Promise.resolve();
  await assert.rejects(service.roll([{ sides: 6 }]), /already in progress/);
  service.clear();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(transports[0].closed, true);
  service.transportFactory = () => ({ ready: Promise.resolve(), roll: async () => [{ sides: 6, value: 2 }], destroy() {} });
  assert.deepEqual(await service.roll([{ sides: 6 }]), { dice: [{ sides: 6, value: 2 }] });
});
test('abort during initialization, destroy, and timeout all release the world', async () => {
  for (const action of ['abort', 'destroy', 'timeout']) {
    const { service, transports } = fixture({ ready: new Promise(() => {}) }, { timeoutMs: 10 });
    const controller = new AbortController();
    const pending = service.roll([{ sides: 6 }], { signal: controller.signal });
    if (action === 'abort') controller.abort();
    if (action === 'destroy') service.destroy();
    await assert.rejects(pending, action === 'timeout' ? /timed out/ : { name: 'AbortError' });
    assert.equal(transports[0].closed, true);
  }
});
test('mount and pre-abort fail without creating an engine; separate services are independent', async () => {
  const unmounted = new DiceService();
  await assert.rejects(unmounted.roll([{ sides: 6 }]), /Mount/);
  const a = fixture();
  const b = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(a.service.roll([{ sides: 6 }], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(a.transports.length, 0);
  a.service.destroy();
  await b.service.roll([{ sides: 6 }]);
  assert.equal(b.transports.length, 1);
  b.service.destroy();
});
