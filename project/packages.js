import { normalizeStats } from './checks.js';
import { parseChapter } from '../chapter/model.js';
import { canonicalCardKind } from './cards.js';
import { definitionGraph } from './dependencies.js';
import { cloneProject, list, object, unique, walk } from './model-data.js';
import { migrateChapter } from './migration.js';
import { discardPlacementContext, normalizeSingleItems } from './normalization.js';
import { validateProject } from './validation.js';

export function exportChapter(project, id = project.activeChapterId) {
  const chapter = project.chapters.find(c => c.id === id);
  if (!chapter) throw new TypeError('Unknown chapter.');
  const ids = definitionGraph(project).reachableFrom(chapter);
  const pkg = cloneProject({version: 2, kind: 'nest-chapter', library: project.library.filter(d => ids.has(d.id)),
    variables: project.variables, cardStyles: project.cardStyles || {}, switchCardBackIcons: project.switchCardBackIcons,
    chapter});
  for (const definition of pkg.library) definition.kind = canonicalCardKind(definition.kind);
  discardPlacementContext({library: pkg.library, chapters: [pkg.chapter]});
  return normalizeStats(normalizeSingleItems(pkg));
}

export function importChapter(project, pkgOrV1) {
  const next = cloneProject(project);
  const imported = pkgOrV1.version === 1 ? migrateChapter(pkgOrV1) : pkgOrV1.kind === 'nest-project' ? cloneProject(pkgOrV1) : {library: cloneProject(pkgOrV1.library),
    variables: cloneProject(pkgOrV1.variables || []), chapters: [cloneProject(pkgOrV1.chapter)]};
  if (next.switchCardBackIcons === undefined && pkgOrV1.switchCardBackIcons !== undefined) next.switchCardBackIcons = pkgOrV1.switchCardBackIcons;
  if (!next.cardStyles && pkgOrV1.cardStyles) next.cardStyles = cloneProject(pkgOrV1.cardStyles);
  for (const definition of imported.library) definition.kind = canonicalCardKind(definition.kind);
  const defMap = new Map(), varMap = new Map(), chapterIds = new Set(next.chapters.map(c => c.id)), defs = new Set(next.library.map(d => d.id)),
    vars = new Set(next.variables.map(v => v.id));
  const inventoryUsed = new Set(next.library.filter(d => d.kind === 'item').flatMap(d => [d.id, d.inventoryKey].filter(Boolean)));
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
  const variablesUnchanged = [...varMap].every(([a, b]) => a === b);
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
    if (v.contextItemId && defMap.has(v.contextItemId)) v.contextItemId = defMap.get(v.contextItemId);
    if (v.key) {
      if (v.source === 'inventory' || ['addItem', 'removeItem'].includes(v.op)) v.key = itemMap.get(v.key) || aliases.get(v.key) || v.key;
      else v.key = varMap.get(v.key) || v.key;
    }
    if (v.modifierVariable) v.modifierVariable = varMap.get(v.modifierVariable) || v.modifierVariable;
  });
  for (const d of imported.library) {
    const old = d.id;
    if (reused.has(old)) continue;
    remap(d);
    d.id = defMap.get(old);
    if (d.inventoryKey) d.inventoryKey = aliases.get(d.inventoryKey) || d.inventoryKey;
    next.library.push(d);
  }
  for (const v of imported.variables) {
    v.id = varMap.get(v.id);
    if (!next.variables.some(x => x.id === v.id)) next.variables.push(v);
  }
  for (const c of imported.chapters) {
    remap(c);
    if (c.initialValues) c.initialValues = Object.fromEntries(Object.entries(c.initialValues).map(([k, v]) => [varMap.get(k) || k, v]));
    c.id = unique(c.id, chapterIds);
    next.chapters.push(c);
    next.activeChapterId = c.id;
  }
  return normalizeStats(normalizeSingleItems(discardPlacementContext(next)));
}

export function parseProject(text, {allowDraft = false} = {}) {
  let value = JSON.parse(text);
  if (value?.version === 1) {
    parseChapter(text, {allowDraft});
    value = migrateChapter(value);
  }
  else if (value?.version === 2 && value.kind === 'nest-chapter') value = {version: 2, kind: 'nest-project',
    id: `${value.chapter?.id || 'chapter'}-project`, name: value.chapter?.name, activeChapterId: value.chapter?.id,
    library: value.library, variables: value.variables || [], cardStyles: value.cardStyles || {}, switchCardBackIcons: value.switchCardBackIcons,
    chapters: [value.chapter]};
  for (const definition of list(value?.library)) if (object(definition)) definition.kind = canonicalCardKind(definition.kind);
  discardPlacementContext(value);
  normalizeSingleItems(value);
  normalizeStats(value);
  for (const chapter of list(value?.chapters)) if (object(chapter)) delete chapter.backImage;
  const errors = validateProject(value, {allowDraft});
  if (errors.length) throw new TypeError(errors.map(e => e.message).join('\n'));
  return value;
}
