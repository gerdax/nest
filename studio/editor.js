import { DocumentHistory } from '../editor/DocumentHistory.js';
import { createDefinition } from '../project/cards.js';
import { createProject,createChapter,validateProject,parseProject,definitionUsers,exportChapter,importChapter } from '../project/model.js';
import { loadProject,saveProject } from '../project/storage.js';
import { GraphView } from './GraphView.js';
import { ProjectPreview } from './ProjectPreview.js';
import { definitionInspector,nodeInspector,variableInspector } from './inspectors.js';
import { esc } from './forms.js';
import { renderCardPreviews } from './card-preview.js';
import { bindImagePicker } from './image-picker.js';
import { uid,createNode,makePlacement,replaceCard,promoteCard,duplicateNode,findPlacement,pathTarget,synchronizeConnections,customizeAction,newRule,normalizeRule } from './commands.js';

const $=s=>document.querySelector(s),loaded=loadProject();
let project=loaded.project||createProject(),chapterId=project.activeChapterId,selected=project.chapters.find(c=>c.id===chapterId)?.startNode,definitionId=project.library.find(d=>d.visibility!=='local')?.id,mode='chapter';
const history=new DocumentHistory(project);
const chapter=()=>project.chapters.find(c=>c.id===chapterId)||project.chapters[0];
const node=()=>chapter().nodes.find(n=>n.id===selected);
const definition=()=>project.library.find(d=>d.id===definitionId);
const preview=new ProjectPreview($('#preview'),{onChange:()=>renderGraph()});
const graph=new GraphView($('#canvas'),{
 onSelect:id=>{selected=id;renderInspector();renderGraph();},
 onConnect:(id,exit,target)=>edit(()=>setConnection(chapter().nodes.find(n=>n.id===id),exit,target)),
 onMove:(id,x,y)=>edit(()=>Object.assign(chapter().nodes.find(n=>n.id===id),{x,y})),
});
function report(text){$('#save-status').textContent=text;}
function edit(fn){
 let failure;
 graph.cancel();
 try{history.transact(draft=>{project=draft;fn();synchronizeConnections(project);return project;});}
 catch(error){failure=error.message;}
 finally{project=history.document;}
 const saved=saveProject(project);render();report(failure|| (saved.ok?'Saved in this browser':`Save failed: ${saved.error}`));
}
function renderGraph(){if(mode==='chapter')graph.render(project,chapter(),selected,preview.state?.activeNodeId);}
function renderInspector(){
 const settingsOpen=$('#settings').querySelector('details')?.open;
 const inspectorKey=`${mode}:${mode==='library'?definitionId:selected}`;
 const sameInspector=$('#inspector').dataset.key===inspectorKey;
 const expanded=sameInspector?[...$('#inspector').querySelectorAll('details')].map((el,i)=>el.open?i:-1):[];
 $('#settings').innerHTML=variableInspector(project,chapter());
 $('#inspector').innerHTML=mode==='library'?definitionInspector(project,definition()):nodeInspector(project,chapter(),node());
 renderCardPreviews($('#inspector'),project,node());
 if(settingsOpen)$('#settings').querySelector('details').open=true;
 if(sameInspector)[...$('#inspector').querySelectorAll('details')].forEach((el,i)=>{el.open=expanded.includes(i);});
 $('#inspector').dataset.key=inspectorKey;
 if(!sameInspector)document.querySelector('aside').scrollTop=0;
 $('#selected-type').textContent=mode==='library'?'Shared definition':node()?.type||'';
}
function renderLibrary(){
 const query=$('#library-search').value.toLowerCase();
 $('#library-list').innerHTML=project.library.filter(d=>d.visibility!=='local'&&`${d.name} ${d.kind}`.toLowerCase().includes(query)).map(d=>`<button type="button" data-definition="${esc(d.id)}" class="library-entry ${d.id===definitionId?'selected':''}"><strong>${esc(d.name)}</strong><span>${esc(d.kind)} · ${definitionUsers(project,d.id).length} uses</span></button>`).join('');
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
 if(path==='definitionId'&&!el.value){renderInspector();return;}
 edit(()=>{
  if(scope==='connection'){setConnection(node(),path,el.value||null);return;}
  if(scope==='initial-toggle'){chapter().initialValues||={};if(el.checked)chapter().initialValues={...chapter().initialValues,[path]:project.variables.find(v=>v.id===path).initial};else delete chapter().initialValues[path];return;}
  if(scope==='initial-value'){const variable=project.variables.find(v=>v.id===path);const value=variable.type==='flag'?el.value==='true':Number(el.value);chapter().initialValues={...(chapter().initialValues||{}),[path]:value};return;}
  const root=scopeRoot(scope,el);if(!root)return;
  if(path==='itemBehaviour'){if(el.value==='consumable')root.use={effects:[],conditions:[]};else delete root.use;return;}
  const {parent,key}=pathTarget(root,path);let value=el.type==='checkbox'?el.checked:el.type==='number'||key==='sides'?Number(el.value):el.value;
  if((['value','initial'].includes(key)||path.startsWith('initialValues.'))&&['true','false'].includes(value))value=value==='true';
  if(el.type==='number'&&el.value===''){delete parent[key];return;}
  parent[key]=value;
  if(scope==='placement'&&key==='definitionId')delete root.overrides;
  if(key==='modifierVariable'&&!value)delete parent[key];
  if(key==='resolution'&&value==='check')parent.check||={pool:[{sides:20,count:1}],modifier:0,target:10};
  if(key==='type'&&['flag','number'].includes(value)){parent.initial=value==='flag'?false:0;delete parent.min;delete parent.max;}
  if(['source','op','key'].includes(key))normalizeRule(project,parent,key);
 });
}
for(const root of [$('#inspector'),$('#settings')])root.addEventListener('change',changeField);
for(const root of [$('#inspector'),$('#settings')])bindImagePicker(root,{
 onSelect(scope,placementId,path,value){
  edit(()=>{
   let target;
   if(scope==='local-definition'){const p=findPlacement(node(),placementId);target=project.library.find(d=>d.id===p?.definitionId);}
   else target=scope==='chapter'?chapter():scope==='definition'?definition():null;
   if(!target)throw new Error('Select the card again before choosing its image.');
   const {parent,key}=pathTarget(target,path);parent[key]=value;
  });
 },onError:report
});
function command(event){const b=event.target.closest('[data-command]');if(!b)return;const cmd=b.dataset.command;
 if(cmd==='edit-shared'){definitionId=b.dataset.definition;mode='library';render();return;}
 if(cmd==='jump-use'){chapterId=b.dataset.chapter;selected=b.dataset.node;mode='chapter';render();graph.fit();return;}
 edit(()=>{
  const n=node(),p=findPlacement(n||{},b.dataset.placement);
  if(cmd==='add-rule'){const root=scopeRoot(b.dataset.scope,b),{parent,key}=pathTarget(root,b.dataset.path);parent[key]||=[];parent[key].push(newRule(project,b.dataset.ruleKind));}
  if(cmd==='remove-rule'){const root=scopeRoot(b.dataset.scope,b),{parent,key}=pathTarget(root,b.dataset.path);parent[key].splice(Number(b.dataset.index),1);}
  if(cmd==='new-card'||cmd==='local-copy')replaceCard(project,p,b.dataset.kind,{copy:cmd==='local-copy'});
  if(cmd==='promote-card')promoteCard(project,p);
  if(cmd==='add-placement')n[b.dataset.slot].push(makePlacement(project,b.dataset.kind));
  if(cmd==='remove-placement')for(const slot of ['cards','choices','items'])if(n[slot])n[slot]=n[slot].filter(c=>c.id!==p.id);
  if(cmd==='move-placement')for(const slot of ['cards','choices','items'])if(n[slot]){const i=n[slot].findIndex(c=>c.id===p.id),j=i+Number(b.dataset.direction);if(i>=0&&j>=0&&j<n[slot].length)[n[slot][i],n[slot][j]]=[n[slot][j],n[slot][i]];}
  if(cmd==='variant'){const source=project.library.find(d=>d.id===p.definitionId),copy={...structuredClone(source),id:uid(source.kind),name:`${source.name} variant`};project.library.push(copy);p.definitionId=copy.id;}
  if(cmd==='customize')customizeAction(project,p);
  if(cmd==='reset-overrides')delete p.overrides;
  if(cmd==='add-route')n.routes.push({id:uid('route'),name:`Route ${n.routes.length+1}`,target:null,weight:1,conditions:[]});
  if(cmd==='remove-route')n.routes.splice(Number(b.dataset.index),1);
  if(cmd==='delete-definition'){if(definitionUsers(project,definitionId).length)throw new Error('Definition is still used.');project.library=project.library.filter(d=>d.id!==definitionId);definitionId=project.library.find(d=>d.visibility!=='local')?.id;}
  if(cmd==='add-variable')project.variables.push({id:uid('variable'),name:'New variable',type:'number',initial:0});
  if(cmd==='remove-variable')project.variables.splice(Number(b.dataset.index),1);
 });
}
for(const root of [$('#inspector'),$('#settings')])root.addEventListener('click',command);
$('#library-list').onclick=e=>{const b=e.target.closest('[data-definition]');if(b){definitionId=b.dataset.definition;renderLibrary();renderInspector();}};
$('#library-search').oninput=renderLibrary;
$('#chapter-view').onclick=()=>{mode='chapter';render();};$('#library-view').onclick=()=>{mode='library';render();};
$('#chapter-selector').onchange=e=>{preview.stop();chapterId=e.target.value;selected=project.chapters.find(c=>c.id===chapterId).startNode;edit(()=>{project.activeChapterId=chapterId;});graph.fit();};
$('#add-chapter').onclick=()=>edit(()=>{const c=createChapter(uid('chapter'),`Chapter ${project.chapters.length+1}`),n=createNode(project,'linear');c.nodes.push(n);c.startNode=n.id;project.chapters.push(c);chapterId=c.id;selected=n.id;project.activeChapterId=c.id;});
for(const b of document.querySelectorAll('[data-add-kind]'))b.onclick=()=>edit(()=>{const d=createDefinition(b.dataset.addKind,uid(b.dataset.addKind));project.library.push(d);definitionId=d.id;mode='library';});
for(const b of document.querySelectorAll('[data-add]'))b.onclick=()=>edit(()=>{const n=createNode(project,b.dataset.add,{x:(150-graph.view.x)/graph.view.z,y:(140-graph.view.y)/graph.view.z});chapter().nodes.push(n);if(!chapter().startNode)chapter().startNode=n.id;selected=n.id;});
$('#duplicate').onclick=()=>{if(node())edit(()=>{const n=duplicateNode(project,node());chapter().nodes.push(n);selected=n.id;});};
$('#delete').onclick=()=>{if(node())edit(()=>{const id=node().id;chapter().nodes=chapter().nodes.filter(n=>n.id!==id);for(const n of chapter().nodes){for(const key of Object.keys(n.connections||{}))if(n.connections[key]===id)n.connections[key]=null;for(const r of n.routes||[])if(r.target===id)r.target=null;if(n.fallback===id)n.fallback=null;}if(chapter().startNode===id)chapter().startNode=chapter().nodes[0]?.id||'';selected=chapter().startNode;});};
$('#start').onclick=()=>{if(node())edit(()=>{chapter().startNode=node().id;});};$('#fit').onclick=()=>graph.fit();
function travel(method){graph.cancel();if(history[method]()){project=history.document;saveProject(project);}render();}
$('#undo').onclick=()=>travel('undo');$('#redo').onclick=()=>travel('redo');
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-project').onclick=()=>{const errors=validateProject(project);if(errors.length){report('Fix validation errors before exporting.');return;}download(project,`${project.name.replace(/[^a-z0-9]+/gi,'-')}.nest.json`);};
$('#export-chapter').onclick=()=>{const errors=validateProject(project);if(errors.length){report('Fix validation errors before exporting.');return;}download(exportChapter(project,chapterId),`${chapter().name.replace(/[^a-z0-9]+/gi,'-')}.chapter.json`);};
$('#import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const text=await file.text(),raw=JSON.parse(text),incoming=parseProject(text);preview.stop();edit(()=>{project=raw.kind==='nest-project'?incoming:importChapter(project,raw);chapterId=project.activeChapterId;selected=chapter().startNode;});graph.fit();}catch(error){report(`Import rejected: ${error.message}`);}e.target.value='';};
function play(startNode){try{preview.play(project,chapterId,startNode);report('Chapter ready.');}catch(error){report(error.message);}}
$('#play').onclick=()=>play();$('#play-node').onclick=()=>play(selected);$('#restart').onclick=()=>play();$('#stop').onclick=()=>preview.stop();
window.addEventListener('pagehide',()=>preview.destroy());
render();graph.fit();if(loaded.error)report(loaded.error);else if(loaded.migrated)report('Legacy save loaded; original browser save preserved.');
