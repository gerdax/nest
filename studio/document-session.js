import { discardPlacementContext } from '../project/model.js';
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
  return {project:history.document, result, failure};
}
