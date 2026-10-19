import { definitionGraph } from '../project/dependencies.js';
import { placementOverrideKeys } from '../project/cards.js';
import { unique } from '../project/model-data.js';

/** Read-only preflight. References point into the supplied document revision. */
export function libraryRemovalPlan(project, id) {
  const definition = project.library?.find(entry => entry.id === id);
  if (!definition || definition.visibility === 'local') return {
    definition, placements: [], blocked: true, reason: 'Choose a shared Library source to remove.',
  };
  // Use the full graph rather than users(): users deliberately omits self refs.
  const references = definitionGraph(project).references.filter(ref => ref.definitionId === id);
  const placements = references.filter(ref => ref.kind === 'placement' && ref.chapter && !ref.sourceDefinition);
  if (definition.kind === 'item') {
    if (new Set(placements.map(ref => ref.chapterId)).size > 1) return {
      definition, placements, blocked: true,
      reason: 'This Item is used in multiple chapters. Converting it would change its shared inventory identity. Convert or update those uses first.',
    };
    if (placements.some(ref => project.chapters.some(chapter => chapter.id === ref.chapter.nextChapterId))) return {
      definition, placements, blocked: true,
      reason: 'This Item can carry into the next chapter. Converting it to local cards would remove that carry-over. Update those chapter uses first.',
    };
    const keys = new Set([definition.id, definition.inventoryKey].filter(Boolean));
    if (project.library.some(other => other !== definition && other.kind === 'item'
      && [other.id, other.inventoryKey].filter(Boolean).some(key => keys.has(key)))) return {
      definition, placements, blocked: true,
      reason: 'This Item shares an inventory identity with another source. Update those gameplay references first.',
    };
  }
  const blocked = references.some(ref => ref.kind !== 'placement' || !ref.chapter || ref.sourceDefinition);
  return {definition, placements, blocked, reason: blocked
    ? 'Update gameplay references to this source first (including inventory rules, Item context, or source self-references).'
    : ''};
}

/** Run inside a document-history transaction. All preflight and cloning precedes edits. */
export function removeLibraryDefinition(project, id, {reservedIds = []} = {}) {
  const plan = libraryRemovalPlan(project, id);
  if (plan.blocked) throw new Error(plan.reason);
  const used = new Set([...reservedIds, ...project.library.flatMap(entry => [entry.id, entry.inventoryKey].filter(Boolean))]);
  const seen = new Set();
  const conversions = plan.placements.filter(ref => {
    if (seen.has(ref.placement)) return false;
    seen.add(ref.placement);
    return true;
  }).map(ref => {
    const overrides = Object.fromEntries(placementOverrideKeys(plan.definition.kind)
      .filter(key => Object.hasOwn(ref.placement.overrides ?? {}, key))
      .map(key => [key, ref.placement.overrides[key]]));
    const definition = structuredClone({...plan.definition, ...overrides});
    definition.id = unique(`${id}-local`, used);
    definition.visibility = 'local';
    definition.chapterId = ref.chapterId;
    // Independent content copies retain the source's single Item ownership identity.
    if (definition.kind === 'item') definition.inventoryKey = plan.definition.inventoryKey ?? id;
    return {placement: ref.placement, definition};
  });
  project.library = [...project.library.filter(entry => entry.id !== id), ...conversions.map(entry => entry.definition)];
  for (const {placement, definition} of conversions) {
    placement.definitionId = definition.id;
    delete placement.overrides;
  }
  return {converted: conversions.length};
}
