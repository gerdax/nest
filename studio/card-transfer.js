import { allowedCardKinds, canonicalCardKind } from '../project/cards.js';
import { definitionGraph } from '../project/dependencies.js';
import { outputsForNode, connectionForOutput } from '../project/graph.js';
import { pasteNodeClipboard } from './node-clipboard.js';

/** Only the main authoring collections participate; introductions stay fixed. */
export function cardTransferSlot(node) {
  if (node?.type === 'linear') return 'cards';
  if (node?.type === 'fork') return 'choices';
  if (node?.type === 'container') return 'items';
  return null;
}

function copyPlacement(project, chapter, source, placement) {
  // Reuse clipboard dependency and inventory remapping on an isolated one-card
  // node. Nothing enters the live document until the complete copy is ready.
  const dependencies = definitionGraph(project).reachableFrom(placement);
  const temporaryChapter = {id:chapter.id, nodes:[], startNode:''};
  const temporaryProject = {...project, id:project.id || 'card-transfer', library:[...project.library], chapters:[temporaryChapter]};
  const copied = pasteNodeClipboard(temporaryProject, temporaryChapter, {
    kind:'nest-node-clipboard', projectId:temporaryProject.id, chapterId:chapter.id,
    node:{id:source.id, type:'linear', cards:[placement], connections:{next:false}},
    definitions:project.library.filter(definition => dependencies.has(definition.id)),
  });
  return {placement:copied.cards[0], definitions:temporaryProject.library.slice(project.library.length)};
}

/** Index is a gap in the destination collection before removing the source. */
export function transferCard(project, chapter, {sourceNodeId, placementId, targetNodeId, index, copy = false} = {}) {
  if (!project.chapters.includes(chapter)) return null;
  const source = chapter.nodes.find(node => node.id === sourceNodeId);
  const target = chapter.nodes.find(node => node.id === targetNodeId);
  const sourceSlot = cardTransferSlot(source), targetSlot = cardTransferSlot(target);
  if (!sourceSlot || !targetSlot || !Array.isArray(source[sourceSlot]) || !Array.isArray(target[targetSlot])) return null;
  const sourceIndex = source[sourceSlot].findIndex(placement => placement.id === placementId);
  if (sourceIndex < 0 || !Number.isInteger(index) || index < 0 || index > target[targetSlot].length) return null;
  const placement = source[sourceSlot][sourceIndex];
  const definition = project.library.find(definition => definition.id === placement.definitionId);
  const kind = canonicalCardKind(definition?.kind);
  if (!definition || !allowedCardKinds(source.type, sourceSlot).includes(kind)
    || !allowedCardKinds(target.type, targetSlot).includes(kind)) return null;
  const sameSlot = source === target;
  const insertionIndex = !copy && sameSlot && sourceIndex < index ? index - 1 : index;
  if (!copy && sameSlot && sourceIndex === insertionIndex) return null;

  const prepared = copy ? copyPlacement(project, chapter, source, placement) : {placement, definitions:[]};
  const moved = prepared.placement;
  const outgoing = source.type === 'fork' && !copy ? Object.fromEntries(
    outputsForNode(project, {...source, choices:[placement]}).map(output => [output, connectionForOutput(source.connections || {}, output)])) : {};

  project.library.push(...prepared.definitions);
  if (!copy) source[sourceSlot].splice(sourceIndex, 1);
  target[targetSlot].splice(insertionIndex, 0, moved);
  if (!sameSlot || copy) {
    if (!copy && source.type === 'fork') {
      for (const key of Object.keys(source.connections || {})) {
        if (key === placement.id || key.startsWith(`${placement.id}:`)) delete source.connections[key];
      }
    }
    if (target.type === 'fork') {
      target.connections ||= {};
      for (const output of outputsForNode(project, {...target, choices:[moved]})) {
        const connection = !copy && source.type === 'fork' ? outgoing[output] : false;
        target.connections[output] = project.allowCycles === false && connection === target.id ? false : connection;
      }
    }
  }
  return moved;
}
