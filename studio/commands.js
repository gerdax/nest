import { eligibleInventoryItems } from './item-options.js';
import { createDefinition, resolvePlacement, isStoryKind, isConsumableKind } from '../project/cards.js';
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
function owningChapterId(project,value,chapterId) {
 if(chapterId)return chapterId;
 for(const chapter of project.chapters||[])for(const node of chapter.nodes||[])if(node===value||placements(node).includes(value))return chapter.id;
 const placement=value?.definitionId?value:placements(value||{}).find(p=>project.library.find(d=>d.id===p.definitionId)?.visibility==='local');
 return project.library.find(d=>d.id===placement?.definitionId)?.chapterId||project.activeChapterId||project.chapters?.[0]?.id;
}
export function makePlacement(project,kind,name,chapterId) {
 const definition=makeDefinition(project,kind,name);definition.visibility='local';definition.chapterId=owningChapterId(project,null,chapterId);
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
/** Keep copied Item variants in one fresh inventory ownership group. */
export function preserveCopiedInventoryAliases(sources,copies,inventoryIds) {
 const groups=new Map();
 for(const source of sources)if(source.kind==='item'&&copies.has(source.id)){
  const key=source.inventoryKey??source.id;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(source);
 }
 for(const [key,group] of groups){
  // An alias may itself be a definition ID. Keep that definition's remap,
  // rather than letting the last variant overwrite its independent identity.
  const anchor=group.find(source=>source.id===key)||group[0],alias=copies.get(anchor.id).id;
  if(!inventoryIds.has(key))inventoryIds.set(key,alias);
  if(group.length>1)for(const source of group)copies.get(source.id).inventoryKey=alias;
 }
}
export function replaceCard(project,placement,kind,{copy=false,chapterId}={}) {
 const source=project.library.find(d=>d.id===placement.definitionId);
 const definition=copy?{...structuredClone(source),...structuredClone(placement.overrides||{}),id:uid(kind),visibility:'local'}:{...createDefinition(kind,uid(kind)),visibility:'local'};
 definition.chapterId=owningChapterId(project,placement,chapterId);
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
 for(const dependency of project.library)if(dependencies.has(dependency.id)){dependency.visibility='shared';delete dependency.chapterId;}
 return definition;
}
export function duplicatePlacement(project,node,placement) {
 const slot=['cards','choices','items'].find(key=>node[key]?.includes(placement));
 if(!slot)throw new Error('This card slot cannot be duplicated.');
 const copy={...structuredClone(placement),id:uid('placement')};
 const copies=cloneLocalDefinitions(project,copy,owningChapterId(project,node));
 const definition=copies.get(placement.definitionId);if(definition)definition.name+=' copy';
 node[slot].splice(node[slot].indexOf(placement)+1,0,copy);
 if(slot==='choices')for(const output of outputsForNode(project,node).filter(exit=>exit===copy.id||exit.startsWith(`${copy.id}:`))){
  const original=placement.id+output.slice(copy.id.length);node.connections[output]=Object.hasOwn(node.connections,original)?node.connections[original]:false;
 }
 return copy;
}
export function duplicateNode(project,source) {
 const node=structuredClone(source);node.id=uid('node');node.name+=' copy';node.x+=40;node.y+=40;
 cloneLocalDefinitions(project,node,owningChapterId(project,source));
 return node;
}
function cloneLocalDefinitions(project,value,chapterId) {
 const reachable=definitionGraph(project).reachableFrom(value),copies=new Map(),inventoryIds=new Map();
 for(const source of project.library)if(reachable.has(source.id)&&source.visibility==='local'){
  const copy={...structuredClone(source),id:uid(source.kind),chapterId};delete copy.inventoryKey;
  copies.set(source.id,copy);if(source.kind==='item')inventoryIds.set(source.id,copy.id);
 }
 preserveCopiedInventoryAliases(project.library,copies,inventoryIds);
 const remap=value=>{
  if(Array.isArray(value))value.forEach(remap);
  else if(value&&typeof value==='object'){if(copies.has(value.definitionId))value.definitionId=copies.get(value.definitionId).id;Object.values(value).forEach(remap);}
 };
 for(const entry of [value,...copies.values()]){remap(entry);remapInventory(entry,inventoryIds);}
 project.library.push(...copies.values());
 return copies;
}
export function createNode(project,type,position={x:100,y:100},chapterId) {
 const defaults=createNodeDefaults(type,{makePlacement:kind=>makePlacement(project,kind,undefined,chapterId),uid});
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
export function customizeItem(project,placement) {
 const definition=project.library.find(d=>d.id===placement.definitionId);
 if(definition?.visibility==='local'){delete placement.overrides;return;}
 if(definition?.kind!=='item')throw new Error('Custom Item rules need an Item definition.');
 const card=resolvePlacement(project,placement);
 placement.overrides={onCollect:structuredClone(card.onCollect??[]),permability:card.permability??0};
 delete placement.effects;
}
export function customizeConsumable(project,placement) {
 const definition=project.library.find(d=>d.id===placement.definitionId);
 if(definition?.visibility==='local'){delete placement.overrides;return;}
 if(!isConsumableKind(definition?.kind))throw new Error('Custom collection rules need a Health or Energy definition.');
 // Resolved collection effects already contain the automatic resource gain.
 // Copy only authored effects so toggling custom rules cannot add it twice.
 const card={...definition,...placement.overrides};
 placement.overrides={value:card.value??1,onCollect:structuredClone([...(card.onCollect??[]),...(placement.effects??[])])};
 delete placement.effects;
}
export function customizeStory(project,placement) {
 const definition=project.library.find(d=>d.id===placement.definitionId);
 if(definition?.visibility==='local'){delete placement.overrides;return;}
 if(!isStoryKind(definition?.kind))throw new Error('Custom progression rules need a Vignette or Caption.');
 const card=resolvePlacement(project,placement);
 placement.overrides={effects:structuredClone(card.effects??[])};
 delete placement.effects;
}
export function newRule(project,kind,chapter) {
 const variables=chapterVariables(project,chapter);
 if(kind==='dice')return {sides:20,count:1};
 let variable=variables[0];
 if(!variable&&kind!=='costs'){variable={id:uid('variable'),name:'New variable',type:'number',initial:0};(chapter?(chapter.variables ||= []):project.variables).push(variable);}
 if(kind==='conditions')return variable?{source:'variable',key:variable.id,op:'eq',value:variable.initial}:{source:'inventory',key:eligibleInventoryItems(project,chapter)[0]?.id||'',op:'has'};
 if(kind==='costs')return {source:'variable',key:variables.find(v=>v.type==='number')?.id||'',amount:1};
 return {op:'set',key:variable?.id||'',value:variable?.initial??0};
}
export function normalizeRule(project,rule,leaf,chapter) {
 const variables=chapterVariables(project,chapter);
 const item=eligibleInventoryItems(project,chapter)[0],variable=variables.find(v=>v.type==='number')||variables[0];
 if(leaf==='source') {if(rule.source==='inventory'&&'amount'in rule)rule.amount=1;rule.key=rule.source==='inventory'?item?.id||'':variable?.id||'';if('op'in rule){rule.op=rule.source==='inventory'?'has':'eq';if(rule.source==='inventory')delete rule.value;else rule.value=variable?.initial??0;}}
 if(leaf==='op'&&['addItem','removeItem'].includes(rule.op)){rule.key=item?.id||'';delete rule.quantity;delete rule.value;}
 if(leaf==='op'&&['set','add'].includes(rule.op)){rule.key=variable?.id||'';rule.value=variable?.type==='flag'?false:0;delete rule.quantity;}
 if(leaf==='key'&&'op'in rule&&rule.source!=='inventory'&&!['addItem','removeItem'].includes(rule.op)){const v=variables.find(v=>v.id===rule.key);rule.value=v?.type==='flag'?false:0;if(v?.type==='flag'&&!['eq','neq','set'].includes(rule.op))rule.op=rule.source==='variable'?'eq':'set';}
 if(leaf==='op'&&['gte','lte'].includes(rule.op)&&rule.source==='inventory')rule.value=1;
}
