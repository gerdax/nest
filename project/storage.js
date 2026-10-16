import { parseProject } from './model.js';
export const STORAGE_KEY = 'nest.project.v2';
export const LEGACY_STORAGE_KEY = 'nest.chapter.v1';
export const RECOVERY_STORAGE_KEY = 'nest.project.v2.recovery';
export const RECOVERY_NOTICE_KEY = 'nest.project.v2.recovery-notice';
const message = error => error.message || String(error);

// Keep the exact damaged payload, including malformed JSON. Never replace an
// older backup with a different payload, even after another damaged save.
function preserveDamagedSave(store, text) {
  let key = RECOVERY_STORAGE_KEY, suffix = 1;
  for (;;) {
    const existing = store.getItem(key);
    if (existing === text) break;
    if (existing === null) {
      store.setItem(key, text);
      if (store.getItem(key) !== text) throw new Error('Recovery backup could not be verified.');
      break;
    }
    key = `${RECOVERY_STORAGE_KEY}.${suffix++}`;
  }
  store.setItem(RECOVERY_NOTICE_KEY, key);
  if (store.getItem(RECOVERY_NOTICE_KEY) !== key) throw new Error('Recovery notice could not be verified.');
  return key;
}
export function saveProject(project, storage) {
  try {
    const text = JSON.stringify(parseProject(JSON.stringify(project), {allowDraft:true}));
    const store = storage ?? globalThis.localStorage;
    const current = store.getItem(STORAGE_KEY);
    if (current !== null) {
      try { parseProject(current, {allowDraft:true}); }
      catch {
        try { preserveDamagedSave(store, current); }
        catch (error) { throw new Error(`Damaged browser save was not replaced: ${message(error)}`); }
      }
    }
    store.setItem(STORAGE_KEY, text);
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
    if (store.getItem(RECOVERY_NOTICE_KEY) !== null) throw new Error('Recovery notice could not be cleared.');
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
      if (text === null) throw new Error('The recovery backup is no longer available.');
      return {ok:true,text,key};
    }
    throw new Error('No damaged browser save is available to download.');
  } catch (error) { return {ok:false,error:message(error)}; }
}
