import { ensureCombatDefaults } from './combat-model.js';
import { createError } from '../errors.js';
import { isTagKey, tagKey, tagIdFromKey } from './item-tags.js';
import { normalizeLocalOwnership } from './local-ownership.js';
import { normalizeStats } from './checks.js';
import { canonicalCardKind } from './cards.js';
import { projectCardBack } from './card-backs.js';
import { definitionGraph, remapDefinitionReferences } from './dependencies.js';
import { cloneProject, list, named, object, unique, walk } from './model-data.js';
import { discardPlacementContext, normalizeSingleItems } from './normalization.js';
import { validateProject } from './validation.js';

export function exportChapter(project, id = project.activeChapterId) {
  project = normalizeLocalOwnership(cloneProject(project));
  const chapter = project.chapters.find(c => c.id === id);
  if (!chapter) throw createError('PROJECT_UNKNOWN_CHAPTER');
  ensureCombatDefaults(project);
  const ids = definitionGraph(project).reachableFrom([chapter,project.combat]);
  const pkg = cloneProject({version: 3, kind: 'nest-chapter', combat:project.combat, showDeathBeat:project.showDeathBeat, library: project.library.filter(d => ids.has(d.id)),
    itemTags: project.itemTags || [], variables: project.variables, allowCycles: project.allowCycles !== false,
    ownedItemsVisibility: project.ownedItemsVisibility ?? 'disabled', unavailableActions: project.unavailableActions ?? 'disabled',
    showWeaponActionsOnCooldown: project.showWeaponActionsOnCooldown !== false,
    ...(project.ignoreAllOverrides !== undefined ? {ignoreAllOverrides: project.ignoreAllOverrides} : {}),
    cardStyles: project.cardStyles || {}, cardBack: projectCardBack(project),
    chapter});
  pkg.chapter.variables ??= [];
  if (named(pkg.chapter.nextChapterId) && pkg.chapter.nextChapterId !== pkg.chapter.id) delete pkg.chapter.nextChapterId;
  normalizeSingleItems(pkg);
  for (const definition of pkg.library) definition.kind = canonicalCardKind(definition.kind);
  discardPlacementContext({library: pkg.library, chapters: [pkg.chapter]});
  return normalizeStats(normalizeSingleItems(pkg));
}

export function importChapter(project, pkg) {
  if(![2,3].includes(pkg?.version))throw new Error('Unsupported chapter package version');
  // Importing merges chapter content; destination project-wide playback settings
  // (including ignoreAllOverrides) continue to govern the imported beats.
  const next = normalizeLocalOwnership(ensureCombatDefaults(cloneProject(project)));
  const imported = pkg.kind === 'nest-project' ? cloneProject(pkg) : {combat:cloneProject(pkg.combat || {}),library: cloneProject(pkg.library),
    itemTags: cloneProject(pkg.itemTags || []), variables: cloneProject(pkg.variables || []), chapters: [cloneProject(pkg.chapter)]};
  normalizeSingleItems(next);
  normalizeSingleItems(imported);
  ensureCombatDefaults(imported);
  normalizeLocalOwnership(imported);
  return mergePackageContent(next, imported, pkg);
}

/** Merge portable Library content without applying defaults or touching destination settings. */
export function mergeLibraryContent(project, content) {
  return mergePackageContent(cloneProject(project), {...cloneProject(content), chapters: []}, {}, {libraryOnly: true});
}

