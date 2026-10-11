import { cardSummary, canonicalCardKind, isStoryKind } from './cards.js';

/** Shared front-face content for gameplay and authoring previews. */
export const cardBody = card => card?.text ?? '';
export function cardFace(card, variables=[], library=[]) {
 const cardKind=canonicalCardKind(card?.kind ?? card?.cardKind ?? 'event');
 return {
  cardKind,
  heading:cardKind==='item'&&card?.showName===true?(card?.name ?? card?.label ?? 'Continue'):'',
  text:cardBody(card),
  summary:isStoryKind(cardKind)?'':cardSummary(card ?? {},variables,library),
  image:card?.image ?? '',
  imageScale:card?.imageScale ?? 100,
  imageOffsetX:card?.imageOffsetX ?? 0,
  imageOffsetY:card?.imageOffsetY ?? 0,
  flipImage:!!card?.flipImage
 };
}
