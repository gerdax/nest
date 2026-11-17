import { allowedCardKinds, canonicalCardKind } from '../project/cards.js';
import { definitionGraph } from '../project/dependencies.js';
import { walk } from '../project/model-data.js';
import { outputsForNode, connectionForOutput } from '../project/graph.js';
import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { captureClipboardVariables, pasteNodeClipboard } from './node-clipboard.js';
import { makePlacement, placementList } from './commands.js';

/** The main authoring collection used for insertion drops. */
export function cardTransferSlot(node) {
  if (['linear','death'].includes(node?.type)) return 'cards';
  if (node?.type === 'fork') return 'choices';
  if (node?.type === 'container') return 'items';
  if (node?.type === 'randomizer' && node.travel?.enabled===true) return 'travel.steps';
  return null;
}

function copyPlacement(project, chapter, sourceChapter, source, placement, copy = true) {
  // Reuse clipboard dependency and inventory remapping on an isolated one-card
  // node. Nothing enters the live document until the complete copy is ready.
  const dependencies = definitionGraph(project).reachableFrom(placement);
  const definitions = project.library.filter(definition => dependencies.has(definition.id));
  const temporaryChapter = {id:chapter.id, variables:[...(chapter.variables || [])], nodes:[], startNode:''};
  const temporaryProject = {...project, id:project.id || 'card-transfer', library:[...project.library], chapters:[temporaryChapter]};
  const copied = pasteNodeClipboard(temporaryProject, temporaryChapter, {
    kind:'nest-node-clipboard', projectId:temporaryProject.id, chapterId:sourceChapter.id, cut:!copy,
    node:{id:source.id, type:'linear', cards:[placement], connections:{next:false}},
    definitions, variables:captureClipboardVariables(sourceChapter, placement, definitions),
  });
  let collision = false;
  walk(chapter, entry => { if (entry.id === placement.id) collision = true; });
  if (!copy && !collision) copied.cards[0].id = placement.id;
  return {placement:copied.cards[0], definitions:temporaryProject.library.slice(project.library.length),
    variables:temporaryChapter.variables.slice((chapter.variables || []).length)};
}

function placementLocation(node, id) {
  const slot = node?.travel?.steps?.some(p=>p.id===id)?'travel.steps':cardTransferSlot(node);
  if (!slot) return null;
  if (['fork', 'container'].includes(node.type) && node.intro?.id === id) {
    return {slot:'intro', placement:node.intro};
  }
  const list=placementList(node,slot);
  const index = Array.isArray(list) ? list.findIndex(placement => placement.id === id) : -1;
  return index < 0 ? null : {slot, index, placement:list[index]};
}

function clearPlacementConnections(node, id) {
  if (node.type !== 'fork') return;
  for (const key of Object.keys(node.connections || {})) {
    if (key === id || key.startsWith(`${id}:`)) delete node.connections[key];
  }
}

