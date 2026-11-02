import { walk } from '../project/model-data.js';
import { isTagKey, tagIdFromKey, tagKey } from '../project/item-tags.js';

/** Restore only tags referenced by a detached editor snapshot, merging reused names. */
export function restoreSnapshotTags(project, value, tags = []) {
 const referenced=new Set();
 walk(value,entry=>{
  if(entry.tagId)referenced.add(entry.tagId);
  if(isTagKey(entry.contextItemId))referenced.add(tagIdFromKey(entry.contextItemId));
  if(entry.source==='inventory'&&isTagKey(entry.key))referenced.add(tagIdFromKey(entry.key));
 });
 const concreteKeys=new Set((project.library||[]).filter(item=>item.kind==='item').flatMap(item=>[item.id,item.inventoryKey].filter(Boolean)));
 walk(value,entry=>{if(entry.kind==='item'){if(entry.id)concreteKeys.add(entry.id);if(entry.inventoryKey)concreteKeys.add(entry.inventoryKey);}});
 const ids=new Map();
 for(const tag of tags) {
  if(!referenced.has(tag.id))continue;
  const existing=(project.itemTags||[]).find(candidate=>candidate.id===tag.id)
   ||(project.itemTags||[]).find(candidate=>candidate.name.toLowerCase()===tag.name.toLowerCase());
  if(existing)ids.set(tag.id,existing.id);
  else {
   let id=tag.id,index=2;
   while((project.itemTags||[]).some(candidate=>candidate.id===id)||concreteKeys.has(tagKey(id)))id=`${tag.id}-${index++}`;
   (project.itemTags||=[]).push({...structuredClone(tag),id});ids.set(tag.id,id);
  }
 }
 walk(value,entry=>{
  if(ids.has(entry.tagId))entry.tagId=ids.get(entry.tagId);
  if(isTagKey(entry.contextItemId)&&ids.has(tagIdFromKey(entry.contextItemId)))entry.contextItemId=tagKey(ids.get(tagIdFromKey(entry.contextItemId)));
  if(entry.source==='inventory'&&isTagKey(entry.key)&&ids.has(tagIdFromKey(entry.key)))entry.key=tagKey(ids.get(tagIdFromKey(entry.key)));
 });
}
