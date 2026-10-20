import { cardRuleIndicators } from './card-rule-indicators.js';
import { createLibraryIndex } from '../project/library-index.js';
import { sortedChapters, startChapter } from '../project/chapter-navigation.js';
import { remapVariableClipboard, variableRenamesBetween } from './variable-ids.js';
import { captureCardClipboard, canPasteCard } from './card-clipboard.js';
import { captureNodeClipboard } from './node-clipboard.js';
import { mountNodeClipboardShortcuts } from './node-clipboard-shortcuts.js';
import { applyCardStyles, parseCardColor } from '../project/card-styles.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { nodeIcon } from './node-icons.js';
import { artworkSettings, parseArtworkSettings } from './artwork-settings.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from './local-card-drafts.js';
import { cardKinds, cardEditorTint } from '../project/cards.js';
import { createProject,validateProject } from '../project/model.js';
import { definitionGraph } from '../project/dependencies.js';
import { loadProject, readRecoveredSave } from '../project/storage.js';
import { createPersistence, travelHistory, exportProjectDraft, exportStudioChapter, parseStudioImport } from './persistence.js';
import { mountNodeCreateMenu } from './node-create-menu.js';
import { GraphView } from './GraphView.js';
import { previewActiveNode, updatePreviewHighlight } from './preview-highlight.js';
import { ProjectPreview } from './ProjectPreview.js';
import { definitionInspector,nodeInspector,projectSettingsInspector,chapterSettingsInspector } from './inspectors.js';
import { esc, field, select } from './forms.js';
import { mountPreviewWindow } from './preview-window.js';
import { mountAutoplay } from './autoplay.js';
import { sourceCard, revealCardEntry } from './card-navigation.js';
import { renderCardPreviews } from './card-preview.js';
import { bindImagePicker } from './image-picker.js';
import { findPlacement } from './commands.js';
import { applyDocumentCommand, documentScope } from './document-commands.js';
import { transactDocument } from './document-session.js';
import { mountProjectSettingsWindow } from './project-settings-window.js';
import { mountHistoryShortcuts } from './history-shortcuts.js';
import { libraryCardSlot, mountLibraryCardActions } from './library-cards.js';
import { mountViewShortcuts } from './view-shortcuts.js';
import { mountPlayShortcuts } from './play-shortcuts.js';
import { cardLabel } from './card-label.js';
import { confirmLibraryRemoval } from './library-removal-confirmation.js';

