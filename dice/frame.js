// Dice Box has no disposal API. This disposable document owns all its workers.
const workers = new Set();
const BrowserWorker = window.Worker;
window.Worker = class extends BrowserWorker {
  constructor(...args) { super(...args); workers.add(this); }
};
const base = new URL('./vendor/dice-box/', import.meta.url);
let box;
let initialization;
let disposed = false;
let resizeObserver;
let resizeFrame;
const appearance = new URLSearchParams(window.location?.search ?? '');
const setting = (key, fallback) => {
  const value = Number(appearance.get(key) ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const scale = () => {
  const { clientWidth: width, clientHeight: height } = document.getElementById('tray');
  // Keep the normal tray's readable pixel size, while leaving compact trays
  // enough physical space for several dice to settle side by side.
  const referenceWidth = setting('referenceWidth', width), referenceHeight = setting('referenceHeight', height);
  const referenceScale = Math.min(12, (4400 / 1.5) / Math.max(1, referenceHeight), 12 * Math.max(0.4, referenceWidth / Math.max(1, referenceHeight)));
  return referenceScale * referenceHeight / Math.max(1, height) * setting('sizeMultiplier', 1);
};
async function resize() {
  if (disposed || !box) return;
  await box.updateConfig({ scale: scale() });
  if (!disposed) window.dispatchEvent(new Event('resize'));
}
function dispose() {
  disposed = true;
  resizeObserver?.disconnect();
  cancelAnimationFrame(resizeFrame);
  for (const worker of workers) worker.terminate();
  workers.clear();
  for (const canvas of document.querySelectorAll('canvas')) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
window.NestDiceFrame = {
  init() {
    initialization ||= (async () => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl');
      if (!gl) throw new Error('3D dice require WebGL in this browser.');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      const { default: DiceBox } = await import(new URL('dice-box.es.js', base).href);
      if (disposed) throw new Error('Dice tray closed.');
      box = new DiceBox({
        container: '#tray', id: 'nest-dice-canvas', origin: base.origin,
        assetPath: new URL('assets/', base).pathname, theme: 'nest',
        externalThemes: { nest: new URL('./themes/nest', import.meta.url).href },
        // Leave camera clearance at the walls and start rolls near the surface.
        // This changes the throw envelope without shrinking the dice.
        offscreen: false, size: 7, startingHeight: 2, scale: scale(), settleTimeout: 2000,
        mass: 2.4, gravity: 2.3, friction: 0.95, restitution: 0.05,
        angularDamping: 0.78, linearDamping: 0.68, spinForce: 3, throwForce: 4,
        enableShadows: true, lightIntensity: 1.2, suspendSimulation: false
      });
      await box.init();
      if (disposed) throw new Error('Dice tray closed.');
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => { void resize(); });
      });
      resizeObserver.observe(document.getElementById('tray'));
    })();
    return initialization;
  },
  async roll(pool) {
    await resize();
    return box.roll(pool.map(({ sides, count }) => `${count}d${sides}`));
  },
  dispose
};
