import {commonCardRemovalPlan} from './common-card-removal.js';
import {esc,button} from './forms.js';
export const isCommonDefinition=definition=>['combatAction','effect'].includes(definition?.kind);
export function commonLibraryGroups(project){
 const definitions=new Map(project.library.map(d=>[d.id,d]));
 const actions=(project.combat?.defaultActions||[]).map(ref=>({id:ref.definitionId,definition:definitions.get(ref.definitionId)}));
 const hit={id:project.combat?.playerHit?.definitionId,definition:definitions.get(project.combat?.playerHit?.definitionId)};
 const assigned=new Set([...actions.map(row=>row.id),hit.id]);
 return {actions,hit,unassigned:project.library.filter(d=>isCommonDefinition(d)&&!assigned.has(d.id))};
}
const row=({id,definition},role)=>`<div class="common-card">${definition?`<div class="common-preview" aria-hidden="true"><div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definition.id)}"></div></div>`:'<p class="small">Missing definition. Import or restore its source.</p>'}<button type="button" class="common-entry" data-definition="${esc(id||'')}"><strong>${esc(role||definition?.name||'Missing definition')}</strong><span>${esc(role?definition?.name||'Missing definition':'Default combat Action')}</span></button></div>`;

export function commonLibrary(project){
 const {actions,hit,unassigned}=commonLibraryGroups(project);
 return '<section class="common-section"><h2>Default combat Actions</h2><p class="small">Available in combat without a Weapon. Select an Action to edit its presentation and rules.</p>'+actions.map((entry,i)=>'<div class="common-action-row">'+row(entry)+'<div class="common-order">'+button('↑','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="-1" aria-label="Move ${esc(entry.definition?.name||'Action')} up" ${i===0?'disabled':''}`)+button('↓','move-common-action',`data-action-id="${esc(entry.id)}" data-direction="1" aria-label="Move ${esc(entry.definition?.name||'Action')} down" ${i===actions.length-1?'disabled':''}`)+'</div></div>').join('')+button('+ Combat Action','add-common-action')+'</section><section class="common-section"><h2>Player combat feedback</h2><p class="small">Shared presentation for combat outcomes.</p>'+row(hit,'Damage received')+'</section>'+(unassigned.length?'<details class="common-section"><summary>Unassigned common cards</summary><p class="small">Preserved definitions that are not currently used as defaults or player damage feedback.</p>'+unassigned.map(d=>row({id:d.id,definition:d},d.name)).join('')+'</details>':'');
}
export function commonRoleControls(project,definition){
 if(!definition)return '';
 const isDefault=project.combat?.defaultActions?.some(ref=>ref.definitionId===definition.id);
 const removal=commonCardRemovalPlan(project,definition.id);
 const deletion='<div class="common-delete">'+button('Delete card','delete-common-card',`data-action-id="${esc(definition.id)}" ${removal.blocked?'disabled':''}`)+(removal.blocked?`<p class="small">${esc(removal.reason)}</p>`:'<p class="small">Deletes this card and removes it from defaults. Undo restores it.</p>')+'</div>';
 if(definition.kind==='combatAction')return deletion+ '<p class="small">'+(isDefault?'Default combat Action · Available without a Weapon.':'Unassigned combat Action · Not available by default.')+'</p>'+button(isDefault?'Remove from defaults':'Use by default',isDefault?'remove-common-action':'use-common-action',`data-action-id="${esc(definition.id)}" ${!isDefault&&definition.attack?.source==='weapon'?'disabled title="Default Actions must use their own attack properties"':''}`);
 if(definition.kind==='effect')return deletion+ '<p class="small">'+(project.combat?.playerHit?.definitionId===definition.id?'Player damage feedback · Combat supplies the resolved damage value.':'Unassigned feedback presentation.')+'</p>'+(project.combat?.playerHit?.definitionId===definition.id?'':button('Use for damage received','use-common-effect',`data-action-id="${esc(definition.id)}"`));
 return '';
}
