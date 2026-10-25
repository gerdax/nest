import { createError } from '../errors.js';
import { parseProject } from './model.js';
export const STORAGE_KEY = 'nest.project.v2';
export const LEGACY_STORAGE_KEY = 'nest.chapter.v1';
export const RECOVERY_STORAGE_KEY = 'nest.project.v2.recovery';
export const RECOVERY_NOTICE_KEY = 'nest.project.v2.recovery-notice';
const message = error => error.message || String(error);
// One exact, validated primary payload per adapter. Always reread storage before
// using it: another tab, import, or adapter can replace the primary at any time.
const validatedPrimary = new WeakMap();

// Keep the exact damaged payload, including malformed JSON. Never replace an
// older backup with a different payload, even after another damaged save.
function preserveDamagedSave(store, text) {
  let key = RECOVERY_STORAGE_KEY, suffix = 1;
  for (;;) {
    const existing = store.getItem(key);
    if (existing === text) break;
    if (existing === null) {
      store.setItem(key, text);
      if (store.getItem(key) !== text) throw createError('PROJECT_RECOVERY_BACKUP_COULD_NOT_BE_VERIFIED');
      break;
    }
    key = `${RECOVERY_STORAGE_KEY}.${suffix++}`;
  }
  store.setItem(RECOVERY_NOTICE_KEY, key);
  if (store.getItem(RECOVERY_NOTICE_KEY) !== key) throw createError('PROJECT_RECOVERY_NOTICE_COULD_NOT_BE_VERIFIED');
  return key;
}
export function saveProject(project, storage) {
  try {
    const text = JSON.stringify(parseProject(JSON.stringify(project), {allowDraft:true}));
    const store = storage ?? globalThis.localStorage;
    const current = store.getItem(STORAGE_KEY);
    if (current !== null && current !== validatedPrimary.get(store)) {
      try { parseProject(current, {allowDraft:true}); }
      catch {
        try { preserveDamagedSave(store, current); }
        catch (error) { throw createError('PROJECT_DAMAGED_SAVE_NOT_REPLACED', { reason: message(error) }); }
      }
    }
    store.setItem(STORAGE_KEY, text);
    // Outgoing data was normalized and validated above. Failed writes never
    // populate this cache, and a different stored string is never trusted.
    validatedPrimary.set(store, text);
    return {ok:true};
  } catch (error) { return {ok:false,error:message(error)}; }
}
export function loadProject(storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    const text = store.getItem(STORAGE_KEY);
    if (text !== null) {
      let project;
      try { project = parseProject(text, {allowDraft:true}); }
      catch (error) {
        try {
          const backupKey = preserveDamagedSave(store, text);
          return {project:null,error:message(error),recovery:{backupKey}};
        } catch (backupError) {
          return {project:null,error:message(error),recovery:{error:message(backupError)}};
        }
      }
      const backupKey = store.getItem(RECOVERY_NOTICE_KEY);
      return {project,...(backupKey ? {recovery:{backupKey}} : {})};
    }
    const old = store.getItem(LEGACY_STORAGE_KEY);
    return {project:old === null ? null : parseProject(old, {allowDraft:true}),migrated:old !== null};
  } catch (error) { return {project:null,error:message(error)}; }
}

// Explicit adoption clears only the notice. Recovery payloads remain available.
export function acknowledgeRecovery(storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    store.removeItem(RECOVERY_NOTICE_KEY);
    if (store.getItem(RECOVERY_NOTICE_KEY) !== null) throw createError('PROJECT_RECOVERY_NOTICE_COULD_NOT_BE_CLEARED');
    return {ok:true};
  } catch (error) { return {ok:false,error:message(error)}; }
}

// Read only: downloading recovery data must never disturb either stored copy.
export function readRecoveredSave(storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    // A newer damaged primary may not have fit in storage as a backup. Its
    // untouched text takes priority over any notice for an older recovery.
    const current = store.getItem(STORAGE_KEY);
    if (current !== null) {
      try { parseProject(current, {allowDraft:true}); }
      catch { return {ok:true,text:current,key:STORAGE_KEY}; }
    }
    const key = store.getItem(RECOVERY_NOTICE_KEY);
    if (key) {
      const text = store.getItem(key);
      if (text === null) throw createError('PROJECT_THE_RECOVERY_BACKUP_IS_NO_LONGER_AVAILABLE');
      return {ok:true,text,key};
    }
    throw createError('PROJECT_NO_DAMAGED_BROWSER_SAVE_IS_AVAILABLE_TO_DOWNLOAD');
  } catch (error) { return {ok:false,error:message(error)}; }
}
