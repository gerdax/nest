import { esc, options } from '../editor/fields.js';

export { esc };
export const field = (label,value,path,scope='definition',type='text') => `<label class="field">${esc(label)}${type==='textarea'?`<textarea data-scope="${esc(scope)}" data-path="${esc(path)}">${esc(value??'')}</textarea>`:`<input data-scope="${esc(scope)}" data-path="${esc(path)}" type="${type}" ${type==='number'?'step="any"':''} value="${esc(value??'')}">`}</label>`;
export const select = (label,value,choices,path,scope='definition') => `<label class="field">${esc(label)}<select data-scope="${esc(scope)}" data-path="${esc(path)}">${options(choices,value)}</select></label>`;
export const checkbox = (label,value,path,scope='definition',disabled=false) => `<label class="field check-field"><input type="checkbox" data-scope="${esc(scope)}" data-path="${esc(path)}" ${value?'checked':''} ${disabled?'disabled':''}>${esc(label)}</label>`;
export const button = (label,cmd,attrs='') => `<button type="button" data-command="${cmd}" ${attrs}>${esc(label)}</button>`;
export const imageField=(label,value,path,scope='definition')=>field(label,value,path,scope)+`<button type="button" data-image-picker data-scope="${esc(scope)}" data-path="${esc(path)}">Choose image file</button>`;
const extras=(scope,path,kind)=>`data-scope="${esc(scope)}" data-path="${esc(path)}" data-rule-kind="${kind}"`;
export function rules(project,list=[],path,scope,kind) {
 const vars=project.variables.map(v=>[v.id,v.name||v.id]);
 const items=project.library.filter(d=>d.kind==='item').map(d=>[d.id,d.name]);
 let html=`<details class="state-panel"><summary>${kind[0].toUpperCase()+kind.slice(1)} · ${list.length}</summary>`;
 html+=list.map((rule,i)=>{
  const p=`${esc(path)}.${i}`;
  let fields='';
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
   const resources=project.variables.filter(variable=>variable.type==='number').map(variable=>[variable.id,variable.name||variable.id]);
   fields=select('Spend',rule.source,[['variable','Resource'],['inventory','Item']],`${p}.source`,scope)+select('Resource or item',rule.key,rule.source==='inventory'?items:resources,`${p}.key`,scope)+(rule.source==='inventory'?'<p class="small">Consumes this item.</p>':field('Amount',rule.amount,`${p}.amount`,scope,'number'));
  } else {
   const inventory=['addItem','removeItem'].includes(rule.op);
   fields=select('Operation',rule.op,[['set','Set variable'],['add','Add to variable'],['addItem','Add item'],['removeItem','Remove item']],`${p}.op`,scope)+select('Target',rule.key,inventory?items:vars,`${p}.key`,scope);
   const flag=project.variables.find(v=>v.id===rule.key)?.type==='flag';
   fields+=inventory?'':flag?select('Value',String(rule.value),[['true','True'],['false','False']],`${p}.value`,scope):field('Value',rule.value,`${p}.value`,scope,'number');
  }
  return `<div class="entry">${fields}${button('Remove','remove-rule',extras(scope,path,kind)+` data-index="${i}"`)}</div>`;
 }).join('');
 return html+button(`Add ${kind==='conditions'?'condition':kind==='costs'?'cost':'effect'}`,'add-rule',extras(scope,path,kind))+'</details>';
}
export function actionFields(project,action,prefix='',scope='definition') {
 const p=key=>prefix+key;
 let html=rules(project,action.conditions,p('conditions'),scope,'conditions')+rules(project,action.costs,p('costs'),scope,'costs')+rules(project,action.effects,p('effects'),scope,'effects');
 html+=select('Resolution',action.resolution||'direct',[['direct','Direct'],['check','Dice check']],p('resolution'),scope);
 if(action.resolution==='check') {
  const check=action.check||{pool:[{sides:20,count:1}],modifier:0,target:10};
  html+='<div class="entry"><h3>Check settings</h3>';
  html+=check.pool.map((die,i)=>select('Dice',String(die.sides),[4,6,8,10,12,20].map(n=>[String(n),`d${n}`]),p(`check.pool.${i}.sides`),scope)+field('Count',die.count,p(`check.pool.${i}.count`),scope,'number')+button('Remove dice','remove-rule',extras(scope,p('check.pool'),'dice')+` data-index="${i}"`)).join('');
  html+=button('Add dice','add-rule',extras(scope,p('check.pool'),'dice'))+field('Modifier',check.modifier,p('check.modifier'),scope,'number')+select('Variable modifier',check.modifierVariable||'',[['','None'],...project.variables.filter(v=>v.type==='number').map(v=>[v.id,v.name||v.id])],p('check.modifierVariable'),scope)+field('Target',check.target,p('check.target'),scope,'number')+'</div>';
  html+=rules(project,action.successEffects,p('successEffects'),scope,'effects')+rules(project,action.failureEffects,p('failureEffects'),scope,'effects');
 }
 return html;
}
