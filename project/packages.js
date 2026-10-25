import { createError } from '../errors.js';
import { isTagKey, tagKey, tagIdFromKey } from './item-tags.js';
import { normalizeLocalOwnership } from './local-ownership.js';
import { normalizeStats } from './checks.js';
import { parseChapter } from '../chapter/model.js';
import { canonicalCardKind } from './cards.js';
import { projectCardBack } from './card-backs.js';
import { definitionGraph } from './dependencies.js';
import { cloneProject, list, named, object, unique, walk } from './model-data.js';
import { migrateChapter } from './migration.js';
import { discardPlacementContext, normalizeSingleItems } from './normalization.js';
import { validateProject } from './validation.js';

export function exportChapter(project, id = project.activeChapterId) {
  project = normalizeLocalOwnership(cloneProject(project));
  const chapter = project.chapters.find(c => c.id === id);
  if (!chapter) throw createError('PROJECT_UNKNOWN_CHAPTER');
  const ids = definitionGraph(project).reachableFrom(chapter);
  const pkg = cloneProject({version: 2, kind: 'nest-chapter', library: project.library.filter(d => ids.has(d.id)),
    itemTags: project.itemTags || [], variables: project.variables, allowCycles: project.allowCycles !== false,
    ownedItemsVisibility: project.ownedItemsVisibility ?? 'disabled', unavailableActions: project.unavailableActions ?? 'disabled',
    ...(project.ignoreAllOverrides !== undefined ? {ignoreAllOverrides: project.ignoreAllOverrides} : {}),
    cardStyles: project.cardStyles || {}, cardBack: projectCardBack(project),
    chapter});
  pkg.chapter.variables ??= [];
  if (named(pkg.chapter.nextChapterId) && pkg.chapter.nextChapterId !== pkg.chapter.id) delete pkg.chapter.nextChapterId;
  for (const definition of pkg.library) definition.kind = canonicalCardKind(definition.kind);
  discardPlacementContext({library: pkg.library, chapters: [pkg.chapter]});
  return normalizeStats(normalizeSingleItems(pkg));
}

