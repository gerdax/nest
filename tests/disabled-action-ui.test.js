import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ActionContextPanel } from '../studio/ActionContextPanel.js';
import { ProjectPreview } from '../studio/ProjectPreview.js';
import { stageActionDeck, decorateCard, announceDeck } from '../engine/renderer.js';

class Element extends EventTarget {
  constructor(doc) {
    super(); this.ownerDocument = doc; this.attrs = {}; this.style = {}; this.children = [];
    this.classList = { add: value => { this.className = value; } };
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  getBoundingClientRect() { return {}; }
  remove() {}
}
function setup() {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  doc.createElement = () => new Element(doc);
  return { doc, panel: new ActionContextPanel(new Element(doc)) };
}
const info = { stat: 'LUCK', chance: 60 };
const item = { id: 'lockpick', name: 'Lockpick' };

test('disabled reason shares the caption, suppresses odds and item, and restores context', () => {
  const { panel } = setup(), caption = panel.caption;
  panel.update({ info, item });
  panel.mini.beginHold({ key: 'Enter' });
  panel.update({ info, item, disabledReason: 'REQUIRES: LOCKPICK' });
  assert.equal(panel.caption, caption);
  assert.equal(caption.textContent, 'REQUIRES: LOCKPICK');
  assert.equal(panel.root.attrs['data-mode'], 'reason');
  assert.equal(panel.visible, true);
  assert.equal(panel.checkDetails.hidden, true);
  assert.equal(panel.checkChance.textContent, '');
  assert.equal(panel.mini.item, null);
  assert.equal(panel.mini.held, null);
  assert.equal(panel.itemColumn.hidden, true);
  panel.update({ info, item });
  assert.equal(caption.textContent, 'LUCK');
  assert.equal(panel.root.attrs['data-mode'], 'check-item');
  assert.equal(panel.mini.item, item);
  panel.update({ disabledReason: 'REQUIRES: ENERGY' });
  panel.update();
  assert.equal(panel.visible, false);
  assert.equal(caption.textContent, 'REQUIRES: ENERGY', 'caption remains painted during exit');
  assert.equal(panel.root.attrs['aria-hidden'], 'true');
  panel.clear();
  assert.equal(caption.textContent, '');
  assert.equal(panel.root.hidden, true);
  panel.destroy();
});

test('completed check feedback takes precedence over a disabled reason', () => {
  const { panel } = setup();
  panel.update({ disabledReason: 'REQUIRES: ENERGY', result: { target: 8, total: 10, success: true } });
  assert.equal(panel.root.attrs['data-mode'], 'result');
  assert.equal(panel.caption.textContent, 'TARGET: 8  CHECK: 10');
  assert.equal(panel.checkChance.textContent, 'SUCCESS');
  panel.destroy();
});

test('reason changes crossfade in the shared caption lane and clear cancels painted copies', () => {
  const { panel } = setup(), animations = [];
  const animate = function (frames) {
    const animation = { frames, cancel() { this.cancelled = true; } };
    animations.push(animation); return animation;
  };
  panel.view.animate = animate;
  panel.view.cloneNode = () => {
    const clone = new Element(panel.root.ownerDocument);
    clone.caption = panel.caption.textContent;
    clone.animate = animate;
    return clone;
  };
  panel.update({ disabledReason: 'REQUIRES: LOCKPICK', selectionKey: 'door' });
  panel.update({ disabledReason: 'REQUIRES: ENERGY', selectionKey: 'door' });
  assert.equal(panel.caption.textContent, 'REQUIRES: ENERGY');
  assert.equal(panel.outgoing.node.caption, 'REQUIRES: LOCKPICK');
  assert.equal(panel.outgoing.node.attrs['aria-hidden'], 'true');
  assert.equal(panel.outgoing.node.attrs.inert, '');
  assert.deepEqual(animations.map(animation => animation.frames), [
    [{ opacity: 0 }, { opacity: 1 }], [{ opacity: 1 }, { opacity: 0 }],
  ]);
  panel.clear();
  assert.ok(animations.every(animation => animation.cancelled));
  assert.equal(panel.outgoingLayers.size, 0);
  panel.destroy();
});

test('preview follows selected disabled actions including a single linear action and clears on checking or close', () => {
  let context;
  const preview = {
    deck: { phase: 'choices', index: 0, content: { decisionOnly: true, actions: [
      { id: 'blocked', disabled: true, disabledReason: 'REQUIRES: LOCKPICK', checkInfo: info },
      { id: 'enabled', checkInfo: info },
    ] } },
    state: { idle: true }, actionContext: { update: value => { context = value; } }, syncBackdrop() {},
  };
  const sync = () => ProjectPreview.prototype.syncActionContext.call(preview);
  sync(); assert.equal(context.disabledReason, 'REQUIRES: LOCKPICK');
  preview.deck.index = 1; sync(); assert.equal(context.disabledReason, null);
  preview.deck.content.actions = [preview.deck.content.actions[0]];
  preview.deck.index = 0; sync(); assert.equal(context.disabledReason, 'REQUIRES: LOCKPICK');
  preview.state.checking = true; sync(); assert.equal(context.disabledReason, null);
  preview.state.checking = false; preview.deck.phase = 'closed';
  sync(); assert.equal(context.disabledReason, null);
  preview.deck.phase = 'choices'; preview.state.completed = true;
  sync(); assert.equal(context.disabledReason, null);
});

test('disabled front decoration survives retained cards and leaves backs and artwork filters independent', () => {
  const { doc, panel } = setup();
  const original = globalThis.document;
  globalThis.document = doc;
  try {
    const deck = { mount: new Element(doc), decorate(...args) { return decorateCard(this, ...args); } };
    const action = { id: 'a', cardKind: 'action', text: 'Open', disabled: true, disabledReason: 'REQUIRES: LOCKPICK' };
    const content = { decisionOnly: true, actions: [action] };
    const staged = stageActionDeck(deck, content);
    const front = staged.cards[0], back = staged.cardBacks[0];
    assert.equal(front.attrs['data-card-kind'], 'action');
    assert.equal(front.attrs['data-action-disabled'], 'true');
    assert.equal(front.attrs['aria-disabled'], 'true');
    assert.equal(front.attrs['aria-description'], action.disabledReason);
    assert.equal(back.attrs['data-action-disabled'], undefined);
    assert.equal(front.style.filter, undefined, 'availability never overwrites inline filters');
    const live = { ...content, actions: [{ ...action, disabled: false, disabledReason: undefined }] };
    const updated = stageActionDeck(deck, live, 0, staged);
    assert.equal(updated.cards[0], front);
    assert.equal(front.attrs['data-action-disabled'], 'false');
    assert.equal(front.attrs['aria-description'], undefined);
    const css = readFileSync(new URL('../engine/card-deck.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /\[data-action-disabled="true"\][^{]*\{[^}]*(?:filter|opacity)\s*:/, 'unavailable cards keep normal brightness');
    const liveRegion = new Element(doc);
    announceDeck({ content, index: 0, phase: 'choices', open: true, cards: [front], live: liveRegion });
    assert.match(liveRegion.textContent, /Unavailable choice: REQUIRES: LOCKPICK/);
  } finally { globalThis.document = original; panel.destroy(); }
});
