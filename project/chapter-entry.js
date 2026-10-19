import { initialValues, transact, addInventory } from './state.js';
import { compileChapter } from './compilation.js';

/** A chapter starts fresh, except for project variables and shared owned Items. */
export function chapterEntryState(project, chapterId, previous) {
  const chapter = project.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) throw new TypeError(`Unknown chapter: ${chapterId}`);
  const compiled = compileChapter(project, chapterId);
  const effects = (project.variables || []).filter(variable =>
    Object.hasOwn(previous?.variables || {}, variable.id) && !Object.hasOwn(chapter.initialValues || {}, variable.id)
  ).map(variable => ({op:'set', key:variable.id, value:previous.variables[variable.id]}));
  const variables = transact(initialValues(compiled.variables), [], {effects}, compiled.variables).variables;
  const sharedItems = new Set(project.library.filter(card => card.kind === 'item' && card.visibility !== 'local').map(card => card.id));
  const inventory = (previous?.collectedItems || []).filter(item => sharedItems.has(item.definitionId ?? item.id))
    .reduce((items, item) => addInventory(items, structuredClone(item)), []);
  return {variables, inventory};
}
