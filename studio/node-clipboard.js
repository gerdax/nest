import { normalizeConsumableCard } from '../project/cards.js';
import { createError } from '../errors.js';
import { restoreSnapshotTags } from './tag-snapshots.js';
import { definitionGraph } from '../project/dependencies.js';
import { walk } from '../project/model-data.js';
import { outputsForNode, connectionForOutput } from '../project/graph.js';
import { uid, remapInventory, preserveCopiedInventoryAliases } from './commands.js';

function variableReferences(value) {
  const ids = new Set();
  walk(value, entry => {
    if (typeof entry.key === 'string' && (entry.source === 'variable' || ['set', 'add'].includes(entry.op))) ids.add(entry.key);
    if (typeof entry.modifierVariable === 'string') ids.add(entry.modifierVariable);
  });
  return ids;
}

/** Snapshot only referenced chapter variables, including rules on local dependencies. */
export function captureClipboardVariables(chapter, node, definitions) {
  const ids = variableReferences([node, ...definitions.filter(definition => definition.visibility === 'local')]);
  return structuredClone((chapter.variables || []).filter(variable => ids.has(variable.id)));
}

function remapVariables(value, ids) {
  walk(value, entry => {
    if (ids.has(entry.key) && (entry.source === 'variable' || ['set', 'add'].includes(entry.op))) entry.key = ids.get(entry.key);
    if (ids.has(entry.modifierVariable)) entry.modifierVariable = ids.get(entry.modifierVariable);
  });
}

/** A detached, session-local snapshot, including definitions cleanup may remove. */
export function captureNodeClipboard(project, chapterId, nodeId, options) {
  const payload=captureNodesClipboard(project,chapterId,[nodeId],options);
  const {nodes,...rest}=payload;
  return {...rest,kind:'nest-node-clipboard',node:nodes[0]};
}

/** Capture a group with one dependency and variable snapshot. */
export function captureNodesClipboard(project, chapterId, ids, {cut = false} = {}) {
  const chapter = project.chapters.find(chapter => chapter.id === chapterId);
  const nodes = Array.isArray(ids) ? [...new Set(ids)].map(id=>chapter?.nodes.find(node=>node.id===id)) : [];
  if (!nodes.length || nodes.some(node=>!node)) throw createError('STUDIO_THE_SELECTED_BEAT_NO_LONGER_EXISTS');
  if(cut&&nodes.some(node=>node.type==='death'))throw new Error('The mandatory Death beat cannot be cut');
  const dependencies = definitionGraph(project).reachableFrom(nodes);
  const definitions = project.library.filter(definition => dependencies.has(definition.id));
  return structuredClone({kind:'nest-nodes-clipboard', projectId:project.id, chapterId, nodes, definitions,
    variables:captureClipboardVariables(chapter, nodes, definitions), itemTags:project.itemTags||[], cut:!!cut});
}

/** Mutate only a document draft; never consume or modify the clipboard itself. */
export function pasteNodeClipboard(project, chapter, payload, options) {
  return pasteNodesClipboard(project,chapter,payload,options)[0];
}

