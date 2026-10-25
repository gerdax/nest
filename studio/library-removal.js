import { createError, errorMessage } from '../errors.js';
import { definitionGraph } from '../project/dependencies.js';
import { placementOverrideKeys } from '../project/cards.js';
import { unique } from '../project/model-data.js';

/** Read-only preflight. References point into the supplied document revision. */
export function libraryRemovalPlan(project, id) {
  const definition = project.library?.find(entry => entry.id === id);
  if (!definition || definition.visibility === 'local') return {
    definition, placements: [], blocked: true, reason: errorMessage('STUDIO_CHOOSE_A_SHARED_LIBRARY_SOURCE_TO_REMOVE'),
  };
  // Use the full graph rather than users(): users deliberately omits self refs.
  const references = definitionGraph(project).references.filter(ref => ref.definitionId === id);
  const placements = references.filter(ref => ref.kind === 'placement' && ref.chapter && !ref.sourceDefinition);
  if (definition.kind === 'item') {
    if (new Set(placements.map(ref => ref.chapterId)).size > 1) return {
      definition, placements, blocked: true,
      reason: errorMessage('STUDIO_THIS_ITEM_IS_USED_IN_MULTIPLE_CHAPTERS_CONVERTING_IT_WOULD_CHANGE_ITS_SHARED_INVENTORY_IDENTITY'),
    };
    if (placements.some(ref => project.chapters.some(chapter => chapter.id === ref.chapter.nextChapterId))) return {
      definition, placements, blocked: true,
      reason: errorMessage('STUDIO_THIS_ITEM_CAN_CARRY_INTO_THE_NEXT_CHAPTER_CONVERTING_IT_TO_LOCAL_CARDS_WOULD_REMOVE_THAT_CARRY_OVER'),
    };
    const keys = new Set([definition.id, definition.inventoryKey].filter(Boolean));
    if (project.library.some(other => other !== definition && other.kind === 'item'
      && [other.id, other.inventoryKey].filter(Boolean).some(key => keys.has(key)))) return {
      definition, placements, blocked: true,
      reason: errorMessage('STUDIO_THIS_ITEM_SHARES_AN_INVENTORY_IDENTITY_WITH_ANOTHER_SOURCE_UPDATE_THOSE_GAMEPLAY_REFERENCES_FIRST'),
    };
  }
  const blocked = references.some(ref => ref.kind !== 'placement' || !ref.chapter || ref.sourceDefinition);
  return {definition, placements, blocked, reason: blocked
    ? errorMessage('STUDIO_UPDATE_GAMEPLAY_REFERENCES_TO_THIS_SOURCE_FIRST_INCLUDING_INVENTORY_RULES_ITEM_CONTEXT_OR_SOURCE_SELF')
    : ''};
}

/** Run inside a document-history transaction. All preflight and cloning precedes edits. */
export function removeLibraryDefinition(project, id, {reservedIds = []} = {}) {
  const plan = libraryRemovalPlan(project, id);
  if (plan.blocked) throw createError('STUDIO_LIBRARY_REMOVAL_BLOCKED', {reason: plan.reason});
  const used = new Set([...reservedIds, ...project.library.flatMap(entry => [entry.id, entry.inventoryKey].filter(Boolean))]);
  const seen = new Set();
  const conversions = plan.placements.filter(ref => {
    if (seen.has(ref.placement)) return false;
    seen.add(ref.placement);
    return true;
  }).map(ref => {
    const overrides = Object.fromEntries(placementOverrideKeys(plan.definition.kind,plan.definition)
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
