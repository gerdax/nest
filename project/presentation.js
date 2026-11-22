import {resolveDescription} from './description-tokens.js';
import {cardText} from './card-text.js';
import { resolveCheck, playerCheckPresentation, diceCheckTarget } from './checks.js';
import { cardSummary, playerCardSummary, canonicalCardKind, isStoryKind, isConsumableKind, consumableResource, actionEnergyCost, actionHealthCost } from './cards.js';

/** Shared front-face content for gameplay and authoring previews. */
export const cardBody = (card,context={}) => resolveDescription((['event','narrative','discovery','caption','enemy','effect'].includes(card?.kind??card?.cardKind)?cardText(card).headline:cardText(card).description),{preparationBonus:0,...context,card}).text;
export function cardFace(card, variables=[], library=[], values,descriptionContext={}) {
 const copy=cardText(card,{enemyAction:descriptionContext.enemy===true});
 const context={preparationBonus:0,...descriptionContext,variables,values:values??Object.fromEntries(variables.map(v=>[v.id,v.initial])),card};
 const heading=resolveDescription(copy.headline,context).text;
 const description=resolveDescription(copy.description,context).text;
 const authoredKind=canonicalCardKind(card?.kind ?? card?.cardKind ?? 'event');
 const cardKind=authoredKind==='consumable'?consumableResource(card):authoredKind==='enemy'?'event':authoredKind==='effect'?'health':authoredKind==='combatAction'?'action':authoredKind;
 return {
  cardKind,
  ...(cardKind==='item'&&card?.permability>0?{usesRemaining:card.remainingTriggers??card.permability}:{}),
  prepared:authoredKind==='combatAction'&&descriptionContext.preparationBonus>0&&(card.type??'attack')==='attack',
  ...(cardKind==='action'?{actionEnergyCost:actionEnergyCost(card),actionHealthCost:actionHealthCost(card)}:{}),
  ...(isConsumableKind(cardKind)?{value:authoredKind==='effect'?(card.value??-2):card.value,...(authoredKind==='effect'?{showValue:card.showValue!==false}:{})}:{}),
  ...(authoredKind==='effect'?{typeLabel:'EFFECT'}:authoredKind==='combatAction'?{typeLabel:descriptionContext.preparationBonus>0&&(card.type??'attack')==='attack'?'PREPARED':(card.type??'attack').toUpperCase()}:authoredKind==='item'&&card.subtype==='weapon'?{typeLabel:'WEAPON'}:{}),
  ...(card?.inventoryLabel?{inventoryLabel:card.inventoryLabel}:{}),
  semanticText:true,
  heading,
  text:description,
  summary:isStoryKind(cardKind)?'':(values === undefined ? cardSummary(card ?? {},variables,library,card?.itemTags || [],{omitActionResourceCosts:true}) : playerCardSummary(card ?? {},variables,library,values)),
  image:card?.image ?? '',
  imageScale:card?.imageScale ?? 100,
  imageOffsetX:card?.imageOffsetX ?? 0,
  imageOffsetY:card?.imageOffsetY ?? 0,
  flipImage:!!card?.flipImage
 };
}

/** Action fronts keep stat-check rules in the surrounding check panel. */
export function actionCardFace(card, variables=[], library=[], values={},descriptionContext={}) {
 const face=cardFace(card,variables,library,values,descriptionContext);
 const resolved=card.resolution==='check'?resolveCheck(card.check,values,descriptionContext.checkBonus):null;
 const checkInfo=resolved?playerCheckPresentation(card.check,values,variables,{resolved,showCustom:card.lockMethod==='force'}):null;
 const triggerSummary=card.contextItemId?cardSummary({kind:'action',contextItemId:card.contextItemId,itemTags:card.itemTags},variables,library):'';
 return {...face,
  ...(resolved?{checkTarget:diceCheckTarget(resolved)}:{}),
  ...(checkInfo?{checkInfo:{...checkInfo,rules:face.summary},summary:triggerSummary}:{})};
}