export function importChapter(project, pkgOrV1) {
  // Importing merges chapter content; destination project-wide playback settings
  // (including ignoreAllOverrides) continue to govern the imported beats.
  const next = normalizeLocalOwnership(cloneProject(project));
  const imported = pkgOrV1.version === 1 ? migrateChapter(pkgOrV1) : pkgOrV1.kind === 'nest-project' ? cloneProject(pkgOrV1) : {library: cloneProject(pkgOrV1.library),
    itemTags: cloneProject(pkgOrV1.itemTags || []), variables: cloneProject(pkgOrV1.variables || []), chapters: [cloneProject(pkgOrV1.chapter)]};
  normalizeLocalOwnership(imported);
  const concreteIds = new Set(imported.library.filter(d => d.kind === 'item').map(d => d.id));
  const concreteKeys = new Set(imported.library.filter(d => d.kind === 'item').flatMap(d => [d.id,d.inventoryKey].filter(Boolean)));
  const destinationKeys = next.library.filter(d => d.kind === 'item').flatMap(d => [d.id,d.inventoryKey].filter(Boolean));
  // A tag reference must never occupy a concrete inventory identity. Keep the
  // destination stable and allocate fresh imported identities around both sets.
  const tagMap = new Map(), tagIds = new Set([
    ...list(next.itemTags).map(tag => tag.id),
    ...[...destinationKeys,...concreteKeys].filter(isTagKey).map(tagIdFromKey),
  ]);
  for (const tag of list(imported.itemTags)) {
    const existing = list(next.itemTags).find(candidate => candidate.name.toLowerCase() === tag.name.toLowerCase());
    const id = existing?.id ?? unique(tag.id, tagIds);
    tagMap.set(tag.id, id);
    if (!existing) { next.itemTags ??= []; next.itemTags.push({...tag, id}); }
  }
  const tagContextRefs = new Set(), tagRuleRefs = new Set();
  // Remap tags before definition equivalence checks so shared definitions can be reused.
  walk(imported, value => {
    if (value.tagId && tagMap.has(value.tagId)) value.tagId = tagMap.get(value.tagId);
    if (isTagKey(value.contextItemId) && !concreteIds.has(value.contextItemId) && tagMap.has(tagIdFromKey(value.contextItemId))) {
      tagContextRefs.add(value);
      value.contextItemId = tagKey(tagMap.get(tagIdFromKey(value.contextItemId)));
    }
    if (value.source === 'inventory' && isTagKey(value.key) && !concreteKeys.has(value.key) && tagMap.has(tagIdFromKey(value.key))) {
      tagRuleRefs.add(value);
      value.key = tagKey(tagMap.get(tagIdFromKey(value.key)));
    }
  });
  if (!next.cardStyles && pkgOrV1.cardStyles) next.cardStyles = cloneProject(pkgOrV1.cardStyles);
  for (const definition of imported.library) definition.kind = canonicalCardKind(definition.kind);
  const defMap = new Map(), varMap = new Map(), chapterIds = new Set(next.chapters.map(c => c.id)), defs = new Set(next.library.map(d => d.id)),
    vars = new Set([...next.variables, ...next.chapters.flatMap(c => list(c.variables))].map(v => v.id));
  const chapterMap = new Map(imported.chapters.map(chapter => [chapter.id, unique(chapter.id, chapterIds)]));
  const inventoryUsed = new Set([...destinationKeys, ...list(next.itemTags).map(tag => tagKey(tag.id))]);
  const allocateDefinition = d => {
    const used = d.kind === 'item' ? new Set([...defs, ...inventoryUsed]): defs;
    const id = unique(d.id, used);
    defs.add(id);
    if (d.kind === 'item') inventoryUsed.add(id);
    return id;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const v of imported.variables) {
    const existing = next.variables.find(x => x.id === v.id);
    varMap.set(v.id, existing && same(existing, v) ? v.id: unique(v.id, vars));
  }
  // Local identities remain local, but allocate around every target identity so imported
  // definitions can be remapped once even when used by multiple imported chapters.
  const localVarMap = new Map();
  for (const chapter of imported.chapters) for (const variable of list(chapter.variables)) {
    if (!localVarMap.has(variable.id)) localVarMap.set(variable.id, unique(variable.id, vars));
  }
  const ruleVarMap = new Map([...varMap, ...localVarMap]);
  const variablesUnchanged = [...ruleVarMap].every(([a, b]) => a === b);
  const reused = new Set();
  for (const d of imported.library) {
    const existing = next.library.find(x => x.id === d.id);
    if (d.visibility !== 'local' && existing && same(existing, d) && variablesUnchanged) {
      defMap.set(d.id, d.id);
      reused.add(d.id);
    } else defMap.set(d.id, allocateDefinition(d));
  }
  let reduced = true;
  while (reduced) {
    reduced = false;
    for (const d of imported.library.filter(d => reused.has(d.id))) {
      let conflict = false;
      walk(d, v => {
        if ([v.definitionId, v.contextItemId].some(id => id && defMap.has(id) && defMap.get(id) !== id)) conflict = true;
        if (v.key && (v.source === 'inventory' || ['addItem', 'removeItem'].includes(v.op))) {
          if (defMap.has(v.key) && defMap.get(v.key) !== v.key) conflict = true;
          if (imported.library.some(item => item.kind === 'item' && item.inventoryKey === v.key && !reused.has(item.id))) conflict = true;
        }
      });
      if (conflict) {
        reused.delete(d.id);
        defMap.set(d.id, allocateDefinition(d));
        reduced = true;
      }
    }
  }
  const importedItems = imported.library.filter(d => d.kind === 'item'), itemMap = new Map(importedItems.map(d => [d.id, defMap.get(d.id)]));
  const aliases = new Map();
  for (const d of importedItems.filter(d => d.inventoryKey)) {
    if (aliases.has(d.inventoryKey)) continue;
    const group = importedItems.filter(item => (item.inventoryKey ?? item.id) === d.inventoryKey);
    // Shared aliases deliberately describe one inventory identity in legacy data.
    const owner = group.find(item => reused.has(item.id)) || group.find(item => item.id === d.inventoryKey);
    aliases.set(d.inventoryKey, owner ? (reused.has(owner.id) ? d.inventoryKey: defMap.get(owner.id)): unique(d.inventoryKey, inventoryUsed));
  }
  const remap = value => walk(value, v => {
    if (v.definitionId && defMap.has(v.definitionId)) v.definitionId = defMap.get(v.definitionId);
    if (v.contextItemId && !tagContextRefs.has(v) && defMap.has(v.contextItemId)) v.contextItemId = defMap.get(v.contextItemId);
    if (v.key) {
      if (v.source === 'inventory' || ['addItem', 'removeItem'].includes(v.op)) v.key = tagRuleRefs.has(v) ? v.key : itemMap.get(v.key) || aliases.get(v.key) || v.key;
      else v.key = ruleVarMap.get(v.key) || v.key;
    }
    if (v.modifierVariable) v.modifierVariable = ruleVarMap.get(v.modifierVariable) || v.modifierVariable;
  });
  for (const d of imported.library) {
    const old = d.id;
    if (reused.has(old)) continue;
    remap(d);
    d.id = defMap.get(old);
    if (d.visibility === 'local') d.chapterId = chapterMap.get(d.chapterId) || d.chapterId;
    if (d.inventoryKey) d.inventoryKey = aliases.get(d.inventoryKey) || d.inventoryKey;
    next.library.push(d);
  }
  for (const v of imported.variables) {
    v.id = varMap.get(v.id);
    if (!next.variables.some(x => x.id === v.id)) next.variables.push(v);
  }
  for (const c of imported.chapters) {
    remap(c);
    for (const variable of list(c.variables)) variable.id = localVarMap.get(variable.id) || variable.id;
    if (c.initialValues) c.initialValues = Object.fromEntries(Object.entries(c.initialValues).map(([k, v]) => [ruleVarMap.get(k) || k, v]));
    if (named(c.nextChapterId)) {
      if (chapterMap.has(c.nextChapterId)) c.nextChapterId = chapterMap.get(c.nextChapterId);
      else delete c.nextChapterId;
    }
    c.id = chapterMap.get(c.id);
    next.chapters.push(c);
    next.activeChapterId = c.id;
  }
  return normalizeStats(normalizeSingleItems(discardPlacementContext(normalizeLocalOwnership(next))));
}