export function pasteNodesClipboard(project, chapter, payload, {position} = {}) {
  const sources=payload?.kind==='nest-node-clipboard'?[payload.node]:payload?.kind==='nest-nodes-clipboard'?payload.nodes:undefined;
  if (!Array.isArray(sources) || !sources.length || sources.some(node=>!node||typeof node.id!=='string') || new Set(sources.map(node=>node.id)).size!==sources.length || !Array.isArray(payload.definitions)) {
    throw createError('STUDIO_COPY_A_BEAT_BEFORE_PASTING');
  }
  if (!project.id || payload.projectId !== project.id) throw createError('STUDIO_COPIED_BEATS_BELONG_TO_A_DIFFERENT_PROJECT');
  if (!project.chapters.includes(chapter)) throw createError('STUDIO_THE_DESTINATION_CHAPTER_NO_LONGER_EXISTS');
  if(sources.some(node=>node.type==='death')&&chapter.id===payload.chapterId)throw new Error('Death cannot be duplicated in its chapter');
  if(sources.filter(node=>node.type==='death').length>1)throw new Error('A chapter must have exactly one Death beat');
  const destinationDeath=chapter.nodes.find(node=>node.id===chapter.deathNode&&node.type==='death');
  if(sources.some(node=>node.type==='death')&&!destinationDeath)throw new Error('Destination Death beat is missing');
  const nodes = structuredClone(sources), definitions = [], definitionIds = new Map(), inventoryIds = new Map();
  const crossChapter = chapter.id !== payload.chapterId;
  const variables = [], variableIds = new Map();
  for (const source of payload.variables || []) {
    if (!crossChapter && chapter.variables?.some(variable => variable.id === source.id)) continue;
    const variable = structuredClone(source);
    if (crossChapter) variable.id = uid('variable');
    variableIds.set(source.id, variable.id);
    variables.push(variable);
  }
  const cloneLocal = !payload.cut || crossChapter;
  const clonedDefinitions = new Map();
  const currentDefinitions = new Map(project.library.map(definition => [definition.id, definition]));
  const graph = definitionGraph({...project, library:[...payload.definitions.filter(definition => !currentDefinitions.has(definition.id)), ...project.library]});
  const sharedDependencies = new Set();
  for (const source of payload.definitions) {
    const reused = currentDefinitions.get(source.id);
    if (source.visibility !== 'local') for (const id of graph.reachableFrom(reused || source)) sharedDependencies.add(id);
  }
  for (const source of payload.definitions) {
    const existing = currentDefinitions.get(source.id);
    // Preserve legacy shared inventory identity within its chapter. Across
    // chapters every local definition receives an independent destination owner.
    const sharedInventoryDependency = !crossChapter && source.kind === 'item' && sharedDependencies.has(source.id);
    if ((!cloneLocal || source.visibility !== 'local' || sharedInventoryDependency) && existing) continue;
    const definition = normalizeConsumableCard(structuredClone(source));
    if (cloneLocal && source.visibility === 'local' && !sharedInventoryDependency) {
      definition.id = uid(source.kind);
      delete definition.inventoryKey;
      definitionIds.set(source.id, definition.id);
      if (source.kind === 'item') inventoryIds.set(source.id, definition.id);
      clonedDefinitions.set(source.id, definition);
    }
    if (definition.visibility === 'local') definition.chapterId = chapter.id;
    else delete definition.chapterId;
    definitions.push(definition);
  }
  preserveCopiedInventoryAliases(payload.definitions, clonedDefinitions, inventoryIds);
  restoreSnapshotTags(project,[...nodes,...definitions],payload.itemTags);
  for (const value of [...nodes, ...definitions]) {
    walk(value, entry => {
      if (definitionIds.has(entry.definitionId)) entry.definitionId = definitionIds.get(entry.definitionId);
    });
    remapInventory(value, inventoryIds);
    if (nodes.includes(value) || value.visibility === 'local') remapVariables(value, variableIds);
  }

  // Every placement and route gets a fresh identity, including nested legacy
  // cards and choices. Legacy sequences and exits also have internal references.
  const outputMaps=new Map();
  for (const node of nodes) {
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
    outputMaps.set(node,remapOutput);
  }
  // Allocate every beat identity before resolving any peer connection.
  const nodeIds=new Map(nodes.map(node=>[node.id,node.type==='death'?destinationDeath.id:!payload.cut || chapter.nodes.some(candidate=>candidate.id===node.id)?uid('node'):node.id]));
  const origin=sources[0],dx=(position?.x ?? (origin.x ?? 100)+40)-(origin.x ?? 100),dy=(position?.y ?? (origin.y ?? 100)+40)-(origin.y ?? 100);
  const target = id => nodeIds.has(id) ? nodeIds.get(id) : id === null || id === false ? id
    : chapter.id === payload.chapterId && chapter.nodes.some(candidate => candidate.id === id) ? id : false;
  for(const node of nodes){
    const remapOutput=outputMaps.get(node);
    node.id=nodeIds.get(node.id);
    node.x=(node.x ?? 100)+dx;node.y=(node.y ?? 100)+dy;
    if (node.connections) {
      const connections = Object.fromEntries(Object.entries(node.connections).map(([exit, id]) => [remapOutput(exit), target(id)]));
      node.connections = connections;
      node.connections = Object.fromEntries(outputsForNode({...project, library:[...project.library, ...definitions]}, node)
        .map(exit => [exit, connectionForOutput(connections, exit)]));
    }
    if (node.type === 'random') {
      for (const route of node.routes || []) route.target = target(route.target);
      node.fallback = target(node.fallback);
    }
  }
  if (variables.length) {
    chapter.variables ||= [];
    chapter.variables.push(...variables);
  }
  project.library.push(...definitions);
  const added=nodes.map(node=>{if(node.type==='death'){destinationDeath.cards=node.cards;return destinationDeath;}chapter.nodes.push(node);return node;});
  if (!chapter.startNode) chapter.startNode = added.find(node=>node.type!=='death')?.id||'';
  return added;
}
