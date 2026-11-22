import { createLibraryIndex } from '../project/library-index.js';
import { definitionGraph } from '../project/dependencies.js';
import { validateProject } from '../project/model.js';

/** The editor publishes a new snapshot for each committed document change. */
export function createEditorRenderState() {
  const revisions = new WeakMap();
  const surfaces = new Map();
  return {
    revision(project) {
      let revision = revisions.get(project);
      if (!revision) {
        let issues, dependencies, libraryIndex;
        revision = {
          id: Symbol(),
          get issues() { return issues ??= validateProject(project); },
          get dependencies() { return dependencies ??= definitionGraph(project); },
          get libraryIndex() { return libraryIndex ??= createLibraryIndex(project.library); },
        };
        revisions.set(project, revision);
      }
      return revision;
    },
    changed(surface, ...inputs) {
      const previous = surfaces.get(surface);
      if (previous?.length === inputs.length && inputs.every((input, index) => Object.is(input, previous[index]))) return false;
      surfaces.set(surface, inputs);
      return true;
    },
  };
}
