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
   if(definition.mechanics==='opposed-preparation')for(const key of ['block','charge','blocked','hold'])candidates.push({card:definition.preparationCards?.[key],definitionPath:`preparationCards.${key}`});
   for(const [i,card] of (definition.preparedActions||[]).entries())candidates.push({card,definitionPath:`preparedActions.${i}`});
   for(const [i,card] of (definition.actions||[]).entries())candidates.push({card,definitionPath:`actions.${i}`});
   for(const [i,reaction] of (definition.reactions||[]).entries())candidates.push({card:reaction.card,definitionPath:`reactions.${i}.card`});
   for(const [i,card] of (definition.death||[]).entries())candidates.push({card,definitionPath:`death.${i}`});
  }
  if(definition.kind==='item'&&definition.subtype==='weapon')for(const [i,card] of (definition.combat?.actions||[]).entries())candidates.push({card,definitionPath:`combat.actions.${i}`});
  if(definition.kind==='combatAction'&&definition.type==='defend')candidates.push({card:definition.blockReveal,definitionPath:'blockReveal'});
  if(definition.kind==='item'&&definition.subtype==='weapon')for(const [i,action] of (definition.combat?.actions||[]).entries())if(action.type==='defend')candidates.push({card:action.blockReveal,definitionPath:`combat.actions.${i}.blockReveal`});
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

function cardSections(inspector) {
 return new Set(inspector.querySelectorAll('details[data-placement],details[data-sequence]'));
}

function openDetails(inspector,entry) {
 for(let parent=entry;parent&&parent!==inspector;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
}

function clearCardHighlight(inspector) {
 for(const previous of inspector.querySelectorAll('.card-navigation-target'))previous.classList.remove('card-navigation-target');
}

function closeOtherCards(inspector,entry,sections=cardSections(inspector)) {
 const path=new Set();
 for(let parent=entry;parent&&parent!==inspector;parent=parent.parentElement)path.add(parent);
 for(const section of sections)if(!path.has(section)&&section.open)section.open=false;
}

export function mountCardAccordion(inspector) {
 inspector.addEventListener('click',event=>{
  if(event.defaultPrevented)return;
  const summary=event.target.closest?.('summary');
  const section=summary?.parentElement;
  if(section?.tagName!=='DETAILS'||section.open)return;
  const sections=cardSections(inspector);
  if(sections.has(section)){
   closeOtherCards(inspector,section,sections);
   clearCardHighlight(inspector);
  }
 });
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
 if(target.kind!=='definition')closeOtherCards(inspector,entry);
 clearCardHighlight(inspector);
 openDetails(inspector,entry);
 entry.classList.add('card-navigation-target');
 entry.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});
 if(focus){
  const control=entry.tagName==='DETAILS'?entry.querySelector('summary'):entry;
  control?.focus({preventScroll:true});
 }
 return true;
}
