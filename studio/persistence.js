import { createError, errorMessage } from '../errors.js';
import { projectCardBack } from '../project/card-backs.js';
import { saveProject, acknowledgeRecovery, STORAGE_KEY } from '../project/storage.js';
import { exportChapter, parseCurrentProject } from '../project/model.js';

/** One status boundary for edits, history travel, imports and other messages. */
export function createPersistence({loaded = {}, storage, onStatus = () => {}, onConflict = () => {},
  eventTarget, backend, download, locks = globalThis.navigator?.locks} = {}) {
  let warning = loaded.error || loaded.recovery ? recoveryWarning(loaded) : '';
  let saveFailure = '', conflict = null, pending = 0, running = false, generation = 0, destroyed = false;
  let lastSaveResult = {ok:true};
  const flushWaiters = [];
  const settleFlush = () => {
    if (!pending && !running && !queue.length) for (const resolve of flushWaiters.splice(0)) resolve(lastSaveResult);
  };
  let autosaveEnabled = loaded.project?.autosave !== false;
  let draftText = loaded.project ? JSON.stringify(loaded.project) : null;
  let savedDraftText = draftText;
  let base, baseKnown = false;
  const queue = [];
  const store = () => storage ?? globalThis.localStorage;
  const savedMessage = download ? 'Project JSON downloaded.' : backend?.savedMessage || 'Saved in this browser.';
  try {
    if (Object.hasOwn(loaded, 'sourceText')) {base = loaded.sourceText; baseKnown = true;}
    else if (!backend && !download && !loaded.error) {base = store().getItem(STORAGE_KEY); baseKnown = true;}
  } catch {} // Access denial is reported on save; construction must leave export usable.
  const dirty = () => draftText !== savedDraftText;
  const report = (text = '') => !destroyed && onStatus([warning, saveFailure,
    pending ? 'Saving…' : dirty() ? 'Unsaved changes.' : '',
    download ? 'Opened from disk. Autosave is off.' : !autosaveEnabled ? 'Autosave off.' : '',
    text === saveFailure || ((pending || dirty()) && text.startsWith('Saved')) ? '' : text].filter(Boolean).join(' '));
  const setConflict = primary => {
    conflict = {primary};
    saveFailure = 'Save conflict: another editor changed the saved project. Your draft is still open.';
    onConflict(conflict);
  };
  const applyResult = (result, text, saveGeneration) => {
    if (saveGeneration !== generation) return {ok:false,cancelled:true};
    lastSaveResult = result;
    if (result.ok) {
      base = result.primary;
      baseKnown = true;
      conflict = null;
      saveFailure = '';
      savedDraftText = text;
      onConflict(null);
    } else if (result.conflict) setConflict(result.primary);
    else saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message: result.error});
    return result;
  };
  const perform = (project, options = {}, text = JSON.stringify(project), saveGeneration = generation) => {
    let result;
    try {
      if (download) {
        download(exportProjectDraft(project));
        result = {ok:true,primary:text};
      } else {
        if (!baseKnown) throw createError('STUDIO_PRIMARY_SAVE_UNREADABLE');
        const saveOptions = {expectedPrimary:base, ...options, includePrimary:true};
        result = backend ? backend.save(project, saveOptions) : saveProject(project, store(), saveOptions);
      }
    } catch (error) {result = {ok:false,error:error.message};}
    if (backend) return Promise.resolve(result).catch(error => ({ok:false,error:error.message}))
      .then(result => applyResult(result, text, saveGeneration));
    return applyResult(result, text, saveGeneration);
  };
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const entry = queue.shift();
        let result;
        try {
          const write = () => entry.generation === generation
            ? perform(JSON.parse(entry.text), entry.options, entry.text, entry.generation)
            : {ok:false,cancelled:true,error:'Save cancelled before leaving this document.'};
          result = !download && locks?.request ? await locks.request(STORAGE_KEY + '.write', write) : await write();
        } catch (error) {
          result = {ok:false,error:error.message};
          if (entry.generation === generation) {lastSaveResult = result; saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:result.error});}
        }
        pending -= entry.waiters.length;
        if (entry.generation === generation) report(!pending && result.ok ? savedMessage : '');
        for (const resolve of entry.waiters) resolve(result);
      }
    } finally {running = false; settleFlush();}
  }
  const checkForChanges = () => {
    if (destroyed || pending || download) return backend ? Promise.resolve(conflict) : conflict;
    const checkGeneration = generation, checkBase = base;
    const obsolete = () => checkGeneration !== generation || checkBase !== base || pending > 0;
    const checked = primary => {
      if (obsolete()) return conflict;
      if (baseKnown && primary !== base) {setConflict(primary); report();}
      return conflict;
    };
    const failed = error => {
      if (obsolete()) return conflict;
      saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});
      report();
      return conflict;
    };
    try {
      return backend ? Promise.resolve(backend.read()).then(checked, failed) : checked(store().getItem(STORAGE_KEY));
    } catch (error) {return failed(error);}
  };
  // Both automatic and explicit saves use the existing conflict-aware queue.
  // A completed old snapshot must not mark a newer, unsaved draft as saved.
  const queueSave = (project, options = {}) => {
    if (destroyed) return Promise.resolve({ok:false,cancelled:true});
    let text;
    try {text = JSON.stringify(project);}
    catch (error) {
      saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});
      report();
      lastSaveResult = {ok:false,error:error.message};
      return Promise.resolve(lastSaveResult);
    }
    draftText = text;
    autosaveEnabled = project.autosave !== false;
    pending++;
    const promise = new Promise(resolve => {
      const previous = queue.at(-1);
      if (previous && !Object.keys(options).length && !Object.keys(previous.options).length) {
        previous.text = text;
        previous.waiters.push(resolve);
      } else queue.push({text,options,generation,waiters:[resolve]});
    });
    report();
    queueMicrotask(drain);
    return promise;
  };
  const cancelPending = () => {
    generation++;
    lastSaveResult = {ok:false,cancelled:true};
    draftText = savedDraftText;
    for (const entry of queue.splice(0)) {
      pending -= entry.waiters.length;
      for (const resolve of entry.waiters) resolve({ok:false,cancelled:true});
    }
    settleFlush();
  };
  const storageChanged = event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== store()) return;
    checkForChanges();
  };
  if (!backend && !download) eventTarget?.addEventListener('storage', storageChanged);
  return {
    report, checkForChanges,
    get lastSaveResult() {return lastSaveResult;},
    flush() {
      if (!pending && !running && !queue.length) return Promise.resolve(lastSaveResult);
      return new Promise(resolve => flushWaiters.push(resolve));
    },
    get savedMessage() { return savedMessage; },
    get conflict() { return conflict; },
    get hasUnsaved() { return pending > 0 || dirty() || !!saveFailure; },
    save(project) {
      if (destroyed) return {ok:false,cancelled:true};
      if (backend || download) return queueSave(project);
      try {draftText = JSON.stringify(project);} catch (error) {
        saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});report();
        lastSaveResult = {ok:false,error:error.message};
        return lastSaveResult;
      }
      autosaveEnabled = project.autosave !== false;
      const result = perform(project, {}, draftText);
      report(result.ok ? savedMessage : '');
      return result;
    },
    saveAutomatic(project) {
      if (destroyed) return Promise.resolve({ok:false,cancelled:true});
      const enabled = project.autosave !== false;
      // Persist a setting change once, including turning autosave off. Later
      // ordinary edits remain in memory until Save or re-enabling autosave.
      if (!download && (enabled || enabled !== autosaveEnabled)) return queueSave(project);
      try {draftText = JSON.stringify(project);} catch (error) {
        saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});report();
        lastSaveResult = {ok:false,error:error.message};
        return Promise.resolve(lastSaveResult);
      }
      report();
      return Promise.resolve({ok:true,deferred:true});
    },
    // Snapshot at enqueue time. Coalesce only not-yet-started ordinary saves;
    // explicit conflict resolutions retain their exact expected competing text.
    saveQueued(project, options = {}) {
      return queueSave(project, options);
    },
    cancelPending,
    destroy() {destroyed = true; cancelPending(); if (!backend && !download) eventTarget?.removeEventListener('storage', storageChanged);},
    adopt() {
      if (backend || download) {warning = ''; return {ok:true};}
      const result = acknowledgeRecovery(storage);
      if (result.ok) warning = '';
      else report(errorMessage('STUDIO_RECOVERY_WARNING_RETAINED', {message: result.error}));
      return result;
    }
  };
}
function recoveryWarning(loaded) {
  if (loaded.recovery?.backupKey) return errorMessage('STUDIO_RECOVERY_DAMAGED_SAVE_PRESERVED');
  return errorMessage('STUDIO_RECOVERY_SAVE_COULD_NOT_BE_LOADED', {loadedError: loaded.error, backupError: loaded.recovery?.error});
}

