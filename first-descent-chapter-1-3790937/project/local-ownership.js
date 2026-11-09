import { definitionGraph, remapDefinitionReferences } from './dependencies.js';
import { cloneProject, list, object, unique, walk } from './model-data.js';

/**
 * Upgrade legacy local definitions in place, returning the supplied project.
 * The first referencing chapter keeps a legacy identity. Other chapters receive
 * detached copies of its whole local dependency graph, including inventory aliases.
 * Unplaced drafts infer their chapter from variable rules before using active/first.
 * Explicit owners are preserved (including invalid owners, for validation to report).
 * Preserve historical promotion for existing story/item rules. Combat reference
 * roots require explicit shared definitions and never silently promote locals.
 */
export function normalizeLocalOwnership(project) {
  if (!object(project)) return project;
  const chapters = list(project.chapters).filter(object);
  const library = list(project.library).filter(object);
  if (!library.length) return project;
  const chapterIds = new Set(chapters.map(chapter => chapter.id));
  const graph = definitionGraph({...project, library,
    chapters: chapters.map(chapter => ({...chapter, nodes: list(chapter.nodes).filter(object)}))});
  const shared = graph.reachableFrom(library.filter(definition => definition.visibility !== 'local' && !['combatAction','effect','enemy'].includes(definition.kind) && definition.subtype!=='weapon'));
  for (const definition of library) if (definition.visibility === 'local' && shared.has(definition.id)) {
    definition.visibility = 'shared';
    delete definition.chapterId;
  }
  for (const definition of library) if (definition.visibility !== 'local') delete definition.chapterId;
  if (!chapters.length) return project;
  const locals = library.filter(definition => definition.visibility === 'local');
  const byId = new Map(library.map(definition => [definition.id, definition]));
  const reached = new Map(chapters.map(chapter => [chapter.id, graph.reachableFrom(chapter)]));
  const globalVariables = new Set(list(project.variables).map(variable => variable?.id));
  const fallback = chapters.find(chapter => chapter.id === project.activeChapterId) || chapters[0];
  function inferredChapter(definition) {
    const keys = new Set();
    for (const id of new Set([definition.id, ...graph.reachableFrom(definition)])) {
      walk(byId.get(id), value => {
        if (typeof value.key === 'string' && (value.source === 'variable' || ['set', 'add'].includes(value.op))) keys.add(value.key);
        if (typeof value.modifierVariable === 'string') keys.add(value.modifierVariable);
      });
    }
    for (const key of globalVariables) keys.delete(key);
    if (!keys.size) return null;
    return chapters.find(chapter => {
      const available = new Set(list(chapter.variables).map(variable => variable?.id));
      return [...keys].every(key => available.has(key));
    });
  }
  for (const definition of locals) if (definition.chapterId === undefined) {
    definition.chapterId = chapters.find(chapter => reached.get(chapter.id).has(definition.id))?.id
      ?? inferredChapter(definition)?.id ?? fallback.id;
  }
  // Owned drafts are roots too: their dependencies need valid ownership even when
  // the draft itself has never been placed on the canvas. Closure handles cycles.
  for (const chapter of chapters) {
    const owned = locals.filter(definition => definition.chapterId === chapter.id);
    const ids = reached.get(chapter.id);
    for (const definition of owned) {
      ids.add(definition.id);
      for (const id of graph.reachableFrom(definition)) ids.add(id);
    }
  }
  const used = new Set(library.flatMap(definition => [definition.id, definition.inventoryKey].filter(Boolean)));
  const maps = new Map(chapters.map(chapter => [chapter.id, new Map()]));
  const copies = new Map(chapters.map(chapter => [chapter.id, []]));
  for (const chapter of chapters) for (const definition of locals) {
    // An explicitly malformed owner is authored data, not a legacy omission.
    if (!chapterIds.has(definition.chapterId) || !reached.get(chapter.id).has(definition.id)) continue;
    const map = maps.get(chapter.id);
    if (definition.chapterId === chapter.id) {
      map.set(definition.id, definition.id);
      copies.get(chapter.id).push([cloneProject(definition), definition]);
    } else {
      const copy = {...cloneProject(definition), id: unique(`${definition.id}-${chapter.id}`, used), chapterId: chapter.id};
      map.set(definition.id, copy.id);
      copies.get(chapter.id).push([cloneProject(definition), copy]);
      project.library.push(copy);
    }
  }
  const itemGroups = new Map();
  for (const definition of library.filter(definition => definition.kind === 'item')) {
    const key = definition.inventoryKey ?? definition.id;
    if (!itemGroups.has(key)) itemGroups.set(key, []);
    itemGroups.get(key).push(definition);
  }
  // Prefer the chapter holding the original identity for each alias group. Copies
  // share one fresh alias within their chapter, never an alias of another chapter.
  const aliasOwners = new Map([...itemGroups].map(([key, group]) => [key,
    group.find(item => item.id === key)?.chapterId ?? group.find(item => chapterIds.has(item.chapterId))?.chapterId]));
  for (const chapter of chapters) {
    const map = maps.get(chapter.id), aliases = new Map();
    const itemIds = new Map(library.filter(definition => definition.kind === 'item' && map.has(definition.id))
      .map(definition => [definition.id, map.get(definition.id)]));
    for (const [key, group] of itemGroups) {
      if (!group.some(item => map.has(item.id))) continue;
      const identity = group.find(item => item.id === key);
      aliases.set(key, aliasOwners.get(key) === chapter.id ? key
        : identity && map.has(identity.id) ? map.get(identity.id) : unique(`${key}-${chapter.id}`, used));
    }
    const remap = value => {remapDefinitionReferences(value,map);return walk(value, entry => {
      if(map.has(entry.contextItemId))entry.contextItemId=map.get(entry.contextItemId);
      if (entry.source === 'inventory' || ['addItem', 'removeItem'].includes(entry.op)) {
        entry.key = itemIds.get(entry.key) ?? aliases.get(entry.key) ?? entry.key;
      }
    });
    };
    remap(chapter);
    for (const [original, copy] of copies.get(chapter.id)) {
      remap(copy);
      if (original.kind === 'item' && original.inventoryKey !== undefined) copy.inventoryKey = aliases.get(original.inventoryKey) ?? original.inventoryKey;
    }
  }
  return project;
}
