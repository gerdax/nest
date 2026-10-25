import { createError, errorMessage } from '../errors.js';
import { projectCardBack } from '../project/card-backs.js';
import { saveProject, acknowledgeRecovery } from '../project/storage.js';
import { exportChapter, parseProject } from '../project/model.js';

/** One status boundary for edits, history travel, imports and other messages. */
export function createPersistence({loaded = {}, storage, onStatus = () => {}} = {}) {
  let warning = loaded.error || loaded.recovery ? recoveryWarning(loaded) : '';
  let saveFailure = '';
  const report = text => onStatus([warning, saveFailure, text === saveFailure ? '' : text].filter(Boolean).join(' '));
  return {
    report,
    save(project) {
      const result = saveProject(project, storage);
      saveFailure = result.ok ? '' : errorMessage('STUDIO_SAVE_FAILED', {message: result.error});
      report(result.ok ? 'Saved in this browser.' : '');
      return result;
    },
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
    if (raw?.version !== 2 || raw.kind !== `nest-${kind}`) {
      throw createError('STUDIO_EXPECTED_A_VERSION_2_NEST_FILE', {kind});
    }
  }
  return {raw,project:parseProject(text, {allowDraft:raw?.kind === 'nest-project'})};
}
