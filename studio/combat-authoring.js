import {isDodgeFeedback} from './common-library.js';
import {attackDamageRange,enemyActionSelection} from '../project/combat-rules.js';
import {field,select,checkbox,button,imageField,artworkEditor,rules,actionResolutionFields,checkSettingsFields,esc} from './forms.js';
import {createEnemyAction,createEffectCard,createCombatAction} from '../project/combat-model.js';
import {uid,pathTarget} from './commands.js';
const refs=(project,kind)=>[['','Choose a Library definition'],...project.library.filter(d=>d.kind===kind&&d.visibility!=='local').map(d=>[d.id,d.name||d.id])];

const attrs=(path,scope='definition')=>`data-scope="${scope}" data-path="${esc(path)}"`;
const add=(label,path,factory,scope='definition')=>button(label,'combat-add',`${attrs(path,scope)} data-factory="${factory}"`);
const controls=(path,i,count,min=0,scope='definition',className='')=>`<div class="row${className?' '+esc(className):''}">${button('Move up','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="-1" ${i===0?'disabled':''}`)}${button('Move down','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="1" ${i===count-1?'disabled':''}`)}${button('Remove','combat-remove',`${attrs(path,scope)} data-index="${i}" ${count<=min?'disabled':''}`)}</div>`;
function orderedEntry(html,path,index,count,{min=0,label='action',removeReason=''}={}){
 const target=`${attrs(path)} data-index="${index}"`;
 const arrow=(direction,disabled)=>{const name=`Move ${label} ${direction<0?'up':'down'}`;return `<button type="button" class="card-order-arrow" data-command="combat-move" ${target} data-direction="${direction}" aria-label="${esc(name)}" title="${esc(name)}" ${disabled?'disabled':''}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${direction<0?'M3 10 8 5l5 5':'M3 6l5 5 5-5'}"/></svg></button>`;};
 return `<div class="card-placement-row combat-entry-row" data-combat-section="${esc(path)}">${html}<div class="card-order-controls">${arrow(-1,index===0)}${arrow(1,index===count-1)}</div><button type="button" class="card-remove-button" data-command="combat-remove" ${target} aria-label="Remove ${esc(label)}" title="${esc(removeReason||`Remove ${label}`)}" ${count<=min||removeReason?'disabled':''}><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 3 10 10M13 3 3 13"/></svg></button></div>`;
}
export function combatReferenceList(project,list,path,label,scope='definition'){
 return `<h3>${esc(label)}</h3>`+(list||[]).map((ref,i)=>`<div class="entry">${select('Combat Action',ref.definitionId,refs(project,'combatAction').filter(([id])=>path!=='combat.defaultActions'||!id||!(project.library.find(d=>d.id===id)?.type==='attack'&&project.library.find(d=>d.id===id)?.attack?.source==='weapon')),`${path}.${i}.definitionId`,scope)}${controls(path,i,list.length,0,scope)}</div>`).join('')+add('Add combat action',path,'reference',scope);
}
function damageFields(damage,prefix){return '<div class="row">'+field('Minimum damage',damage?.min??1,`${prefix}.min`,'definition','number')+field('Maximum damage',damage?.max??1,`${prefix}.max`,'definition','number')+'</div>';}
function embeddedImage(card,path,definitionId,enemy=false){
 return `<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definitionId)}" data-preview-path="${esc(path)}"></div>`+(card.kind==='caption'||enemy&&card.kind==='combatAction'&&card.presentationKind==='caption'?'':imageField('Artwork path',card.image,`${path}.image`,'definition',{clearable:true})+artworkEditor(card,'definition',path));
}
function embeddedCard(card,path,definitionId,{kinds=['event','caption'],heading='Card',fixedLabel=false,editableName=true,collapsible=true,beforePreview=''}={}){
 if(!card)return '<p class="small">Missing required card.</p>';
 return (collapsible?`<details class="entry combat-embedded" open><summary>${esc(heading)}${fixedLabel?'':` · ${esc(card.name||'Untitled')}`}</summary>`:'')+(editableName?field('Name',card.name,`${path}.name`):'')+ (kinds.length>1?select('Card type',card.kind,kinds.map(k=>[k,k==='event'?'Vignette':k==='effect'?'Feedback':'Caption']),`${path}.kind`):'')+field('Description',card.text,`${path}.text`,'definition','textarea')+beforePreview+embeddedImage(card,path,definitionId)+(collapsible?'</details>':'');
}
export function defendRevealFields(project,action,prefix=''){
 if(action.kind!=='combatAction'||action.type!=='defend')return '';
 const selected=action.reveal?.definitionId||'',id=selected||project.combat?.playerDodge?.definitionId;
 const definition=project.library.find(d=>d.id===id&&d.kind==='effect');
 const options=[['','Default Dodge'],...project.library.filter(d=>d.kind==='effect'&&d.visibility!=='local'&&d.id!==project.combat?.playerHit?.definitionId).map(d=>[d.id,d.name||d.id])];
 return '<details class="entry combat-embedded"><summary>Reveal</summary>'+select('Feedback effect',selected,options,`${prefix}reveal.definitionId`)+button('Go to definition','go-to-definition',`data-definition="${esc(definition?.id||'')}" ${definition?'':'disabled'}`)+'</details>';
}
export function combatActionTypeField(action,prefix='',scope='definition',{enemy=false}={}){
 const types=[['attack','Attack'],['defend','Defend'],['prepare','Prepare'],...(enemy||action.type==='wait'?[['wait','Wait']]:[])];
 return select('Action type',action.type||'attack',types,prefix+'type',scope);
}
function weaponDamageBonusFields(action,weapon,prefix) {
 const range=attackDamageRange(action,weapon),id=`damage-range-${weapon?.id??'action'}-${prefix}`;
 const bonusField=(label,key)=>field(label,action.attack?.[key]??0,`${prefix}attack.${key}`,'definition','number')
  .replace('type="number"',`type="number" aria-describedby="${esc(id)}"${range.valid?'':' aria-invalid="true"'}`);
 return `<div class="weapon-damage-bonuses">${bonusField('Minimum damage bonus','minBonus')}${bonusField('Maximum damage bonus','maxBonus')}<p id="${esc(id)}" class="small calculated-damage${range.valid?'':' calculated-damage-invalid'}" role="status">Calculated damage: <strong>${esc(range.min)}–${esc(range.max)}</strong>${range.valid?'':' · Invalid'}<br>${esc(range.equation)}${range.reason?`<br>${esc(range.reason)}`:''}</p></div>`;
}
function combatActionFields(project,action,prefix='',{enemy=false,owned=false,showType=true,weapon,opposedPreparation=false}={}){
 const path=key=>prefix+key,type=action.type||'attack';
 const playerRules=!enemy;
 let html=showType?combatActionTypeField(action,prefix,'definition',{enemy}):'';
 if(type==='attack'){
  const sources=enemy?[['self','Own damage'],['none','No attack']]:[['self','Own damage'],['weapon','Source Weapon'],['none','No attack']];
  html+='<h4>Action properties</h4>'+select('Attack properties',action.attack?.source||'none',sources,path('attack.source'))+(action.attack?.source==='self'?damageFields(action.attack.damage,path('attack.damage'))+(enemy&&(action.attack.minBonus||action.attack.maxBonus)?weaponDamageBonusFields(action,undefined,prefix):''):'')+(action.attack?.source==='weapon'?weaponDamageBonusFields(action,weapon,prefix):'');
 }else {
  html+='<h4>Action properties</h4>';
  if(type==='defend'&&enemy)html+=select('Protection',action.protection||'numeric',[['numeric','Damage reduction'],['all','Entire incoming attack']],path('protection'))+(action.protection==='all'?'<p class="small">Stops all damage on success. Uses its own resolution check.</p>':field('Damage reduction',action.damageReduction??1,path('damageReduction'),'definition','number')+'<p class="small">Direct Action. Reduces damage from the next opposing attack, then expires even if it misses. Protection does not stack. Spends the turn.</p>');
  else if(type==='defend')html+=field('Damage reduction',action.damageReduction??1,path('damageReduction'),'definition','number')+'<p class="small">Direct Action. Reduces damage from the next opposing attack, then expires even if it misses. Protection does not stack. Spends the turn.</p>';
  else if(type==='prepare'&&enemy&&(opposedPreparation||Array.isArray(action.preparedActions)))html+='<p class="small">Uses the prepared actions below. Spends the turn.</p>';
  else if(type==='prepare')html+=field('Preparation bonus',action.preparationBonus??2,path('preparationBonus'),'definition','number')+(enemy?field('Damage reduction',action.damageReduction??1,path('damageReduction'),'definition','number')+'<p class="small">Secretly prepares either a block against your next Attack or bonus damage on its next successful Attack. Equal chance; replaces previous preparation. Spends the turn.</p>':'<p class="small">Applies only to your next action. An Attack gains this damage bonus, or breaks defence and deals base damage only. Any other action or a missed Attack consumes preparation. A successful new Prepare replaces it; a failed Prepare clears it. Direct resolution needs no roll. Resets each encounter. Spends the turn.</p>');
  else html+='<p class="small">Direct Action. Passes the turn.</p>';
 }
 if(playerRules)html+=field('Cooldown (following player turns)',action.cooldown??0,path('cooldown'),'definition','number')
  +rules(project,action.conditions,path('conditions'),'definition','conditions',{label:'Requirements',help:'All requirements must pass before this action can be selected. Health and Energy equality requirements act as minimums. Requirements do not spend resources.'})
  +rules(project,action.costs,path('costs'),'definition','costs');
 if(!enemy||owned)html+=rules(project,action.effects,path('effects'),'definition','effects',{label:'Progression effects',help:'Apply when the action completes. For a dice check, these apply on either outcome.'});
 if(type==='attack'||type==='prepare'&&!enemy||enemy&&type==='defend'&&action.protection==='all')html+=actionResolutionFields(project,action,prefix,'definition',undefined,{showEffects:!enemy||owned});
 if(owned)html+='<p class="small">Enemy preparation requires no costs/requirements and zero cooldown.</p>';
 if(enemy&&owned)html+=select('Card type',action.presentationKind||'event',[['event','Vignette'],['caption','Caption']],path('presentationKind'));
 return html;
}

export function preparedActionChoices(enemy,trigger){
 if(trigger==='all'){const eligible=new Set([...preparedActionChoices(enemy,'incoming-hit'),...preparedActionChoices(enemy,'after-player-action')]);return (enemy.preparedActions||[]).filter(action=>eligible.has(action));}
 return (enemy.preparedActions||[]).filter(d=>d.kind==='combatAction'&&Array.isArray(d.conditions)&&!d.conditions.length&&Array.isArray(d.costs)&&!d.costs.length&&d.cooldown===0&&
  (trigger==='incoming-hit'?d.type==='defend'&&d.protection==='all'&&d.damageReduction===1&&['direct','check'].includes(d.resolution):trigger==='fallback'?d.type==='wait'&&d.resolution==='direct':d.type==='wait'&&d.resolution==='direct'||d.type==='attack'&&['self','none'].includes(d.attack?.source)&&['direct','check'].includes(d.resolution)));
}
function preparedActionFields(enemy,action,path){
 const list=action.preparedActions||[],base=`${path}.preparedActions`;
 const picker=(label,id,p,trigger)=>select(label,id||'',[['',trigger==='fallback'?'No response':'Choose an action'],...preparedActionChoices(enemy,trigger).map(d=>[d.id,d.name||d.id])],p);
 return '<h4>What can this enemy prepare?</h4><p class="small">Add choices from the Prepared actions below. Prepare secretly picks one. Equal weights mean equal chances. Weight 2 is twice as likely as weight 1.</p>'+list.map((ref,i)=>{
  const p=`${base}.${i}`,selected=(enemy.preparedActions||[]).find(a=>a.id===ref.actionId);
  const timing=!selected?(ref.trigger==='incoming-hit'?'Choose a defense action for this trigger.':'Choose an Attack or Wait for this trigger.'):'';
  return '<div class="entry">'+picker('Action',ref.actionId,`${p}.actionId`,'all')+select('Trigger',ref.trigger,[['incoming-hit',"When the player's attack hits"],['after-player-action',"After the player's action"]],`${p}.trigger`)+(timing?`<p class="small">${esc(timing)}</p>`:'')+field('Chance weight',ref.weight??1,`${p}.weight`,'definition','number')+(selected?.type==='defend'?picker('Response to other player actions',ref.fallback?.actionId,`${p}.fallback.actionId`,'fallback')+(ref.fallback?.actionId?['defend','wait','prepare'].map(type=>checkbox(`Show response after player ${type}`,ref.fallback.when?.includes(type),`${p}.fallback.when.${type}`)).join('')+(Array.isArray(ref.fallback?.when)&&!ref.fallback.when.length?'<p class="small">No player actions selected. This fallback is disabled.</p>':''):''):'')+controls(base,i,list.length)+'</div>';
 }).join('')+add('Add choice',base,'prepared-reference');
}
function ownedPreparedActions(project,enemy){
 return '<h3>Prepared actions</h3><p class="small">Create an action, choose its type, then add it to a Prepare action above.</p>'+(enemy.preparedActions||[]).map((action,i)=>{
  const path=`preparedActions.${i}`;

  return orderedEntry(`<details class="entry combat-embedded" data-enemy-action-type="${esc(action.type||'attack')}" open><summary>${esc(action.name||'Prepared action')}</summary>`+field('Name',action.name,`${path}.name`)+select('Action type',action.type,[['attack','Attack'],['defend','Defend'],['wait','Wait']],`${path}.type`)+field('Description',action.text,`${path}.text`,'definition','textarea')+combatActionFields(project,action,`${path}.`,{enemy:true,owned:true,showType:false})+embeddedImage(action,path,enemy.id,true)+'</details>','preparedActions',i,enemy.preparedActions.length,{label:'prepared action'});
 }).join('')+add('Add prepared action','preparedActions','prepared-action');
}

function weaponActions(project,weapon){
 return '<h3>Combat Actions</h3><p class="small">Owned by this Weapon and available while the player carries it.</p>'+(weapon.combat?.actions||[]).map((action,i)=>{
 const path=`combat.actions.${i}`;
 if(action.kind!=='combatAction')return '<p class="small">Missing Combat Action. Restore its source definition to migrate it.</p>';
 return `<details class="entry combat-embedded" open><summary>${esc(action.name||'Combat Action')}</summary>`+field('Name',action.name,`${path}.name`)+combatActionTypeField(action,`${path}.`)+field('Description',action.text,`${path}.text`,'definition','textarea')+combatActionFields(project,action,`${path}.`,{showType:false,weapon})+embeddedImage(action,path,weapon.id)+defendRevealFields(project,action,`${path}.`)+controls('combat.actions',i,weapon.combat.actions.length)+'</details>';
 }).join('')+add('Add combat action','combat.actions','weapon-action');
}
export function combatDefinitionFields(project,d){
 if(d.kind==='combatAction')return combatActionFields(project,d,'',{showType:false});
 if(d.kind==='item')return (d.subtype==='weapon'?`<h3>Weapon damage</h3>${damageFields(d.combat?.damage,'combat.damage')}<p class="small">This milestone resolves damage from the Weapon profile. Additional intrinsic effects and statuses are deferred.</p>${weaponActions(project,d)}`:'');
 if(d.kind==='effect'&&isDodgeFeedback(project,d))return '';
 if(d.kind==='effect')return '<p class="small">Combat supplies the resolved signed health change. Preview sample: −2. This card applies no collection effects.</p>';
 if(d.kind!=='enemy')return '';
 let html='';
 html+='<h3>Combat Actions</h3>'+select('Action selection',Object.hasOwn(d,'actionSelection')&&!['random','order'].includes(d.actionSelection)?d.actionSelection:enemyActionSelection(d),[['random','Random'],['order','Order']],'actionSelection')+'<p class="small">'+(d.actionSelection==='random'||!Object.hasOwn(d,'actionSelection')&&d.mechanics==='opposed-preparation'?'One action is selected each enemy turn using Random weights. Equal weights mean equal chances.':'Actions play from top to bottom, then repeat. Random weights are ignored.')+'</p>'+(d.actions||[]).map((action,i)=>{
 const path=`actions.${i}`;
 return orderedEntry(`<details class="entry" data-enemy-action-type="${esc(action.type||'attack')}" open><summary>${i+1} · ${esc(action.name)}</summary>`+field('Name',action.name,`${path}.name`)+combatActionTypeField(action,`${path}.`,'definition',{enemy:true})+field('Random weight',action.weight??1,`${path}.weight`,'definition','number').replace('step="any"','step="1" min="1"')+'<p class="small">Used by Random selection. Ignored in Order; kept when switching modes.</p>'+field('Description',action.text,`${path}.text`,'definition','textarea')+combatActionFields(project,action,`${path}.`,{enemy:true,showType:false,opposedPreparation:d.mechanics==='opposed-preparation'})+(action.type==='prepare'&&(d.mechanics==='opposed-preparation'||Array.isArray(action.preparedActions))?preparedActionFields(d,action,path):'')+embeddedImage(action,path,d.id,true)+'</details>','actions',i,d.actions.length,{min:1,label:'combat action'});
 }).join('')+add('Add combat action','actions','enemy-action');

 if(d.mechanics==='opposed-preparation'||Array.isArray(d.preparedActions))html+=ownedPreparedActions(project,d);

 if(d.mechanics==='opposed-preparation'&&!Array.isArray(d.preparedActions)&&!(d.actions||[]).some(action=>Array.isArray(action.preparedActions))){
  const prepares=(d.actions||[]).map((action,index)=>({action,index})).filter(({action})=>action.type==='prepare');
  const rushProperties=prepares.map(({action,index})=>field(prepares.length>1?`Damage bonus · Action ${index+1}: ${action.name||'Prepare'}`:'Damage bonus',action.preparationBonus??2,`actions.${index}.preparationBonus`,'definition','number')).join('');
  html+='<h3>Prepared actions</h3>'+[['block','Dodge'],['charge','Rush'],['hold','Skip']].map(([key,heading])=>{
   const card=d.preparationCards?.[key],path=`preparationCards.${key}`;
   let properties=key==='block'||key==='charge'?select('Resolution',card?.resolution||'check',[['direct','Direct'],['check','Dice check']],`${path}.resolution`):'';
   if((key==='block'||key==='charge')&&card?.resolution!=='direct')properties+=checkSettingsFields(project,card?.check??{pool:[{sides:6,count:3}],modifier:0,target:10},`${path}.check.`);
   properties+=key==='block'?'<p class="small">Success dodges the entire attack.</p>':key==='charge'?rushProperties:'';
   return embeddedCard(card,path,d.id,{heading,fixedLabel:true,editableName:false,beforePreview:properties});
  }).join('');
 }
 html+='<h3>Effects Feedback</h3>'+embeddedCard(d.hit,'hit',d.id,{kinds:['effect'],heading:'Health damage',fixedLabel:true,editableName:false});
 html+='<h3>Health reactions</h3><p class="small">At or below this percentage of starting health. If multiple thresholds are crossed, only the strongest reaction is shown.</p>'+(d.reactions||[]).map((r,i)=>orderedEntry(`<details class="entry" open><summary>${Number((r.threshold.numerator/r.threshold.denominator*100).toFixed(6))}% · ${esc(r.card?.name||'Reaction')}</summary>${field('Remaining health threshold (%)',Number((r.threshold.numerator/r.threshold.denominator*100).toFixed(6)),`reactions.${i}.threshold.percent`,'definition','number')}<div class="row">${field('Threshold numerator',r.threshold.numerator,`reactions.${i}.threshold.numerator`,'definition','number')}${field('Threshold denominator',r.threshold.denominator,`reactions.${i}.threshold.denominator`,'definition','number')}</div>${embeddedCard(r.card,`reactions.${i}.card`,d.id,{kinds:['caption','event'],collapsible:false})}</details>`,'reactions',i,d.reactions.length,{label:'health reaction'})).join('')+add('Add health reaction','reactions','reaction');
 return html+'<h3>Enemy death</h3>'+embeddedCard(d.death?.[0],'death.0',d.id,{kinds:['event','caption'],heading:d.death?.[0]?.name||'Death',fixedLabel:true});
}
export function combatProjectFields(project){return checkbox('Show death beat in chapter graph',project.showDeathBeat!==false,'showDeathBeat','project');}
export function combatNodeFields(project,node){
 const enemy=project.library.find(d=>d.id===node.enemy?.definitionId&&d.kind==='enemy'&&d.visibility!=='local');
 return '<h3>Combat introduction</h3><div class="row introduction-controls">'+checkbox('Show introduction',node.introEnabled===true,'introEnabled','node')+'</div>'+select('Enemy',node.enemy?.definitionId||'',[['','None'],...refs(project,'enemy').slice(1)],'enemy.definitionId','node')+button('Go to definition','go-to-definition',`data-definition="${esc(enemy?.id||'')}" ${enemy?'':'disabled'}`);
}
export function applyCombatArrayCommand(root,data){
 const {parent,key}=pathTarget(root,data.path);if(data.command==='combat-add'&&data.factory==='prepared-reference')parent[key]??=[];const list=parent[key];if(!Array.isArray(list))throw new Error('Combat list is unavailable');
 if(root.kind==='enemy'&&data.path==='intro')throw new Error('Enemy introduction uses the main Enemy card');
 if(root.kind==='enemy'&&data.path==='death')throw new Error('Enemy death has one required card');
 const index=Number(data.index);
 if(data.command==='combat-remove'){
  if(root.kind==='enemy'&&data.path==='preparedActions'){
   if(!Number.isInteger(index)||index<0||index>=list.length)throw new Error('Prepared action is unavailable');
   const id=list[index].id;
   for(const action of root.actions||[])if(Array.isArray(action.preparedActions)){
    action.preparedActions=action.preparedActions.filter(ref=>ref.actionId!==id);
    for(const ref of action.preparedActions)if(ref.fallback?.actionId===id)delete ref.fallback;
   }
  }
  if((data.path==='actions'||data.path==='death')&&list.length<=1)throw new Error('Enemy requires at least one Action and death card');list.splice(index,1);
 }else if(data.command==='combat-move'){const to=index+Number(data.direction);if(to>=0&&to<list.length)[list[index],list[to]]=[list[to],list[index]];}
 else if(data.command==='combat-add'){
  let value;const id=uid('embedded');
  if(data.factory==='prepared-reference')value={actionId:'',weight:1,trigger:'incoming-hit'};
  else if(data.factory==='reference')value={definitionId:''};
  else if(data.factory==='enemy-action'||data.factory==='attack')value=createEnemyAction(id);
  else if(data.factory==='weapon-action')value={...createCombatAction(id),attack:{source:'weapon',minBonus:0,maxBonus:0}};
  else if(data.factory==='reaction')value={id,threshold:{numerator:1,denominator:2},card:{id:uid('caption'),kind:'caption',name:'Reaction',text:'',image:'',effects:[]}};
  else if(data.factory==='effect')value=createEffectCard(id);
  else value={id,kind:data.factory==='event'?'event':'caption',name:data.factory==='event'?'Introduction':'Death',text:'',image:'',effects:[]};
  list.push(value);
 }
}
