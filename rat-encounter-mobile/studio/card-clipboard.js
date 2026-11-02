import { createError } from '../errors.js';
import { canonicalCardKind, allowedCardKinds } from '../project/cards.js';
import { definitionGraph } from '../project/dependencies.js';
import { placements } from '../project/model-data.js';
import { captureClipboardVariables, pasteNodeClipboard } from './node-clipboard.js';

function targetSlot(node, placement) {
 if(node?.intro===placement)return 'intro';
 return ['cards','choices','items'].find(slot=>node?.[slot]?.includes(placement));
}
function sourceDefinition(project,payload) {
 const snapshot=payload?.definitions?.find(d=>d.id===payload.placement?.definitionId);
 return snapshot?.visibility==='local'?snapshot:project.library.find(d=>d.id===snapshot?.id)||snapshot;
}
/** An internal snapshot, independent of the system clipboard and later source edits. */
export function captureCardClipboard(project,chapterId,nodeId,placementId) {
 const chapter=project.chapters.find(c=>c.id===chapterId),node=chapter?.nodes.find(n=>n.id===nodeId);
 const placement=node&&placements(node).find(p=>p.id===placementId);
 if(!placement||!project.library.some(d=>d.id===placement.definitionId))throw createError('STUDIO_THE_CARD_NO_LONGER_EXISTS');
 const ids=definitionGraph(project).reachableFrom(placement),definitions=project.library.filter(d=>ids.has(d.id));
 return structuredClone({kind:'nest-card-clipboard',projectId:project.id,chapterId,placement,definitions,
  itemTags:project.itemTags||[],variables:captureClipboardVariables(chapter,placement,definitions)});
}
export function canPasteCard(project,node,placement,payload) {
 if(payload?.kind!=='nest-card-clipboard'||payload.projectId!==project.id||!Array.isArray(payload.definitions))return false;
 const slot=targetSlot(node,placement),source=sourceDefinition(project,payload);
 const target=project.library.find(d=>d.id===placement?.definitionId);
 return !!slot&&!!source&&!!target&&canonicalCardKind(source.kind)===canonicalCardKind(target.kind)
  &&allowedCardKinds(node.type,slot).includes(canonicalCardKind(source.kind));
}
/** Replace a slot, retaining its identity and the destination beat's wiring. */
export function pasteCardClipboard(project,chapter,node,placement,payload) {
 if(!project.chapters.includes(chapter)||!chapter.nodes.includes(node)||!canPasteCard(project,node,placement,payload))throw createError('STUDIO_COPY_A_COMPATIBLE_CARD_FROM_THIS_PROJECT_FIRST');
 const temporaryChapter={id:chapter.id,variables:[...(chapter.variables||[])],nodes:[],startNode:''};
 const temporaryProject={...project,library:[...project.library],itemTags:structuredClone(project.itemTags||[]),chapters:[temporaryChapter]};
 const copied=pasteNodeClipboard(temporaryProject,temporaryChapter,{
  kind:'nest-node-clipboard',projectId:project.id,chapterId:payload.chapterId,cut:false,
  node:{id:'card-clipboard',type:'linear',cards:[payload.placement],connections:{next:false}},
  definitions:payload.definitions,itemTags:payload.itemTags||[],variables:payload.variables||[],
 }).cards[0];
 const slot=targetSlot(node,placement),kind=canonicalCardKind(sourceDefinition(project,payload).kind);
 if(slot!=='choices'||kind!=='action'){delete copied.contextItemId;delete copied.contextOverrideImage;}
 const placementId=placement.id;
 project.library.push(...temporaryProject.library.slice(project.library.length));
 project.itemTags=temporaryProject.itemTags;
 if(temporaryChapter.variables.length>(chapter.variables||[]).length){
  chapter.variables||=[];
  chapter.variables.push(...temporaryChapter.variables.slice(chapter.variables.length));
 }
 for(const key of Object.keys(placement))delete placement[key];
 Object.assign(placement,copied,{id:placementId});
 return placement;
}
