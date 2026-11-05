import { walk } from '../project/model-data.js';
import { definitionGraph } from '../project/dependencies.js';

const systemIds=new Set(['health','energy','agility','intelligence','composure']);
export function variableIdFromName(name) {
 let id=String(name??'').toLowerCase().replace(/ł/g,'l').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9_\s]/g,'').replace(/\s+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
 if(!id)id='variable';
 if(/^\d/.test(id))id=`variable_${id}`;
 return id;
}
export function allocateVariableId(project,name,except) {
 const used=new Set([...systemIds,...(project.variables||[]).filter(v=>v!==except).map(v=>v.id),
  ...(project.chapters||[]).flatMap(c=>(c.variables||[]).filter(v=>v!==except).map(v=>v.id))]);
 const base=variableIdFromName(name);let id=base,n=2;
 while(used.has(id))id=`${base}_${n++}`;
 return id;
}
export function remapVariableReferences(value,oldId,newId) {
 walk(value,entry=>{
  if(entry.key===oldId&&(entry.source==='variable'||['set','add'].includes(entry.op)))entry.key=newId;
  if(entry.modifierVariable===oldId)entry.modifierVariable=newId;
 });
}
export function renameVariable(project,variable,name,chapter) {
 const oldId=variable.id;
 variable.name=name;
 if(!chapter&&systemIds.has(oldId))return;
 const id=allocateVariableId(project,name,variable);
 if(id===oldId)return;
 const chapters=chapter?[chapter]:project.chapters;
 const reachable=chapter?definitionGraph(project).reachableFrom(chapter):null;
 for(const definition of project.library)if(!chapter||definition.visibility==='local'&&(definition.chapterId===chapter.id||!definition.chapterId&&reachable.has(definition.id)))remapVariableReferences(definition,oldId,id);
 for(const target of chapters){
  remapVariableReferences(target.nodes,oldId,id);
  if(Object.hasOwn(target.initialValues||{},oldId)){
   target.initialValues=Object.fromEntries(Object.entries(target.initialValues).map(([key,value])=>[key===oldId?id:key,value]));
  }
 }
 variable.id=id;
 return {oldId,newId:id,chapterId:chapter?.id,name};
}
/** Refresh detached snapshots, so pasting after a rename cannot restore stale rules. */
export function remapVariableClipboard(payload,rename) {
 if(!payload||rename.chapterId&&payload.chapterId!==rename.chapterId)return;
 remapVariableReferences(payload,rename.oldId,rename.newId);
 for(const variable of payload.variables||[])if(variable.id===rename.oldId){variable.id=rename.newId;variable.name=rename.name;}
}

/** History restores detached documents; detect the same scoped name edit in either direction. */
export function variableRenamesBetween(before,after) {
 const result=[];
 const compare=(a,b,chapterId)=>{
  if(a.length!==b.length)return;
  for(let i=0;i<a.length;i++){
   const {id:oldId,name:oldName,...oldRules}=a[i],{id:newId,name,...newRules}=b[i];
   if(oldId!==newId&&oldName!==name&&JSON.stringify(oldRules)===JSON.stringify(newRules))result.push({oldId,newId,name,chapterId});
  }
 };
 compare(before.variables||[],after.variables||[]);
 for(const chapter of before.chapters||[]){
  const next=after.chapters?.find(c=>c.id===chapter.id);
  if(next)compare(chapter.variables||[],next.variables||[],chapter.id);
 }
 return result;
}
