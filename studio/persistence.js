import { saveProject, acknowledgeRecovery } from '../project/storage.js';
import { parseProject } from '../project/model.js';

/** One status boundary for edits, history travel, imports and other messages. */
export function createPersistence({loaded = {}, storage, onStatus = () => {}} = {}) {
  let warning = loaded.error || loaded.recovery ? recoveryWarning(loaded) : '';
  let saveFailure = '';
  const report = text => onStatus([warning, saveFailure, text === saveFailure ? '' : text].filter(Boolean).join(' '));
  return {
    report,
    save(project) {
      const result = saveProject(project, storage);
      saveFailure = result.ok ? '' : `Save failed: ${result.error}`;
      report(result.ok ? 'Saved in this browser.' : '');
      return result;
    },
    adopt() {
      const result = acknowledgeRecovery(storage);
      if (result.ok) warning = '';
      else report(`Recovery warning retained: ${result.error}`);
      return result;
    }
  };
}
function recoveryWarning(loaded) {
  if (loaded.recovery?.backupKey) return `Recovery warning: a damaged browser save is preserved. Use Download recovered save to keep its exact text. Import a project to explicitly replace the working document; the backup will remain.`;
  return `Recovery warning: browser save could not be loaded${loaded.error ? ` (${loaded.error})` : ''}. ${loaded.recovery?.error ? `Backup failed (${loaded.recovery.error}). ` : ''}Use Download recovered save for the damaged text when available, and keep a project draft export of your current work.`;
}

export function travelHistory(history, method, persistence) {
  if (!['undo','redo'].includes(method)) throw new TypeError('Unknown history operation.');
  if (!history[method]()) return {changed:false};
  const project = history.document;
  return {changed:true,project,saved:persistence.save(project)};
}

// Project files are portable authoring drafts. Playable chapter files and the
// player keep the model's default strict validation.
export function exportProjectDraft(project) {
  return parseProject(JSON.stringify(project), {allowDraft:true});
}
export function parseStudioImport(text) {
  const raw = JSON.parse(text);
  return {raw,project:parseProject(text, {allowDraft:raw?.kind === 'nest-project'})};
}
