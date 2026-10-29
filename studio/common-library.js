import {commonCardRemovalPlan} from './common-card-removal.js';
import {cardRuleIndicators} from './card-rule-indicators.js';
import {esc,button} from './forms.js';
export const isCommonDefinition=definition=>['combatAction','effect'].includes(definition?.kind);
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
 return `<div class="common-card">${definition?`<div class="common-preview" aria-hidden="true"><div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div></div>`:'<p class="small">Missing definition. Import or restore its source.</p>'}<button type="button" class="common-entry" data-definition="${esc(id||'')}"><strong>${esc(role||definition?.name||'Missing definition')}</strong><span class="common-card-meta"><span>${esc(action?type:definition?.name||'Missing definition')}</span>${markers}</span></button></div>`;
};

export function commonLibrary(project){
 const {actions,hit,unassigned}=commonLibraryGroups(project);
 return '<section class="common-section"><h2>Combat Actions</h2>'+actions.map((entry,i)=>'<div class="common-action-row">'+row(project,entry)+'<div class="common-order">'+button('↑','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="-1" aria-label="Move ${esc(entry.definition?.name||'Action')} up" ${i===0?'disabled':''}`)+button('↓','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="1" aria-label="Move ${esc(entry.definition?.name||'Action')} down" ${i===actions.length-1?'disabled':''}`)+'</div></div>').join('')+button('+ Combat Action','add-common-action')+'</section><section class="common-section"><h2>Combat Feedback</h2>'+row(project,hit,'Damage received')+'</section>'+(unassigned.length?'<details class="common-section"><summary>Unassigned common cards</summary>'+unassigned.map(d=>row(project,{id:d.id,definition:d},d.name)).join('')+'</details>':'');
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
