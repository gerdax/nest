import { createError } from '../errors.js';
import {restoreSnapshotTags} from './tag-snapshots.js';
import {createDefinition} from '../project/cards.js';
import {definitionGraph,unusedLocalDefinitions} from '../project/dependencies.js';
import {replaceCard,setCardSource,remapInventory} from './commands.js';

const commonKeys=['name','text','image','flipImage','imageScale','imageOffsetX','imageOffsetY'];
const placementKeys=['conditions','effects','unavailable','contextItemId','contextOverrideImage'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
const sourceOf=(project,p)=>project.library.find(d=>d.id===p.definitionId);

/** Editing-session drafts only: never inserted into the saved project. */
export class LocalCardDrafts {
 constructor(){this.context=null;this.drafts=new Map();this.managedIds=new Set();}
 setContext(chapterId,beatId){const key=JSON.stringify([chapterId,beatId]);if(key!==this.context){this.reset();this.context=key;}}
 reset(){this.drafts.clear();this.context=null;}
 refreshChangedDefinitions(project,previousLibrary){
  // Inspect only cached identities, once per document mutation, never on render.
  const ids=new Set();
  for(const draft of this.drafts.values())for(const saved of draft.types.values()){
   ids.add(saved.definition.id);
   for(const dependency of saved.dependencies)ids.add(dependency.id);
  }
  const previous=new Map(previousLibrary.map(d=>[d.id,d]));
  const current=new Map(project.library.map(d=>[d.id,d]));
  for(const id of ids){
   const before=previous.get(id),after=current.get(id);
   if(JSON.stringify(before)!==JSON.stringify(after))this.refreshDefinition(project,after||before);
  }
 }
 refreshDefinition(project,source){
  if(!source)return;
  // Dependency copies outlive their owning placement. Explicit edits must win
  // over those older copies even after removal or unused-definition cleanup.
  for(const draft of this.drafts.values())for(const saved of draft.types.values()){
   if(saved.definition.id!==source.id&&!saved.dependencies.some(d=>d.id===source.id))continue;
   saved.itemTags=[...new Map([...(saved.itemTags||[]),...(project.itemTags||[])].map(tag=>[tag.id,structuredClone(tag)])).values()];
   if(saved.definition.id===source.id){
    saved.definition=structuredClone(source);
    draft.common=pick(source,commonKeys);
   }
   // Live definitions refresh the entire reachable closure. Cached definitions
   // remain available for dependencies already pruned by a type switch.
   const candidates=new Map([...saved.dependencies,...project.library].map(d=>[d.id,d]));
   candidates.set(source.id,source);
   candidates.set(saved.definition.id,saved.definition);
   const library=[...candidates.values()];
   const reachable=definitionGraph({...project,library}).reachableFrom({definition:saved.definition,placement:saved.placement});
   reachable.delete(saved.definition.id);
   saved.dependencies=library.filter(d=>reachable.has(d.id)).map(d=>structuredClone(d));
  }
 }
 removePlacement(project,p){
  this.refreshDefinition(project,sourceOf(project,p));
  this.drafts.delete(p.id);
 }
 capture(project,p){
  const source=sourceOf(project,p);
  if(source?.visibility!=='local')return;
  let draft=this.drafts.get(p.id);
  if(!draft){draft={common:{},types:new Map()};this.drafts.set(p.id,draft);}
  draft.common=pick(source,commonKeys);
  const placement=pick(p,placementKeys);
  const dependencies=definitionGraph(project).reachableFrom({definition:source,placement});
  dependencies.delete(source.id);
  draft.types.set(source.kind,{itemTags:structuredClone(project.itemTags||[]),definition:structuredClone(source),placement,
   dependencies:project.library.filter(d=>dependencies.has(d.id)).map(d=>structuredClone(d))});
 }
 prune(project,id){
  if(project.library.some(d=>d.id===id&&d.visibility==='local'))this.managedIds.add(id);
  const removed=new Set(unusedLocalDefinitions(project).filter(d=>this.managedIds.has(d.id)).map(d=>d.id));
  project.library=project.library.filter(d=>!removed.has(d.id));
  for(const key of this.managedIds)if(!project.library.some(d=>d.id===key))this.managedIds.delete(key);
 }
 restoreDependencies(project,snapshot){
  const pending=[...snapshot.dependencies];
  while(pending.length){
   const dependency=pending.pop();
   if(project.library.some(d=>d.id===dependency.id))continue;
   let latest,owner;
   for(const draft of this.drafts.values())for(const saved of draft.types.values())if(saved.definition.id===dependency.id){latest=saved;owner=draft;}
   const restored=structuredClone(latest?.definition||dependency);
   restoreSnapshotTags(project,restored,latest?.itemTags||snapshot.itemTags);
   if(latest){for(const key of commonKeys)delete restored[key];Object.assign(restored,structuredClone(owner.common));pending.push(...latest.dependencies);}
   project.library.push(restored);
   if(restored.visibility==='local')this.managedIds.add(restored.id);
  }
 }
 switchSource(project,p,value,{allowedKinds}={}){
  const source=sourceOf(project,p);
  if(!source){setCardSource(project,p,value,{allowedKinds});return;}
  const kind=value.startsWith('local:')?value.slice(6):null;
  if(kind&&!(allowedKinds||[source.kind]).includes(kind))throw createError('STUDIO_CHOOSE_A_LOCAL_CARD_TYPE_ALLOWED_IN_THIS_BEAT');
  if(kind&&source.visibility==='local'&&source.kind===kind)return;
  this.capture(project,p);
  if(!kind){
   setCardSource(project,p,value,{allowedKinds});
   if(source.kind!==sourceOf(project,p).kind)for(const key of placementKeys)delete p[key];
   if(source.visibility==='local')this.prune(project,source.id);
   return;
  }
  const draft=this.drafts.get(p.id),snapshot=draft?.types.has(kind)?structuredClone(draft.types.get(kind)):undefined;
  if(snapshot)restoreSnapshotTags(project,snapshot,snapshot.itemTags);
  const template=snapshot?.definition || (source.kind===kind?{...source,...p.overrides}:null);
  const previousPlacement=pick(p,placementKeys);
  let definition=replaceCard(project,p,kind);
  const chapterId=definition.chapterId;
  if(snapshot){
   const existing=project.library.find(d=>d.id===snapshot.definition.id);
   if(!existing||existing.visibility==='local'){
    const generatedId=definition.id;
    if(existing){project.library=project.library.filter(d=>d.id!==generatedId);definition=existing;}
    Object.assign(definition,structuredClone(snapshot.definition),{kind,visibility:'local'});
    p.definitionId=definition.id;
   }
   this.restoreDependencies(project,snapshot);
  }
  if(template){
   const id=definition.id;
   for(const key of Object.keys(definition))delete definition[key];
   Object.assign(definition,structuredClone(template),{id,kind,visibility:'local'});
   if(!snapshot||id!==snapshot.definition.id)delete definition.inventoryKey;
  }
  definition.chapterId=chapterId;
  for(const key of commonKeys)delete definition[key];
  Object.assign(definition,draft?.common||pick(source,commonKeys));
  for(const key of placementKeys)delete p[key];
  if(snapshot)Object.assign(p,structuredClone(snapshot.placement));
  else if(source.kind===kind)Object.assign(p,previousPlacement);
  if(template){const ids=new Map([[template.id,definition.id],...(template.inventoryKey?[[template.inventoryKey,definition.id]]:[])]);remapInventory(definition,ids);remapInventory(p,ids);}
  this.prune(project,source.id);
  this.capture(project,p);
 }
 convert(project,p){
  const source=sourceOf(project,p);
  if(!source)throw createError('STUDIO_CARD_DEFINITION_IS_MISSING');
  const old=source.id;
  replaceCard(project,p,source.kind,{copy:true});
  // Explicit conversion starts a fresh local draft from the chosen Library source.
  this.drafts.delete(p.id);this.capture(project,p);
  this.prune(project,old);
 }
 clear(project,p){
  const source=sourceOf(project,p);
  if(source?.visibility!=='local')throw createError('STUDIO_CLEAR_IS_AVAILABLE_FOR_LOCAL_CARDS_ONLY');
  const defaults=createDefinition(source.kind,source.id);
  // Inventory aliases are identity, rather than an editable field.
  if(source.inventoryKey!==undefined)defaults.inventoryKey=source.inventoryKey;
  if(source.chapterId!==undefined)defaults.chapterId=source.chapterId;
  for(const key of Object.keys(source))delete source[key];
  Object.assign(source,defaults,{visibility:'local'});
  for(const key of Object.keys(p))if(!['id','definitionId'].includes(key))delete p[key];
  this.refreshDefinition(project,source);
  this.drafts.delete(p.id);
  this.prune(project,source.id);
 }
}
