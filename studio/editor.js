import { addHealthVariable } from './commands.js';
import { applyCardStyles, parseCardColor } from '../project/card-styles.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { artworkSettings, parseArtworkSettings } from './artwork-settings.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from './local-card-drafts.js';
import { createDefinition, allowedCardKinds, cardKinds, cardEditorTint } from '../project/cards.js';
import { createProject,createChapter,validateProject,parseProject,exportChapter,importChapter,discardPlacementContext } from '../project/model.js';
import { definitionGraph, deleteDefinition, cleanupLocalDefinitions } from '../project/dependencies.js';
import { loadProject,saveProject } from '../project/storage.js';
import { GraphView } from './GraphView.js';
import { ProjectPreview } from './ProjectPreview.js';
import { definitionInspector,nodeInspector,variableInspector } from './inspectors.js';
import { esc } from './forms.js';
import { mountPreviewWindow } from './preview-window.js';
import { mountAutoplay } from './autoplay.js';
import { sourceCard, revealCardEntry } from './card-navigation.js';
import { renderCardPreviews } from './card-preview.js';
import { bindImagePicker } from './image-picker.js';
import { uid,createNode,makePlacement,promoteCard,duplicateNode,duplicatePlacement,findPlacement,pathTarget,synchronizeConnections,customizeAction,newRule,normalizeRule } from './commands.js';