const $=s=>document.querySelector(s),loaded=loadProject();
let copiedArtwork = null;
let nodeClipboard = null;
let cardClipboard = null;
const artworkClipboardKey = 'nest.artwork.clipboard';
let project=loaded.project||createProject(),chapterId=project.activeChapterId,selected=project.chapters.find(c=>c.id===chapterId)?.startNode,definitionId=project.library.find(d=>d.visibility!=='local')?.id,mode='chapter';
const history=new DocumentHistory(project);
const localDrafts=new LocalCardDrafts();
const chapter=()=>project.chapters.find(c=>c.id===chapterId)||project.chapters[0];
const node=()=>chapter().nodes.find(n=>n.id===selected);
const definition=()=>project.library.find(d=>d.id===definitionId);
const preview=new ProjectPreview($('#preview'),{inventoryHost:$('.preview-window-body'),onChange:state=>updatePreviewHighlight(graph,preview,chapter(),state),onStop:()=>graph.setActive(null),onGoToCard:goToPreviewCard});
const previewWindow=mountPreviewWindow($('#preview-window'),{onClose:()=>preview.stop()});
const autoplay=mountAutoplay($('#autoplay'),{getSelected:()=>graph.selectedIds.size>1?undefined:selected,onPlay:id=>play(id,{restore:false})});
const nodeCreateMenu=mountNodeCreateMenu({onChoose:(type,request)=>edit('create-connected-node',{...request,type}),onDismiss:()=>graph.cancelCreation(),returnFocus:$('#canvas')});
const graph=new GraphView($('#canvas'),{
 onSelect:id=>{graph.selectedIds=new Set([id]);selected=id;renderInspector({collapseCards:true});renderGraph();autoplay.select(id);},
 onOpenCard:(id,target,exit)=>{
  graph.selectedIds=new Set([id]);selected=id;mode='chapter';renderInspector({collapseCards:true});renderGraph();
  if(target)revealCardEntry($('#inspector'),target);
  else {const field=[...$('#inspector').querySelectorAll('[data-scope="connection"]')].find(el=>el.dataset.path===exit);field?.scrollIntoView({block:'center'});field?.focus({preventScroll:true});}
 },
 onCreateConnected:request=>nodeCreateMenu.open(request),
 onCancelCreate:()=>nodeCreateMenu.close(),
 onConnect:(id,exit,target)=>edit('connect',{id,exit,target}),
 onMove:(id,x,y)=>edit('move-node',{id,x,y}),
 onMoveMany:positions=>edit('move-nodes',{positions}),
 onSelectMany:ids=>{selected=ids[0];renderGraph();renderInspector({collapseCards:true});},
 onTransferCard:data=>{preview.stop();edit('transfer-card',data);},
 onDelete:()=>{if(mode==='chapter'&&node())edit('delete-node');},
});
const projectSettingsWindow=mountProjectSettingsWindow($('#project-settings-overlay'),{trigger:$('#project-settings-toggle'),preview:$('#preview-window'),onOpen:()=>graph.cancel()});
const persistence=createPersistence({loaded,onStatus:text=>{$('#save-status').textContent=text;}});
const saveProject=project=>persistence.save(project);
function report(text){persistence.report(text);}
function goToPreviewCard(target){
 const source=sourceCard(project,target);
 if(!source){report('This card was removed from the current project. Restart preview to use the latest version.');return;}
 const changedChapter=chapterId!==source.chapter.id;
 graph.selectedIds=new Set([source.node.id]);
 chapterId=source.chapter.id;selected=source.node.id;mode='chapter';
 render();if(changedChapter)graph.fit();
 if(!revealCardEntry($('#inspector'),target))report('This card is not currently shown in the panel. Its introduction may have been disabled since playback started.');
}
const selection=()=>({chapterId,selected,definitionId,mode});
function edit(type,data={}, {preserveProjectSettings=false,refresh=true}={}){
 graph.cancel();
 const outcome=transactDocument(history,localDrafts,draft=>applyDocumentCommand(draft,selection(),type,data,localDrafts));
 project=outcome.project;
 if(outcome.result?.variableRename){
  remapVariableClipboard(cardClipboard,outcome.result.variableRename);
  remapVariableClipboard(nodeClipboard?.data,outcome.result.variableRename);
 }
 const patch=outcome.result?.selection||{};
 if('chapterId' in patch)chapterId=patch.chapterId;
 if('selected' in patch)selected=patch.selected;
 if('definitionId' in patch)definitionId=patch.definitionId;
 if('mode' in patch)mode=patch.mode;
 const saved=saveProject(project);
 if(refresh)render({preserveProjectSettings});
 else {
  $('#undo').disabled=!history.canUndo;$('#redo').disabled=!history.canRedo;
  $('#errors').innerHTML=validateProject(project).map(e=>`<div>${esc(e.message)}</div>`).join('');
 }
 report(outcome.failure|| (saved.ok?'Saved in this browser':`Save failed: ${saved.error}`));
 return {ok:!outcome.failure&&saved.ok,value:outcome.result?.value};
}
function renderGraph(){
 if(mode==='chapter')graph.render(project,chapter(),selected,previewActiveNode(preview,chapter()));
 const multiple=graph.selectedIds.size>1;
 $('#copy-node').disabled=$('#cut-node').disabled=mode!=='chapter'||!node()||multiple;
 for(const id of ['duplicate','start','play-node'])$('#'+id).disabled=mode!=='chapter'||!node()||multiple;
 $('#paste-node').disabled=mode!=='chapter'||!nodeClipboard||nodeClipboard.projectId!==project.id;
}
function renderProjectSettings(){
 const root=$('#project-settings-content'),active=document.activeElement;
 const restore=root.contains(active),path=active?.dataset.path,scope=active?.dataset.scope;
 const start=restore&&['text','search'].includes(active.type)?active.selectionStart:null;
 const end=start===null?null:active.selectionEnd,scroll=root.scrollTop;
 const sections=['data-project-variables','data-project-item-tags','data-project-card-styles','data-project-card-backs'];
 const expanded=sections.filter(key=>root.querySelector(`[${key}]`)?.open);
 root.innerHTML=projectSettingsInspector(project);
 for(const key of expanded)root.querySelector(`[${key}]`).open=true;
 root.scrollTop=scroll;
 if(restore&&path){
  const next=[...root.querySelectorAll('[data-path]')].find(el=>el.dataset.path===path&&el.dataset.scope===scope);
  next?.focus({preventScroll:true});if(next&&start!==null)next.setSelectionRange(start,end);
 }
}
function renderInspector({collapseCards=false,preserveProjectSettings=false}={}){
 const multiple=mode==='chapter'&&graph.selectedIds.size>1;
 localDrafts.setContext(chapterId,selected);
 const sidebar=document.querySelector('aside'),scroll=sidebar.scrollTop;
 const settings=$('#settings'),active=document.activeElement;
 const focusedSetting=settings.contains(active)?{scope:active.dataset.scope,path:active.dataset.path}:null;
 const settingsOpen=$('#settings').querySelector('details')?.open;
 const globalInitialValuesOpen=settings.querySelector('[data-global-initial-values]')?.open;
 const chapterVariablesOpen=settings.querySelector('[data-chapter-variables]')?.open;
 const inspectorKey=`${mode}:${mode==='library'?definitionId:`${chapterId}:${selected}`}`;
 const sameInspector=$('#inspector').dataset.key===inspectorKey;
 const expanded=sameInspector?[...$('#inspector').querySelectorAll('details')].map((el,i)=>el.open?i:-1):[];
 $('#settings').innerHTML=chapterSettingsInspector(project,chapter());
 if(!preserveProjectSettings)renderProjectSettings();
 $('#inspector').innerHTML=mode==='library'?definitionInspector(project,definition()):multiple?`<p class="small">${graph.selectedIds.size} beats selected. Drag a selected beat’s header to move them together.</p>`:nodeInspector(project,chapter(),node());
 renderCardPreviews($('#inspector'),project,node(),chapterId);
 refreshCardClipboardButtons();
 applyCardStyles(preview.mount,project.cardStyles);
 if(settingsOpen)$('#settings').querySelector('details').open=true;
 if(globalInitialValuesOpen)settings.querySelector('[data-global-initial-values]').open=true;
 if(chapterVariablesOpen)settings.querySelector('[data-chapter-variables]').open=true;
 if(sameInspector)[...$('#inspector').querySelectorAll('details')].forEach((el,i)=>{el.open=expanded.includes(i);});
 if(collapseCards)for(const entry of $('#inspector').querySelectorAll('details[data-placement],details[data-sequence]')){entry.open=false;entry.classList.remove('card-navigation-target');}
 $('#inspector').dataset.key=inspectorKey;
 const panelLabel=multiple?'Multiple beats':mode==='library'?(cardKinds[definition()?.kind]?.label||'Library'):nodeTypeLabel(node()?.type)||'Beat';
 $('#panel-title').closest('.tabs').hidden=mode==='library';
 $('#panel-title').innerHTML=`<span>${esc(panelLabel)}</span>${mode==='chapter'&&!multiple?nodeIcon(node()?.type):''}`;
 if(sameInspector&&focusedSetting){
  const next=[...settings.querySelectorAll('[data-path]')].find(el=>el.dataset.scope===focusedSetting.scope&&el.dataset.path===focusedSetting.path);
  next?.focus({preventScroll:true});
 }
 // Replacing and reopening details can change the browser's scroll anchor.
 // Restore only after the entire sidebar has its final layout.
 sidebar.scrollTop=sameInspector?scroll:0;
}
function renderLibrary(){
 const libraryIndex=createLibraryIndex(project.library);
 const query=$('#library-search').value.toLowerCase();
 $('#library-search-clear').hidden=!query;
 const dependencies=definitionGraph(project);
 const match=$('#library-match-beat').checked;
 $('#library-list').innerHTML=project.library.filter(d=>d.visibility!=='local'&&`${cardLabel(d)} ${cardKinds[d.kind]?.label||d.kind} ${d.kind} ${(project.itemTags||[]).find(tag=>tag.id===d.tagId)?.name||''}`.toLowerCase().includes(query)).map(d=>{
  const compatible=!!libraryCardSlot(node(),d);
  const indicators=cardRuleIndicators(project,{definitionId:d.id},libraryIndex);
  const indicatorLabel=indicators.map(([letter,label])=>`${letter}: ${label}`).join('; ');
  const hint=compatible?`Double-click to add to ${node().name}`:node()?'Cannot add this card type to the selected beat. Click to inspect.':'Select a beat to add this card. Click to inspect.';
  return `<button type="button" data-definition="${esc(d.id)}" class="library-entry card-panel ${d.id===definitionId?'selected':''} ${match&&!compatible?'library-entry-incompatible':''}" data-card-type="${esc(d.kind)}" title="${esc(hint)}" style="--card-editor-tint:${esc(cardEditorTint(d.kind))}"><strong>${esc(cardLabel(d))}</strong><span class="library-card-meta"><span>${esc(cardKinds[d.kind]?.label||d.kind)} · ${dependencies.users(d.id).length} uses</span>${indicators.length?`<span class="library-card-rules" role="img" aria-label="${esc(indicatorLabel)}" title="${esc(indicatorLabel)}">${esc(indicators.map(([letter])=>letter).join(' · '))}</span>`:''}</span>${d.kind==='item'&&d.tagId?`<span class="library-item-tag">[${esc((project.itemTags||[]).find(tag=>tag.id===d.tagId)?.name||d.tagId)}]</span>`:''}</button>`;
 }).join('');
}
function render({preserveProjectSettings=false}={}){
 graph.cancelCreation();
 if(!project.chapters.some(c=>c.id===chapterId))chapterId=project.activeChapterId||project.chapters[0]?.id;
 if(!chapter()?.nodes.some(n=>n.id===selected))selected=chapter()?.startNode;
 $('#project-name').textContent=project.name;
 $('#chapter-selector').innerHTML=sortedChapters(project).map(c=>`<option value="${esc(c.id)}" ${c.id===chapterId?'selected':''}>${esc(c.name)}</option>`).join('');
 $('#undo').disabled=!history.canUndo;$('#redo').disabled=!history.canRedo;

 $('#canvas').hidden=mode!=='chapter';$('#library-panel').hidden=mode!=='library';$('#node-tools').hidden=mode!=='chapter';
 $('#chapter-view').classList.toggle('active-tab',mode==='chapter');$('#library-view').classList.toggle('active-tab',mode==='library');
 const issues=validateProject(project);$('#errors').innerHTML=issues.map(e=>`<div>${esc(e.message)}</div>`).join('');
 renderGraph();renderLibrary();renderInspector({preserveProjectSettings});
}
function scopeRoot(scope,element){
 return documentScope(project,selection(),{scope,placementId:element.closest('[data-placement]')?.dataset.placement});
}
function changeField(event){const el=event.target,path=el.dataset.path,scope=el.dataset.scope;if(!path)return;
 const colorField=el.matches('[data-card-style-color]');let color;
 if(colorField){
  try{color=el.value.trim()?parseCardColor(el.value):undefined;el.setCustomValidity('');}
  catch{el.setCustomValidity('Enter a 3- or 6-digit hex color, such as #A9BB86.');el.reportValidity();return;}
 }
 // Keep blur-driven changes from replacing the next focus or click target.
 const preserveProjectSettings=!!el.closest('#project-settings-content')&&!/^variables\.\d+\.type$/.test(path);
 const initialValue=scope==='initial-toggle'||scope==='initial-value';
 edit('field',{scope,path,value:el.value,checked:el.checked,inputType:el.type,
  placementId:el.closest('[data-placement]')?.dataset.placement,colorField,color},{preserveProjectSettings,refresh:!initialValue});
 if(scope==='initial-toggle'){
  // Keep the clicked checkbox and sidebar mounted; only its value field changes.
  const entry=el.closest('.entry'),variable=project.variables.find(v=>v.id===path);
  entry.querySelector('[data-scope="initial-value"]')?.closest('.field').remove();
  el.checked=Object.hasOwn(chapter().initialValues||{},path);
  if(el.checked){
   const value=chapter().initialValues[path];
   entry.insertAdjacentHTML('beforeend',variable.type==='flag'
    ?select('Initial value',String(value),[['true','True'],['false','False']],path,'initial-value')
    :field('Initial value',value,path,'initial-value','number'));
  }
 }
}
for(const root of [$('#inspector'),$('#settings'),$('#project-settings-content')])root.addEventListener('change',changeField);
$('#project-settings-content').addEventListener('input',event=>{
 const el=event.target;
 if(!el.matches('[data-card-style-slider],[data-card-style-color]'))return;
 const styles={...project.cardStyles},key=el.dataset.path.split('.')[1];
 if(el.matches('[data-card-style-color]')){
  try{if(el.value.trim())styles[key]=parseCardColor(el.value);else delete styles[key];el.setCustomValidity('');}
  catch{el.setCustomValidity('Enter a 3- or 6-digit hex color, such as #A9BB86.');return;}
 }else{
  el.closest('label').querySelector('output').textContent=`${el.value}px`;
  styles[key]=Number(el.value);
 }
 renderCardPreviews($('#inspector'),{...project,cardStyles:styles},node(),chapterId);applyCardStyles(preview.mount,styles);
});
$('#inspector').addEventListener('input',event=>{
 const el=event.target;if(!el.matches('[data-artwork-slider]'))return;
 el.closest('label').querySelector('output').textContent=`${el.value}%`;
 const source=scopeRoot(el.dataset.scope,el);if(!source)return;
 const draft={...project,library:project.library.map(d=>d.id===source.id?{...d,[el.dataset.path]:Number(el.value)}:d)};
 renderCardPreviews($('#inspector'),draft,node(),chapterId);
});

