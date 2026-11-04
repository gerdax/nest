import { beatGroups, readBeatTarget } from './beat-groups.js';
import { outputsForNode } from './graph.js';
import { list } from './model-data.js';

/** Check structural reachability. Authored conditions can still block an exit at runtime. */
export function inspectRandomizerGroup(project, chapter, groupId) {
  const group = beatGroups(chapter).find(candidate => candidate?.id === groupId);
  const unavailable = warning => ({group, usable:false, warning});
  if (!group) return unavailable('This group is unavailable in the current chapter.');
  const memberIds = new Set(list(group.memberIds));
  const nodes = new Map(list(chapter.nodes).filter(node => node && memberIds.has(node.id)).map(node => [node.id, node]));
  if (!nodes.has(group.entryId)) return unavailable('Connect the group input to an entry beat.');
  if ([...nodes.values()].some(node => node.type === 'randomizer')) {
    return unavailable('A Randomizer cannot run a group containing another Randomizer.');
  }

  const exitsByNode = new Map();
  for (const binding of list(group.outgoing)) {
    if (!binding || !nodes.has(binding.nodeId)) continue;
    if (!exitsByNode.has(binding.nodeId)) exitsByNode.set(binding.nodeId, new Set());
    exitsByNode.get(binding.nodeId).add(binding.output);
  }
  const visited = new Set(), predecessors = new Map(), pending = [group.entryId], exits = [];
  let deadEnd = false;
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id), outputs = outputsForNode(project, node);
    if (!outputs.length) deadEnd = true;
    for (const output of outputs) {
      if (exitsByNode.get(id)?.has(output)) {
        exits.push({nodeId:id,output});
        continue;
      }
      const target = readBeatTarget(node, output);
      if (!nodes.has(target)) {
        deadEnd = true;
        continue;
      }
      if (!predecessors.has(target)) predecessors.set(target, new Set());
      predecessors.get(target).add(id);
      if (!visited.has(target)) pending.push(target);
    }
  }
  if (!exits.length) return unavailable('No path from the entry reaches the group output.');

  const canReturn = new Set(), returning = exits.map(exit => exit.nodeId);
  while (returning.length) {
    const id = returning.pop();
    if (canReturn.has(id)) continue;
    canReturn.add(id);
    for (const previous of predecessors.get(id) || []) returning.push(previous);
  }
  const warning = deadEnd || canReturn.size < visited.size ? 'Some paths cannot return through the group output.' : '';
  return {group, usable:true, warning, exits};
}
