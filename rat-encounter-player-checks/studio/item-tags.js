import { createError } from '../errors.js';
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
  if(tagIsUsed(project,id))throw createError('STUDIO_REMOVE_ASSIGNMENTS_AND_RULE_REFERENCES_BEFORE_DELETING_THIS_TAG');
  project.itemTags=(project.itemTags||[]).filter(tag=>tag.id!==id);
  return;
 }
 name=name?.trim();
 if(!validItemTagName(name))throw createError('STUDIO_TAG_NAMES_MUST_BE_A_SINGLE_WORD');
 if(!itemTagNameAvailable(project,name,operation==='rename'?id:undefined))throw createError('STUDIO_A_TAG_WITH_THIS_NAME_ALREADY_EXISTS');
 if(operation==='rename') {
  const tag=project.itemTags?.find(tag=>tag.id===id);
  if(!tag)throw createError('STUDIO_THE_TAG_NO_LONGER_EXISTS');
  tag.name=name;
 } else if(operation==='add') {
  if(!id||project.itemTags?.some(tag=>tag.id===id))throw createError('STUDIO_INVALID_TAG_ID');
  (project.itemTags||=[]).push({id,name});
 } else throw createError('STUDIO_UNKNOWN_TAG_OPERATION');
}