for(const root of [$('#inspector'),$('#settings'),$('#project-settings-content')])bindImagePicker(root,{
 onSelect(scope,placementId,path,value){
  edit('image',{scope,placementId,path,value});
 },onError:report
});
function refreshCardClipboardButtons(){
 for(const button of $('#inspector').querySelectorAll('[data-command="paste-card"]')){
  const placement=node()&&findPlacement(node(),button.dataset.placement);
  button.disabled=mode!=='chapter'||!placement||!canPasteCard(project,node(),placement,cardClipboard);
  button.title=button.disabled?'Copy a compatible card from this project first.':'Replace this card with the copied card. Undo restores it.';
 }
}
function command(event){const b=event.target.closest('[data-command]');if(!b)return;const cmd=b.dataset.command;
 if(cmd==='clear-image'){
  if(b.disabled)return;
  edit('image',{scope:b.dataset.scope,placementId:b.closest('[data-placement]')?.dataset.placement,path:b.dataset.path,value:''});
  return;
 }
 if(cmd==='delete-definition'){
  if(b.disabled||!confirmLibraryRemoval(project,definitionId,{report}))return;
  preview.stop();
  const result=edit('inspector',{command:cmd});
  if(result.ok)report(result.value?`Removed from Library. ${result.value} placement${result.value===1?'':'s'} converted to local cards. Undo restores the shared links.`:'Removed from Library. Undo restores it.');
  return;
 }
 if(cmd==='play-from-start'){
  const target=startChapter(project);
  if(target){projectSettingsWindow.close();play(undefined,{chapterId:target.id});}
  return;
 }
 if(cmd==='copy-card'){
  try{cardClipboard=captureCardClipboard(project,chapterId,selected,b.dataset.placement);refreshCardClipboardButtons();report('Card copied.');}
  catch(error){report(error.message);}
  return;
 }
 if(cmd==='paste-card'){
  if(b.disabled)return;
  preview.stop();
  const result=edit('paste-card',{placementId:b.dataset.placement,clipboard:cardClipboard});
  if(result.ok)report('Card pasted. Undo restores the previous card.');
  return;
 }
 if(cmd==='copy-artwork'){
  const card=scopeRoot(b.dataset.scope,b);if(!card)return;
  copiedArtwork=artworkSettings(card);
  try{localStorage.setItem(artworkClipboardKey,JSON.stringify(copiedArtwork));}catch{}
  report('Image settings copied, including the path.');return;
 }
 if(cmd==='paste-artwork'){
  const card=scopeRoot(b.dataset.scope,b);if(!card)return;
  let settings=copiedArtwork;
  try{const saved=localStorage.getItem(artworkClipboardKey);if(saved)settings=parseArtworkSettings(saved);}catch{}
  if(!settings){report('Copy image settings from a card first.');return;}
  edit('paste-artwork',{id:card.id,settings});return;
 }
 if(cmd==='delete-chapter'){
  if(b.disabled)return;
  const chapter=project.chapters.find(chapter=>chapter.id===b.dataset.chapter);
  if(!chapter||project.chapters.length<=1)return;
  if(!globalThis.confirm(`Delete chapter “${chapter.name||chapter.id}”?\n\nThis removes the chapter and its local content. Shared Library cards and project variables are kept.\n\nUndo restores the chapter and its removed content.`))return;
  preview.stop();localDrafts.reset();
  const result=edit('delete-chapter',{id:b.dataset.chapter});
  if(result.ok){if(mode==='chapter')graph.fit();report('Chapter deleted. Undo restores it.');}
  return;
 }
 if(cmd==='edit-shared'){definitionId=b.dataset.definition;mode='library';render();return;}
 if(cmd==='back-to-beat'){mode='chapter';render();return;}
 if(cmd==='jump-use'){
  if(b.disabled)return;
  if(b.dataset.placement){
   goToPreviewCard({chapterId:b.dataset.chapter,nodeId:b.dataset.node,placementId:b.dataset.placement,
    ...(b.dataset.sequence?{sequenceId:b.dataset.sequence,slot:b.dataset.slot,parentCardId:b.dataset.parent}: {})});
   graph.fit();
  }else{
   chapterId=b.dataset.chapter;selected=b.dataset.node||project.chapters.find(c=>c.id===chapterId)?.startNode;graph.selectedIds=new Set(selected?[selected]:[]);mode='chapter';render();graph.fit();
   if(!b.dataset.node){const settings=$('#settings').querySelector('details');if(settings){settings.open=true;settings.scrollIntoView({block:'start'});}}
  }
  return;
 }
 edit('inspector',{...b.dataset,placement:b.dataset.placement??event.target.closest('[data-placement]')?.dataset.placement});
}
for(const root of [$('#inspector'),$('#settings'),$('#project-settings-content')])root.addEventListener('click',command);
mountLibraryCardActions($('#library-list'),{
 onOpen:id=>{
  definitionId=id;
  // Keep the clicked element mounted so the browser can deliver its dblclick.
  for(const entry of $('#library-list').querySelectorAll('[data-definition]'))entry.classList.toggle('selected',entry.dataset.definition===id);
  renderInspector();
 },
 onAdd:id=>{
  const card=project.library.find(d=>d.id===id);
  if(!libraryCardSlot(node(),card))return;
  preview.stop();edit('add-library-card',{definitionId:id});
 },
});
$('#project-settings-content').addEventListener('submit',event=>{
 if(!event.target.matches('[data-add-tag-form]'))return;
 event.preventDefault();
 edit('item-tag',{operation:'add',id:`tag_${crypto.randomUUID()}`,name:new FormData(event.target).get('tagName')});
});
$('#project-settings-content').addEventListener('change',event=>{
 const input=event.target.closest('[data-tag-name]');if(!input)return;
 edit('item-tag',{operation:'rename',id:input.dataset.tagName,name:input.value});
});
$('#project-settings-content').addEventListener('click',event=>{
 const button=event.target.closest('[data-remove-tag]');if(!button||button.disabled)return;
 edit('item-tag',{operation:'remove',id:button.dataset.removeTag});
});
$('#library-search').oninput=renderLibrary;
$('#library-search-clear').onclick=()=>{
 $('#library-search').value='';renderLibrary();$('#library-search').focus();
};
$('#library-match-beat').onchange=renderLibrary;
$('#chapter-view').onclick=()=>{mode='chapter';render();};$('#library-view').onclick=()=>{mode='library';render();};
$('#chapter-selector').onchange=e=>{preview.stop();edit('select-chapter',{id:e.target.value});graph.fit();};
$('#add-chapter').onclick=()=>edit('add-chapter');
function copyBeat(cut=false){
 if(mode!=='chapter'||!node()||graph.selectedIds.size>1)return false;
 graph.cancel();
 try{
  const data=captureNodeClipboard(project,chapterId,selected,{cut});
  nodeClipboard={projectId:project.id,data,pasteCount:0};
  if(cut){preview.stop();edit('delete-node');}
  render();report(cut?'Beat cut. Paste it into any chapter; Undo restores the original.':'Beat copied. Paste it into any chapter.');
  return true;
 }catch(error){report(`Copy failed: ${error.message}`);return false;}
}
function pasteBeat(){
 if(mode!=='chapter'||!nodeClipboard||nodeClipboard.projectId!==project.id)return false;
 const clipboard=nodeClipboard,offset=40*(clipboard.pasteCount+1);
 const result=edit('paste-node',{clipboard:clipboard.data,position:{x:(clipboard.data.node.x||0)+offset,y:(clipboard.data.node.y||0)+offset}});
 if(result.value){
  clipboard.pasteCount++;clipboard.data={...clipboard.data,cut:false};
  graph.centerOn(result.value);$('#canvas').focus({preventScroll:true});
  if(result.ok)report('Beat pasted. Undo removes it.');
 }
 return true;
}
$('#copy-node').onclick=()=>copyBeat();$('#cut-node').onclick=()=>copyBeat(true);$('#paste-node').onclick=pasteBeat;
function duplicateBeat(){
 if(mode!=='chapter'||!node()||graph.selectedIds.size>1)return false;
 edit('duplicate-node');graph.centerOn(selected);$('#canvas').focus({preventScroll:true});return true;
}
const stopNodeClipboardShortcuts=mountNodeClipboardShortcuts(document,{copy:()=>copyBeat(),cut:()=>copyBeat(true),paste:pasteBeat,duplicate:duplicateBeat,enabled:()=>mode==='chapter'});
for(const b of document.querySelectorAll('[data-add-kind]'))b.onclick=()=>edit('add-definition',{kind:b.dataset.addKind});
for(const b of document.querySelectorAll('[data-add]'))b.onclick=()=>{graph.cancel();edit('add-node',{type:b.dataset.add,position:{x:(150-graph.view.x)/graph.view.z,y:(140-graph.view.y)/graph.view.z}});};
$('#duplicate').onclick=duplicateBeat;
$('#start').onclick=()=>{if(node()&&graph.selectedIds.size<=1)edit('set-start');};
function travel(method){
 graph.cancel();localDrafts.reset();const result=travelHistory(history,method,persistence);
 if(result.changed){
  for(const rename of variableRenamesBetween(project,result.project)){
   remapVariableClipboard(cardClipboard,rename);remapVariableClipboard(nodeClipboard?.data,rename);
  }
  project=result.project;
 }
 render();
}
$('#undo').onclick=()=>travel('undo');$('#redo').onclick=()=>travel('redo');
const stopHistoryShortcuts=mountHistoryShortcuts(document,{undo:()=>$('#undo').click(),redo:()=>$('#redo').click()});
const stopViewShortcuts=mountViewShortcuts(document,{
 toggleAutoplay:()=>$('#autoplay').click(),
 libraryActive:()=>mode==='library',
 enabled:()=>$('#project-settings-overlay').hidden&&!graph.drag&&!graph.pending&&!graph.creation&&!preview.deck?.input?.active,
 switchView:()=>{
  graph.cancel();mode=mode==='chapter'?'library':'chapter';render();
  $(mode==='chapter'?'#canvas':'#library-panel').focus({preventScroll:true});
 },
 togglePreview:()=>{if(!previewWindow.visible)return false;previewWindow.toggle();},
});
$('#autoplay').title='Toggle Autoplay (/)';
$('#autoplay').setAttribute('aria-keyshortcuts','/');
function download(value,name){downloadText(JSON.stringify(value,null,2),name,'application/json');}
function downloadText(text,name,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let recoveryDownload;
if(loaded.recovery){
 recoveryDownload=document.createElement('button');recoveryDownload.type='button';recoveryDownload.textContent='Download recovered save';
 recoveryDownload.onclick=()=>{const recovered=readRecoveredSave();if(!recovered.ok){report(`Recovery download failed: ${recovered.error}`);return;}downloadText(recovered.text,'nest-recovered-save.txt');report('Recovered save downloaded as exact original text. Recovery backup retained.');};
 $('#save-status').after(recoveryDownload);
}
$('#export-project').textContent='Export project';
$('#export-project').onclick=()=>{try{download(exportProjectDraft(project),`${project.name.replace(/[^a-z0-9]+/gi,'-')}.nest.json`);report('Project exported. Unfinished work is included; playback requires validation errors to be fixed.');}catch(error){report(`Project export failed: ${error.message}`);}};
$('#export-chapter').onclick=()=>{try{download(exportStudioChapter(project,chapterId),`${chapter().name.replace(/[^a-z0-9]+/gi,'-')}.chapter.json`);report('Chapter exported.');}catch(error){report(`Chapter export failed: ${error.message}`);}};
function bindImport(input,kind){
 input.onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
   const {raw,project:incoming}=parseStudioImport(await file.text(),{kind});
   preview.stop();localDrafts.reset();if(kind==='project')nodeClipboard=null;
   const saved=edit('import',{raw,incoming}).ok;
   if(saved&&kind==='project'&&persistence.adopt().ok){recoveryDownload?.remove();report('Project imported and saved in this browser. Recovery backups retained.');}
   else if(saved&&kind==='chapter')report('Chapter imported and saved in this browser.');
   graph.fit();
  }catch(error){report(`Import rejected: ${error.message}`);}
  e.target.value='';
 };
}
bindImport($('#import'),'project');
bindImport($('#import-chapter'),'chapter');
function play(startNode,{restore=false,chapterId:targetChapterId=chapterId,focus=true}={}){try{previewWindow.show({restore});preview.play(project,targetChapterId,startNode,{focus:focus&&!previewWindow.minimized});report('Chapter ready.');return true;}catch(error){report(error.message);return false;}}
function playSelected(options){if(!node()||graph.selectedIds.size>1)return false;return play(selected,options);}
$('#play').onclick=()=>play();$('#play-node').onclick=()=>playSelected();
$('#play-node').title='Play selected beat from the start (Shift+Enter)';
$('#play-node').setAttribute('aria-keyshortcuts','Shift+Enter');
const stopPlayShortcuts=mountPlayShortcuts(document,{
 playSelected:()=>{graph.cancel();return playSelected({focus:false});},
 commitField:target=>{
  if(!target?.matches?.('input,textarea,select')||!target.closest('#inspector,#settings,#project-settings-content'))return false;
  target.blur();return true;
 },
 enabled:()=>!!node()&&graph.selectedIds.size<=1,
});
window.addEventListener('pagehide',event=>{if(event.persisted)return;graph.cancel();stopHistoryShortcuts();stopNodeClipboardShortcuts();stopViewShortcuts();stopPlayShortcuts();autoplay.destroy();previewWindow.destroy();projectSettingsWindow.destroy();preview.destroy();});
render();graph.fit();if(loaded.error||loaded.recovery)report('');else if(loaded.migrated)report('Legacy save loaded; original browser save preserved.');else report(loaded.project?'Saved in this browser.':'Not saved yet.');
