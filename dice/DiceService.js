const SIDES = new Set([4, 6, 8, 10, 12, 20]);
export function validatePool(pool) {
  if (!Array.isArray(pool) || !pool.length) throw new TypeError('Provide a nonempty dice pool.');
  let total = 0;
  const result = pool.map(({ sides, count = 1 } = {}) => {
    if (!SIDES.has(sides) || !Number.isInteger(count) || count < 1) throw new TypeError('Use d4, d6, d8, d10, d12 or d20 with positive integer counts.');
    total += count;
    return { sides, count };
  });
  if (total > 30) throw new RangeError('A tray supports at most 30 dice per roll.');
  return result;
}
const abortError = () => new DOMException('Dice roll cancelled.', 'AbortError');

/** Raw physical dice only: callers interpret outcomes and own game mechanics. */
export class DiceService {
  constructor({ timeoutMs = 30000, transportFactory = createFrameTransport } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive.');
    this.timeoutMs = timeoutMs;
    this.transportFactory = transportFactory;
    this.container = null;
    this.transport = null;
    this.pending = null;
    this.destroyed = false;
  }
  mount(container) {
    if (this.destroyed) throw new Error('Dice service has been destroyed.');
    if (!container?.appendChild) throw new TypeError('mount requires a DOM container.');
    if (this.container !== container) this.clear();
    this.container = container;
    return this;
  }
  async roll(pool, { signal } = {}) {
    if (this.destroyed) throw new Error('Dice service has been destroyed.');
    if (!this.container) throw new Error('Mount the dice service before rolling.');
    if (this.pending) throw new Error('A dice roll is already in progress.');
    const request = validatePool(pool);
    if (signal?.aborted) throw abortError();
    let rejectCancel;
    const cancelled = new Promise((_, reject) => { rejectCancel = reject; });
    const operation = { cancel: () => rejectCancel(abortError()) };
    this.pending = operation;
    const onAbort = () => this.clear();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timer;
    try {
      const work = (async () => {
        this.transport ||= this.transportFactory(this.container);
        const transport = this.transport;
        await transport.ready;
        if (this.pending !== operation) throw abortError();
        const dice = await transport.roll(request);
        return { dice: dice.map(die => ({ sides: die.sides, value: die.value })) };
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dice engine timed out. Try another roll.')), this.timeoutMs);
      });
      return await Promise.race([work, cancelled, timeout]);
    } catch (error) {
      this.releaseTransport();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (this.pending === operation) this.pending = null;
    }
  }
  releaseTransport() {
    this.transport?.destroy();
    this.transport = null;
  }
  clear() {
    this.pending?.cancel();
    // Unload instead of DiceBox.clear(): upstream discards an active roll promise.
    this.releaseTransport();
  }
  destroy() {
    this.clear();
    this.container = null;
    this.destroyed = true;
  }
}

function createFrameTransport(container) {
  const frame = container.ownerDocument.createElement('iframe');
  frame.title = '3D dice tray';
  frame.style.cssText = 'width:100%;height:100%;display:block;border:0;background:transparent';
  let alive = true;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    frame.addEventListener('load', async () => {
      if (!alive) return;
      try {
        if (!frame.contentWindow.NestDiceFrame) throw new Error('Dice frame failed to load.');
        await frame.contentWindow.NestDiceFrame.init();
        if (alive) resolve();
      } catch (error) { reject(error); }
    }, { once: true });
    frame.addEventListener('error', () => reject(new Error('Dice frame failed to load.')), { once: true });
  });
  frame.src = new URL('./frame.html', import.meta.url).href;
  container.appendChild(frame);
  return {
    ready,
    roll: pool => frame.contentWindow.NestDiceFrame.roll(pool),
    destroy() {
      if (!alive) return;
      alive = false;
      rejectReady(abortError());
      frame.contentWindow?.NestDiceFrame?.dispose();
      frame.remove();
    }
  };
}
