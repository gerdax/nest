import { createError } from '../errors.js';
import { isTagKey } from './item-tags.js';
/** Shared reference analysis for portable exports, deletion and local cleanup.
 * Rebuild for each document revision; never retain indexes across edits.
 */
function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, visit, [...path, index]));
  else if (value && typeof value === 'object') {
    visit(value, path);
    for (const [key, entry] of Object.entries(value)) if (key !== 'use') walk(entry, visit, [...path, key]);
  }
}

export function definitionGraph(project) {
  const definitions = new Map((project.library || []).map(definition => [definition.id, definition]));
  const itemKeys = new Map();
  for (const definition of definitions.values()) {
    if (definition.kind !== 'item') continue;
    for (const key of [definition.id, definition.inventoryKey].filter(Boolean)) {
      if (!itemKeys.has(key)) itemKeys.set(key, new Set());
      itemKeys.get(key).add(definition.id);
    }
  }
  function scan(value, context = {}) {
    const references = [];
    walk(value, (entry, path) => {
      if (typeof entry.definitionId === 'string') references.push({
        ...context, definitionId: entry.definitionId, kind: 'placement', placement: entry, path,
      });
      // Tags describe a class of owned items; they do not depend on any
      // particular definition or pull another chapter's local items into scope.
      if (typeof entry.contextItemId === 'string' && entry.contextItemId && (!isTagKey(entry.contextItemId) || definitions.get(entry.contextItemId)?.kind === 'item')) references.push({
        ...context, definitionId: entry.contextItemId, kind: 'contextItem', placement: entry, path,
      });
      if (typeof entry.key === 'string' && (entry.source === 'inventory' || ['addItem', 'removeItem'].includes(entry.op))) {
        for (const definitionId of itemKeys.get(entry.key) || []) references.push({
          ...context, definitionId, kind: 'inventory', rule: entry, path,
        });
      }
    });
    return references;
  }
  const references = [];
  for (const chapter of project.chapters || []) {
    const { nodes, ...settings } = chapter;
    references.push(...scan(settings, { chapter, chapterId: chapter.id }));
    for (const node of nodes || []) references.push(...scan(node, { chapter, chapterId: chapter.id, node, nodeId: node.id }));
  }
  const dependencies = new Map();
  for (const definition of definitions.values()) {
    const refs = scan(definition, { sourceDefinition: definition });
    references.push(...refs);
    dependencies.set(definition.id, refs.map(ref => ref.definitionId));
  }
  function closure(roots) {
    const reached = new Set(), pending = [...roots];
    while (pending.length) {
      const id = pending.pop();
      if (reached.has(id)) continue;
      reached.add(id);
      pending.push(...(dependencies.get(id) || []));
    }
    return reached;
  }
  const users = new Map();
  for (const reference of references) {
    if (reference.sourceDefinition?.id === reference.definitionId) continue;
    if (!users.has(reference.definitionId)) users.set(reference.definitionId, []);
    users.get(reference.definitionId).push(reference);
  }
  return {
    references,
    users: id => users.get(id) || [],
    reachableFrom: value => closure(scan(value).map(ref => ref.definitionId)),
    retained: () => closure([
      ...references.filter(ref => !ref.sourceDefinition).map(ref => ref.definitionId),
      ...[...definitions.values()].filter(def => def.visibility !== 'local').map(def => def.id),
    ]),
  };
}

export function definitionReferences(project, id) { return definitionGraph(project).users(id); }

export function unusedLocalDefinitions(project) {
  const retained = definitionGraph(project).retained();
  return project.library.filter(definition => definition.visibility === 'local' && !retained.has(definition.id));
}

/** Mutating commands belong inside the host's undoable document transaction. */
export function deleteDefinition(project, id) {
  if (definitionReferences(project, id).length) throw createError('PROJECT_DEFINITION_IS_STILL_USED_BY_CARDS_OR_GAMEPLAY_RULES');
  project.library = project.library.filter(definition => definition.id !== id);
}

export function cleanupLocalDefinitions(project) {
  const unused = unusedLocalDefinitions(project), ids = new Set(unused.map(definition => definition.id));
  project.library = project.library.filter(definition => !ids.has(definition.id));
  return unused.length;
}
