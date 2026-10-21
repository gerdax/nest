import { chapterVariables } from '../project/model.js';
import { decorateCard } from '../engine/renderer.js';
import { resolvePlacement } from '../project/cards.js';
import { cardFace, actionCardFace } from '../project/presentation.js';
import { findPlacement } from './commands.js';
import { applyCardStyles } from '../project/card-styles.js';

/** Static card fronts use the gameplay renderer without gestures or game state. */
export function renderCardPreviews(root,project,node,chapterId) {
 for(const mount of root.querySelectorAll('[data-card-preview]')) {
  applyCardStyles(mount,project.cardStyles);
  const placement=mount.dataset.previewPlacement && findPlacement(node ?? {},mount.dataset.previewPlacement);
  let card;
  try { card=placement?resolvePlacement(project,placement):project.library.find(d=>d.id===mount.dataset.previewDefinition); }
  catch { mount.replaceChildren(); continue; } // Incomplete drafts can reference missing definitions.
  if(!card)continue;
  const chapter=project.chapters?.find(chapter=>placement?(chapterId?chapter.id===chapterId:chapter.nodes.includes(node)):card.visibility==='local'&&chapter.id===card.chapterId);
  const variables=chapterVariables(project,chapter).map(variable=>({...variable,initial:chapter?.initialValues?.[variable.id]??variable.initial}));
  const values=Object.fromEntries(variables.map(variable=>[variable.id,variable.initial]));
  const typed={...card,itemTags:project.itemTags||[]};
  let face;
  try {face=actionCardFace(typed,variables,project.library,values);}
  catch {
   // Unfinished checks must still show their artwork and authored text.
   face=cardFace(typed,variables,project.library,values);
   if(card.resolution==='check'&&card.check?.mode==='stat')face.summary='';
  }
  const front=document.createElement('article');
  front.className=`nest-card ${['event','caption'].includes(face.cardKind)?'nest-situation':'nest-action'}`;
  decorateCard(null,front,face.image,face.heading,face.text,face.flipImage,face);
  mount.replaceChildren(front);
 }
}
