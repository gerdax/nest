/** Resolve stable placement identity against the current editor document. */
export function sourceCard(project,target) {
 const chapter=project.chapters.find(c=>c.id===target.chapterId);
 const node=chapter?.nodes.find(n=>n.id===target.nodeId);
 if(!node)return null;
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
 if(target.sequenceId) {
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
