import { unusedLocalDefinitions, definitionGraph } from '../project/dependencies.js';
import { remapVariableReferences } from './variable-ids.js';
import { discardPlacementContext, normalizeLocalOwnership } from '../project/model.js';
import { synchronizeConnections } from './commands.js';

/** Commit one document command. UI selection, rendering and persistence stay in the host. */
export function transactDocument(history, localDrafts, command) {
  const previous = history.document, previousLibrary = previous.library;
  let result;
  let failure;
  try {
    history.transact(draft => {
      result = command(draft) ?? {};
      const next = result.project ?? draft;
      // Existing unplaced drafts are authored data, including imported drafts.
      const preserved = new Set(unusedLocalDefinitions(result.project ?? previous).map(card => card.id));
      normalizeLocalOwnership(next);
      discardPlacementContext(next);
      synchronizeConnections(next);
      localDrafts.refreshChangedDefinitions(next, previousLibrary);
      // Keep the newest cached variants before pruning their saved definitions.
      // Cleanup shares this edit's history entry, so undo restores both together.
      // A preserved unplaced draft can still need a just-unplaced item.
      for(const id of definitionGraph(next).reachableFrom(next.library.filter(card=>preserved.has(card.id))))preserved.add(id);
      const newlyUnused = new Set(unusedLocalDefinitions(next).filter(card => !preserved.has(card.id)).map(card => card.id));
      if(newlyUnused.size)next.library=next.library.filter(card=>!newlyUnused.has(card.id));
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
