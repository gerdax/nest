import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterChapter } from '../chapter/model.js';
import { STORAGE_KEY, loadChapter, saveChapter } from '../editor/storage.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
}

test('chapter local save round trips and absent save is empty', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadChapter(storage), { chapter: null });
  const chapter = createStarterChapter();
  assert.deepEqual(saveChapter(chapter, storage), { ok: true });
  assert.deepEqual(loadChapter(storage), { chapter });
  assert.notEqual(loadChapter(storage).chapter, chapter);
});

test('bad stored JSON and invalid chapter are reported without overwriting valid save', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{');
  assert.equal(loadChapter(storage).chapter, null);
  assert.equal(typeof loadChapter(storage).error, 'string');
  storage.setItem(STORAGE_KEY, '{}');
  assert.equal(loadChapter(storage).chapter, null);
  assert.equal(typeof loadChapter(storage).error, 'string');
  const chapter = createStarterChapter();
  saveChapter(chapter, storage);
  assert.equal(saveChapter({}, storage).ok, false);
  assert.deepEqual(loadChapter(storage).chapter, chapter);
});

test('storage access and quota failures are returned', () => {
  const unavailable = {
    getItem() { throw new Error('Storage unavailable'); },
    setItem() { throw new Error('Quota exceeded'); },
  };
  assert.deepEqual(loadChapter(unavailable), { chapter: null, error: 'Storage unavailable' });
  assert.deepEqual(saveChapter(createStarterChapter(), unavailable), { ok: false, error: 'Quota exceeded' });
});

test('incomplete drafts remain saved for later editing', () => {
  const storage = memoryStorage();
  const chapter = createStarterChapter();
  chapter.nodes[1].connections.next = 'unfinished';
  chapter.sequences[1].items = [];
  assert.deepEqual(saveChapter(chapter, storage), { ok: true });
  assert.deepEqual(loadChapter(storage).chapter, chapter);
});
