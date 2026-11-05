import { definitionGraph } from '../project/dependencies.js';

/** Only card placements belong to a node; referenced rewards live elsewhere. */
export function placedLocalDefinitions(project, value) {
 const ids=new Set();
 const visit=entry=>{
  if(!entry||typeof entry!=='object')return;
  if(typeof entry.definitionId==='string')ids.add(entry.definitionId);
  for(const [key,child] of Object.entries(entry))if(key!=='use') {
   if(Array.isArray(child))child.forEach(visit);
   else if(child&&typeof child==='object')visit(child);
  }
 };
 visit(value);
 return project.library.filter(definition=>definition.visibility==='local'&&ids.has(definition.id));
}

/** Remove semantic item references, without matching prose or variable rules. */
function removeReferences(value, itemKeys, contextIds) {
 if(!value||typeof value!=='object')return;
 if(contextIds.has(value.contextItemId)) {
  delete value.contextItemId;
  delete value.contextOverrideImage;
 }
 for(const [key,child] of Object.entries(value)) {
  if(Array.isArray(child)) {
   value[key]=child.filter(entry=>!(entry&&typeof entry==='object'&&itemKeys.has(entry.key)
    &&(entry.source==='inventory'||['addItem','removeItem'].includes(entry.op))));
   value[key].forEach(entry=>removeReferences(entry,itemKeys,contextIds));
  }else if(child&&typeof child==='object')removeReferences(child,itemKeys,contextIds);
 }
}

/** Delete sources whose last placement was removed, plus their incoming rules.
 * Called inside the same document transaction as node/card removal for Undo.
 */
export function removeUnplacedLocalDefinitions(project, candidates, localDrafts) {
 const stillPlaced=new Set(definitionGraph(project).references.filter(ref=>ref.kind==='placement').map(ref=>ref.definitionId));
 const removed=candidates.filter(definition=>definition.visibility==='local'&&!stillPlaced.has(definition.id));
 if(!removed.length)return;
 const ids=new Set(removed.map(definition=>definition.id));
 project.library=project.library.filter(definition=>!ids.has(definition.id));
 const survivingItems=project.library.filter(definition=>definition.kind==='item');
 const survivingKeys=new Set(survivingItems.flatMap(item=>[item.id,item.inventoryKey].filter(Boolean)));
 const itemKeys=new Set(removed.filter(definition=>definition.kind==='item')
  .flatMap(item=>[item.id,item.inventoryKey].filter(key=>key&&!survivingKeys.has(key))));
 const contextIds=new Set(removed.filter(definition=>definition.kind==='item').map(item=>item.id));
 removeReferences(project,itemKeys,contextIds);
 // Inactive type snapshots must not resurrect a deleted source or its rules.
 for(const [placementId,draft] of localDrafts?.drafts||[]) {
  for(const [kind,saved] of draft.types) {
   if(ids.has(saved.definition.id)){draft.types.delete(kind);continue;}
   saved.dependencies=saved.dependencies.filter(definition=>!ids.has(definition.id));
   removeReferences(saved,itemKeys,contextIds);
  }
  if(!draft.types.size)localDrafts.drafts.delete(placementId);
 }
 for(const id of ids)localDrafts?.managedIds.delete(id);
}
