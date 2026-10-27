import { createError, errorMessage } from '../errors.js';
import { projectCardBack } from '../project/card-backs.js';
import { saveProject, acknowledgeRecovery, STORAGE_KEY } from '../project/storage.js';
import { exportChapter, parseProject } from '../project/model.js';

/** One status boundary for edits, history travel, imports and other messages. */
export function createPersistence({loaded = {}, storage, onStatus = () => {}, onConflict = () => {},
  eventTarget, locks = globalThis.navigator?.locks} = {}) {
  let warning = loaded.error || loaded.recovery ? recoveryWarning(loaded) : '';
  let saveFailure = '', conflict = null, pending = 0, running = false, generation = 0;
  let base, baseKnown = false;
  const queue = [];
  const store = () => storage ?? globalThis.localStorage;
  try {
    if (Object.hasOwn(loaded, 'sourceText')) {base = loaded.sourceText; baseKnown = true;}
    else if (!loaded.error) {base = store().getItem(STORAGE_KEY); baseKnown = true;}
  } catch {} // Access denial is reported on save; construction must leave export usable.
  const report = (text = '') => onStatus([warning, saveFailure, pending ? 'Saving…' : '',
    text === saveFailure || (pending && text.startsWith('Saved')) ? '' : text].filter(Boolean).join(' '));
  const setConflict = primary => {
    conflict = {primary};
    saveFailure = 'Save conflict: another editor changed the saved project. Your draft is still open.';
    onConflict(conflict);
  };
  const perform = (project, options = {}) => {
    let result;
    try {
      if (!baseKnown) throw createError('STUDIO_PRIMARY_SAVE_UNREADABLE');
      result = saveProject(project, store(), {expectedPrimary:base, ...options, includePrimary:true});
    } catch (error) {result = {ok:false,error:error.message};}
    if (result.ok) {
      base = result.primary;
      conflict = null;
      saveFailure = '';
      onConflict(null);
    } else if (result.conflict) setConflict(result.primary);
    else saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message: result.error});
    return result;
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
            ? perform(JSON.parse(entry.text), entry.options)
            : {ok:false,cancelled:true,error:'Save cancelled before leaving this document.'};
          result = locks?.request ? await locks.request(STORAGE_KEY + '.write', write) : write();
        } catch (error) {
          result = {ok:false,error:error.message};
          saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:result.error});
        }
        pending -= entry.waiters.length;
        report(!pending && result.ok ? 'Saved in this browser.' : '');
        for (const resolve of entry.waiters) resolve(result);
      }
    } finally {running = false;}
  }
  const checkForChanges = () => {
    try {
      const primary = store().getItem(STORAGE_KEY);
      if (baseKnown && primary !== base) {setConflict(primary); report();}
      return conflict;
    } catch (error) {
      saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});
      report();
      return conflict;
    }
  };
  const storageChanged = event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== store()) return;
    checkForChanges();
  };
  eventTarget?.addEventListener('storage', storageChanged);
  return {
    report, checkForChanges,
    get conflict() { return conflict; },
    get hasUnsaved() { return pending > 0 || !!saveFailure; },
    save(project) {
      const result = perform(project);
      report(result.ok ? 'Saved in this browser.' : '');
      return result;
    },
    // Snapshot at enqueue time. Coalesce only not-yet-started ordinary saves;
    // explicit conflict resolutions retain their exact expected competing text.
    saveQueued(project, options = {}) {
      let text;
      try {text = JSON.stringify(project);}
      catch (error) {
        saveFailure = errorMessage('STUDIO_SAVE_FAILED', {message:error.message});
        report();
        return Promise.resolve({ok:false,error:error.message});
      }
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
    },
    cancelPending() {
      generation++;
      for (const entry of queue.splice(0)) {
        pending -= entry.waiters.length;
        for (const resolve of entry.waiters) resolve({ok:false,cancelled:true});
      }
    },
    destroy() {eventTarget?.removeEventListener('storage', storageChanged);},
    adopt() {
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
  return parseProject(JSON.stringify(project), {allowDraft:true});
}
export function exportStudioChapter(project, chapterId = project.activeChapterId) {
  const chapter = project.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) throw createError('STUDIO_UNKNOWN_CHAPTER');
  // Dependency discovery only needs the selected chapter. Other chapters may
  // still be unfinished or contain malformed draft data.
  const pkg = exportChapter({...project, cardBack:projectCardBack(project), chapters:[chapter]}, chapterId);
  parseProject(JSON.stringify(pkg));
  return pkg;
}
export function parseStudioImport(text, {kind} = {}) {
  const raw = JSON.parse(text);
  if (kind !== undefined) {
    if (!['project', 'chapter'].includes(kind)) throw createError('STUDIO_UNKNOWN_STUDIO_IMPORT_KIND');
    if (![2,3].includes(raw?.version) || raw.kind !== `nest-${kind}`) {
      throw createError('STUDIO_EXPECTED_A_VERSION_2_NEST_FILE', {kind});
    }
  }
  return {raw,project:parseProject(text, {allowDraft:raw?.kind === 'nest-project'})};
}
