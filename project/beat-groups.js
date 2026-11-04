import { connectionForOutput, outputsForNode } from './graph.js';
import { createLibraryIndex } from './library-index.js';
import { list, named, object } from './model-data.js';

export const beatGroups = chapter => list(chapter?.beatGroups);
export const beatGroupFor = (chapter, nodeId) => beatGroups(chapter).find(group => list(group?.memberIds).includes(nodeId));

export function readBeatTarget(node, output) {
  if (!node) return undefined;
  if (node.type === 'random') return output === 'fallback'
    ? node.fallback : list(node.routes).find(route => route?.id === output)?.target;
  return object(node.connections) ? connectionForOutput(node.connections, output) : undefined;
}

export function writeBeatTarget(node, output, target) {
  if (node.type === 'random') {
    if (output === 'fallback') node.fallback = target;
    else node.routes.find(route => route.id === output).target = target;
  } else {
    Object.defineProperty(node.connections ??= {}, output, {value:target, enumerable:true, writable:true, configurable:true});
  }
}

const sameOutput = (a, b) => a.nodeId === b.nodeId && a.output === b.output;
const outputKey = ({nodeId, output}) => JSON.stringify([nodeId, output]);

function indexChapter(project, chapter) {
  const nodes = new Map(list(chapter.nodes).filter(object).map(node => [node.id, node]));
  const groups = new Map(beatGroups(chapter).filter(object).map(group => [group.id, group]));
  const owners = new Map();
  for (const group of groups.values()) for (const id of list(group.memberIds)) owners.set(id, group);
  const library = createLibraryIndex(list(project.library));
  const outputs = new Map();
  const getOutputs = node => {
    if (!outputs.has(node.id)) {
      try { outputs.set(node.id, outputsForNode(project, node, library)); }
      catch { outputs.set(node.id, []); } // Malformed mechanics are diagnosed by project validation.
    }
    return outputs.get(node.id);
  };
  return {nodes, groups, owners, getOutputs};
}

function targetFromDestination(destination, groups) {
  if (destination === null) return null;
  return destination?.nodeId ?? (groups.get(destination?.groupId)?.entryId || false);
}

function destinationFor(nodeId, owners) {
  const group = owners.get(nodeId);
  return group ? {groupId:group.id} : {nodeId};
}

/** Project authoring bindings onto the existing runtime graph without mutating the source. */
export function resolveBeatGroups(project, chapter) {
  if (chapter.beatGroups === undefined) return {chapter, issues:[]};
  const issues = [];
  const add = (group, message, nodeId, draft = false) => {
    issues.push({message:`Beat group ${group?.name || group?.id || ''}: ${message}`, chapterId:chapter.id,
      ...(group?.id ? {groupId:group.id} : {}), ...(nodeId ? {nodeId} : {}), ...(draft ? {draft:true} : {})});
  };
  if (!Array.isArray(chapter.beatGroups)) {
    add(null, 'groups must be a list');
    return {chapter, issues};
  }
  if (!chapter.beatGroups.length) return {chapter, issues};
  const result = structuredClone(chapter);
  const {nodes, groups, owners, getOutputs} = indexChapter(project, result);
  const ids = new Set();
  const membership = new Set(), claimedOutputs = new Set();
  for (const group of result.beatGroups) {
    if (!object(group) || !named(group.id) || !named(group.name) || typeof group.collapsed !== 'boolean'
        || (group.oncePerRun !== undefined && typeof group.oncePerRun !== 'boolean')
        || !Array.isArray(group.memberIds) || !group.memberIds.length
        || !Array.isArray(group.incoming) || !Array.isArray(group.outgoing)) {
      add(group, 'invalid group structure');
      continue;
    }
    if (ids.has(group.id) || nodes.has(group.id)) add(group, 'duplicate group identity');
    ids.add(group.id);
    for (const id of group.memberIds) {
      if (!named(id) || !nodes.has(id) || nodes.get(id).type === 'death') add(group, 'members must be existing beats other than Death', id);
      if (membership.has(id)) add(group, 'a beat may only belong to one group', id);
      membership.add(id);
    }
    if (group.entryId !== false && !group.memberIds.includes(group.entryId)) add(group, 'input must lead to a member beat', group.entryId);
    const destination = group.destination;
    if (destination !== false && destination !== null) {
      const validBeat = object(destination) && Object.keys(destination).length === 1 && named(destination.nodeId)
        && nodes.has(destination.nodeId) && !owners.has(destination.nodeId);
      const validGroup = object(destination) && Object.keys(destination).length === 1 && named(destination.groupId)
        && groups.has(destination.groupId) && destination.groupId !== group.id;
      if (!validBeat && !validGroup) add(group, 'output must lead to an outside beat, another group input, or End Chapter');
    }
    for (const [side, bindings] of [['incoming', group.incoming], ['outgoing', group.outgoing]]) {
      for (const binding of bindings) {
        const node = object(binding) && nodes.get(binding.nodeId);
        const owner = node && owners.get(node.id);
        if (!node || !named(binding.output) || !getOutputs(node).includes(binding.output)
            || (side === 'incoming' ? owner !== undefined : owner !== group)) {
          add(group, `invalid ${side} beat outcome`, binding?.nodeId);
          continue;
        }
        const key = outputKey(binding);
        if (claimedOutputs.has(key)) add(group, 'a beat outcome may only have one destination', node.id);
        claimedOutputs.add(key);
        if (readBeatTarget(node, binding.output) !== false) add(group, 'a bound outcome cannot also have a direct route', node.id);
      }
    }
  }
  for (const node of nodes.values()) for (const output of getOutputs(node)) {
    const target = readBeatTarget(node, output), owner = owners.get(node.id);
    if ((typeof target === 'string' && nodes.has(target) && owner !== owners.get(target)) || (target === null && owner)) {
      add(owner ?? owners.get(target), 'crossing wires must use the group boundary', node.id);
    }
  }
  if (issues.length) return {chapter, issues};

  for (const group of groups.values()) {
    for (const binding of group.incoming) {
      writeBeatTarget(nodes.get(binding.nodeId), binding.output, group.entryId);
    }
    const target = targetFromDestination(group.destination, groups);
    for (const binding of group.outgoing) {
      const node = nodes.get(binding.nodeId);
      if (target === null && node.type === 'combat') {
        add(group, 'Combat Victory requires a next beat', binding.nodeId, true);
        writeBeatTarget(node, binding.output, false);
      } else {
        writeBeatTarget(node, binding.output, target);
      }
    }
  }
  return {chapter:result, issues};
}

