import { resolvePlacement } from './cards.js';
import { cloneProject, list, object, placements, legacyArtwork, walk } from './model-data.js';
import { outputsForNode, connectionForOutput } from './graph.js';

export function normalizeSingleItems(project) {
  walk(project, value => {
    delete value.quantity;
    if (value.source === 'inventory') {
      if (value.op === 'gte') value.op = 'has';
      if (value.op === 'lte') value.op = 'missing';
      if (['has', 'missing'].includes(value.op)) delete value.value;
      if (!value.op) value.amount = 1;
    }
  });
  return project;
}
export function discardPlacementContext(project) {
  const localIds = new Set(list(project?.library).filter(d => d?.visibility === 'local').map(d => d.id));
  for (const chapter of list(project?.chapters)) for (const node of list(chapter?.nodes).filter(object)) {
    let resetResolution = false;
    for (const p of [...placements(node), ...legacyArtwork(node)]) {
      delete p.context;
      if (p.contextItemId === '') delete p.contextItemId;
      if (localIds.has(p.definitionId) && p.overrides !== undefined) {
        resetResolution ||= p.overrides?.resolution !== undefined;
        delete p.overrides;
      }
      const definition = list(project?.library).find(d => d?.id === p.definitionId);
      if (definition?.kind === 'action' && ['linear', 'fork'].includes(node.type) && [p.conditions, p.effects].every(v => v === undefined
        || Array.isArray(v))) {
        if (p.conditions?.length || p.effects?.length) {
          const resolved = resolvePlacement(project, {...p, contextItemId: undefined});
          if (definition.visibility === 'local') {
            definition.conditions = resolved.conditions;
            definition.effects = resolved.effects;
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
      node.connections = Object.fromEntries(outputsForNode(project, node).map(exit => [exit, connectionForOutput(old, exit)]));
    }
  }
  return project;
}
