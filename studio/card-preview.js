import { chapterVariables } from '../project/model.js';
import { decorateCard } from '../engine/renderer.js';
import { resolvePlacement } from '../project/cards.js';
import { cardFace, actionCardFace } from '../project/presentation.js';
import { enemyActionCard } from '../project/combat-presentation.js';
import { findPlacement } from './commands.js';
import { applyCardStyles } from '../project/card-styles.js';

const preparedControls=new WeakMap();

/** Static card fronts use the gameplay renderer without gestures or game state. */
export function renderCardPreviews(root,project,node,chapterId) {
 for(const mount of root.querySelectorAll('[data-card-preview]')) {
  applyCardStyles(mount,project.cardStyles);
  const placement=mount.dataset.previewPlacement && findPlacement(node ?? {},mount.dataset.previewPlacement);
  let card;
  try { card=placement?resolvePlacement(project,placement):project.library.find(d=>d.id===mount.dataset.previewDefinition); }
  catch { mount.replaceChildren(); continue; } // Incomplete drafts can reference missing definitions.
  const owner=card;
  const enemyAction=card?.kind==='enemy'&&/^actions\.\d+$/.test(mount.dataset.previewPath??'');
  if(mount.dataset.previewPath)card=mount.dataset.previewPath.split('.').reduce((value,key)=>value?.[key],card);
  if(!card)continue;
  const chapter=project.chapters?.find(chapter=>placement?(chapterId?chapter.id===chapterId:chapter.nodes.includes(node)):owner.visibility==='local'&&chapter.id===owner.chapterId);
  const variables=chapterVariables(project,chapter).map(variable=>({...variable,initial:chapter?.initialValues?.[variable.id]??variable.initial}));
  const values=Object.fromEntries(variables.map(variable=>[variable.id,variable.initial]));
  const typed={...card,itemTags:project.itemTags||[]};
  const eligible=card.kind==='combatAction'&&(card.type??'attack')==='attack'&&!enemyAction;
  let controls=preparedControls.get(mount);
  // Thumbnail lists stay compact; the switch belongs above the full card.
  if(!controls&&eligible&&mount.before&&!mount.closest?.('.common-preview')){
   const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');
   label.className='small card-preview-prepared-toggle';checkbox.type='checkbox';text.textContent='Preview prepared';
   label.append(checkbox,text);mount.before(label);
   controls={label,checkbox,draw:null};preparedControls.set(mount,controls);
   checkbox.addEventListener('change',()=>controls.draw?.());
  }
  if(controls)controls.label.hidden=!eligible;
  const prepare=(project.combat?.defaultActions??[]).map(ref=>project.library.find(d=>d.id===ref.definitionId)).find(d=>d?.type==='prepare');
  const draw=()=>{
   const context={source:owner?.subtype==='weapon'?owner:undefined,preparationBonus:eligible&&controls?.checkbox.checked?prepare?.preparationBonus??2:0};
   let face;
   try {face=enemyAction?enemyActionCard(typed,'preview',{variables,values,enemy:true}):actionCardFace(typed,variables,project.library,values,context);}
   catch {
    // Unfinished checks must still show their artwork and authored text.
    face=cardFace(typed,variables,project.library,values,context);
    if(card.resolution==='check'&&card.check?.mode==='stat')face.summary='';
   }
   const front=document.createElement('article');
   front.className=`nest-card ${['event','caption'].includes(face.cardKind)?'nest-situation':'nest-action'}`;
   decorateCard(null,front,face.image,face.heading,face.text,face.flipImage,face);
   mount.replaceChildren(front);
  };
  if(controls)controls.draw=draw;
  draw();
 }
}