function removeOutputBinding(groups, source) {
  for (const group of groups.values()) {
    group.incoming = group.incoming.filter(binding => !sameOutput(binding, source));
    group.outgoing = group.outgoing.filter(binding => !sameOutput(binding, source));
  }
}

export function connectBeatBoundary(project, chapter, {source, target}) {
  const {nodes, groups, owners, getOutputs} = indexChapter(project, chapter);
  const targetNode = nodes.get(target?.nodeId);
  const targetGroup = groups.get(target?.groupId);
  if (source?.groupId !== undefined) {
    const group = groups.get(source.groupId);
    if (group && source.port === 'input') {
      if (target !== false && (!targetNode || owners.get(targetNode.id) !== group)) {
        throw new Error('Group input must connect to a member beat');
      }
      group.entryId = target === false ? false : targetNode.id;
      return;
    }
    if (group && source.port === 'output') {
      if (target === false || target === null) group.destination = target;
      else if (targetNode && !owners.has(targetNode.id)) group.destination = {nodeId:targetNode.id};
      else if (targetGroup && targetGroup !== group && target.port === 'input') group.destination = {groupId:targetGroup.id};
      else throw new Error('Group output must connect to an outside beat, another group input, or End Chapter');
      return;
    }
    throw new Error('Unknown group connector');
  }

  const node = nodes.get(source?.nodeId);
  if (!node || !getOutputs(node).includes(source.output)) throw new Error('Unknown beat outcome');
  const owner = owners.get(node.id);
  let side;
  let direct = false;
  if (target === false || target === null && !owner) direct = target;
  else if (targetNode && owners.get(targetNode.id) === owner) direct = targetNode.id;
  else if (targetGroup && target.port === 'input' && !owner) side = 'incoming';
  else if (targetGroup && target.port === 'output' && owner === targetGroup) side = 'outgoing';
  else throw new Error('Crossing wires must use the group boundary');
  removeOutputBinding(groups, source);
  if (side) targetGroup[side].push({nodeId:node.id, output:source.output});
  writeBeatTarget(node, source.output, direct);
}

