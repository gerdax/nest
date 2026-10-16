import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryShortcuts } from '../studio/history-shortcuts.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';

function key(root, properties) {
  const event = new Event('keydown', { cancelable: true });
  for (const [name, value] of Object.entries(properties)) Object.defineProperty(event, name, { value });
  root.dispatchEvent(event);
  return event;
}

for (const modifier of ['metaKey', 'ctrlKey']) test(`${modifier} Z undoes and Shift Z redoes project history`, () => {
  const root = new EventTarget(), history = new DocumentHistory({ name: 'Before' });
  history.transact(draft => { draft.name = 'After'; });
  const stop = mountHistoryShortcuts(root, { undo: () => history.undo(), redo: () => history.redo() });
  assert.equal(key(root, { key: 'z', [modifier]: true }).defaultPrevented, true);
  assert.equal(history.document.name, 'Before');
  assert.equal(key(root, { key: 'Z', [modifier]: true, shiftKey: true }).defaultPrevented, true);
  assert.equal(history.document.name, 'After');
  stop();
  assert.equal(key(root, { key: 'z', [modifier]: true }).defaultPrevented, false);
  assert.equal(history.document.name, 'After');
});

test('typing, composition, held keys, other shortcuts and handled events preserve native behavior', () => {
  const root = new EventTarget();
  mountHistoryShortcuts(root, { undo: () => assert.fail('unexpected undo'), redo: () => assert.fail('unexpected redo') });
  for (const properties of [{ key: 'z' }, { key: 'x', metaKey: true },
    ...['isComposing', 'repeat', 'altKey'].map(name => ({ key: 'z', metaKey: true, [name]: true }))]) {
    assert.equal(key(root, properties).defaultPrevented, false);
  }
  const handled = new Event('keydown', { cancelable: true });
  Object.defineProperties(handled, { key: { value: 'z' }, metaKey: { value: true } });
  handled.preventDefault();root.dispatchEvent(handled);
  root.closest = selector => {
    assert.match(selector, /input,textarea,select/);
    assert.match(selector, /contenteditable/);
    assert.match(selector, /dialog/);
    return {};
  };
  assert.equal(key(root, { key: 'z', metaKey: true }).defaultPrevented, false);
});
