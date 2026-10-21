import { resolveCheck, playerCheckPresentation } from './checks.js';
import { cardSummary, playerCardSummary, canonicalCardKind, isStoryKind, isConsumableKind, actionEnergyCost } from './cards.js';

/** Shared front-face content for gameplay and authoring previews. */
export const cardBody = card => card?.text ?? '';
export function cardFace(card, variables=[], library=[], values) {
 const cardKind=canonicalCardKind(card?.kind ?? card?.cardKind ?? 'event');
 return {
  cardKind,
  ...(cardKind==='action'?{actionEnergyCost:actionEnergyCost(card)}:{}),
  ...(isConsumableKind(cardKind)?{value:card.value}:{}),
  ...(card?.inventoryLabel?{inventoryLabel:card.inventoryLabel}:{}),
  heading:(cardKind==='item'||isConsumableKind(cardKind))&&card?.showName===true?(card?.name ?? card?.label ?? 'Continue'):'',
  text:cardBody(card),
  summary:isStoryKind(cardKind)?'':(values === undefined ? cardSummary(card ?? {},variables,library,card?.itemTags || [],{omitActionEnergyCost:true}) : playerCardSummary(card ?? {},variables,library,values)),
  image:card?.image ?? '',
  imageScale:card?.imageScale ?? 100,
  imageOffsetX:card?.imageOffsetX ?? 0,
  imageOffsetY:card?.imageOffsetY ?? 0,
  flipImage:!!card?.flipImage
 };
}

/** Action fronts keep stat-check rules in the surrounding check panel. */
export function actionCardFace(card, variables=[], library=[], values={}) {
 const face=cardFace(card,variables,library,values);
 const checkInfo=card.resolution==='check'?playerCheckPresentation(card.check,values,variables):null;
 const triggerSummary=card.contextItemId?cardSummary({kind:'action',contextItemId:card.contextItemId,itemTags:card.itemTags},variables,library):'';
 return {...face,
  ...(card.resolution==='check'?{checkTarget:resolveCheck(card.check,values).target}:{}),
  ...(checkInfo?{checkInfo:{...checkInfo,rules:face.summary},summary:triggerSummary}:{})};
}