/** Index is a gap before removing the source; targetSlot:'intro' also creates a missing intro. */
export function transferCard(project, chapter, {sourceNodeId, sourceChapterId, placementId, targetNodeId, targetPlacementId, targetSlot:requestedSlot, index, copy = false} = {}) {
  if (!project.chapters.includes(chapter)) return null;
  if (requestedSlot !== undefined && !['intro','travel.steps'].includes(requestedSlot)) return null;
  const sourceChapter = sourceChapterId ? project.chapters.find(candidate => candidate.id === sourceChapterId)
    : chapter.nodes.some(node => node.id === sourceNodeId) ? chapter
    : project.chapters.find(candidate => candidate.nodes.some(node => node.id === sourceNodeId));
  const source = sourceChapter?.nodes.find(node => node.id === sourceNodeId);
  const crossChapter = sourceChapter !== chapter;
  const target = chapter.nodes.find(node => node.id === targetNodeId);
  const origin = placementLocation(source, placementId);
  if(source?.type==='death'&&!copy&&source.cards.length<=1&&source!==target)return null;
  const introDestination = requestedSlot === 'intro';
  if (introDestination && (!Object.hasOwn(nodeTypeDescriptor(target?.type)?.slots || {}, 'intro')
    || (targetPlacementId !== undefined && targetPlacementId !== target?.intro?.id))) return null;
  const replacing = targetPlacementId !== undefined || (introDestination && !!target.intro);
  const destination = introDestination && target.intro ? {slot:'intro', placement:target.intro}
    : replacing ? placementLocation(target, targetPlacementId) : null;
  const targetSlot = introDestination ? 'intro' : replacing ? destination?.slot : requestedSlot??cardTransferSlot(target);
  if(targetSlot==='travel.steps'&&(target?.type!=='randomizer'||target.travel?.enabled!==true))return null;
  if (!origin || !targetSlot || (replacing && !destination)) return null;
  if (source === target && placementId === targetPlacementId) return null;
  if (source === target && origin.slot === 'intro' && targetSlot === 'intro') return null;
  if (targetSlot !== 'intro' && !Array.isArray(placementList(target,targetSlot))) return null;
  if (!replacing && targetSlot !== 'intro' && (!Number.isInteger(index) || index < 0 || index > placementList(target,targetSlot).length)) return null;
  const {placement, slot:sourceSlot, index:sourceIndex} = origin;
  const definition = project.library.find(definition => definition.id === placement.definitionId);
  const kind = canonicalCardKind(definition?.kind);
  if (!definition || !allowedCardKinds(source.type, sourceSlot).includes(kind)
    || !allowedCardKinds(target.type, targetSlot).includes(kind)) return null;
  const sameSlot = source === target && sourceSlot === targetSlot;
  const insertionIndex = !copy && sameSlot && sourceIndex < index ? index - 1 : index;
  if (!replacing && !copy && sameSlot && sourceIndex === insertionIndex) return null;

  const prepared = copy || crossChapter ? copyPlacement(project, chapter, sourceChapter, source, placement, copy) : {placement, definitions:[], variables:[]};
  const moved = prepared.placement;
  if(target.type!=='fork'||targetSlot!=='choices')delete moved.hideAfterUse;
  const outgoing = sourceSlot === 'choices' && !copy ? Object.fromEntries(
    outputsForNode(project, {...source, choices:[placement]}).map(output => [output, connectionForOutput(source.connections || {}, output)])) : {};

  project.library.push(...prepared.definitions);
  if (prepared.variables.length) {
    chapter.variables ||= [];
    chapter.variables.push(...prepared.variables);
  }
  if (!copy) {
    if (sourceSlot === 'intro') {
      // Containers always retain an introduction placement, even when hidden.
      if (source.type === 'container') source.intro = makePlacement(project, 'event', undefined, sourceChapter.id);
      else delete source.intro;
      source.introEnabled = false;
    } else placementList(source,sourceSlot).splice(sourceIndex, 1);
  }
  if (replacing) clearPlacementConnections(target, destination.placement.id);
  if (targetSlot === 'intro') {
    target.intro = moved;
    target.introEnabled = true;
  } else if (replacing) {
    const replacementIndex = placementList(target,targetSlot).indexOf(destination.placement);
    placementList(target,targetSlot).splice(replacementIndex, 1, moved);
  } else placementList(target,targetSlot).splice(insertionIndex, 0, moved);
  if (!sameSlot || copy || replacing) {
    if (!copy) clearPlacementConnections(source, placement.id);
    if (targetSlot === 'choices') {
      target.connections ||= {};
      for (const output of outputsForNode(project, {...target, choices:[moved]})) {
        const connection = !copy && !crossChapter && sourceSlot === 'choices' ? outgoing[output] : false;
        target.connections[output] = project.allowCycles === false && connection === target.id ? false : connection;
      }
    }
  }
  return moved;
}
