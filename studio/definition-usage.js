import { definitionGraph } from '../project/dependencies.js';

const markerLabels = [['T', 'Inventory trigger'], ['R', 'Requirements'], ['C', 'Costs'], ['E', 'Effects']];
const ruleMarkers = {conditions:'R', costs:'C', effects:'E', onCollect:'E', successEffects:'E', failureEffects:'E'};
const key = value => JSON.stringify(value);
const startsWith = (path, prefix) => prefix.every((part, index) => path[index] === part);

/** A read-only presentation of the dependency graph, with editor navigation identities. */
export function definitionUsage(project, id) {
 const graph = definitionGraph(project || {}), users = graph.users(id);
 const definitions = new Map((project?.library || []).map(definition => [definition.id, definition]));
 const occurrences = [];
 for (const chapter of project?.chapters || []) for (const node of chapter.nodes || []) {
  const add = (placement, path, extra = {}) => {
   if (!placement || typeof placement !== 'object') return;
   occurrences.push({chapter, node, placement, path, target:{chapterId:chapter.id, nodeId:node.id, placementId:placement.id, ...extra}});
  };
  for (const slot of ['cards', 'choices', 'items']) (node[slot] || []).forEach((placement, index) => add(placement, [slot, index]));
  if (node.intro) add(node.intro, ['intro']);
  const sequences = node.sequence ? [[node.sequence, ['sequence']]] : (node.sequences || []).map((sequence, index) => [sequence, ['sequences', index]]);
  for (const [sequence, path] of sequences) {
   for (const slot of ['cards', 'items']) (sequence[slot] || []).forEach((placement, index) => {
    add(placement, [...path, slot, index], {sequenceId:sequence.id, slot});
    if (slot === 'cards') (placement.choices || []).forEach((choice, choiceIndex) => add(choice, [...path, slot, index, 'choices', choiceIndex], {sequenceId:sequence.id, slot:'choices', parentCardId:placement.id}));
   });
  }
 }
 const ancestor = ref => occurrences.filter(entry => entry.chapter === ref.chapter && entry.node === ref.node && startsWith(ref.path, entry.path)).sort((a,b) => b.path.length-a.path.length)[0];
 const cardName = entry => definitions.get(entry.placement.definitionId)?.name || entry.placement.name || 'Unnamed card';
 const cardSource = entry => definitions.get(entry.placement.definitionId)?.visibility === 'local' ? 'local' : 'Library';
 const location = entry => `${entry.chapter.name || 'Unnamed chapter'} → ${entry.node.name || 'Unnamed node'}`;
 const placements = [], placementKeys = new Set();
 for (const ref of users.filter(ref => ref.kind === 'placement' && ref.chapter)) {
  const entry = ancestor(ref), identity = key([ref.chapterId, ref.nodeId, ref.path]);
  if (placementKeys.has(identity)) continue;
  placementKeys.add(identity);
  placements.push({name:`${ref.chapter.name || 'Unnamed chapter'} → ${ref.node?.name || 'Chapter settings'}`, chapterId:ref.chapterId, ...(ref.nodeId !== undefined ? {nodeId:ref.nodeId} : {}), ...(entry && entry.placement === ref.placement ? {target:entry.target} : {})});
 }
 const rows = new Map();
 const addReference = (identity, row, marker) => {
  if (!rows.has(identity)) rows.set(identity, {...row, letters:new Set()});
  rows.get(identity).letters.add(marker);
 };
 for (const ref of users) {
  if (ref.kind === 'placement') continue;
  if(['combatAction','effect','enemy'].includes(ref.kind)){
   const owner=ref.sourceDefinition;
   addReference(key(['combat',owner?.id,ref.chapterId,ref.nodeId,ref.path]),owner?{name:owner.name||owner.id,source:'Library',definitionId:owner.id}:ref.projectSetting?{name:'Common combat definitions',unavailableReason:'Edit default Actions and player feedback in Library → Common.'}:{name:`${ref.chapter?.name||''} → ${ref.node?.name||'Combat'}`,chapterId:ref.chapterId,nodeId:ref.nodeId},'B');continue;
  }
  const entry = ref.sourceDefinition ? null : ancestor(ref);
  const relativePath = entry ? ref.path.slice(entry.path.length) : ref.path;
  const marker = ref.kind === 'contextItem' ? 'T' : relativePath.map(part => ruleMarkers[part]).find(Boolean);
  if (!marker) continue;
  if (ref.sourceDefinition) {
   const source = ref.sourceDefinition;
   if (source.visibility !== 'local') addReference(key(['definition', source.id]), {name:source.name || 'Unnamed card', source:'Library', definitionId:source.id}, marker);
   else {
    const placed = occurrences.filter(occurrence => occurrence.placement.definitionId === source.id);
    for (const occurrence of placed) addReference(key(['card', occurrence.target]), {name:cardName(occurrence), source:'local', chapterId:occurrence.chapter.id, nodeId:occurrence.node.id, target:occurrence.target, location:location(occurrence)}, marker);
    if (!placed.length) addReference(key(['draft', source.id]), {name:source.name || 'Unnamed card', source:'local', ...(source.chapterId ? {chapterId:source.chapterId} : {}), unavailableReason:'This local card has no placement in a chapter.'}, marker);
   }
  } else if (entry) {
   addReference(key(['card', entry.target]), {name:cardName(entry), source:cardSource(entry), chapterId:ref.chapterId, nodeId:ref.nodeId, target:entry.target, location:location(entry)}, marker);
  } else {
   // Route rules and chapter settings have no card entry to reveal.
   let owner = ref.node || ref.chapter, ownerPath = [], fallbackName;
   let value = owner;
   for (let index = 0; index < ref.path.length; index++) {
    value = value?.[ref.path[index]];
    if (value && typeof value === 'object' && !Array.isArray(value) && (value.name || ref.path[index-1] === 'routes')) {
     owner = value; ownerPath = ref.path.slice(0, index+1);
     fallbackName = ref.path[index-1] === 'routes' ? `Route ${Number(ref.path[index])+1}` : undefined;
    }
   }
   addReference(key(['context', ref.chapterId, ref.nodeId, ownerPath]), {name:owner?.name || fallbackName || ref.node?.name || ref.chapter?.name || 'Chapter settings', chapterId:ref.chapterId, ...(ref.nodeId !== undefined ? {nodeId:ref.nodeId} : {})}, marker);
  }
 }
 return {placements, references:[...rows.values()].map(({letters, ...row}) => ({...row, markers:[...markerLabels.filter(([letter]) => letters.has(letter)).map(marker => [...marker]),...(letters.has('B')?[['B','Combat reference']]:[])]}))};
}
