import {cardText} from '../project/card-text.js';
import {cardKinds,canonicalCardKind} from '../project/cards.js';

/** Editor labels are derived without filling the authored Name field. */
export function cardLabel(card) {
 const name=card?.name?.trim();
 if(name)return name;
 return cardFallbackLabel(card);
}

export function cardFallbackLabel(card) {
 const description=(cardText(card).headline || cardText(card).description).replace(/\s+/g,' ').trim();
 if(description){
  const characters=Array.from(description);
  return characters.length>39?characters.slice(0,38).join('').trimEnd()+'…':description;
 }
 const kind=canonicalCardKind(card?.kind||card?.cardKind);
 return `Untitled ${cardKinds[kind]?.label||'card'}`;
}
