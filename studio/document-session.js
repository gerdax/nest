import { remapVariableReferences } from './variable-ids.js';
import { discardPlacementContext, normalizeLocalOwnership } from '../project/model.js';
import { synchronizeConnections } from './commands.js';

/** Commit one document command. UI selection, rendering and persistence stay in the host. */
export function transactDocument(history, localDrafts, command) {
  const previousLibrary = history.document.library;
  let result;
  let failure;
  try {
    history.transact(draft => {
      result = command(draft) ?? {};
      const next = result.project ?? draft;
      normalizeLocalOwnership(next);
      discardPlacementContext(next);
      synchronizeConnections(next);
      localDrafts.refreshChangedDefinitions(next, previousLibrary);
      return next;
    });
  } catch (error) {
    failure = error.message;
    result = undefined;
    localDrafts.reset();
  }
  const rename=result?.variableRename;
  if(!failure&&rename&&(!rename.chapterId||JSON.parse(localDrafts.context||'null')?.[0]===rename.chapterId)){
    for(const draft of localDrafts.drafts.values())for(const saved of draft.types.values())remapVariableReferences(saved,rename.oldId,rename.newId);
  }
  return {project:history.document, result, failure};
}