export function travelHistory(history, method, persistence) {
  if (!['undo','redo'].includes(method)) throw createError('STUDIO_UNKNOWN_HISTORY_OPERATION');
  if (!history[method]()) return {changed:false};
  const project = history.document;
  return {changed:true,project,saved:persistence.save(project)};
}

// Project files are portable authoring drafts. Playable chapter files and the
// player keep the model's default strict validation.
export function exportProjectDraft(project) {
  return parseCurrentProject(JSON.stringify(project), {allowDraft:true});
}
export function exportStudioChapter(project, chapterId = project.activeChapterId) {
  const chapter = project.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) throw createError('STUDIO_UNKNOWN_CHAPTER');
  // Dependency discovery only needs the selected chapter. Other chapters may
  // still be unfinished or contain malformed draft data.
  const pkg = exportChapter({...project, cardBack:projectCardBack(project), chapters:[chapter]}, chapterId);
  parseCurrentProject(JSON.stringify(pkg));
  return pkg;
}
export function parseStudioImport(text, {kind} = {}) {
  const raw = JSON.parse(text);
  if (kind !== undefined) {
    if (!['project', 'chapter'].includes(kind)) throw createError('STUDIO_UNKNOWN_STUDIO_IMPORT_KIND');
    if (raw?.version !== 3 || raw.kind !== `nest-${kind}`) {
      throw createError('STUDIO_EXPECTED_A_VERSION_3_NEST_FILE', {kind});
    }
  }
  return {raw,project:parseCurrentProject(text, {allowDraft:raw?.kind === 'nest-project'})};
}
