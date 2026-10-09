import { cardSummary } from './cards.js';

/** Shared front-face content for gameplay and authoring previews. */
export const cardBody = card => card?.text ?? '';
export function cardFace(card, variables=[], library=[]) {
 const cardKind=card?.kind ?? card?.cardKind ?? 'narrative';
 return {
  cardKind,
  heading:cardKind==='narrative'?(card?.heading ?? ''):(card?.name ?? card?.label ?? 'Continue'),
  text:cardBody(card),
  summary:cardKind==='narrative'?'':cardSummary(card ?? {},variables,library),
  image:card?.image ?? '',
  flipImage:!!card?.flipImage
 };
}
