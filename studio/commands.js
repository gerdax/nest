import { createDefinition, resolvePlacement } from '../project/cards.js';
import { chapterVariables,outputsForNode,connectionForOutput } from '../project/model.js';
import { createNodeDefaults } from '../project/nodeTypes.js';
import { definitionGraph } from '../project/dependencies.js';
export const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0,8)}`;
export function addHealthVariable(project) {
 if(project.variables.some(variable=>variable.id==='health'))return false;
 project.variables.push({id:'health',name:'Health',type:'number',initial:10,min:0,max:10});
 return true;
}
export function makeDefinition(project,kind,name) {
 const definition=createDefinition(kind,uid(kind));if(name)definition.name=name;project.library.push(definition);return definition;
}
export function makePlacement(project,kind,name) {
 const definition=makeDefinition(project,kind,name);definition.visibility='local';
 return {id:uid('placement'),definitionId:definition.id};
}
export function remapInventory(value,ids) {
 if(Array.isArray(value))value.forEach(v=>remapInventory(v,ids));
 else if(value&&typeof value==='object'){
  if(value.key&&(value.source==='inventory'||['addItem','removeItem'].includes(value.op))&&ids.has(value.key))value.key=ids.get(value.key);
  if(ids.has(value.contextItemId))value.contextItemId=ids.get(value.contextItemId);
  Object.values(value).forEach(v=>remapInventory(v,ids));
 }
}
export function replaceCard(project,placement,kind,{copy=false}={}) {
 const source=project.library.find(d=>d.id===placement.definitionId);
 const definition=copy?{...structuredClone(source),...structuredClone(placement.overrides||{}),id:uid(kind),visibility:'local'}:{...createDefinition(kind,uid(kind)),visibility:'local'};
 if(copy){delete definition.inventoryKey;remapInventory(definition,new Map([[source.id,definition.id],...(source.inventoryKey?[[source.inventoryKey,definition.id]]:[])]));}
 project.library.push(definition);placement.definitionId=definition.id;delete placement.overrides;if(definition.kind!=='action'){delete placement.contextItemId;delete placement.contextOverrideImage;}return definition;
}
export function setCardSource(project,placement,definitionId,{allowedKinds}={}) {
 const source=project.library.find(d=>d.id===placement.definitionId);
 const kinds=allowedKinds || (source?[source.kind]:[]);
 if(definitionId?.startsWith('local:')){
  const kind=definitionId.slice(6);
  if(!kinds.includes(kind))throw new Error('Choose a local card type allowed in this beat.');
  if(source?.visibility==='local'&&source.kind===kind)return;
  replaceCard(project,placement,kind,{copy:source?.kind===kind});
  return;
 }
 if(!definitionId){
  if(!source)throw new Error('Choose a card source to repair the missing definition.');
  if(source.visibility!=='local')replaceCard(project,placement,source.kind,{copy:true});
  return;
 }
 const target=project.library.find(d=>d.id===definitionId);
 if(!target||!kinds.includes(target.kind)||target.visibility==='local')throw new Error('Choose a shared library card of the same type.');
 placement.definitionId=definitionId;delete placement.overrides;if(target.kind!=='action'){delete placement.contextItemId;delete placement.contextOverrideImage;}
}
export function promoteCard(project,placement) {
 const definition=project.library.find(d=>d.id===placement.definitionId);
 const globals=new Set(project.variables.map(v=>v.id));
 const inspect=value=>{
  if(!value||typeof value!=='object')return;
  if((value.source==='variable'||['set','add'].includes(value.op))&&!globals.has(value.key)
   ||value.modifierVariable&&!globals.has(value.modifierVariable))throw new Error('Replace Chapter variables with Global variables before adding this card to the Library.');
  Object.values(value).forEach(inspect);
 };
 const dependencies=definitionGraph(project).reachableFrom({definitionId:definition.id});
 for(const dependency of project.library)if(dependencies.has(dependency.id))inspect(dependency);
 definition.visibility='shared';return definition;
}
export function duplicatePlacement(project,node,placement) {
 const slot=['cards','choices','items'].find(key=>node[key]?.includes(placement));
 if(!slot)throw new Error('This card slot cannot be duplicated.');
 const copy={...structuredClone(placement),id:uid('placement')};
 const source=project.library.find(d=>d.id===placement.definitionId);
 if(source?.visibility==='local'){
  const definition={...structuredClone(source),id:uid(source.kind),name:`${source.name} copy`};
  delete definition.inventoryKey;
  const ids=new Map([[source.id,definition.id],...(source.inventoryKey?[[source.inventoryKey,definition.id]]:[])]);
  remapInventory(definition,ids);remapInventory(copy,ids);copy.definitionId=definition.id;project.library.push(definition);
 }
 node[slot].splice(node[slot].indexOf(placement)+1,0,copy);
 if(slot==='choices')for(const output of outputsForNode(project,node).filter(exit=>exit===copy.id||exit.startsWith(`${copy.id}:`))){
  const original=placement.id+output.slice(copy.id.length);node.connections[output]=Object.hasOwn(node.connections,original)?node.connections[original]:false;
 }
 return copy;
}
export function duplicateNode(project,source) {
 const node=structuredClone(source);node.id=uid('node');node.name+=' copy';node.x+=40;node.y+=40;
 const copies=new Map(),ids=new Map();
 for(const p of placements(node)){
  const d=project.library.find(d=>d.id===p.definitionId);
  if(d?.visibility!=='local')continue;
  if(!copies.has(d.id)){const copy={...structuredClone(d),id:uid(d.kind)};delete copy.inventoryKey;copies.set(d.id,copy);ids.set(d.id,copy.id);if(d.inventoryKey)ids.set(d.inventoryKey,copy.id);}
  p.definitionId=copies.get(d.id).id;
 }
 remapInventory(node,ids);for(const copy of copies.values()){remapInventory(copy,ids);project.library.push(copy);}
 return node;
}
export function createNode(project,type,position={x:100,y:100}) {
 const defaults=createNodeDefaults(type,{makePlacement:kind=>makePlacement(project,kind),uid});
 const node={id:uid('node'),name:`New ${type}`,type,...position,connections:{},...defaults};
 if(type==='random')delete node.connections;
 return node;
}
export function placements(node){return [...(node.cards||[]),...(node.choices||[]),...(node.items||[]),...(node.intro?[node.intro]:[])];}
export function findPlacement(node,id){return placements(node).find(p=>p.id===id);}
export function pathTarget(root,path) {
 const keys=path.split('.');const key=keys.pop();let parent=root;
 for(const part of keys){if(parent[part]===undefined)parent[part]={};parent=parent[part];}return {parent,key};
}
export function synchronizeConnections(project) {
 for(const chapter of project.chapters)for(const node of chapter.nodes){
  if(node.type==='random')continue;
  const old=node.connections||{};
  node.connections=Object.fromEntries(outputsForNode(project,node).map(exit=>[exit,connectionForOutput(old,exit)]));
 }
}
export function customizeAction(project,placement) {
 if(project.library.find(d=>d.id===placement.definitionId)?.visibility==='local'){delete placement.overrides;return;}
 const card=resolvePlacement(project,{...placement,contextItemId:undefined});
 placement.overrides=Object.fromEntries(['conditions','costs','effects','resolution','check','successEffects','failureEffects'].map(key=>[key,structuredClone(card[key]??(key==='resolution'?'direct':key==='check'?{pool:[{sides:20,count:1}],modifier:0,target:10}:[]))]));
 delete placement.conditions;delete placement.effects;
}
export function newRule(project,kind,chapter) {
 const variables=chapterVariables(project,chapter);
 if(kind==='dice')return {sides:20,count:1};
 let variable=variables[0];
 if(!variable&&kind!=='costs'){variable={id:uid('variable'),name:'New variable',type:'number',initial:0};(chapter?(chapter.variables ||= []):project.variables).push(variable);}
 if(kind==='conditions')return variable?{source:'variable',key:variable.id,op:'eq',value:variable.initial}:{source:'inventory',key:project.library.find(d=>d.kind==='item')?.id||'',op:'has'};
 if(kind==='costs')return {source:'variable',key:variables.find(v=>v.type==='number')?.id||'',amount:1};
 return {op:'set',key:variable?.id||'',value:variable?.initial??0};
}
export function normalizeRule(project,rule,leaf,chapter) {
 const variables=chapterVariables(project,chapter);
 const item=project.library.find(d=>d.kind==='item'),variable=variables.find(v=>v.type==='number')||variables[0];
 if(leaf==='source') {if(rule.source==='inventory'&&'amount'in rule)rule.amount=1;rule.key=rule.source==='inventory'?item?.id||'':variable?.id||'';if('op'in rule){rule.op=rule.source==='inventory'?'has':'eq';if(rule.source==='inventory')delete rule.value;else rule.value=variable?.initial??0;}}
 if(leaf==='op'&&['addItem','removeItem'].includes(rule.op)){rule.key=item?.id||'';delete rule.quantity;delete rule.value;}
 if(leaf==='op'&&['set','add'].includes(rule.op)){rule.key=variable?.id||'';rule.value=variable?.type==='flag'?false:0;delete rule.quantity;}
 if(leaf==='key'&&'op'in rule&&rule.source!=='inventory'&&!['addItem','removeItem'].includes(rule.op)){const v=variables.find(v=>v.id===rule.key);rule.value=v?.type==='flag'?false:0;if(v?.type==='flag'&&!['eq','neq','set'].includes(rule.op))rule.op=rule.source==='variable'?'eq':'set';}
 if(leaf==='op'&&['gte','lte'].includes(rule.op)&&rule.source==='inventory')rule.value=1;
}