const $=s=>document.querySelector(s),loaded=loadProject();
let copiedArtwork = null;
const artworkClipboardKey = 'nest.artwork.clipboard';
let project=loaded.project||createProject(),chapterId=project.activeChapterId,selected=project.chapters.find(c=>c.id===chapterId)?.startNode,definitionId=project.library.find(d=>d.visibility!=='local')?.id,mode='chapter';
const history=new DocumentHistory(project);
const localDrafts=new LocalCardDrafts();
const chapter=()=>project.chapters.find(c=>c.id===chapterId)||project.chapters[0];
const node=()=>chapter().nodes.find(n=>n.id===selected);
const definition=()=>project.library.find(d=>d.id===definitionId);
const preview=new ProjectPreview($('#preview'),{onChange:()=>renderGraph(),onGoToCard:goToPreviewCard});
const previewWindow=mountPreviewWindow($('#preview-window'),{onClose:()=>preview.stop()});
$('#show-preview').onclick=()=>previewWindow.show();
const autoplay=mountAutoplay($('#autoplay'),{getSelected:()=>selected,onPlay:id=>play(id,{restore:false})});
const graph=new GraphView($('#canvas'),{
 onSelect:id=>{selected=id;renderInspector({collapseCards:true});renderGraph();autoplay.select(id);},
 onOpenCard:(id,target,exit)=>{
  selected=id;mode='chapter';renderInspector({collapseCards:true});renderGraph();
  if(target)revealCardEntry($('#inspector'),target);
  else {const field=[...$('#inspector').querySelectorAll('[data-scope="connection"]')].find(el=>el.dataset.path===exit);field?.scrollIntoView({block:'center'});field?.focus({preventScroll:true});}
 },
 onConnect:(id,exit,target)=>edit(()=>setConnection(chapter().nodes.find(n=>n.id===id),exit,target)),
 onMove:(id,x,y)=>edit(()=>Object.assign(chapter().nodes.find(n=>n.id===id),{x,y})),
});
function report(text){$('#save-status').textContent=text;}
function goToPreviewCard(target){
 const source=sourceCard(project,target);
 if(!source){report('This card was removed from the current project. Restart preview to use the latest version.');return;}
 const changedChapter=chapterId!==source.chapter.id;
 chapterId=source.chapter.id;selected=source.node.id;mode='chapter';
 render();if(changedChapter)graph.fit();
 if(!revealCardEntry($('#inspector'),target))report('This card is not currently shown in the panel. Its introduction may have been disabled since playback started.');
}
function edit(fn){
 const previousLibrary=project.library;
 let failure;
 graph.cancel();
 try{history.transact(draft=>{project=draft;fn();discardPlacementContext(project);synchronizeConnections(project);localDrafts.refreshChangedDefinitions(project,previousLibrary);return project;});}
 catch(error){failure=error.message;localDrafts.reset();}
 finally{project=history.document;}
 const saved=saveProject(project);render();report(failure|| (saved.ok?'Saved in this browser':`Save failed: ${saved.error}`));
 return !failure && saved.ok;
}
function renderGraph(){if(mode==='chapter')graph.render(project,chapter(),selected,preview.state?.activeNodeId);}
function renderInspector({collapseCards=false}={}){
 localDrafts.setContext(chapterId,selected);
 const settingsOpen=$('#settings').querySelector('details')?.open;
 const inspectorKey=`${mode}:${mode==='library'?definitionId:selected}`;
 const sameInspector=$('#inspector').dataset.key===inspectorKey;
 const expanded=sameInspector?[...$('#inspector').querySelectorAll('details')].map((el,i)=>el.open?i:-1):[];
 $('#settings').innerHTML=variableInspector(project,chapter());
 $('#inspector').innerHTML=mode==='library'?definitionInspector(project,definition()):nodeInspector(project,chapter(),node());
 renderCardPreviews($('#inspector'),project,node());
 applyCardStyles(preview.mount,project.cardStyles);
 if(settingsOpen)$('#settings').querySelector('details').open=true;
 if(sameInspector)[...$('#inspector').querySelectorAll('details')].forEach((el,i)=>{el.open=expanded.includes(i);});
 if(collapseCards)for(const entry of $('#inspector').querySelectorAll('details[data-placement],details[data-sequence]')){entry.open=false;entry.classList.remove('card-navigation-target');}
 $('#inspector').dataset.key=inspectorKey;
 if(!sameInspector)document.querySelector('aside').scrollTop=0;
 $('#panel-title').textContent=mode==='library'?(cardKinds[definition()?.kind]?.label||'Library'):nodeTypeLabel(node()?.type)||'Beat';
}
function renderLibrary(){
 const query=$('#library-search').value.toLowerCase();
 const dependencies=definitionGraph(project);
 $('#library-list').innerHTML=project.library.filter(d=>d.visibility!=='local'&&`${d.name} ${cardKinds[d.kind]?.label||d.kind} ${d.kind}`.toLowerCase().includes(query)).map(d=>`<button type="button" data-definition="${esc(d.id)}" class="library-entry card-panel ${d.id===definitionId?'selected':''}" data-card-type="${esc(d.kind)}" style="--card-editor-tint:${esc(cardEditorTint(d.kind))}"><strong>${esc(d.name)}</strong><span>${esc(cardKinds[d.kind]?.label||d.kind)} · ${dependencies.users(d.id).length} uses</span></button>`).join('');
}
function render(){
 if(!project.chapters.some(c=>c.id===chapterId))chapterId=project.activeChapterId||project.chapters[0]?.id;
 if(!chapter()?.nodes.some(n=>n.id===selected))selected=chapter()?.startNode;
 $('#project-name').textContent=project.name;
 $('#chapter-selector').innerHTML=project.chapters.map(c=>`<option value="${esc(c.id)}" ${c.id===chapterId?'selected':''}>${esc(c.name)}</option>`).join('');
 $('#undo').disabled=!history.canUndo;$('#redo').disabled=!history.canRedo;
 $('#canvas').hidden=mode!=='chapter';$('#library-panel').hidden=mode!=='library';$('#node-tools').hidden=mode!=='chapter';
 $('#chapter-view').classList.toggle('active-tab',mode==='chapter');$('#library-view').classList.toggle('active-tab',mode==='library');
 const issues=validateProject(project);$('#errors').innerHTML=issues.map(e=>`<div>${esc(e.message)}</div>`).join('');
 renderGraph();renderLibrary();renderInspector();
}
function setConnection(n,exit,target){if(n.type==='random'){if(exit==='fallback')n.fallback=target;else n.routes.find(r=>r.id===exit).target=target;}else n.connections[exit]=target;}
function scopeRoot(scope,element){
 if(scope==='project')return project;if(scope==='chapter')return chapter();if(scope==='node')return node();if(scope==='definition')return definition();
 if(scope==='local-definition'){const p=findPlacement(node(),element.closest('[data-placement]')?.dataset.placement);return project.library.find(d=>d.id===p?.definitionId);}
 if(scope==='placement')return findPlacement(node(),element.closest('[data-placement]')?.dataset.placement);
}
function changeField(event){const el=event.target,path=el.dataset.path,scope=el.dataset.scope;if(!path)return;
 const colorField=el.matches('[data-card-style-color]');let color;
 if(colorField){
  try{color=el.value.trim()?parseCardColor(el.value):undefined;el.setCustomValidity('');}
  catch{el.setCustomValidity('Enter a 3- or 6-digit hex color, such as #A9BB86.');el.reportValidity();return;}
 }
 edit(()=>{
  if(scope==='connection'){setConnection(node(),path,el.value==='unlinked'?false:el.value==='end'?null:el.value.slice(7));return;}
  if(scope==='initial-toggle'){chapter().initialValues||={};if(el.checked)chapter().initialValues={...chapter().initialValues,[path]:project.variables.find(v=>v.id===path).initial};else delete chapter().initialValues[path];return;}
  if(scope==='initial-value'){const variable=project.variables.find(v=>v.id===path);const value=variable.type==='flag'?el.value==='true':Number(el.value);chapter().initialValues={...(chapter().initialValues||{}),[path]:value};return;}
  const root=scopeRoot(scope,el);if(!root)return;
  if(scope==='placement'&&path==='useCustomRules'){if(el.checked)customizeAction(project,root);else delete root.overrides;return;}
  if(scope==='node'&&path==='introEnabled'&&el.checked&&root.type==='fork'&&!root.intro)root.intro=makePlacement(project,'event');
  if(scope==='placement'&&path==='definitionId'){localDrafts.switchSource(project,root,el.value,{allowedKinds:allowedCardKinds(node().type,node().intro===root?'intro':node().type==='container'?'items':'cards')});return;}
  if(path==='itemBehaviour'){if(el.value==='consumable')root.use={effects:[],conditions:[]};else delete root.use;return;}
  const {parent,key}=pathTarget(root,path);
  if(colorField){if(color===undefined)delete parent[key];else parent[key]=color;return;}
  let value=el.type==='checkbox'?el.checked:['number','range'].includes(el.type)||key==='sides'?Number(el.value):el.value;
  if((['value','initial'].includes(key)||path.startsWith('initialValues.'))&&['true','false'].includes(value))value=value==='true';
  if(el.type==='number'&&el.value===''){delete parent[key];return;}
  if(['imageScale','imageOffsetX','imageOffsetY'].includes(key))value=Math.max(key==='imageScale'?10:-100,Math.min(key==='imageScale'?400:100,value));
  parent[key]=value;
  if(['modifierVariable','contextItemId'].includes(key)&&!value)delete parent[key];
  if(key==='contextItemId'&&!value)delete parent.contextOverrideImage;
  if(key==='resolution'&&value==='check')parent.check||={pool:[{sides:20,count:1}],modifier:0,target:10};
  if(key==='type'&&['flag','number'].includes(value)){parent.initial=value==='flag'?false:0;delete parent.min;delete parent.max;}
  if(['source','op','key'].includes(key))normalizeRule(project,parent,key);
 });
}
for(const root of [$('#inspector'),$('#settings')])root.addEventListener('change',changeField);
$('#settings').addEventListener('input',event=>{
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
 renderCardPreviews($('#inspector'),{...project,cardStyles:styles},node());applyCardStyles(preview.mount,styles);
});
$('#inspector').addEventListener('input',event=>{
 const el=event.target;if(!el.matches('[data-artwork-slider]'))return;
 el.closest('label').querySelector('output').textContent=`${el.value}%`;
 const source=scopeRoot(el.dataset.scope,el);if(!source)return;
 const draft={...project,library:project.library.map(d=>d.id===source.id?{...d,[el.dataset.path]:Number(el.value)}:d)};
 renderCardPreviews($('#inspector'),draft,node());
});