export function parseProject(text, {allowDraft = false} = {}) {
  let value = JSON.parse(text);
  if (value?.version === 1) {
    parseChapter(text, {allowDraft});
    value = migrateChapter(value);
  }
  else if (value?.version === 2 && value.kind === 'nest-chapter') {
    if (named(value.chapter?.nextChapterId) && value.chapter.nextChapterId !== value.chapter.id) delete value.chapter.nextChapterId;
    value = {version: 2, kind: 'nest-project',
    id: `${value.chapter?.id || 'chapter'}-project`, name: value.chapter?.name, activeChapterId: value.chapter?.id, startChapterId: value.chapter?.id,
    itemTags: value.itemTags, library: value.library, variables: value.variables || [], allowCycles: value.allowCycles,
    ownedItemsVisibility: value.ownedItemsVisibility, unavailableActions: value.unavailableActions,
    ...(value.ignoreAllOverrides !== undefined ? {ignoreAllOverrides: value.ignoreAllOverrides} : {}),
    cardStyles: value.cardStyles || {}, cardBack: value.cardBack,
    chapters: [value.chapter]};
  }
  for (const definition of list(value?.library)) if (object(definition)) definition.kind = canonicalCardKind(definition.kind);
  normalizeLocalOwnership(value);
  discardPlacementContext(value);
  normalizeSingleItems(value);
  normalizeStats(value);
  for (const chapter of list(value?.chapters)) if (object(chapter)) {
    delete chapter.backImage;
    chapter.variables ??= [];
  }
  const errors = validateProject(value, {allowDraft});
  if (errors.length) throw createError('PROJECT_PARSE_VALIDATION_FAILED', { messages: errors.map(e => e.message).join('\n') });
  return value;
}
