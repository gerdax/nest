/** Resolve stable placement identity against the current editor document. */
export function sourceCard(project,target) {
 const chapter=project.chapters.find(c=>c.id===target.chapterId);
 const node=chapter?.nodes.find(n=>n.id===target.nodeId);
 if(!node)return null;
 if(target.kind==='definition') {
  const definition=project.library.find(d=>d.id===target.definitionId);
  if(!definition)return null;
  const candidates=[{card:definition,definitionPath:''}];
  if(definition.kind==='enemy'){
   candidates.push({card:definition.hit,definitionPath:'hit'});
   for(const [i,card] of (definition.actions||[]).entries())candidates.push({card,definitionPath:`actions.${i}`});
   for(const [i,reaction] of (definition.reactions||[]).entries())candidates.push({card:reaction.card,definitionPath:`reactions.${i}.card`});
   for(const [i,card] of (definition.death||[]).entries())candidates.push({card,definitionPath:`death.${i}`});
  }
  if(definition.kind==='item'&&definition.subtype==='weapon')for(const [i,card] of (definition.combat?.actions||[]).entries())candidates.push({card,definitionPath:`combat.actions.${i}`});
  const match=candidates.find(entry=>entry.card?.id===target.cardId);
  return match?{chapter,node,definition,...match}:null;
 }
 let placements;
 if(target.sequenceId) {
  const sequence=(node.sequence?[node.sequence]:node.sequences||[]).find(s=>s.id===target.sequenceId);
  if(!sequence)return null;
  if(target.slot==='choices')placements=sequence.cards?.find(c=>c.id===target.parentCardId)?.choices||[];
  else if(['cards','items'].includes(target.slot))placements=sequence[target.slot]||[];
  else return null;
 }else placements=[...(node.cards||[]),...(node.choices||[]),...(node.items||[]),...(node.intro?[node.intro]:[])];
 const placement=placements.find(p=>p.id===target.placementId);
 return placement?{chapter,node,placement}:null;
}

/** Expand and reveal the matching entry without dispatching editor selection events. */
export function revealCardEntry(inspector,target,{focus=true}={}) {
 let entry;
 if(target.kind==='definition') {
  if(target.definitionPath){
   const preview=[...inspector.querySelectorAll('[data-preview-path]')].find(el=>el.dataset.previewPath===target.definitionPath);
   entry=preview?.closest('details');
  }else entry=inspector.querySelector('.card-definition-panel');
 }else if(target.sequenceId) {
  const sequence=[...inspector.querySelectorAll('details[data-sequence]')].find(el=>el.dataset.sequence===target.sequenceId);
  entry=sequence&&[...sequence.querySelectorAll('[data-card-placement]')].find(el=>el.dataset.cardPlacement===target.placementId&&el.dataset.cardSlot===target.slot&&(!target.parentCardId||el.dataset.cardParent===target.parentCardId));
 }else entry=[...inspector.querySelectorAll('details[data-placement]')].find(el=>el.dataset.placement===target.placementId);
 if(!entry)return false;
 for(const previous of inspector.querySelectorAll('.card-navigation-target'))previous.classList.remove('card-navigation-target');
 for(let parent=entry;parent&&parent!==inspector;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 entry.classList.add('card-navigation-target');
 entry.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});
 if(focus){
  const control=entry.tagName==='DETAILS'?entry.querySelector('summary'):entry;
  control?.focus({preventScroll:true});
 }
 return true;
}
