import {isDodgeFeedback} from './common-library.js';
import {attackDamageRange} from '../project/combat-rules.js';
import {field,select,checkbox,button,imageField,artworkEditor,rules,actionResolutionFields,checkSettingsFields,esc} from './forms.js';
import {createEnemyAction,createEffectCard,createCombatAction} from '../project/combat-model.js';
import {uid,pathTarget} from './commands.js';
const refs=(project,kind)=>[['','Choose a Library definition'],...project.library.filter(d=>d.kind===kind&&d.visibility!=='local').map(d=>[d.id,d.name||d.id])];
const attrs=(path,scope='definition')=>`data-scope="${scope}" data-path="${esc(path)}"`;
const add=(label,path,factory,scope='definition')=>button(label,'combat-add',`${attrs(path,scope)} data-factory="${factory}"`);
const controls=(path,i,count,min=0,scope='definition',className='')=>`<div class="row${className?' '+esc(className):''}">${button('Move up','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="-1" ${i===0?'disabled':''}`)}${button('Move down','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="1" ${i===count-1?'disabled':''}`)}${button('Remove','combat-remove',`${attrs(path,scope)} data-index="${i}" ${count<=min?'disabled':''}`)}</div>`;
export function combatReferenceList(project,list,path,label,scope='definition'){
 return `<h3>${esc(label)}</h3>`+(list||[]).map((ref,i)=>`<div class="entry">${select('Combat Action',ref.definitionId,refs(project,'combatAction').filter(([id])=>path!=='combat.defaultActions'||!id||!(project.library.find(d=>d.id===id)?.type==='attack'&&project.library.find(d=>d.id===id)?.attack?.source==='weapon')),`${path}.${i}.definitionId`,scope)}${controls(path,i,list.length,0,scope)}</div>`).join('')+add('Add Combat Action',path,'reference',scope);
}
function damageFields(damage,prefix){return '<div class="row">'+field('Minimum damage',damage?.min??1,`${prefix}.min`,'definition','number')+field('Maximum damage',damage?.max??1,`${prefix}.max`,'definition','number')+'</div>';}
function embeddedImage(card,path,definitionId){
 return `<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definitionId)}" data-preview-path="${esc(path)}"></div>`+(card.kind==='caption'?'':imageField('Artwork path',card.image,`${path}.image`,'definition',{clearable:true})+artworkEditor(card,'definition',path));
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
function combatActionFields(project,action,prefix='',{enemy=false,showType=true,weapon,opposedPreparation=false}={}){
 const path=key=>prefix+key,type=action.type||'attack';
 let html=showType?combatActionTypeField(action,prefix,'definition',{enemy}):'';
 if(type==='attack'){
  const sources=enemy?[['self','Own damage'],['none','No attack']]:[['self','Own damage'],['weapon','Source Weapon'],['none','No attack']];
  html+='<h4>Action properties</h4>'+select('Attack properties',action.attack?.source||'none',sources,path('attack.source'))+(action.attack?.source==='self'?damageFields(action.attack.damage,path('attack.damage')):'')+(action.attack?.source==='weapon'?weaponDamageBonusFields(action,weapon,prefix):'');
 }else {
  html+='<h4>Action properties</h4>';
  if(type==='defend')html+=field('Damage reduction',action.damageReduction??1,path('damageReduction'),'definition','number')+'<p class="small">Direct Action. Reduces damage from the next opposing attack, then expires even if it misses. Protection does not stack. Spends the turn.</p>';
  else if(type==='prepare'&&opposedPreparation)html+='<p class="small">Uses the prepared actions below. Spends the turn.</p>';
  else if(type==='prepare')html+=field('Preparation bonus',action.preparationBonus??2,path('preparationBonus'),'definition','number')+(enemy?field('Damage reduction',action.damageReduction??1,path('damageReduction'),'definition','number')+'<p class="small">Secretly prepares either a block against your next Attack or bonus damage on its next successful Attack. Equal chance; replaces previous preparation. Spends the turn.</p>':'<p class="small">Applies only to your next action. An Attack gains this damage bonus, or breaks defence and deals base damage only. Any other action or a missed Attack consumes preparation. A successful new Prepare replaces it; a failed Prepare clears it. Direct resolution needs no roll. Resets each encounter. Spends the turn.</p>');
  else html+='<p class="small">Direct Action. Passes the turn.</p>';
 }
 if(!enemy)html+=field('Cooldown (following player turns)',action.cooldown??0,path('cooldown'),'definition','number')
  +rules(project,action.conditions,path('conditions'),'definition','conditions',{label:'Requirements',help:'All requirements must pass before this action can be selected. Health and Energy equality requirements act as minimums. Requirements do not spend resources.'})
  +rules(project,action.costs,path('costs'),'definition','costs');
 if(!enemy)html+=rules(project,action.effects,path('effects'),'definition','effects',{label:'Progression effects',help:'Apply when the action completes. For a dice check, these apply on either outcome.'});
 if(type==='attack'||type==='prepare'&&!enemy)html+=actionResolutionFields(project,action,prefix,'definition',undefined,{showEffects:!enemy});
 return html;
}

function weaponActions(project,weapon){
 return '<h3>Combat Actions</h3><p class="small">Owned by this Weapon and available while the player carries it.</p>'+(weapon.combat?.actions||[]).map((action,i)=>{
 const path=`combat.actions.${i}`;
 if(action.kind!=='combatAction')return '<p class="small">Missing Combat Action. Restore its source definition to migrate it.</p>';
 return `<details class="entry combat-embedded" open><summary>${esc(action.name||'Combat Action')}</summary>`+field('Name',action.name,`${path}.name`)+combatActionTypeField(action,`${path}.`)+field('Description',action.text,`${path}.text`,'definition','textarea')+combatActionFields(project,action,`${path}.`,{showType:false,weapon})+embeddedImage(action,path,weapon.id)+defendRevealFields(project,action,`${path}.`)+controls('combat.actions',i,weapon.combat.actions.length)+'</details>';
 }).join('')+add('+ Combat Action','combat.actions','weapon-action');
}
export function combatDefinitionFields(project,d){
 if(d.kind==='combatAction')return combatActionFields(project,d,'',{showType:false});
 if(d.kind==='item')return (d.subtype==='weapon'?`<h3>Weapon damage</h3>${damageFields(d.combat?.damage,'combat.damage')}<p class="small">This milestone resolves damage from the Weapon profile. Additional intrinsic effects and statuses are deferred.</p>${weaponActions(project,d)}`:'');
 if(d.kind==='effect'&&isDodgeFeedback(project,d))return '';
 if(d.kind==='effect')return '<p class="small">Combat supplies the resolved signed health change. Preview sample: −2. This card applies no collection effects.</p>';
 if(d.kind!=='enemy')return '';
 let html='';
 html+='<h3>Combat Actions</h3><p class="small">'+(d.mechanics==='opposed-preparation'?'One action is declared at random each enemy turn.':'Performed in order, then repeated.')+'</p>'+(d.actions||[]).map((action,i)=>{
 const path=`actions.${i}`;
 return `<details class="entry" open><summary>${i+1} · ${esc(action.name)}</summary>`+field('Name',action.name,`${path}.name`)+combatActionTypeField(action,`${path}.`,'definition',{enemy:true})+field('Description',action.text,`${path}.text`,'definition','textarea')+combatActionFields(project,action,`${path}.`,{enemy:true,showType:false,opposedPreparation:d.mechanics==='opposed-preparation'})+embeddedImage(action,path,d.id)+controls('actions',i,d.actions.length,1,'definition','enemy-action-controls')+'</details>';
 }).join('')+add('+ Combat Action','actions','enemy-action');

 if(d.mechanics==='opposed-preparation'){
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
 html+='<h3>Health reactions</h3><p class="small">At or below this percentage of starting health. If multiple thresholds are crossed, only the strongest reaction is shown.</p>'+(d.reactions||[]).map((r,i)=>`<details class="entry" open><summary>${Number((r.threshold.numerator/r.threshold.denominator*100).toFixed(6))}% · ${esc(r.card?.name||'Reaction')}</summary>${field('Remaining health threshold (%)',Number((r.threshold.numerator/r.threshold.denominator*100).toFixed(6)),`reactions.${i}.threshold.percent`,'definition','number')}<div class="row">${field('Threshold numerator',r.threshold.numerator,`reactions.${i}.threshold.numerator`,'definition','number')}${field('Threshold denominator',r.threshold.denominator,`reactions.${i}.threshold.denominator`,'definition','number')}</div>${embeddedCard(r.card,`reactions.${i}.card`,d.id,{kinds:['caption','event'],collapsible:false})}${controls('reactions',i,d.reactions.length)}</details>`).join('')+add('Add health reaction','reactions','reaction');
 return html+'<h3>Enemy death</h3>'+embeddedCard(d.death?.[0],'death.0',d.id,{kinds:['event','caption'],heading:d.death?.[0]?.name||'Death',fixedLabel:true});
}
export function combatProjectFields(project){return checkbox('Show death beat in chapter graph',project.showDeathBeat!==false,'showDeathBeat','project');}
export function combatNodeFields(project,node){
 const enemy=project.library.find(d=>d.id===node.enemy?.definitionId&&d.kind==='enemy'&&d.visibility!=='local');
 return select('Enemy',node.enemy?.definitionId||'',refs(project,'enemy'),'enemy.definitionId','node')+button('Go to definition','go-to-definition',`data-definition="${esc(enemy?.id||'')}" ${enemy?'':'disabled'}`)+checkbox('Show introduction',node.introEnabled===true,'introEnabled','node');
}
export function applyCombatArrayCommand(root,data){
 const {parent,key}=pathTarget(root,data.path),list=parent[key];if(!Array.isArray(list))throw new Error('Combat list is unavailable');
 if(root.kind==='enemy'&&data.path==='intro')throw new Error('Enemy introduction uses the main Enemy card');
 if(root.kind==='enemy'&&data.path==='death')throw new Error('Enemy death has one required card');
 const index=Number(data.index);
 if(data.command==='combat-remove'){
  if((data.path==='actions'||data.path==='death')&&list.length<=1)throw new Error('Enemy requires at least one Action and death card');list.splice(index,1);
 }else if(data.command==='combat-move'){const to=index+Number(data.direction);if(to>=0&&to<list.length)[list[index],list[to]]=[list[to],list[index]];}
 else if(data.command==='combat-add'){
  let value;const id=uid('embedded');
  if(data.factory==='reference')value={definitionId:''};
  else if(data.factory==='enemy-action'||data.factory==='attack')value=createEnemyAction(id);
  else if(data.factory==='weapon-action')value={...createCombatAction(id),attack:{source:'weapon',minBonus:0,maxBonus:0}};
  else if(data.factory==='reaction')value={id,threshold:{numerator:1,denominator:2},card:{id:uid('caption'),kind:'caption',name:'Reaction',text:'',image:'',effects:[]}};
  else if(data.factory==='effect')value=createEffectCard(id);
  else value={id,kind:data.factory==='event'?'event':'caption',name:data.factory==='event'?'Introduction':'Death',text:'',image:'',effects:[]};
  list.push(value);
 }
}
