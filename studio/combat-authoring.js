import { isStatVariable } from '../project/checks.js';
import {field,select,checkbox,button,imageField,rules,actionFields,esc} from './forms.js';
import {createEnemyAttack,createEffectCard,createCombatAction} from '../project/combat-model.js';
import {uid,pathTarget} from './commands.js';
const refs=(project,kind)=>[['','Choose a Library definition'],...project.library.filter(d=>d.kind===kind&&d.visibility!=='local').map(d=>[d.id,d.name||d.id])];
const attrs=(path,scope='definition')=>`data-scope="${scope}" data-path="${esc(path)}"`;
const add=(label,path,factory,scope='definition')=>button(label,'combat-add',`${attrs(path,scope)} data-factory="${factory}"`);
const controls=(path,i,count,min=0,scope='definition')=>`<div class="row">${button('Move up','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="-1" ${i===0?'disabled':''}`)}${button('Move down','combat-move',`${attrs(path,scope)} data-index="${i}" data-direction="1" ${i===count-1?'disabled':''}`)}${button('Remove','combat-remove',`${attrs(path,scope)} data-index="${i}" ${count<=min?'disabled':''}`)}</div>`;
export function combatReferenceList(project,list,path,label,scope='definition'){
 return `<h3>${esc(label)}</h3>`+(list||[]).map((ref,i)=>`<div class="entry">${select('Combat Action',ref.definitionId,refs(project,'combatAction').filter(([id])=>path!=='combat.defaultActions'||!id||project.library.find(d=>d.id===id)?.attack?.source!=='weapon'),`${path}.${i}.definitionId`,scope)}${controls(path,i,list.length,0,scope)}</div>`).join('')+add('Add Combat Action',path,'reference',scope);
}
function damageFields(damage,prefix){return '<div class="row">'+field('Minimum damage',damage?.min??1,`${prefix}.min`,'definition','number')+field('Maximum damage',damage?.max??1,`${prefix}.max`,'definition','number')+'</div>';}
function embeddedArtwork(card,path){return '<details class="state-panel"><summary>Image scale and position</summary>'+checkbox('Flip artwork horizontally',card.flipImage,`${path}.flipImage`)+field('Image scale (%)',card.imageScale??100,`${path}.imageScale`,'definition','number')+field('Horizontal offset (%)',card.imageOffsetX??0,`${path}.imageOffsetX`,'definition','number')+field('Vertical offset (%)',card.imageOffsetY??0,`${path}.imageOffsetY`,'definition','number')+'</details>';}
function embeddedImage(card,path,definitionId){
 return `<div class="inspector-card-preview" data-card-preview data-preview-definition="${esc(definitionId)}" data-preview-path="${esc(path)}"></div>`+imageField('Artwork path',card.image,`${path}.image`,'definition',{clearable:true})+embeddedArtwork(card,path);
}
function embeddedCard(card,path,definitionId,{kinds=['event','caption'],heading='Card'}={}){
 if(!card)return '<p class="small">Missing required card.</p>';
 return `<details class="entry combat-embedded" open><summary>${esc(heading)} · ${esc(card.name||'Untitled')}</summary>`+field('Name',card.name,`${path}.name`)+ (kinds.length>1?select('Card type',card.kind,kinds.map(k=>[k,k==='event'?'Vignette':k==='effect'?'Effect Card':'Caption']),`${path}.kind`):'')+field('Description',card.text,`${path}.text`,'definition','textarea')+embeddedImage(card,path,definitionId)+'</details>';
}
function checkFields(project,check,prefix){
 const c=check||{pool:[{sides:6,count:3}],modifier:0,target:11};
 let heading='<h4>Dice check</h4>'+select('Check type',c.mode||'custom',[['custom','Custom check'],['stat','Stat check']],`${prefix}.mode`);
 if(c.mode==='stat')return heading+select('Stat',c.modifierVariable||'',[['','Choose stat'],...project.variables.filter(isStatVariable).map(v=>[v.id,v.name||v.id])],`${prefix}.modifierVariable`)+select('Difficulty',String(c.difficulty??1),Array.from({length:10},(_,i)=>[String(i+1),String(i+1)]),`${prefix}.difficulty`);
 return heading+(c.pool||[]).map((die,i)=>'<div class="row">'+select('Dice',String(die.sides),[4,6,8,10,12,20].map(s=>[String(s),`d${s}`]),`${prefix}.pool.${i}.sides`)+field('Count',die.count,`${prefix}.pool.${i}.count`,'definition','number')+button('Remove dice','remove-rule',`${attrs(`${prefix}.pool`)} data-index="${i}"` )+'</div>').join('')+button('Add dice','add-rule',`${attrs(`${prefix}.pool`)} data-rule-kind="dice"`)+field('Modifier',c.modifier,`${prefix}.modifier`,'definition','number')+select('Variable modifier',c.modifierVariable||'',[['','None'],...project.variables.filter(v=>v.type==='number').map(v=>[v.id,v.name||v.id])],`${prefix}.modifierVariable`)+field('Target',c.target,`${prefix}.target`,'definition','number');
}
function combatActionFields(project,action,prefix=''){
 const path=key=>prefix+key;
 return actionFields(project,action,prefix)+select('Attack properties',action.attack?.source||'none',[['self','Own damage'],['weapon','Source Weapon'],['none','No attack']],path('attack.source'))+(action.attack?.source==='self'?damageFields(action.attack.damage,path('attack.damage')):'')+(action.attack?.source!=='none'?field('Minimum damage bonus',action.attack?.minBonus??0,path('attack.minBonus'),'definition','number')+field('Maximum damage bonus',action.attack?.maxBonus??0,path('attack.maxBonus'),'definition','number'):'')+field('Cooldown (following player turns)',action.cooldown??0,path('cooldown'),'definition','number');
}
function weaponActions(project,weapon){
 return '<h3>Combat Actions</h3><p class="small">Owned by this Weapon and available while the player carries it.</p>'+(weapon.combat?.actions||[]).map((action,i)=>{
 const path=`combat.actions.${i}`;
 if(action.kind!=='combatAction')return '<p class="small">Missing Combat Action. Restore its source definition to migrate it.</p>';
 return `<details class="entry combat-embedded" open><summary>${esc(action.name||'Combat Action')}</summary>`+field('Name',action.name,`${path}.name`)+field('Description',action.text,`${path}.text`,'definition','textarea')+embeddedImage(action,path,weapon.id)+combatActionFields(project,action,`${path}.`)+controls('combat.actions',i,weapon.combat.actions.length)+'</details>';
 }).join('')+add('+ Combat Action','combat.actions','weapon-action');
}
export function combatDefinitionFields(project,d){
 if(d.kind==='combatAction')return combatActionFields(project,d);
 if(d.kind==='item')return (d.subtype==='weapon'?`<h3>Weapon damage</h3>${damageFields(d.combat?.damage,'combat.damage')}<p class="small">This milestone resolves damage from the Weapon profile. Additional intrinsic effects and statuses are deferred.</p>${weaponActions(project,d)}`:'');
 if(d.kind==='effect')return '<p class="small">Combat supplies the resolved signed health change. Preview sample: −2. This card applies no collection effects.</p>';
 if(d.kind!=='enemy')return '';
 let html=field('Starting health',d.health,'health','definition','number')+checkbox('Show introduction',d.introEnabled,'introEnabled');
 html+='<h3>Attacks · authored order, repeating</h3>'+(d.attacks||[]).map((attack,i)=>`<details class="entry" open><summary>Attack ${i+1} · ${esc(attack.name)}</summary>${field('Name',attack.name,`attacks.${i}.name`)}${field('Description',attack.text,`attacks.${i}.text`,'definition','textarea')}${embeddedImage(attack,`attacks.${i}`,d.id)}${checkFields(project,attack.check,`attacks.${i}.check`)}${damageFields(attack.damage,`attacks.${i}.damage`)}<p class="small">No Enemy Energy pool or additional effects in this milestone.</p>${controls('attacks',i,d.attacks.length,1)}</details>`).join('')+add('Add attack','attacks','attack');
 html+='<h3>Damage received</h3>'+embeddedCard(d.hit,'hit',d.id,{kinds:['effect'],heading:'Hit Effect Card'});
 html+='<h3>Health reactions</h3><p class="small">At or below this percentage of starting health. If multiple thresholds are crossed, only the strongest reaction is shown.</p>'+(d.reactions||[]).map((r,i)=>`<div class="entry">${field('Remaining health threshold (%)',Number((r.threshold.numerator/r.threshold.denominator*100).toFixed(6)),`reactions.${i}.threshold.percent`,'definition','number')}<details><summary>Exact threshold</summary>${field('Threshold numerator',r.threshold.numerator,`reactions.${i}.threshold.numerator`,'definition','number')}${field('Threshold denominator',r.threshold.denominator,`reactions.${i}.threshold.denominator`,'definition','number')}</details>${embeddedCard(r.card,`reactions.${i}.card`,d.id,{kinds:['caption','effect'],heading:'Reaction card'})}${controls('reactions',i,d.reactions.length)}</div>`).join('')+add('Add health reaction','reactions','reaction');
 return html+'<h3>Enemy death</h3>'+embeddedCard(d.death?.[0],'death.0',d.id,{kinds:['event','caption'],heading:'Enemy death'});
}
export function combatProjectFields(project){return '<details class="state-panel" data-project-combat open><summary>Death beat</summary>'+checkbox('Show death beat in chapter graph',project.showDeathBeat!==false,'showDeathBeat','project')+'</details>';}
export function combatNodeFields(project,node){
 const enemy=project.library.find(d=>d.id===node.enemy?.definitionId&&d.kind==='enemy'&&d.visibility!=='local');
 return select('Enemy',node.enemy?.definitionId||'',refs(project,'enemy'),'enemy.definitionId','node')+button('Go to definition','go-to-definition',`data-definition="${esc(enemy?.id||'')}" ${enemy?'':'disabled'}`)+'<p class="small">Uses the Enemy’s authored health, ordered attacks and presentation. Victory continues through the connected beat.</p>';
}
export function applyCombatArrayCommand(root,data){
 const {parent,key}=pathTarget(root,data.path),list=parent[key];if(!Array.isArray(list))throw new Error('Combat list is unavailable');
 if(root.kind==='enemy'&&data.path==='intro')throw new Error('Enemy introduction uses the main Enemy card');
 if(root.kind==='enemy'&&data.path==='death')throw new Error('Enemy death has one required card');
 const index=Number(data.index);
 if(data.command==='combat-remove'){
  if((data.path==='attacks'||data.path==='death')&&list.length<=1)throw new Error('Enemy requires at least one attack and death card');list.splice(index,1);
 }else if(data.command==='combat-move'){const to=index+Number(data.direction);if(to>=0&&to<list.length)[list[index],list[to]]=[list[to],list[index]];}
 else if(data.command==='combat-add'){
  let value;const id=uid('embedded');
  if(data.factory==='reference')value={definitionId:''};
  else if(data.factory==='attack')value=createEnemyAttack(id);
  else if(data.factory==='weapon-action')value={...createCombatAction(id),attack:{source:'weapon',minBonus:0,maxBonus:0}};
  else if(data.factory==='reaction')value={id,threshold:{numerator:1,denominator:2},card:{id:uid('caption'),kind:'caption',name:'Reaction',text:'',image:'',effects:[]}};
  else if(data.factory==='effect')value=createEffectCard(id);
  else value={id,kind:data.factory==='event'?'event':'caption',name:data.factory==='event'?'Introduction':'Death',text:'',image:'',effects:[]};
  list.push(value);
 }
}