for(const root of [$('#inspector'),$('#settings')])bindImagePicker(root,{
 onSelect(scope,placementId,path,value){
  edit(()=>{
   let target;
   if(scope==='local-definition'){const p=findPlacement(node(),placementId);target=project.library.find(d=>d.id===p?.definitionId);}
   else target=scope==='chapter'?chapter():scope==='definition'?definition():null;
   if(!target)throw new Error('Select the card again before choosing its image.');
   const {parent,key}=pathTarget(target,path);if(['imageScale','imageOffsetX','imageOffsetY'].includes(key))value=Math.max(key==='imageScale'?10:-100,Math.min(key==='imageScale'?400:100,value));
  parent[key]=value;
  });
 },onError:report
});
function command(event){const b=event.target.closest('[data-command]');if(!b)return;const cmd=b.dataset.command;
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
  const id=card.id;edit(()=>Object.assign(project.library.find(d=>d.id===id),settings));return;
 }
 if(cmd==='edit-shared'){definitionId=b.dataset.definition;mode='library';render();return;}
 if(cmd==='jump-use'){chapterId=b.dataset.chapter;selected=b.dataset.node;mode='chapter';render();graph.fit();autoplay.select(selected);return;}
 edit(()=>{
  const n=node(),p=findPlacement(n||{},b.dataset.placement);
  if(cmd==='reset-artwork'){const root=scopeRoot(b.dataset.scope,b);delete root.imageScale;delete root.imageOffsetX;delete root.imageOffsetY;}
  if(cmd==='add-rule'){const root=scopeRoot(b.dataset.scope,b),{parent,key}=pathTarget(root,b.dataset.path);parent[key]||=[];parent[key].push(newRule(project,b.dataset.ruleKind));}
  if(cmd==='remove-rule'){const root=scopeRoot(b.dataset.scope,b),{parent,key}=pathTarget(root,b.dataset.path);parent[key].splice(Number(b.dataset.index),1);}
  if(cmd==='local-copy')localDrafts.convert(project,p);
  if(cmd==='clear-card')localDrafts.clear(project,p);
  if(cmd==='promote-card'){promoteCard(project,p);localDrafts.drafts.delete(p.id);}
  if(cmd==='add-placement')n[b.dataset.slot].push(makePlacement(project,b.dataset.kind));
  if(cmd==='duplicate-placement')duplicatePlacement(project,n,p);
  if(cmd==='remove-placement'){localDrafts.removePlacement(project,p);for(const slot of ['cards','choices','items'])if(n[slot])n[slot]=n[slot].filter(c=>c.id!==p.id);}
  if(cmd==='move-placement')for(const slot of ['cards','choices','items'])if(n[slot]){const i=n[slot].findIndex(c=>c.id===p.id),j=i+Number(b.dataset.direction);if(i>=0&&j>=0&&j<n[slot].length)[n[slot][i],n[slot][j]]=[n[slot][j],n[slot][i]];}
  if(cmd==='add-route')n.routes.push({id:uid('route'),name:`Route ${n.routes.length+1}`,target:false,weight:1,conditions:[]});
  if(cmd==='remove-route')n.routes.splice(Number(b.dataset.index),1);
  if(cmd==='delete-definition'){deleteDefinition(project,definitionId);definitionId=project.library.find(d=>d.visibility!=='local')?.id;}
  if(cmd==='add-health')addHealthVariable(project);
  if(cmd==='add-variable')project.variables.push({id:uid('variable'),name:'New variable',type:'number',initial:0});
  if(cmd==='remove-variable')project.variables.splice(Number(b.dataset.index),1);
 });
}
for(const root of [$('#inspector'),$('#settings')])root.addEventListener('click',command);
$('#library-list').onclick=e=>{const b=e.target.closest('[data-definition]');if(b){definitionId=b.dataset.definition;renderLibrary();renderInspector();}};
$('#library-search').oninput=renderLibrary;
$('#cleanup-local').onclick=()=>{
 let removed=0;
 if(edit(()=>{removed=cleanupLocalDefinitions(project);}))report(removed?`Removed ${removed} unused local card${removed===1?'':'s'}. Undo restores them.`:'No unused local cards.');
};
$('#chapter-view').onclick=()=>{mode='chapter';render();};$('#library-view').onclick=()=>{mode='library';render();};
$('#chapter-selector').onchange=e=>{preview.stop();chapterId=e.target.value;selected=project.chapters.find(c=>c.id===chapterId).startNode;edit(()=>{project.activeChapterId=chapterId;});graph.fit();};
$('#add-chapter').onclick=()=>edit(()=>{const c=createChapter(uid('chapter'),`Chapter ${project.chapters.length+1}`),n=createNode(project,'linear');c.nodes.push(n);c.startNode=n.id;project.chapters.push(c);chapterId=c.id;selected=n.id;project.activeChapterId=c.id;});
for(const b of document.querySelectorAll('[data-add-kind]'))b.onclick=()=>edit(()=>{const d=createDefinition(b.dataset.addKind,uid(b.dataset.addKind));project.library.push(d);definitionId=d.id;mode='library';});
for(const b of document.querySelectorAll('[data-add]'))b.onclick=()=>edit(()=>{const n=createNode(project,b.dataset.add,{x:(150-graph.view.x)/graph.view.z,y:(140-graph.view.y)/graph.view.z});chapter().nodes.push(n);if(!chapter().startNode)chapter().startNode=n.id;selected=n.id;});
$('#duplicate').onclick=()=>{if(node())edit(()=>{const n=duplicateNode(project,node());chapter().nodes.push(n);selected=n.id;});};
$('#delete').onclick=()=>{if(node())edit(()=>{const id=node().id;chapter().nodes=chapter().nodes.filter(n=>n.id!==id);for(const n of chapter().nodes){for(const key of Object.keys(n.connections||{}))if(n.connections[key]===id)n.connections[key]=false;for(const r of n.routes||[])if(r.target===id)r.target=false;if(n.fallback===id)n.fallback=false;}if(chapter().startNode===id)chapter().startNode=chapter().nodes[0]?.id||'';selected=chapter().startNode;});};
$('#start').onclick=()=>{if(node())edit(()=>{chapter().startNode=node().id;});};$('#fit').onclick=()=>graph.fit();
function travel(method){graph.cancel();localDrafts.reset();if(history[method]()){project=history.document;saveProject(project);}render();}
$('#undo').onclick=()=>travel('undo');$('#redo').onclick=()=>travel('redo');
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-project').onclick=()=>{const errors=validateProject(project);if(errors.length){report('Fix validation errors before exporting.');return;}download(project,`${project.name.replace(/[^a-z0-9]+/gi,'-')}.nest.json`);};
$('#export-chapter').onclick=()=>{const errors=validateProject(project);if(errors.length){report('Fix validation errors before exporting.');return;}download(exportChapter(project,chapterId),`${chapter().name.replace(/[^a-z0-9]+/gi,'-')}.chapter.json`);};
$('#import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const text=await file.text(),raw=JSON.parse(text),incoming=parseProject(text);preview.stop();localDrafts.reset();edit(()=>{project=raw.kind==='nest-project'?incoming:importChapter(project,raw);chapterId=project.activeChapterId;selected=chapter().startNode;});graph.fit();}catch(error){report(`Import rejected: ${error.message}`);}e.target.value='';};
function play(startNode,{restore=true}={}){try{previewWindow.show({restore});preview.play(project,chapterId,startNode,{focus:!previewWindow.minimized});report('Chapter ready.');return true;}catch(error){report(error.message);return false;}}
$('#play').onclick=()=>play();$('#play-node').onclick=()=>play(selected);$('#restart').onclick=()=>play();$('#stop').onclick=()=>preview.stop();
window.addEventListener('pagehide',()=>{autoplay.destroy();previewWindow.destroy();preview.destroy();});
render();graph.fit();if(loaded.error)report(loaded.error);else if(loaded.migrated)report('Legacy save loaded; original browser save preserved.');
