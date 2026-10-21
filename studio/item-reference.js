import { esc } from '../editor/fields.js';
import { isTagKey, itemTagLabel, tagIdFromKey } from '../project/item-tags.js';
import { eligibleInventoryItems } from './item-options.js';

/** Resolve the authored definition, rather than whichever card is selected. */
export function definitionDestination(project, id) {
 const definition=project.library.find(card=>card.id===id);
 if(!definition)return null;
 if(definition.visibility!=='local')return {kind:'library',definition};
 const chapter=project.chapters.find(chapter=>chapter.id===definition.chapterId);
 if(!chapter)return null;
 for(const node of chapter.nodes) {
  const direct=[...(node.cards||[]),...(node.choices||[]),...(node.items||[]),...(node.intro?[node.intro]:[])];
  const placement=direct.find(card=>card.definitionId===id);
  if(placement)return {kind:'placement',definition,chapter,node,target:{chapterId:chapter.id,nodeId:node.id,placementId:placement.id}};
  for(const sequence of node.sequence?[node.sequence]:node.sequences||[]) {
   for(const slot of ['cards','items'])for(const card of sequence[slot]||[]) {
    if(card.definitionId===id)return {kind:'placement',definition,chapter,node,target:{chapterId:chapter.id,nodeId:node.id,placementId:card.id,sequenceId:sequence.id,slot}};
    if(slot==='cards')for(const choice of card.choices||[])if(choice.definitionId===id)
     return {kind:'placement',definition,chapter,node,target:{chapterId:chapter.id,nodeId:node.id,placementId:choice.id,sequenceId:sequence.id,slot:'choices',parentCardId:card.id}};
   }
  }
 }
 return {kind:'unplaced',definition,chapter};
}

function reference(project, item) {
 const destination=definitionDestination(project,item.id);
 if(!destination)return `<p class="small">${esc(item.name||item.id)} · Definition unavailable.</p>`;
 const location=destination.kind==='library'?`Library · ${item.name||item.id}`
  :`Local · ${destination.chapter.name||destination.chapter.id} → ${destination.node?.name||destination.node?.id||'Unplaced definition'} → ${item.name||item.id}`;
 return `<div class="item-reference"><span class="small item-reference-location">${esc(location)}</span><button type="button" data-command="go-to-definition" data-definition="${esc(item.id)}" aria-label="${esc(`Go to definition: ${item.name||item.id}`)}" title="${esc(location)}">Go to definition</button></div>`;
}

/** Shared navigation for triggers, inventory requirements, costs and effects. */
export function itemReferenceLinks(project, key, chapter) {
 if(!key)return '';
 const eligible=eligibleInventoryItems(project,chapter);
 const concrete=project.library.find(item=>item.kind==='item'&&item.id===key)
  ||project.library.find(item=>item.kind==='item'&&item.inventoryKey===key);
 if(concrete)return `<div class="item-reference-links">${eligible.some(item=>item.id===concrete.id)?reference(project,concrete):'<p class="small">Item definition unavailable in this scope.</p>'}</div>`;
 if(isTagKey(key)) {
  const matches=eligible.filter(item=>item.tagId===tagIdFromKey(key));
  return `<div class="item-reference-links"><details class="item-reference-matches"><summary>${esc(itemTagLabel(project,key))} · Matching items: ${matches.length}</summary>${matches.length?matches.map(item=>reference(project,item)).join(''):'<p class="small">No matching items in this scope.</p>'}</details></div>`;
 }
 return '<div class="item-reference-links"><p class="small">Item definition unavailable in this scope.</p></div>';
}
