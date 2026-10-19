import { tagKey } from '../project/item-tags.js';
/** Editor candidates are shared items plus items owned by the explicit chapter. */
export function eligibleInventoryItems(project, chapter) {
 const chapterId=typeof chapter==='string'?chapter:chapter?.id;
 return project.library.filter(item=>item.kind==='item'&&(item.visibility!=='local'||(chapterId&&item.chapterId===chapterId)));
}
const itemLabel=item=>`${item.visibility==='local'?'local':'Item'}: ${item.name||item.id}`;

/** Keep saved, out-of-scope references visible without offering other chapters' items. */
export function inventoryItemOptions(project, chapter, selected='', {allowNone=false,includeTags=false}={}) {
 const choices=eligibleInventoryItems(project,chapter).map(item=>[item.id,itemLabel(item)]);
 if(includeTags)choices.push(...(project.itemTags||[]).map(tag=>[tagKey(tag.id),`Tag: ${tag.name}`]));
 if(allowNone||!selected)choices.unshift(['',allowNone?'None':'Choose item']);
 if(selected&&!choices.some(([id])=>id===selected)) {
  const item=project.library.find(item=>item.id===selected&&item.kind==='item');
  choices.push([selected,`${item?itemLabel(item):selected} (unavailable)`]);
 }
 return choices;
}
