import {commonCardRemovalPlan} from './common-card-removal.js';
import {cardRuleIndicators} from './card-rule-indicators.js';
import {cardSummaryParts} from '../project/cards.js';
import {attackProfile} from '../project/combat-rules.js';
import {esc,button} from './forms.js';
export const isCommonDefinition=definition=>['combatAction','effect'].includes(definition?.kind);
export function combatActionSummary(project,action){
 const type=action.type||'attack';let effect;
 if(type==='defend')effect=`Reduces next incoming attack damage by ${action.damageReduction??1}`;
 else if(type==='wait')effect='Passes the turn';
 else if(action.attack?.source==='weapon'){
  const bonuses=[action.attack.minBonus?`${action.attack.minBonus>0?'+':''}${action.attack.minBonus} minimum`:null,action.attack.maxBonus?`${action.attack.maxBonus>0?'+':''}${action.attack.maxBonus} maximum`:null].filter(Boolean);
  effect=`Damage: Source Weapon${bonuses.length?` (${bonuses.join(', ')})`:''}`;
 }else {
  try{const range=attackProfile(action,null);effect=range?`Damage: ${range.min===range.max?range.min:`${range.min}–${range.max}`}`:'No damage';}
  catch{effect='Damage: Not configured';}
 }
 let rules=[];
 try{rules=cardSummaryParts(action,(project.variables||[]).map(v=>({...v,name:v.name||(v.id==='energy'?'Energy':v.id)})),project.library,project.itemTags).filter(part=>/^(Requires|Cost|Check):/.test(part));}catch{/* Incomplete drafts remain selectable. */}
 const resolution=action.resolution==='check'?(rules.find(part=>part.startsWith('Check:'))||'Check: Not configured'):'Direct';
 const cooldown=action.cooldown>0?`Cooldown: ${action.cooldown} turn${action.cooldown===1?'':'s'}`:'';
 return [[effect,resolution,cooldown].filter(Boolean).join(' · '),rules.filter(part=>!part.startsWith('Check:')).join(' · ')].filter(Boolean);
}
export function commonLibraryGroups(project){
 const definitions=new Map(project.library.map(d=>[d.id,d]));
 const actions=(project.combat?.defaultActions||[]).map(ref=>({id:ref.definitionId,definition:definitions.get(ref.definitionId)}));
 const hit={id:project.combat?.playerHit?.definitionId,definition:definitions.get(project.combat?.playerHit?.definitionId)};
 const assigned=new Set([...actions.map(row=>row.id),hit.id]);
 return {actions,hit,unassigned:project.library.filter(d=>isCommonDefinition(d)&&!assigned.has(d.id))};
}
const row=(project,{id,definition},role)=>{
 const action=definition?.kind==='combatAction';
 const indicators=definition?cardRuleIndicators(project,{definitionId:definition.id}):[];
 const markerLabel=indicators.map(([letter,label])=>`${letter}: ${label}`).join('; ');
 const markers=indicators.length?`<span class="common-card-rules" role="img" aria-label="${esc(markerLabel)}" title="${esc(markerLabel)}">${indicators.map(([letter])=>letter==='T'?'<span data-rule-marker="T">T</span>':esc(letter)).join(' · ')}</span>`:'';
 const type=({attack:'Attack',defend:'Defend',wait:'Wait'})[definition?.type]||'Attack';
 const summary=action?`<span class="common-action-summary">${combatActionSummary(project,definition).map(line=>`<span>${esc(line)}</span>`).join('')}</span>`:'';
 return `<div class="common-card">${definition?`<div class="common-preview" aria-hidden="true"><div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div></div>`:'<p class="small">Missing definition. Import or restore its source.</p>'}<button type="button" class="common-entry" data-definition="${esc(id||'')}"><strong>${esc(role||definition?.name||'Missing definition')}</strong><span class="common-card-meta"><span>${esc(action?type:definition?.name||'Missing definition')}</span>${markers}</span>${summary}</button></div>`;
};

export function commonLibrary(project){
 const {actions,hit,unassigned}=commonLibraryGroups(project);
 return '<section class="common-section"><h2>Combat Actions</h2>'+actions.map((entry,i)=>'<div class="common-action-row">'+row(project,entry)+'<div class="common-order">'+button('↑','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="-1" aria-label="Move ${esc(entry.definition?.name||'Action')} up" ${i===0?'disabled':''}`)+button('↓','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="1" aria-label="Move ${esc(entry.definition?.name||'Action')} down" ${i===actions.length-1?'disabled':''}`)+'</div></div>').join('')+button('+ Combat Action','add-common-action')+'</section><section class="common-section"><h2>Effects Feedback</h2>'+row(project,hit,'Damage received')+'</section>'+(unassigned.length?'<details class="common-section"><summary>Unassigned common cards</summary>'+unassigned.map(d=>row(project,{id:d.id,definition:d},d.name)).join('')+'</details>':'');
}
export function commonRoleControls(project,definition){
 if(!definition)return '';
 const isDefault=project.combat?.defaultActions?.some(ref=>ref.definitionId===definition.id);
 const removal=commonCardRemovalPlan(project,definition.id);
 const roleButton=definition.kind==='combatAction'?button(isDefault?'Unassign':'Use by default',isDefault?'remove-common-action':'use-common-action',`data-action-id="${esc(definition.id)}" ${!isDefault&&definition.type==='attack'&&definition.attack?.source==='weapon'?'disabled title="Default Actions must use their own attack properties"':''}`):definition.kind==='effect'&&project.combat?.playerHit?.definitionId!==definition.id?button('Use for damage received','use-common-effect',`data-action-id="${esc(definition.id)}"`):'';
 const deletion='<div class="common-delete"><div class="common-card-actions">'+roleButton+button('Delete card','delete-common-card',`data-action-id="${esc(definition.id)}" ${removal.blocked?'disabled':''}`)+'</div>'+(removal.blocked?`<p class="small">${esc(removal.reason)}</p>`:'')+'</div>';
 if(definition.kind==='combatAction')return deletion;
 if(definition.kind==='effect')return '<p class="small">'+(project.combat?.playerHit?.definitionId===definition.id?'Player damage feedback · Combat supplies the resolved damage value.':'Unassigned feedback presentation.')+'</p>'+deletion;
 return '';
}
