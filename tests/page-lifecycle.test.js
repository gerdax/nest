import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function pagehide(window, persisted) {
  const event = new Event('pagehide');
  Object.defineProperty(event, 'persisted', {value: persisted});
  window.dispatchEvent(event);
}

// Execute the registered production callbacks with fakes. These deterministic
// tests cover cleanup policy, not browser back/forward-cache eligibility or UI.
for (const [name, path, cleanupNames] of [
  ['player', '../studio/player.js', ['stopPerformanceTuning', 'preview']],
  ['editor', '../studio/editor.js', ['stopHistoryShortcuts', 'stopDrawerDebug', 'autoplay', 'previewWindow', 'preview']]
]) test(`${name} retains live resources on cached departures and cleans up a later terminal departure`, () => {
  const window = new EventTarget(), calls = [], context = {window};
  for (const name of cleanupNames) {
    const cleanup = () => calls.push(name);
    context[name] = name.startsWith('stop') ? cleanup : {destroy: cleanup};
  }
  const registration = source(path).split('\n').find(line => line.includes("window.addEventListener('pagehide'"));
  assert.ok(registration, `${path} registers pagehide cleanup`);
  runInNewContext(registration, context);
  pagehide(window, true);
  pagehide(window, true);
  assert.deepEqual(calls, [], 'cached departures preserve the preview and its services');
  pagehide(window, false);
  assert.deepEqual(calls, cleanupNames, 'terminal cleanup remains registered after cached departures');
});

test('dice frame keeps workers and WebGL alive across cached departures before terminal disposal', () => {
  const window = new EventTarget(), workers = [];
  let lostContexts = 0;
  window.Worker = class {
    constructor() { this.terminations = 0; workers.push(this); }
    terminate() { this.terminations++; }
  };
  const document = {querySelectorAll: () => [{getContext: () => ({getExtension: () => ({loseContext() { lostContexts++; }})})}]};
  const frameSource = source('../dice/frame.js').replace('import.meta.url', JSON.stringify(new URL('../dice/frame.js', import.meta.url).href));
  runInNewContext(frameSource, {window, document, URL});
  new window.Worker();
  pagehide(window, true);
  new window.Worker();
  pagehide(window, true);
  assert.deepEqual(workers.map(worker => worker.terminations), [0, 0]);
  assert.equal(lostContexts, 0);
  pagehide(window, false);
  assert.deepEqual(workers.map(worker => worker.terminations), [1, 1]);
  assert.equal(lostContexts, 1);
});

test('dice demo retains its service on cached departures and destroys it on a later terminal departure', () => {
  const window = new EventTarget();
  let mounts = 0, destructions = 0;
  class DiceService {
    mount() { mounts++; return this; }
    destroy() { destructions++; }
  }
  const document = {getElementById: () => ({addEventListener() {}})};
  runInNewContext(source('../dice/demo.js').replace(/^import .*;\n/, ''), {window, document, DiceService});
  assert.equal(mounts, 1);
  pagehide(window, true);
  pagehide(window, true);
  assert.equal(destructions, 0);
  pagehide(window, false);
  assert.equal(destructions, 1);
});
