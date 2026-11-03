import {createProjectDialog} from './project-file-dialog.js';
import {isCommonDefinition} from './common-library.js';
import {cardKinds} from '../project/cards.js';

/** Choose shared roots; the model includes their dependencies automatically. */
export function showLibraryImportDialog(project,{document=globalThis.document}={}) {
 const ui=createProjectDialog(document,'Import Library','data-library-import-dialog');
 const {element,dialog}=ui;
 dialog.append(element('p',`From ${project.name || 'project'}. Choose Content, Common, or individual cards.`));
 dialog.append(element('p','Required cards, variables and tags are included automatically. Chapters and project settings are not imported. Image files are not bundled.'));
 dialog.append(element('p','Identical cards are reused. Changed cards are imported as separate copies; existing cards are kept.'));
 const list=element('div');list.className='library-import-list';dialog.append(list);
 const fields=[];
 const submit=element('button','Import cards');submit.type='button';
 const update=()=>{
  const count=fields.filter(field=>field.checked).length;
  submit.disabled=!count;submit.textContent=`Import ${count} card${count===1?'':'s'}`;
 };
 for(const [name,common] of [['Content',false],['Common',true]]) {
  const cards=(project.library||[]).filter(card=>card.visibility!=='local'&&isCommonDefinition(card)===common);
  const section=element('fieldset'),legend=element('legend'),label=element('label'),toggle=element('input');
  label.className='check-field';toggle.type='checkbox';toggle.checked=!!cards.length;toggle.disabled=!cards.length;
  toggle.setAttribute('aria-label',name);label.append(toggle,element('span',`${name} (${cards.length})`));legend.append(label);section.append(legend);
  const group=[];
  for(const card of cards) {
   const row=element('label'),field=element('input');row.className='check-field';field.type='checkbox';field.checked=true;field.value=card.id;
   field.setAttribute('aria-label',`${card.name || card.id} · ${cardKinds[card.kind]?.label || card.kind}`);
   row.append(field,element('span',`${card.name || card.id} · ${cardKinds[card.kind]?.label || card.kind}`));
   section.append(row);fields.push(field);group.push(field);
   field.addEventListener('change',()=>{
    const checked=group.filter(item=>item.checked).length;
    toggle.checked=checked===group.length;toggle.indeterminate=checked>0&&checked<group.length;update();
   });
  }
  toggle.addEventListener('change',()=>{for(const field of group)field.checked=toggle.checked;toggle.indeterminate=false;update();});
  list.append(section);
 }
 const cancel=element('button','Cancel');cancel.type='button';
 submit.addEventListener('click',()=>{if(!submit.disabled)ui.close(fields.filter(field=>field.checked).map(field=>field.value));});
 cancel.addEventListener('click',()=>ui.close(null));ui.setCancel(()=>ui.close(null));
 dialog.append(submit,cancel);update();ui.focusFirst();return ui.promise;
}
