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
const scale = () => (4400 / 1.5) / Math.max(1, document.getElementById('tray').clientHeight);
function dispose() {
  disposed = true;
  for (const worker of workers) worker.terminate();
  workers.clear();
  for (const canvas of document.querySelectorAll('canvas')) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
window.addEventListener('pagehide', dispose, { once: true });
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
        assetPath: new URL('assets/', base).pathname, theme: 'default', themeColor: '#efe0bf',
        offscreen: false, scale: scale(), settleTimeout: 2000,
        mass: 2.4, gravity: 2.3, friction: 0.95, restitution: 0.05,
        angularDamping: 0.78, linearDamping: 0.68, spinForce: 3, throwForce: 4,
        enableShadows: true, lightIntensity: 1.2, suspendSimulation: false
      });
      await box.init();
      if (disposed) throw new Error('Dice tray closed.');
    })();
    return initialization;
  },
  async roll(pool) {
    await box.updateConfig({ scale: scale() });
    window.dispatchEvent(new Event('resize'));
    return box.roll(pool.map(({ sides, count }) => `${count}d${sides}`));
  },
  dispose
};
