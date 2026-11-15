import { esc, options } from './fields.js';
import { allocateVariableId } from './variable-ids.js';

export const CREATE_FLAG = '__create_progression_flag__';
const normalizedName = name => String(name ?? '').trim().toLocaleLowerCase();

export function existingProgressionFlag(variables, name) {
 const matches=variables.filter(variable=>normalizedName(variable.name||variable.id)===normalizedName(name));
 if(matches.length>1)throw new Error('Several variables have this name. Rename them before choosing one.');
 if(matches[0]&&matches[0].type!=='flag')throw new Error('A Number variable already has this name. Choose another name.');
 return matches[0];
}

/** Validation precedes mutation; the host commits the flag and rule together. */
export function setProgressionFlag(project, root, chapter, data) {
 const name=String(data.name??'').trim();
 if(!name)throw new Error('Enter a flag name.');
 if(!['global','chapter'].includes(data.variableScope)||data.variableScope==='chapter'&&!chapter)throw new Error('Chapter flags are not available for this card.');
 if(typeof data.value!=='boolean')throw new Error('Choose True or False.');
 const condition=/(^|\.)conditions$/.test(data.path);
 if(!condition&&!['effects','overrides.effects','victoryEffects'].includes(data.path))throw new Error('Choose On progression effects or Appearance conditions.');
 const parts=data.path.split('.'),key=parts.pop();
 const owner=parts.reduce((owner,key)=>owner?.[key],root);
 if(!owner||!Array.isArray(owner[key])&&!((condition||key==='victoryEffects')&&owner[key]==null))throw new Error('These rules are no longer available.');
 const index=data.index==null?null:Number(data.index);
 if(index!==null&&(!Number.isInteger(index)||index<0||index>=(owner[key]?.length??0)))throw new Error('This effect is no longer available.');
 const variables=data.variableScope==='chapter'?chapter.variables??[]:project.variables;
 let flag=existingProgressionFlag(variables,name);
 if(!flag){
  flag={id:allocateVariableId(project,name),name,type:'flag',initial:false};
  if(data.variableScope==='chapter')chapter.variables=variables;
  variables.push(flag);
 }
 const rule=condition?{source:'variable',op:'eq',key:flag.id,value:data.value}:{op:'set',key:flag.id,value:data.value};
 owner[key]??=[];
 if(index===null)owner[key].push(rule);else owner[key][index]=rule;
 return flag.id;
}

/** Draft controls deliberately have no document data-path: typing creates no history. */
export function progressionFlagEditor({variables,chapter,path,scope,index,currentKey='',target='',addButton='',context=''}) {
 const condition=/(^|\.)conditions$/.test(path);
 const requirement=context==='Requirements';
 const victory=path==='victoryEffects';
 const eventText=victory?'this combat is won':'this card is advanced';
 const conditionText=requirement?'The action is available':'The card appears';
 const scopes=chapter?[['chapter','Chapter'],['global','Global']]:[['global','Global']];
 const flags=variables.map(v=>({name:v.name||v.id,type:v.type,scope:v.variableScope==='chapter'?'chapter':'global'}));
 return `<div data-progression-flag data-flag-condition-text="${esc(conditionText)}" data-flag-event-text="${esc(eventText)}" data-scope="${esc(scope)}" data-effects-path="${esc(path)}" ${index==null?'':`data-effect-index="${index}"`} data-current-key="${esc(currentKey)}" data-flag-variables="${esc(JSON.stringify(flags))}">
 ${target||`<div class="rule-footer-actions">${addButton}<button type="button" data-flag-open>+ Create flag…</button></div>`}
 <div class="entry" data-flag-draft hidden>
 <label class="field">Name<input type="text" data-flag-name autocomplete="off"></label>
 <label class="field">Scope<select data-flag-scope>${options(scopes,chapter?'chapter':'global')}</select></label>
 <label class="field" data-flag-value-field>${condition?'Required value':victory?'Set on victory':'Set on progression'}<select data-flag-value>${options([['true','True'],['false','False']],'true')}</select></label>
 <p class="small" data-flag-help>${condition?`Starts as False. ${conditionText} only when the flag is True.`:`Starts as False. Becomes True when ${eventText}.`}</p>
 <p class="small" data-flag-error role="status"></p>
 <button type="button" data-flag-save disabled>${condition?'Create and add condition':'Create and add effect'}</button>
 <button type="button" data-flag-cancel>Cancel</button>
 </div></div>`;
}

export function mountProgressionFlags(root,{create}) {
 const update=box=>{
  const name=box.querySelector('[data-flag-name]').value;
  const scope=box.querySelector('[data-flag-scope]').value;
  const value=box.querySelector('[data-flag-value]').value==='true';
  const save=box.querySelector('[data-flag-save]'),error=box.querySelector('[data-flag-error]');
  let existing;
  error.textContent='';
  try{existing=existingProgressionFlag(JSON.parse(box.dataset.flagVariables).filter(v=>v.scope===scope),name);}
  catch(failure){error.textContent=failure.message;}
  save.disabled=!name.trim()||!!error.textContent;
  const condition=/(^|\.)conditions$/.test(box.dataset.effectsPath);
  const conditionText=box.dataset.flagConditionText;
  const eventText=box.dataset.flagEventText;
  save.textContent=condition?(existing?'Use existing and add condition':'Create and add condition'):(existing?'Use existing':'Create and add effect');
  box.querySelector('[data-flag-help]').textContent=condition
   ?`${existing?'Uses the existing flag.':'Starts as False.'} ${conditionText} only when the flag is ${value?'True':'False'}.`
   :existing
   ?`Uses the existing flag. Sets it to ${value?'True':'False'} when ${eventText}.`
   :`Starts as False. Becomes ${value?'True':'False'} when ${eventText}.`;
 };
 const open=box=>{box.querySelector('[data-flag-draft]').hidden=false;update(box);box.querySelector('[data-flag-name]').focus();};
 root.addEventListener('change',event=>{
  const box=event.target.closest('[data-progression-flag]');
  if(!box)return;
  if(event.target.matches('select[data-path]')&&event.target.value===CREATE_FLAG){
   event.stopImmediatePropagation();open(box);
  }else if(event.target.matches('[data-flag-scope],[data-flag-value]'))update(box);
 },true);
 root.addEventListener('input',event=>{
  const box=event.target.closest('[data-progression-flag]');
  if(box&&event.target.matches('[data-flag-name]'))update(box);
 });
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-flag-open],[data-flag-cancel],[data-flag-save]');
  if(!button)return;
  const box=button.closest('[data-progression-flag]');
  if(button.matches('[data-flag-open]'))open(box);
  else if(button.matches('[data-flag-cancel]')){
   box.querySelector('[data-flag-draft]').hidden=true;
   const target=box.querySelector('select[data-path]');if(target)target.value=box.dataset.currentKey;
  }else if(!button.disabled){
   create({scope:box.dataset.scope,path:box.dataset.effectsPath,index:box.dataset.effectIndex,
    placement:box.closest('[data-placement]')?.dataset.placement,
    name:box.querySelector('[data-flag-name]').value,variableScope:box.querySelector('[data-flag-scope]').value,
    value:box.querySelector('[data-flag-value]').value==='true'});
  }
 });
}
