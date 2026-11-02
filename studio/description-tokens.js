import {renderDescriptionIcons} from '../engine/description-icons.js';
import { resolveDescription, listDescriptionTokens } from '../project/description-tokens.js';
import { chapterVariables } from '../project/model.js';
import { resolvePlacement } from '../project/cards.js';

const atPath=(root,path)=>path.split('.').filter(Boolean).reduce((value,key)=>value?.[key],root);

/** Match the description's owning card, including embedded combat cards. */
export function descriptionEditorContext(project,{scope,path,root,chapter,placement}={}) {
 let owner=root,card,source,enemy=false;
 if(placement&&['placement','local-definition'].includes(scope)) {
  try { owner=resolvePlacement(project,placement); }
  catch { owner=project.library.find(card=>card.id===placement.definitionId)||root; }
 }
 const cardPath=(path||'text').replace(/(?:^|\.)text$/,'').replace(/^overrides(?:\.|$)/,'');
 card=cardPath?atPath(owner,cardPath):owner;
 if(owner?.kind==='enemy'&&/^actions\.\d+$/.test(cardPath)){enemy=true;card=card&&{...card,kind:'combatAction'};}
 if(owner?.kind==='item'&&owner.subtype==='weapon'&&/^combat\.actions\.\d+$/.test(cardPath))source=owner;
 // Shared definitions have no chapter context; local definitions retain theirs.
 const variableChapter=scope==='definition'
  ?owner?.visibility==='local'?project.chapters?.find(item=>item.id===owner.chapterId):undefined
  :chapter;
 const variables=chapterVariables(project,variableChapter).map(variable=>({...variable,initial:variableChapter?.initialValues?.[variable.id]??variable.initial}));
 const values=Object.fromEntries(variables.map(variable=>[variable.id,variable.initial]));
 const prepare=(project.combat?.defaultActions??[]).map(ref=>project.library.find(card=>card.id===ref.definitionId)).find(card=>card?.type==='prepare');
 return {card:card||{},source,variables,values,preparationBonus:0,previewPreparationBonus:prepare?.preparationBonus??2,enemy};
}

/** Insert through the editor's existing input/change history and persistence path. */
export function insertDescriptionToken(textarea,token,editorRoot) {
 if(!token)return;
 const start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??start;
 textarea.focus({preventScroll:true});
 const conditional=token==='[IF:PREPARED][ENDIF]';
 const selected=textarea.value.slice(start,end);
 textarea.setRangeText(conditional?`[IF:PREPARED]${selected}[ENDIF]`:token,start,end,'end');
 if(conditional)textarea.setSelectionRange(start+'[IF:PREPARED]'.length,start+'[IF:PREPARED]'.length+selected.length);
 const EventClass=textarea.ownerDocument?.defaultView?.Event||Event;
 textarea.dispatchEvent(new EventClass('input',{bubbles:true}));
 const caret=textarea.selectionStart,selectionEnd=textarea.selectionEnd,scope=textarea.dataset.scope,path=textarea.dataset.path;
 const placementId=textarea.closest('[data-placement]')?.dataset.placement;
 textarea.dispatchEvent(new EventClass('change',{bubbles:true}));
 // Saving rerenders the inspector. Restore focus to the same stable field.
 if(editorRoot&&textarea.isConnected===false){
  const next=[...editorRoot.querySelectorAll('[data-description-text]')].find(field=>field.dataset.scope===scope&&field.dataset.path===path&&field.closest('[data-placement]')?.dataset.placement===placementId);
  if(next){next.focus({preventScroll:true});next.setSelectionRange(caret,selectionEnd);}
 }
}

/** Controls stay mounted during selection/typing so the textarea keeps its caret. */
export function mountDescriptionEditors(root,contextFor) {
 for(const wrapper of root.querySelectorAll('[data-description-editor]')) {
  if(wrapper.dataset.descriptionMounted)continue;
  wrapper.dataset.descriptionMounted='true';
  const textarea=wrapper.querySelector('[data-description-text]');
  const menu=wrapper.querySelector('[data-description-token]');
  const insert=wrapper.querySelector('[data-description-insert]');
  const preview=wrapper.querySelector('[data-description-preview]');
  const warnings=wrapper.querySelector('[data-description-warnings]');
  const preparedPreview=wrapper.querySelector('[data-description-prepared-preview]');
  const choices=listDescriptionTokens(contextFor(textarea));
  const canPrepare=choices.some(choice=>choice.token==='[IF:PREPARED][ENDIF]');
  const doc=textarea.ownerDocument;
  const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='Choose a token';menu.append(placeholder);
  for(const choice of choices) {
   const option=doc.createElement('option');option.value=choice.token;option.textContent=`${choice.label} · ${choice.token}`;menu.append(option);
  }
  insert.disabled=true;
  menu.addEventListener('change',()=>{insert.disabled=!menu.value;});
  insert.addEventListener('click',()=>insertDescriptionToken(textarea,menu.value,root));
  const update=()=>{
   const context=contextFor(textarea);
   context.preparationBonus=0;
   const resolved=resolveDescription(textarea.value,context);
   preview.hidden=!textarea.value;renderDescriptionIcons(preview,`Base: ${resolved.text}`);preview.style.whiteSpace='pre-wrap';
   let allWarnings=resolved.warnings;
   if(preparedPreview){
    preparedPreview.hidden=!textarea.value||!canPrepare;
    if(canPrepare){
     const prepared=resolveDescription(textarea.value,{...context,preparationBonus:context.previewPreparationBonus??2});
     renderDescriptionIcons(preparedPreview,`Prepared: ${prepared.text}`);preparedPreview.style.whiteSpace='pre-wrap';
     allWarnings=[...new Set([...allWarnings,...prepared.warnings])];
    }
   }
   warnings.hidden=!allWarnings.length;warnings.textContent=allWarnings.join('\n');warnings.style.whiteSpace='pre-wrap';
  };
  textarea.addEventListener('input',update);update();
 }
}
