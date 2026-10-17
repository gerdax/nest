import { cardSummary, playerCardSummary, canonicalCardKind, isStoryKind } from './cards.js';

/** Shared front-face content for gameplay and authoring previews. */
export const cardBody = card => card?.text ?? '';
export function cardFace(card, variables=[], library=[], values) {
 const cardKind=canonicalCardKind(card?.kind ?? card?.cardKind ?? 'event');
 return {
  cardKind,
  ...(card?.inventoryLabel?{inventoryLabel:card.inventoryLabel}:{}),
  heading:cardKind==='item'&&card?.showName===true?(card?.name ?? card?.label ?? 'Continue'):'',
  text:cardBody(card),
  summary:isStoryKind(cardKind)?'':(values === undefined ? cardSummary(card ?? {},variables,library) : playerCardSummary(card ?? {},variables,library,values)),
  image:card?.image ?? '',
  imageScale:card?.imageScale ?? 100,
  imageOffsetX:card?.imageOffsetX ?? 0,
  imageOffsetY:card?.imageOffsetY ?? 0,
  flipImage:!!card?.flipImage
 };
}
