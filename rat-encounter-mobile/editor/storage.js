import { parseChapter } from '../chapter/model.js';

export const STORAGE_KEY = 'nest.chapter.v1';

// Access the browser storage inside the try block: privacy settings may deny
// even reading localStorage, before getItem or setItem can be called.
export function saveChapter(chapter, storage) {
  try {
    const text = JSON.stringify(chapter);
    parseChapter(text, { allowDraft: true });
    (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

export function loadChapter(storage) {
  try {
    const text = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
    return { chapter: text === null ? null : parseChapter(text, { allowDraft: true }) };
  } catch (error) {
    return { chapter: null, error: error.message || String(error) };
  }
}
