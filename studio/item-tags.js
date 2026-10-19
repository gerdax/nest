import { esc } from '../editor/fields.js';
import { walk } from '../project/model-data.js';
import { tagKey, validItemTagName, itemTagNameAvailable } from '../project/item-tags.js';

export function tagIsUsed(project, id) {
 let used=false;
 walk([project.library,project.chapters],value=>{
  if(value.tagId===id||value.contextItemId===tagKey(id)||value.source==='inventory'&&value.key===tagKey(id))used=true;
 });
 return used;
}
export function itemTagsEditor(project) {
 const tags=project.itemTags||[];
 return `<summary>Item tags · ${tags.length}</summary><p class="small">One word per tag. Each Item can have one tag. Use tags in Inventory triggers and Requirements.</p>${tags.map(tag=>`<div class="entry"><label class="field">Tag name<input data-tag-name="${esc(tag.id)}" value="${esc(tag.name)}" aria-label="Tag name" pattern="[^\\s]+" required></label><button type="button" data-remove-tag="${esc(tag.id)}" ${tagIsUsed(project,tag.id)?'disabled title="Remove assignments and rule references before deleting this tag."':''}>Remove tag</button></div>`).join('')}<form data-add-tag-form><label class="field">New tag<input name="tagName" aria-label="New tag" placeholder="Lockpick" pattern="[^\\s]+" required></label><button type="submit">Add tag</button></form>`;
}
export function applyTagCommand(project,{operation,id,name}) {
 if(operation==='remove') {
  if(tagIsUsed(project,id))throw new Error('Remove assignments and rule references before deleting this tag.');
  project.itemTags=(project.itemTags||[]).filter(tag=>tag.id!==id);
  return;
 }
 name=name?.trim();
 if(!validItemTagName(name))throw new Error('Tag names must be a single word.');
 if(!itemTagNameAvailable(project,name,operation==='rename'?id:undefined))throw new Error('A tag with this name already exists.');
 if(operation==='rename') {
  const tag=project.itemTags?.find(tag=>tag.id===id);
  if(!tag)throw new Error('The tag no longer exists.');
  tag.name=name;
 } else if(operation==='add') {
  if(!id||project.itemTags?.some(tag=>tag.id===id))throw new Error('Invalid tag ID.');
  (project.itemTags||=[]).push({id,name});
 } else throw new Error('Unknown tag operation.');
}
