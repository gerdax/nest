import { decorateCard } from '../engine/renderer.js';
import { resolvePlacement } from '../project/cards.js';
import { cardFace } from '../project/presentation.js';
import { findPlacement } from './commands.js';
import { applyCardStyles } from '../project/card-styles.js';

/** Static card fronts use the gameplay renderer without gestures or game state. */
export function renderCardPreviews(root,project,node) {
 for(const mount of root.querySelectorAll('[data-card-preview]')) {
  applyCardStyles(mount,project.cardStyles);
  const placement=mount.dataset.previewPlacement && findPlacement(node ?? {},mount.dataset.previewPlacement);
  let card;
  try { card=placement?resolvePlacement(project,placement):project.library.find(d=>d.id===mount.dataset.previewDefinition); }
  catch { mount.replaceChildren(); continue; } // Incomplete drafts can reference missing definitions.
  if(!card)continue;
  const face=cardFace(card,project.variables,project.library);
  const front=document.createElement('article');
  front.className=`nest-card ${['event','caption'].includes(face.cardKind)?'nest-situation':'nest-action'}`;
  decorateCard(null,front,face.image,face.heading,face.text,face.flipImage,face);
  mount.replaceChildren(front);
 }
}