function mergePackageContent(next, imported, pkg, {libraryOnly = false} = {}) {
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
  if (!next.cardStyles && pkg.cardStyles) next.cardStyles = cloneProject(pkg.cardStyles);
  for (const definition of imported.library) definition.kind = canonicalCardKind(definition.kind);
  const defMap = new Map(), varMap = new Map(), chapterIds = new Set(next.chapters.map(c => c.id)), defs = new Set(next.library.map(d => d.id)),
    vars = new Set([...next.variables, ...next.chapters.flatMap(c => list(c.variables))].map(v => v.id));
  if (libraryOnly) walk(next.library, value => { if (named(value.id)) defs.add(value.id); });
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
    const copied = libraryOnly && vars.has(v.id) && (!existing || !same(existing, v)) ? next.variables.find(x =>
      x.id.startsWith(`${v.id}-`) && /^(?:[2-9]|[1-9]\d+)$/.test(x.id.slice(v.id.length + 1)) && same({...x, id: v.id}, v)) : undefined;
    varMap.set(v.id, existing && same(existing, v) ? v.id : copied?.id ?? unique(v.id, vars));
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
  const withRemappedVariables = definition => {
    const candidate = cloneProject(definition);
    walk(candidate, value => {
      if (value.key && value.source !== 'inventory' && !['addItem', 'removeItem'].includes(value.op)) value.key = ruleVarMap.get(value.key) || value.key;
      if (value.modifierVariable) value.modifierVariable = ruleVarMap.get(value.modifierVariable) || value.modifierVariable;
      if (typeof value.text === 'string') value.text = value.text.replace(/\[STAT:([^\[\]\r\n]*)\]/g,
        (token, key) => ruleVarMap.has(key) ? `[STAT:${ruleVarMap.get(key)}]` : token);
    });
    return candidate;
  };
  const libraryMatches = libraryOnly ? matchLibraryDefinitions(imported.library.map(withRemappedVariables), next.library) : null;
  for (const d of imported.library) {
    const existing = libraryOnly ? libraryMatches.definitions.get(d.id)
      : next.library.find(x => x.id === d.id && same(x, d))?.id;
    if (d.visibility !== 'local' && existing && (libraryOnly || variablesUnchanged)) {
      defMap.set(d.id, existing);
      reused.add(d.id);
    } else defMap.set(d.id, allocateDefinition(d));
  }
  let reduced = true;
  while (reduced && !libraryOnly) {
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
  const aliases = new Map(libraryMatches?.aliases);
  for (const d of importedItems.filter(d => d.inventoryKey)) {
    if (aliases.has(d.inventoryKey)) continue;
    const group = importedItems.filter(item => (item.inventoryKey ?? item.id) === d.inventoryKey);
    // Shared aliases deliberately describe one inventory identity in legacy data.
    const owner = group.find(item => reused.has(item.id)) || group.find(item => item.id === d.inventoryKey);
    let identity;
    if (!owner) identity = unique(d.inventoryKey, inventoryUsed);
    else if (!reused.has(owner.id)) identity = defMap.get(owner.id);
    else if (libraryOnly) {
      const target = next.library.find(item => item.id === defMap.get(owner.id));
      identity = target.inventoryKey ?? target.id;
    } else identity = d.inventoryKey;
    aliases.set(d.inventoryKey, identity);
  }
  const remap = value => {remapDefinitionReferences(value,defMap);return walk(value, v => {
    if (v.contextItemId && !tagContextRefs.has(v) && defMap.has(v.contextItemId)) v.contextItemId = defMap.get(v.contextItemId);
    if (v.key) {
      if (v.source === 'inventory' || ['addItem', 'removeItem'].includes(v.op)) v.key = tagRuleRefs.has(v) ? v.key : itemMap.get(v.key) || aliases.get(v.key) || v.key;
      else v.key = ruleVarMap.get(v.key) || v.key;
    }
    if (v.modifierVariable) v.modifierVariable = ruleVarMap.get(v.modifierVariable) || v.modifierVariable;
    if (typeof v.text === 'string') v.text = v.text.replace(/\[STAT:([^\[\]\r\n]*)\]/g, (token, key) => ruleVarMap.has(key) ? `[STAT:${ruleVarMap.get(key)}]` : token);
  });
  };
  const ownedIds = new Set(defs);
  if (libraryOnly) walk(next.library, value => { if (named(value.id)) ownedIds.add(value.id); });
  for (const d of imported.library) {
    const old = d.id;
    if (reused.has(old)) continue;
    remap(d);
    if (libraryOnly) {
      // Embedded cards belong to their Weapon/Enemy. Remap only that owner's
      // actionId references, never source-relative attack.source = 'weapon'.
      const ownedMap = new Map();
      walk(d, value => {
        if (value !== d && named(value.id)) {
          const id = unique(value.id, ownedIds);
          ownedMap.set(value.id, id);
          value.id = id;
        }
      });
      walk(d, value => { if (ownedMap.has(value.actionId)) value.actionId = ownedMap.get(value.actionId); });
    }
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
  return libraryOnly ? next : normalizeStats(normalizeSingleItems(discardPlacementContext(normalizeLocalOwnership(next))));
}

/** Match existing portable graphs without allocating IDs. Trial mappings roll
 * back on failure; prebinding each pair lets cyclic graphs terminate. Owned
 * identities are scoped to their Enemy/Weapon and inventory aliases have their
 * own mapping, so equality follows behavior rather than generated ID spelling. */
function matchLibraryDefinitions(sourceLibrary, targetLibrary) {
  const sources = new Map(sourceLibrary.map(d => [d.id, d]));
  const targets = new Map(targetLibrary.map(d => [d.id, d]));
  const definitions = new Map(), aliases = new Map(), aliasTargets = new Map();
  const journal = [];
  function remember(map, key, value) {
    map.set(key, value);
    journal.push({map, key});
  }
  function rollback(checkpoint) {
    while (journal.length > checkpoint) {
      const {map, key} = journal.pop();
      map.delete(key);
    }
  }
  const bindAlias = (source, target) => {
    if (aliases.has(source)) return aliases.get(source) === target;
    // Distinct source inventories must remain independent even when their
    // Item presentations happen to be identical.
    if (aliasTargets.has(target)) return false;
    remember(aliases, source, target);
    remember(aliasTargets, target, source);
    return true;
  };
  function* inventory(source, target) {
    if (typeof target !== 'string') return false;
    if (sources.get(source)?.kind === 'item') return yield bind(source, target);
    const group = sourceLibrary.filter(d => d.kind === 'item' && (d.inventoryKey ?? d.id) === source);
    if (!group.length) return source === target; // Tag references were remapped before matching.
    if (!bindAlias(source, target)) return false;
    const candidates = targetLibrary.filter(d => d.kind === 'item' && (d.inventoryKey ?? d.id) === target);
    for (const item of group) {
      let matched = false;
      for (const candidate of candidates) {
        if (yield bind(item.id, candidate.id)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  }
  function* bind(sourceId, targetId) {
    if (definitions.has(sourceId)) return definitions.get(sourceId) === targetId;
    const source = sources.get(sourceId), target = targets.get(targetId);
    if (!source || !target || target.visibility === 'local' || source.kind !== target.kind) return false;
    const checkpoint = journal.length;
    remember(definitions, sourceId, targetId);
    const owned = new Map();
    const dependencies = [];
    function collect(a, b, root = false) {
      if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, index) => collect(entry, b[index]));
      if (!object(a)) return true;
      if (!object(b)) return false;
      if (!root && named(a.id)) {
        if (!named(b.id) || owned.has(a.id) && owned.get(a.id) !== b.id) return false;
        owned.set(a.id, b.id);
      }
      return Object.entries(a).every(([key, entry]) => collect(entry, b[key]));
    }
    function equal(a, b, root = false) {
      if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, index) => equal(entry, b[index]));
      if (!object(a)) return a === b;
      if (!object(b)) return false;
      const skip = key => root && (key === 'id' || key === 'visibility' || source.kind === 'item' && key === 'inventoryKey');
      const keys = Object.keys(a).filter(key => !skip(key));
      if (keys.length !== Object.keys(b).filter(key => !skip(key)).length) return false;
      return keys.every(key => {
        if (!Object.hasOwn(b, key)) return false;
        if (key === 'id' && named(a.id)) return owned.get(a.id) === b.id;
        if (key === 'actionId' && owned.has(a.actionId)) return owned.get(a.actionId) === b.actionId;
        if (key === 'definitionId' || key === 'contextItemId' && sources.get(a.contextItemId)?.kind === 'item') {
          dependencies.push(bind(a[key], b[key]));
          return true;
        }
        if (key === 'key' && (a.source === 'inventory' || ['addItem', 'removeItem'].includes(a.op))) {
          dependencies.push(inventory(a.key, b.key));
          return true;
        }
        return equal(a[key], b[key]);
      });
    }
    let matches = collect(source, target, true)
      && (source.kind !== 'item' || bindAlias(source.inventoryKey ?? source.id, target.inventoryKey ?? target.id))
      && equal(source, target, true);
    if (matches) for (const dependency of dependencies) {
      matches = yield dependency;
      if (!matches) break;
    }
    if (!matches) rollback(checkpoint);
    return matches;
  }
  function trial(sourceId, targetId) {
    // Each frame yields one dependency and resumes with its result. Following
    // references here keeps the JS call stack independent of graph depth.
    const pending = [bind(sourceId, targetId)];
    let result;
    while (pending.length) {
      const next = pending.at(-1).next(result);
      if (next.done) {
        result = next.value;
        pending.pop();
      } else {
        pending.push(next.value);
        result = undefined;
      }
    }
    journal.length = 0;
    return result;
  }
  for (const source of sourceLibrary) {
    if (definitions.has(source.id)) continue;
    const preferred = targets.get(source.id);
    if (preferred && trial(source.id, preferred.id)) continue;
    targetLibrary.some(target => trial(source.id, target.id));
  }
  return {definitions, aliases};
}

/** Current Player and Studio file format. Chapter packages open as projects. */
export function parseCurrentProject(text, options = {}) {
  const value = JSON.parse(text);
  if (value?.version !== 3 || !['nest-project', 'nest-chapter'].includes(value.kind)) {
    throw createError('PROJECT_EXPECTED_A_VERSION_3_NEST_FILE');
  }
  return normalizeProjectDocument(value, options);
}

/** Programmatic reader retained for version 2 integrations. */
export function parseProject(text, options = {}) {
  return normalizeProjectDocument(JSON.parse(text), options);
}

function normalizeProjectDocument(value, {allowDraft = false} = {}) {
  if ([2,3].includes(value?.version) && value.kind === 'nest-chapter') {
    if (named(value.chapter?.nextChapterId) && value.chapter.nextChapterId !== value.chapter.id) delete value.chapter.nextChapterId;
    value = {version: value.version, kind: 'nest-project', combat:value.combat, showDeathBeat:value.showDeathBeat,
    id: `${value.chapter?.id || 'chapter'}-project`, name: value.chapter?.name, activeChapterId: value.chapter?.id, startChapterId: value.chapter?.id,
    itemTags: value.itemTags, library: value.library, variables: value.variables || [], allowCycles: value.allowCycles,
    ownedItemsVisibility: value.ownedItemsVisibility, unavailableActions: value.unavailableActions,
    showWeaponActionsOnCooldown: value.showWeaponActionsOnCooldown,
    ...(value.ignoreAllOverrides !== undefined ? {ignoreAllOverrides: value.ignoreAllOverrides} : {}),
    cardStyles: value.cardStyles || {}, cardBack: value.cardBack,
    chapters: [value.chapter]};
  }
  if (![2,3].includes(value?.version) || value?.kind !== 'nest-project') throw new Error('Unsupported project format or version');
  // Missing fields only: explicit invalid references remain visible diagnostics.
  if(value.combat===undefined)delete value.combat;
  if(value.showDeathBeat===undefined)delete value.showDeathBeat;
  ensureCombatDefaults(value);
  normalizeSingleItems(value);
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
