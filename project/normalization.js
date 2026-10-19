import { resolvePlacement, isStoryKind } from './cards.js';
import { createLibraryIndex } from './library-index.js';
import { cloneProject, list, object, placements, legacyArtwork, walk, unique } from './model-data.js';
import { outputsForNode, connectionForOutput } from './graph.js';

export function normalizeSingleItems(project) {
  walk(project, value => {
    delete value.quantity;
    delete value.use;
    delete value.remainingTriggers;
    if (value.source === 'inventory') {
      if (value.op === 'gte') value.op = 'has';
      if (value.op === 'lte') value.op = 'missing';
      if (['has', 'missing'].includes(value.op)) delete value.value;
      if (!value.op) value.amount = 1;
    }
  });
  return project;
}
export function discardPlacementContext(project, index = createLibraryIndex(list(project?.library))) {
  const localIds = new Set(list(project?.library).filter(d => d?.visibility === 'local').map(d => d.id));
  const definitionIds = new Set(list(project?.library).map(d => d?.id));
  const placementUsers = new Map();
  for (const chapter of list(project?.chapters)) for (const node of list(chapter?.nodes).filter(object)) {
    for (const p of new Set([...placements(node), ...legacyArtwork(node)])) {
      if (!placementUsers.has(p.definitionId)) placementUsers.set(p.definitionId, new Set());
      placementUsers.get(p.definitionId).add(p);
    }
  }
  for (const chapter of list(project?.chapters)) for (const node of list(chapter?.nodes).filter(object)) {
    let resetResolution = false;
    for (const p of [...placements(node), ...legacyArtwork(node)]) {
      delete p.context;
      if (p.contextItemId === '') delete p.contextItemId;
      if (localIds.has(p.definitionId) && p.overrides !== undefined) {
        resetResolution ||= p.overrides?.resolution !== undefined;
        delete p.overrides;
      }
      const definition = index.byId.get(p.definitionId);
      // Older story placements added progression rules beside the source rules.
      // Fold that effective list into the source for local cards, or into the
      // placement's replacement rules for shared cards. Appearance stays local.
      if (isStoryKind(definition?.kind) && Array.isArray(p.effects)
        && [definition.effects, definition.visibility === 'local' ? undefined : p.overrides?.effects]
          .every(value => value === undefined || Array.isArray(value))) {
        if (p.effects.length) {
          const effects = cloneProject(resolvePlacement(project, {...p, contextItemId: undefined}, index).effects);
          if (definition.visibility === 'local') {
            // Imported projects may reuse a local definition. Keep every other
            // placement on its original rules when absorbing this one's additions.
            if (placementUsers.get(definition.id)?.size > 1) {
              const copy = {...cloneProject(definition), id: unique(definition.id, definitionIds), effects};
              project.library.push(copy);
              index.byId.set(copy.id, copy);
              localIds.add(copy.id);
              p.definitionId = copy.id;
            } else definition.effects = effects;
          }
          else p.overrides = {...p.overrides, effects};
        }
        delete p.effects;
      }
      if (definition?.kind === 'action' && ['linear', 'fork'].includes(node.type) && [p.conditions, p.effects].every(v => v === undefined
        || Array.isArray(v))) {
        if (p.conditions?.length || p.effects?.length) {
          const resolved = resolvePlacement(project, {...p, contextItemId: undefined}, index);
          if (definition.visibility === 'local') {
            const rules = {conditions: resolved.conditions, effects: resolved.effects};
            // Local definitions can still have multiple placements in imported
            // data. Absorb additions only into this placement's own source.
            if (placementUsers.get(definition.id)?.size > 1) {
              const copy = {...cloneProject(definition), ...cloneProject(rules), id: unique(definition.id, definitionIds)};
              project.library.push(copy);
              index.byId.set(copy.id, copy);
              localIds.add(copy.id);
              p.definitionId = copy.id;
            } else Object.assign(definition, rules);
          } else {
            p.overrides = Object.fromEntries([
              'conditions', 'costs', 'effects', 'resolution', 'check', 'successEffects', 'failureEffects'
            ].map(key => [key, cloneProject(resolved[key] ?? (
              key === 'resolution' ? 'direct' : key === 'check'
                ? {pool: [{sides: 20, count: 1}], modifier: 0, target: 10}
                : []
            ))]));
          }
        }
        delete p.conditions;
        delete p.effects;
      }
    }
    if (resetResolution && node.type === 'fork') {
      const old = node.connections || {};
      node.connections = Object.fromEntries(outputsForNode(project, node, index).map(exit => [exit, connectionForOutput(old, exit)]));
    }
  }
  return project;
}
