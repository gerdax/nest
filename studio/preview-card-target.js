import {sourceCard} from './card-navigation.js';

function combatTarget(project,chapterId,node,controller,deck){
 const combat=controller.combat;
 if(!combat||combat.disposed)return null;
 let definitionId,cardId;
 if(combat.phase==='choice'){
  const selected=deck.content?.actions?.[deck.index]?.id;
  let choice;
  try{choice=combat.choices().find(choice=>choice.id===selected);}catch{return null;}
  if(!choice)return null;
  definitionId=choice.source?(choice.source.definitionId??choice.source.id):(choice.action.definitionId??choice.action.id);
  cardId=choice.action.id;
 }else if(combat.phase==='enemy-action'){
  definitionId=combat.enemy.definitionId??combat.enemy.id;
  cardId=combat.enemy.actions?.[combat.encounter.actionIndex]?.id;
 }else if(['intro','effects','enemy-death'].includes(combat.phase)){
  const step=combat.sequence?.steps?.[combat.sequence.index];
  if(!step||step.contentId!==deck.content?.id)return null;
  const ownDefinition=project.library?.find(d=>d.id===step.card?.id);
  definitionId=ownDefinition?.id??combat.enemy.definitionId??combat.enemy.id;
  cardId=step.card?.id;
 }else return null;
 const target={kind:'definition',chapterId,nodeId:node.id,definitionId,cardId};
 const source=sourceCard(project,target);
 return source?{...target,definitionPath:source.definitionPath}:null;
}

/** Resolve the visible card to its authored source, without predicting playback. */
export function previewCardTarget({ project, chapterId, controller, deck } = {}) {
  if (!controller || !deck || controller.destroyed || deck.destroyed) return null;
  const state = controller.state;
  if (!state?.idle || state.completed || state.checking || deck.busy || deck.state?.busy || deck.drag
    || controller.pendingIntro || controller.pendingItem || controller.stagedDestination
    || !['closed', 'choices'].includes(deck.phase)) return null;
  const location = controller.location;
  const chapter = project?.chapters?.find(chapter => chapter.id === chapterId);
  const node = chapter?.nodes?.find(node => node.id === location?.node?.id);
  if (!node || state.activeNodeId !== node.id) return null;
  if(node.type==='combat')return combatTarget(project,chapterId,node,controller,deck);
  let sequence;
  if (['legacySequence', 'legacyPool'].includes(node.type)) {
    sequence = node.type === 'legacySequence' ? node.sequence
      : node.sequences?.find(sequence => sequence.id === location.sequence?.id);
    if (!sequence || sequence.id !== location.sequence?.id) return null;
  } else if (location.sequence) return null;
  const type = sequence?.type ?? node.type;
  const card = sequence?.cards?.[location.index] ?? node.cards?.[location.index];
  let placement, slot, parentCardId;
  if (type === 'linear') { placement = card; slot = 'cards'; }
  else if (['fork', 'forked', 'container'].includes(type)) {
    if (deck.phase === 'closed' && !deck.open) {
      placement = sequence ? (type === 'container' ? sequence.cards?.[0] : card) : node.intro;
      slot = 'cards';
    } else if (deck.phase === 'choices' && deck.open) {
      const action = deck.content?.actions?.[deck.index];
      const candidates = type === 'container' ? sequence?.items ?? node.items
        : sequence ? card?.choices : node.choices;
      placement = candidates?.find(placement => placement.id === action?.id);
      slot = type === 'container' ? 'items' : 'choices';
      if (sequence && slot === 'choices') parentCardId = card?.id;
    }
  }
  if (!placement?.id || !placement.definitionId
    || !project.library?.some(definition => definition.id === placement.definitionId)) return null;
  return { chapterId, nodeId: node.id, placementId: placement.id, definitionId: placement.definitionId,
    ...(sequence ? { sequenceId: sequence.id, slot, ...(slot === 'choices' ? { parentCardId } : {}) } : {}) };
}
