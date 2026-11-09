import { beatGroups, readBeatTarget } from './beat-groups.js';
import { outputsForNode } from './graph.js';
import { list } from './model-data.js';
import { beatOptionLabel } from './nodeTypes.js';

export const MAX_AUTO_DRAWS = 100;
export const validAutoDrawCount = count => Number.isInteger(count) && count >= 1 && count <= MAX_AUTO_DRAWS;

export function randomizerBeats(chapter) {
  const grouped = new Set(beatGroups(chapter).flatMap(group => list(group?.memberIds)));
  return list(chapter.nodes).filter(node => node && !grouped.has(node.id)
    && node.type !== 'death' && node.type !== 'randomizer');
}

export const randomizerSceneType = candidate => candidate.enemy !== undefined ? 'enemy'
  : candidate.beatId !== undefined ? 'beat' : 'group';

export function randomizerSceneKey(candidate) {
  const type = randomizerSceneType(candidate);
  return `${type}:${candidate.enemy?.definitionId ?? candidate.beatId ?? candidate.groupId}`;
}

export const randomizerEnemies = project => list(project?.library)
  .filter(definition => definition?.kind === 'enemy' && definition.visibility !== 'local');

export function randomizerScenes(chapter, project, type) {
  const byLabel = (a, b) => a.label.localeCompare(b.label, 'en', {sensitivity:'base'});
  const groups = beatGroups(chapter).map(group => ({
    target:{groupId:group.id}, label:`group: ${group.name || group.id}`
  }));
  const beats = randomizerBeats(chapter).map(beat => ({
    target:{beatId:beat.id}, label:beatOptionLabel(beat)
  }));
  const enemies = randomizerEnemies(project).map(enemy => ({
    target:{enemy:{definitionId:enemy.id}}, label:`Enemy: ${enemy.name || enemy.id}`
  }));
  return [...groups.sort(byLabel), ...beats.sort(byLabel), ...enemies.sort(byLabel)]
    .filter(({target}) => !type || randomizerSceneType(target) === type);
}

/** Check structural reachability. Authored conditions can still block an exit at runtime. */
export function inspectRandomizerGroup(project, chapter, groupId) {
  const group = beatGroups(chapter).find(candidate => candidate?.id === groupId);
  const unavailable = warning => ({group, usable:false, warning});
  if (!group) return unavailable('This group is unavailable in the current chapter.');
  const memberIds = new Set(list(group.memberIds));
  const chapterNodes = new Map(list(chapter.nodes).filter(Boolean).map(node => [node.id, node]));
  const nodes = new Map([...chapterNodes].filter(([id]) => memberIds.has(id)));
  if (!nodes.has(group.entryId)) return unavailable('Connect the group input to an entry beat.');

  const exitsByNode = new Map();
  const linkedInputs = new Map();
  for (const other of beatGroups(chapter)) {
    if (other === group || !other?.entryId) continue;
    for (const binding of list(other.incoming)) {
      if (!binding) continue;
      const {nodeId, output} = binding;
      if (memberIds.has(nodeId)) linkedInputs.set(JSON.stringify([nodeId, output]), other.entryId);
    }
  }
  for (const binding of list(group.outgoing)) {
    if (!binding || !nodes.has(binding.nodeId)) continue;
    if (!exitsByNode.has(binding.nodeId)) exitsByNode.set(binding.nodeId, new Set());
    exitsByNode.get(binding.nodeId).add(binding.output);
  }
  const visited = new Set(), predecessors = new Map(), pending = [group.entryId], exits = [], departures = new Set();
  let deadEnd = false;
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (node.type === 'randomizer') {
      return unavailable('The group’s entry can reach an Auto beat before leaving the scene.');
    }
    const outputs = outputsForNode(project, node);
    if (!outputs.length) deadEnd = true;
    for (const output of outputs) {
      if (exitsByNode.get(id)?.has(output)) {
        exits.push({nodeId:id,output});
        continue;
      }
      const target = linkedInputs.get(JSON.stringify([id, output])) ?? readBeatTarget(node, output);
      if (!nodes.has(target)) {
        if (chapterNodes.has(target)) departures.add(id);
        else deadEnd = true;
        continue;
      }
      if (!predecessors.has(target)) predecessors.set(target, new Set());
      predecessors.get(target).add(id);
      if (!visited.has(target)) pending.push(target);
    }
  }
  if (!exits.length && !departures.size) return unavailable('No path from the entry reaches the group output or a linked outside beat.');

  const canReturn = new Set(), returning = [...departures, ...exits.map(exit => exit.nodeId)];
  while (returning.length) {
    const id = returning.pop();
    if (canReturn.has(id)) continue;
    canReturn.add(id);
    for (const previous of predecessors.get(id) || []) returning.push(previous);
  }
  const warning = deadEnd || canReturn.size < visited.size ? 'Some paths cannot leave the group.' : '';
  return {group, usable:true, warning, exits};
}
