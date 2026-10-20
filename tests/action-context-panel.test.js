import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionContextPanel } from '../studio/ActionContextPanel.js';

class Element extends EventTarget {
  constructor(doc, tag) {
    super(); this.ownerDocument = doc; this.tagName = tag; this.children = [];
    this.attrs = {}; this.style = {}; this.textContent = ''; this.layouts = [];
    this.classList = { add: name => { this.className = name; } };
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() {
    this.layouts.push({ hidden: this.hidden, visible: this.attrs['data-visible'] });
    return {};
  }
}

function setup(options) {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  doc.createElement = tag => new Element(doc, tag);
  return new ActionContextPanel(new Element(doc, 'section'), options);
}
const item = { id: 'wedge', name: 'Wedge', image: 'wedge.png' };
const info = { stat: 'LUCK', chance: '63.7', label: 'Lucky escape', formula: 'D20 + luck', rules: 'At least 12' };

test('one caption and content container switch between item and check modes', () => {
  const panel = setup();
  const caption = panel.caption;
  assert.equal(panel.root.className, 'action-context-panel');
  assert.equal(panel.root.attrs['aria-live'], 'polite');
  assert.equal(panel.root.attrs['aria-atomic'], 'true');
  assert.equal(panel.checkDetails.attrs['aria-live'], undefined);
  assert.deepEqual(panel.root.children, [caption, panel.content]);
  assert.deepEqual(panel.content.children, [panel.checkDetails, panel.mini.root]);
  panel.update({ item });
  assert.equal(panel.caption.textContent, 'USING');
  assert.equal(panel.checkDetails.hidden, true);
  assert.equal(panel.mini.item, item);
  assert.equal(panel.root.attrs['data-mode'], 'item');
  assert.equal(panel.root.attrs['data-visible'], 'true');
  assert.equal(panel.root.attrs['aria-hidden'], 'false');
  assert.equal(panel.root.attrs.inert, undefined);
  assert.deepEqual(panel.root.layouts, [{ hidden: false, visible: 'false' }]);
  panel.update({ info, item });
  assert.equal(panel.caption, caption);
  assert.equal(caption.textContent, 'LUCK');
  assert.equal(panel.root.attrs['data-mode'], 'check');
  assert.equal(panel.checkDetails.hidden, false);
  assert.equal(panel.checkChance.textContent, '64%');
  assert.equal(panel.checkRules.textContent, info.label);
  assert.equal(panel.checkDetails.title, 'D20 + luck · At least 12');
  assert.equal(panel.mini.item, null, 'check wins when both are supplied');
  panel.update({ info: { stat: 'SKILL', chance: 0 } });
  assert.equal(caption.textContent, 'SKILL');
  assert.equal(panel.checkChance.textContent, '0%');
  assert.equal(panel.checkRules.hidden, true);
  assert.equal(panel.checkDetails.title, '');
  panel.update({ item });
  assert.equal(caption.textContent, 'USING');
  assert.equal(panel.checkChance.textContent, '');
  panel.destroy();
});

test('empty context fades painted content but immediately ends and prevents inspection', () => {
  const calls = [];
  let canHold = true;
  const panel = setup({ onHold: value => calls.push(value), canHold: () => canHold });
  panel.update({ item });
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), true);
  const button = panel.mini.button;
  panel.update();
  assert.equal(panel.root.hidden, false);
  assert.equal(panel.root.attrs['data-visible'], 'false');
  assert.equal(panel.root.attrs['aria-hidden'], 'true');
  assert.equal(panel.root.attrs.inert, '');
  assert.equal(panel.caption.textContent, 'USING');
  assert.equal(panel.mini.button, button);
  assert.equal(button.disabled, true);
  assert.equal(panel.mini.held, null);
  assert.deepEqual(calls, [item, null]);
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ item });
  assert.equal(panel.root.attrs['data-visible'], 'true');
  assert.equal(button.disabled, false, 'same item is enabled after interrupted exit');
  assert.equal(panel.root.layouts.length, 2);
  canHold = false;
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ item, busy: true });
  canHold = true;
  assert.equal(panel.mini.button.disabled, true);
  assert.equal(panel.mini.beginHold({ key: 'Enter' }), false);
  panel.update({ info });
  panel.update();
  assert.equal(panel.caption.textContent, 'LUCK');
  assert.equal(panel.checkChance.textContent, '64%');
  assert.equal(panel.checkDetails.hidden, false);
  panel.destroy();
});

test('clear resets immediately and destroy removes hold listeners', () => {
  const calls = [];
  const panel = setup({ onHold: value => calls.push(value) });
  panel.update({ info });
  panel.clear();
  assert.equal(panel.root.hidden, true);
  assert.equal(panel.caption.textContent, '');
  assert.equal(panel.checkChance.textContent, '');
  assert.equal(panel.checkRules.textContent, '');
  assert.equal(panel.checkDetails.title, '');
  assert.equal(panel.checkDetails.hidden, true);
  assert.equal(panel.mini.item, null);
  assert.equal(panel.root.attrs['data-mode'], undefined);
  panel.update({ item });
  panel.mini.beginHold({ key: 'Enter' });
  const view = panel.mini.view;
  const doc = panel.root.ownerDocument;
  const removed = [];
  view.removeEventListener = type => removed.push(type);
  doc.removeEventListener = type => removed.push(type);
  panel.destroy();
  assert.equal(panel.root.hidden, true);
  assert.equal(panel.root.attrs['data-visible'], 'false');
  assert.equal(panel.root.attrs['aria-hidden'], 'true');
  assert.equal(panel.root.attrs.inert, '');
  assert.equal(panel.mini.item, null);
  assert.equal(panel.mini.root.children.length, 0);
  assert.deepEqual(calls, [item, null]);
  assert.deepEqual(removed, ['pointerup', 'pointercancel', 'blur', 'resize', 'visibilitychange']);
});
