import { definitionGraph } from '../project/dependencies.js';
import { walk } from '../project/model-data.js';
import { outputsForNode, connectionForOutput } from '../project/graph.js';
import { uid, remapInventory } from './commands.js';

/** A detached, session-local snapshot, including definitions cleanup may remove. */
export function captureNodeClipboard(project, chapterId, nodeId, {cut = false} = {}) {
  const node = project.chapters.find(chapter => chapter.id === chapterId)?.nodes.find(node => node.id === nodeId);
  if (!node) throw new Error('The selected beat no longer exists.');
  const dependencies = definitionGraph(project).reachableFrom(node);
  return structuredClone({kind:'nest-node-clipboard', projectId:project.id, chapterId, node,
    definitions:project.library.filter(definition => dependencies.has(definition.id)), cut:!!cut});
}

/** Mutate only a document draft; never consume or modify the clipboard itself. */
export function pasteNodeClipboard(project, chapter, payload, {position} = {}) {
  if (payload?.kind !== 'nest-node-clipboard' || !payload.node || !Array.isArray(payload.definitions)) {
    throw new Error('Copy a beat before pasting.');
  }
  if (!project.id || payload.projectId !== project.id) throw new Error('Copied beats belong to a different project.');
  if (!project.chapters.includes(chapter)) throw new Error('The destination chapter no longer exists.');
  const node = structuredClone(payload.node), definitions = [], definitionIds = new Map(), inventoryIds = new Map();
  const currentDefinitions = new Map(project.library.map(definition => [definition.id, definition]));
  const graph = definitionGraph({...project, library:[...payload.definitions.filter(definition => !currentDefinitions.has(definition.id)), ...project.library]});
  const sharedDependencies = new Set();
  for (const source of payload.definitions) {
    const reused = currentDefinitions.get(source.id);
    if (source.visibility !== 'local') for (const id of graph.reachableFrom(reused || source)) sharedDependencies.add(id);
  }
  for (const source of payload.definitions) {
    const existing = currentDefinitions.get(source.id);
    // Shared rules make these Items global inventory dependencies regardless of
    // authoring visibility. Reuse or restore their exact definition identity.
    const sharedInventoryDependency = source.kind === 'item' && sharedDependencies.has(source.id);
    if ((payload.cut || source.visibility !== 'local' || sharedInventoryDependency) && existing) continue;
    const definition = structuredClone(source);
    if (!payload.cut && source.visibility === 'local' && !sharedInventoryDependency) {
      definition.id = uid(source.kind);
      delete definition.inventoryKey;
      definitionIds.set(source.id, definition.id);
      inventoryIds.set(source.id, definition.id);
      if (source.inventoryKey) inventoryIds.set(source.inventoryKey, definition.id);
    }
    definitions.push(definition);
  }
  for (const value of [node, ...definitions]) {
    walk(value, entry => {
      if (definitionIds.has(entry.definitionId)) entry.definitionId = definitionIds.get(entry.definitionId);
    });
    remapInventory(value, inventoryIds);
  }

  // Every placement and route gets a fresh identity, including nested legacy
  // cards and choices. Legacy sequences and exits also have internal references.
  const identities = new Map();
  walk(node, entry => {
    if (entry !== node && typeof entry.id === 'string' && !identities.has(entry.id)) identities.set(entry.id, uid('placement'));
    for (const exit of entry.exits || []) if (!identities.has(exit)) identities.set(exit, uid('exit'));
  });
  const remapOutput = output => {
    if (identities.has(output)) return identities.get(output);
    for (const suffix of [':success', ':failure']) if (output.endsWith(suffix) && identities.has(output.slice(0, -suffix.length))) {
      return identities.get(output.slice(0, -suffix.length)) + suffix;
    }
    return output;
  };
  walk(node, entry => {
    if (entry !== node && identities.has(entry.id)) entry.id = identities.get(entry.id);
    if (identities.has(entry.sequenceId)) entry.sequenceId = identities.get(entry.sequenceId);
    if (entry.exits) entry.exits = entry.exits.map(exit => identities.get(exit) || exit);
    if (['legacySequence','legacyPool'].includes(node.type) && typeof entry.target === 'string' && /^(card|exit):/.test(entry.target)) {
      const colon = entry.target.indexOf(':'), id = entry.target.slice(colon + 1);
      if (identities.has(id)) entry.target = entry.target.slice(0, colon + 1) + identities.get(id);
    }
  });
  const sourceId = node.id;
  if (!payload.cut || chapter.nodes.some(candidate => candidate.id === node.id)) node.id = uid('node');
  Object.assign(node, position || {x:(node.x ?? 100) + 40, y:(node.y ?? 100) + 40});
  const target = id => id === sourceId ? node.id : id === null || id === false ? id
    : chapter.id === payload.chapterId && chapter.nodes.some(candidate => candidate.id === id) ? id : false;
  if (node.connections) {
    const connections = Object.fromEntries(Object.entries(node.connections).map(([exit, id]) => [remapOutput(exit), target(id)]));
    node.connections = connections;
    // Shared definitions may have changed resolution since capture.
    node.connections = Object.fromEntries(outputsForNode({...project, library:[...project.library, ...definitions]}, node)
      .map(exit => [exit, connectionForOutput(connections, exit)]));
  }
  if (node.type === 'random') {
    for (const route of node.routes || []) route.target = target(route.target);
    node.fallback = target(node.fallback);
  }
  project.library.push(...definitions);
  chapter.nodes.push(node);
  if (!chapter.startNode) chapter.startNode = node.id;
  return node;
}