export function createBeatGroup(project, chapter, ids, id) {
  const {nodes, groups, owners, getOutputs} = indexChapter(project, chapter);
  const selected = new Set(ids);
  if (selected.size < 2 || [...selected].some(nodeId => !nodes.has(nodeId) || nodes.get(nodeId).type === 'death' || owners.has(nodeId))) {
    throw new Error('Select at least two ungrouped beats other than Death');
  }
  if (!named(id) || nodes.has(id) || groups.has(id)) throw new Error('Invalid group identity');
  const group = {id, name:'Beat group', collapsed:false, memberIds:[...selected], entryId:false, incoming:[], outgoing:[], destination:false};
  const direct = [], redirects = [], transferred = [];
  function enter(nodeId) {
    if (group.entryId && group.entryId !== nodeId) throw new Error('Selection needs more than one group entry');
    group.entryId = nodeId;
  }
  function leave(binding, destination) {
    if (group.destination !== false && JSON.stringify(group.destination) !== JSON.stringify(destination)) {
      throw new Error('Selection needs more than one group destination');
    }
    group.destination = destination;
    group.outgoing.push(binding);
  }
  for (const node of nodes.values()) for (const output of getOutputs(node)) {
    const target = readBeatTarget(node, output);
    if (selected.has(node.id)) {
      if (target === null || typeof target === 'string' && !selected.has(target)) {
        if (typeof target === 'string' && !nodes.has(target)) {
          throw new Error('Resolve the selection’s invalid crossing route before grouping');
        }
        leave({nodeId:node.id, output}, target === null ? null : destinationFor(target, owners));
        direct.push({node, output});
      }
    } else if (selected.has(target)) {
      enter(target);
      group.incoming.push({nodeId:node.id, output});
      direct.push({node, output});
    }
  }
  for (const other of groups.values()) {
    if (selected.has(other.destination?.nodeId)) {
      enter(other.destination.nodeId);
      redirects.push(other);
    }
    for (const binding of other.incoming) if (selected.has(binding.nodeId)) {
      leave({...binding}, {groupId:other.id});
      transferred.push({other, binding});
    }
  }
  for (const {node, output} of direct) writeBeatTarget(node, output, false);
  for (const other of redirects) other.destination = {groupId:id};
  for (const {other, binding} of transferred) other.incoming = other.incoming.filter(candidate => candidate !== binding);
  (chapter.beatGroups ??= []).push(group);
  return group;
}

export function ungroupBeatGroup(project, chapter, id) {
  const {nodes, groups} = indexChapter(project, chapter);
  const group = groups.get(id);
  if (!group) throw new Error('Unknown beat group');
  for (const binding of group.incoming) writeBeatTarget(nodes.get(binding.nodeId), binding.output, group.entryId);
  for (const binding of group.outgoing) {
    const next = groups.get(group.destination?.groupId);
    if (next?.entryId) next.incoming.push({...binding});
    else if (!next) {
      const node = nodes.get(binding.nodeId);
      const target = group.destination?.nodeId ?? group.destination;
      writeBeatTarget(node, binding.output, node.type === 'combat' && target === null ? false : target);
    }
  }
  for (const other of groups.values()) if (other.destination?.groupId === id) {
    other.destination = group.entryId ? {nodeId:group.entryId} : false;
  }
  chapter.beatGroups = beatGroups(chapter).filter(candidate => candidate !== group);
  if (!chapter.beatGroups.length) delete chapter.beatGroups;
}

export function pruneBeatGroups(project, chapter) {
  if (!beatGroups(chapter).length) return;
  const {nodes, getOutputs} = indexChapter(project, chapter);
  const groups = beatGroups(chapter).filter(group => {
    group.memberIds = group.memberIds.filter(id => nodes.has(id));
    return group.memberIds.length;
  });
  const ids = new Set(groups.map(group => group.id));
  const groupedMembers = new Set(groups.flatMap(group => group.memberIds));
  const existingOutcome = binding => nodes.has(binding.nodeId) && getOutputs(nodes.get(binding.nodeId)).includes(binding.output);
  for (const group of groups) {
    if (!group.memberIds.includes(group.entryId)) group.entryId = false;
    group.incoming = group.incoming.filter(binding => !groupedMembers.has(binding.nodeId) && existingOutcome(binding));
    group.outgoing = group.outgoing.filter(binding => group.memberIds.includes(binding.nodeId) && existingOutcome(binding));
    if (group.destination?.nodeId && !nodes.has(group.destination.nodeId)
        || group.destination?.groupId && !ids.has(group.destination.groupId)) group.destination = false;
  }
  if (groups.length) chapter.beatGroups = groups;
  else delete chapter.beatGroups;
}
