import { isStatVariable, editorCheckSummary } from '../project/checks.js';
import { eligibleInventoryItems, inventoryItemOptions } from './item-options.js';
import { itemReferenceLinks } from './item-reference.js';
import { esc, options } from '../editor/fields.js';

export { esc };
export const variableLabel = variable => `${variable.variableScope === 'chapter' ? 'Chapter' : 'Global'}: ${variable.name || (variable.id === 'energy' ? 'Energy' : variable.id)}`;
export const field = (label,value,path,scope='definition',type='text') => `<label class="field">${esc(label)}${type==='textarea'?`<textarea data-scope="${esc(scope)}" data-path="${esc(path)}">${esc(value??'')}</textarea>`:`<input data-scope="${esc(scope)}" data-path="${esc(path)}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value??'')}">`}</label>`;
export const select = (label,value,choices,path,scope='definition',{disabled=false,help=''}={}) => `<label class="field">${esc(label)}<select data-scope="${esc(scope)}" data-path="${esc(path)}"${disabled?' disabled':''}>${options(choices,value)}</select>${help?`<span class="small">${esc(help)}</span>`:''}</label>`;
export const checkbox = (label,value,path,scope='definition',disabled=false) => `<label class="field check-field"><input type="checkbox" data-scope="${esc(scope)}" data-path="${esc(path)}" ${value?'checked':''} ${disabled?'disabled':''}>${esc(label)}</label>`;
export const button = (label,cmd,attrs='') => `<button type="button" data-command="${cmd}" ${attrs}>${esc(label)}</button>`;
export function artworkEditor(card,scope='definition',prefix='') {
 const path=key=>prefix?`${prefix}.${key}`:key;
 const slider=(label,key,value,min,max)=>`<label class="field artwork-slider">${label}<output>${value}%</output><input type="range" min="${min}" max="${max}" step="1" value="${value}" data-scope="${esc(scope)}" data-path="${esc(path(key))}" data-artwork-slider></label>`;
 const target=`data-scope="${esc(scope)}"${prefix?` data-artwork-path="${esc(prefix)}"`:''}`;
 return '<details class="state-panel artwork-positioning" open><summary>Image scale and position</summary>'+checkbox('Flip artwork horizontally',card.flipImage,path('flipImage'),scope)+slider('Scale','imageScale',card.imageScale??100,10,400)+slider('Horizontal offset','imageOffsetX',card.imageOffsetX??0,-100,100)+slider('Vertical offset','imageOffsetY',card.imageOffsetY??0,-100,100)+'<div class="artwork-settings-actions">'+button('Copy','copy-artwork',target)+button('Paste','paste-artwork',target)+button('Reset','reset-artwork',target)+'</div></details>';
}
export const imageField=(label,value,path,scope='definition',{clearable=false}={})=>field(label,value,path,scope)+`${clearable?'<div class="image-field-actions">':''}<button type="button" data-image-picker data-scope="${esc(scope)}" data-path="${esc(path)}">Choose image file</button>${clearable?button('Reload','reload-image',`data-scope="${esc(scope)}" data-path="${esc(path)}" aria-label="Reload card image" title="Reload artwork from disk" ${value?'':'disabled'}`)+button('Clear','clear-image',`data-scope="${esc(scope)}" data-path="${esc(path)}" aria-label="Clear card image" ${value?'':'disabled'}`):''}${clearable?'</div>':''}`;
const extras=(scope,path,kind)=>`data-scope="${esc(scope)}" data-path="${esc(path)}" data-rule-kind="${kind}"`;
export function rules(project,list=[],path,scope,kind,{label,help,chapter,footer='',countSuffix=''}={}) {
 const vars=project.variables.map(v=>[v.id,variableLabel(v)]);
 let html=`<details class="state-panel"><summary>${esc(label || kind[0].toUpperCase()+kind.slice(1))} · ${list.length}${esc(countSuffix)}</summary>`;
 if(!help&&kind==='costs')help='Spend Energy or Health when the action is committed. Dice checks pay before rolling, regardless of the outcome.';
 if(help)html+=`<p class="small">${esc(help)}</p>`;
 html+=list.map((rule,i)=>{
  const p=`${esc(path)}.${i}`;
  let fields='';
  const itemEffect=kind==='effects'&&['addItem','removeItem'].includes(rule.op);
  const items=inventoryItemOptions(project,chapter,rule.key,{includeTags:kind==='conditions'});
  if(itemEffect)for(const choice of items)if(choice[0]&&!eligibleInventoryItems(project,chapter).some(item=>item.id===choice[0]))choice[2]=true;
  const inventoryRule=itemEffect||(['conditions','costs'].includes(kind)&&rule.source==='inventory');
  const referenceLinks=inventoryRule?itemReferenceLinks(project,rule.key,chapter):'';
  if(kind==='conditions') {
   const inventory=rule.source==='inventory';
   const candidates=inventory?items:vars;
   if(rule.key&&!candidates.some(([id])=>id===rule.key))candidates.push([rule.key,rule.key]);
   fields=select('Source',rule.source,[['variable','Variable'],['inventory','Inventory']],`${p}.source`,scope)+select('Requirement',rule.key,candidates,`${p}.key`,scope)+select('Comparison',rule.op,inventory?[['has','Owned'],['missing','Missing']]:[['eq','Equals'],['neq','Not equal'],['gte','At least'],['lte','At most']],`${p}.op`,scope);
   if(!['has','missing'].includes(rule.op)) {
    const flag=project.variables.find(v=>v.id===rule.key)?.type==='flag';
    fields+=flag?select('Value',String(rule.value),[['true','True'],['false','False']],`${p}.value`,scope):field('Value',rule.value,`${p}.value`,scope,'number');
   }
  } else if(kind==='costs') {
   const resources=[['energy','Energy'],['health','Health']].filter(([id])=>project.variables.some(variable=>variable.id===id&&variable.type==='number'));
   let current=rule.key;
   if(rule.source!=='variable'||!resources.some(([id])=>id===rule.key)) {
    const target=rule.source==='inventory'?project.library.find(item=>item.id===rule.key):project.variables.find(variable=>variable.id===rule.key);
    // A distinct form value lets an inventory item named "energy" be retargeted explicitly.
    current='existing-cost';
    resources.unshift([current,`Existing cost: ${target?.name||rule.key||'No resource'}${rule.source==='inventory'?' (item)':''}`,true]);
   }
   fields=select('Resource',current,resources,`${p}.key`,scope)+field('Amount',rule.amount,`${p}.amount`,scope,'number');
  } else {
   const inventory=['addItem','removeItem'].includes(rule.op);
   fields=select('Operation',rule.op,[['addItem','Add item'],['add','Add to variable'],['removeItem','Remove item'],['set','Set variable']],`${p}.op`,scope)+select('Target',rule.key,inventory?items:vars,`${p}.key`,scope);
   const target=inventory&&eligibleInventoryItems(project,chapter).find(item=>item.id===rule.key);
   if(inventory&&rule.key&&!target)fields+=`<p class="small">Choose ${chapter?'an item from this chapter or the shared Library':'a shared Library item'}. This saved target is unavailable for item effects.</p>`;
   const flag=project.variables.find(v=>v.id===rule.key)?.type==='flag';
   fields+=inventory?'':flag?select('Value',String(rule.value),[['true','True'],['false','False']],`${p}.value`,scope):field('Value',rule.value,`${p}.value`,scope,'number');
  }
  const controls=kind==='costs'?checkbox('Hide badge',rule.hideBadge===true,`${p}.hideBadge`,scope):itemEffect?'':referenceLinks;
  return `<div class="entry">${fields}${itemEffect?`<div class="item-effect-reference">${referenceLinks}</div>`:''}${kind==='costs'&&referenceLinks?`<div class="item-effect-reference">${referenceLinks}</div>`:''}<div class="rule-entry-actions${kind==='costs'?' cost-entry-actions':''}">${controls}${button('Remove','remove-rule',extras(scope,path,kind)+` data-index="${i}"`)}</div></div>`;
 }).join('');
 return html+button(`Add ${kind==='conditions'?'condition':kind==='costs'?'cost':'effect'}`,'add-rule',extras(scope,path,kind))+footer+'</details>';
}
export function actionFields(project,action,prefix='',scope='definition',chapter) {
 const p=key=>prefix+key;
 let html=rules(project,action.conditions,p('conditions'),scope,'conditions',{chapter,label:'Requirements',help:'All requirements must pass before this action can be selected. Requirements do not spend resources.'})+rules(project,action.costs,p('costs'),scope,'costs',{chapter})+(action.kind==='combatAction'?'':rules(project,action.effects,p('effects'),scope,'effects',{chapter,label:'Progression effects',help:'Apply when the action completes. For a dice check, these apply on either outcome.'}));
 return html+actionResolutionFields(project,action,prefix,scope,chapter);
}
export function actionResolutionFields(project,action,prefix='',scope='definition',chapter) {
 const p=key=>prefix+key;
 let html=select('Resolution',action.resolution||'direct',[['direct','Direct'],['check','Dice check']],p('resolution'),scope);
 if(action.resolution==='check') {
  const check=action.check||{pool:[{sides:20,count:1}],modifier:0,target:10};
  html+='<div class="entry check-settings"><h3>Check settings</h3>';
  html+=select('Check type',check.mode||'custom',[['stat','Stat check'],['custom','Custom check']],p('check.mode'),scope);
  if(check.mode==='stat') {
   const stats=project.variables.filter(isStatVariable).map(v=>[v.id,variableLabel(v)]);
   if(check.modifierVariable&&!stats.some(([id])=>id===check.modifierVariable))stats.push([check.modifierVariable,check.modifierVariable]);
   html+=select('Stat',check.modifierVariable||'',[['','Choose stat'],...stats],p('check.modifierVariable'),scope)+select('Difficulty',String(check.difficulty??1),Array.from({length:10},(_,i)=>[String(i+1),String(i+1)]),p('check.difficulty'),scope);
   try { html+=`<p class="small check-diagnostic">${esc(editorCheckSummary(check,project.variables))}</p>`; }
   catch { html+='<p class="small check-diagnostic">Choose a valid stat and difficulty. Stats use integer values from 1 to 10.</p>'; }
  } else {
  html+=(check.pool||[]).map((die,i)=>'<div class="row dice-row">'+select('Dice',String(die.sides),[4,6,8,10,12,20].map(n=>[String(n),`d${n}`]),p(`check.pool.${i}.sides`),scope)+field('Count',die.count,p(`check.pool.${i}.count`),scope,'number')+button('×','remove-rule',extras(scope,p('check.pool'),'dice')+` data-index="${i}" class="dice-remove" aria-label="Remove dice" title="Remove dice"`)+'</div>').join('');
  html+=button('Add dice','add-rule',extras(scope,p('check.pool'),'dice')+' class="dice-add"')+field('Modifier',check.modifier,p('check.modifier'),scope,'number')+select('Variable modifier',check.modifierVariable||'',[['','None'],...project.variables.filter(v=>v.type==='number').map(v=>[v.id,variableLabel(v)])],p('check.modifierVariable'),scope)+field('Target',check.target,p('check.target'),scope,'number');
  }
  html+='</div>';
  html+=rules(project,action.successEffects,p('successEffects'),scope,'effects',{chapter,label:'On success effects'})+rules(project,action.failureEffects,p('failureEffects'),scope,'effects',{chapter,label:'On failure effects'});
 }
 return html;
}
