import { CardDrag } from './card-drag.js';
import { cardLabel } from './card-label.js';
import { uiScale } from './ui-scale.js';
import { esc } from './forms.js';
import { outputsForNode, labelForOutput } from '../project/model.js';
import { readBeatTarget } from '../project/beat-groups.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { nodeIcon } from './node-icons.js';
import { cardEditorTint,canonicalCardKind } from '../project/cards.js';
import { createLibraryIndex } from '../project/library-index.js';
import { cardRuleIndicators } from './card-rule-indicators.js';


/** Canvas interaction owns selection/pan, and emits completed document edits. */
export class GraphView {
 constructor(root,{onSelect,onConnect,onMove,onDuplicate=()=>{},onDuplicateMany=()=>{},onSelectMany=()=>{},onMoveMany=()=>{},onOpenCard=()=>{},onOpenDefinition=()=>{},onTransferCard=()=>{},onRemoveCard=()=>{},onDelete=()=>{},onDeleteMany=()=>{},onCreateConnected=()=>{},onCancelCreate=()=>{},onGroupCommand=()=>{},onBoundaryConnect=()=>{}}) {
  this.onGroupCommand=onGroupCommand;this.onBoundaryConnect=onBoundaryConnect;
  this.onDuplicate=onDuplicate;this.onDuplicateMany=onDuplicateMany;this.overrideNodeIds=new Set();this.nodeErrors=new Map();
  this.selectedIds=new Set();this.onSelectMany=onSelectMany;this.onMoveMany=onMoveMany;
  this.onCreateConnected=onCreateConnected;this.onCancelCreate=onCancelCreate;this.creation=null;
  this.root=root;this.onSelect=onSelect;this.onConnect=onConnect;this.onMove=onMove;this.onOpenCard=onOpenCard;this.lastPortClick=null;
  this.onOpenDefinition=onOpenDefinition;
  this.cardDrag=new CardDrag(this,onTransferCard,onRemoveCard);
  this.view={x:50,y:50,z:1};this.pending=null;this.drag=null;
  root.innerHTML='<div id="world"><svg id="edges"></svg><div id="beat-groups"></div><div id="nodes"></div></div>';
  root.addEventListener('pointerdown',e=>this.down(e));
  root.addEventListener('pointermove',e=>this.move(e));
  root.addEventListener('pointerup',e=>this.up(e));
  root.addEventListener('pointerleave',e=>{
   if(this.drag?.kind==='beat-group'&&this.drag.pointer===e.pointerId&&!this.drag.moved)this.drag=null;
  });
  for(const event of ['pointercancel','lostpointercapture'])root.addEventListener(event,e=>{if(this.drag?.pointer===e.pointerId)this.cancel();});
  root.addEventListener('keydown',e=>{
   if(['Enter',' '].includes(e.key)){this.cardDrag.suppressClick=false;this.suppressSelectionClick=false;}
   if(e.key==='Escape')this.cancel();
   if(!['Delete','Backspace'].includes(e.key)||e.defaultPrevented||e.repeat||e.isComposing||e.ctrlKey||(e.metaKey&&e.key!=='Backspace')||e.altKey||e.shiftKey||this.drag)return;
   if(e.target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
   if(this.groupsById?.has(this.selectedGroupId)){
    e.preventDefault();
    this.onGroupCommand('ungroup-beats',{id:this.selectedGroupId});
    root.focus({preventScroll:true});
    return;
   }
   if(!this.nodesById?.has(this.selected))return;
   const ids=[...this.selectedIds].filter(id=>this.nodesById.has(id));
   e.preventDefault();
   if(ids.length>1)onDeleteMany(ids);else onDelete(this.selected);
   // Deletion redraws node buttons; keep subsequent keyboard input on the graph.
   root.focus({preventScroll:true});
  });
  root.addEventListener('click',e=>{
   if(this.suppressSelectionClick){this.suppressSelectionClick=false;e.preventDefault();return;}
   if(this.cardDrag.consumeClick()){e.preventDefault();return;}
   const groupHeader=e.target.closest('.beat-group-header');
   if(groupHeader){
    if(e.detail===0)this.toggleGroup(groupHeader);
    return;
   }
   const definitionLink=e.target.closest('.graph-definition-link');
   if(definitionLink){
    e.preventDefault();this.lastPortClick=null;
    const node=this.nodesById.get(definitionLink.closest('.node')?.dataset.id);
    const enemy=node?.type==='combat'&&this.project.library.find(d=>d.id===node.enemy?.definitionId&&d.kind==='enemy'&&d.visibility!=='local');
    if(enemy)this.onOpenDefinition(enemy.id,node.id);
    return;
   }
   const port=e.target.closest('.port');
   if(port&&e.detail===0){
    const source=this.nodesById.get(port.closest('.node')?.dataset.id);
    const target=source&&this.target(source,port.dataset.exit);
    if(this.nodesById.has(target))this.onSelect(target);
    return;
   }
   const name=e.target.closest('.graph-card-name'),node=name?.closest('.node'),row=name?.closest('.graph-card-row');
   if(node&&row){this.lastPortClick=null;this.openCard(node.dataset.id,row.dataset.cardPlacement);}
  });
  root.addEventListener('dblclick',e=>{
   const groupHeader=e.target.closest('.beat-group-header');
   if(groupHeader&&!this.drag){e.preventDefault();this.toggleGroup(groupHeader);return;}
   const edge=e.target.closest('.edge-hit');
   if(!edge||this.drag)return;
   e.preventDefault();this.lastPortClick=null;
   if(edge.dataset.groupSource)this.onBoundaryConnect({source:{groupId:edge.dataset.groupSource,port:edge.dataset.groupPort},target:false});
   else this.onConnect(edge.dataset.source,edge.dataset.exit,false);
  });
  root.addEventListener('wheel',e=>{this.lastCanvasClick=null;if(this.drag?.kind==='select'){e.preventDefault();return;}this.cancelCreation();e.preventDefault();const r=root.getBoundingClientRect(),scale=uiScale(root),x=(e.clientX-r.left)/scale,y=(e.clientY-r.top)/scale,old=this.view.z;this.view.z=Math.max(.25,Math.min(1.6,old*Math.exp(-e.deltaY*.001)));this.view.x=x-(x-this.view.x)*this.view.z/old;this.view.y=y-(y-this.view.y)*this.view.z/old;this.transform();},{passive:false});
 }
 render(project,chapter,selected,active) {
  const chapterKey=chapter.id??chapter;
  if(this.selectionChapter!==chapterKey||selected!==this.selected)this.lastCanvasClick=null;
  if(this.selectionChapter!==chapterKey||selected!==this.selected)this.selectedIds=new Set(selected?[selected]:[]);
  this.selectionChapter=chapterKey;
  this.selectedIds=new Set([...this.selectedIds].filter(id=>chapter.nodes.some(node=>node.id===id)));
  if(this.chapter?.id!==chapter.id||!active)this.activeAuto=null;
  this.project=project;this.chapter=chapter;this.selected=selected;this.active=active;
  const playableNodes=chapter.nodes.filter(node=>node.type!=='death'||project.showDeathBeat!==false);
  this.nodesById=new Map(playableNodes.map(node=>[node.id,node]));
  this.selectedIds=new Set([...this.selectedIds].filter(id=>this.nodesById.has(id)));
  this.groupsById=new Map((chapter.beatGroups||[]).map(group=>[group.id,group]));
  this.groupsByMember=new Map([...this.groupsById.values()].flatMap(group=>group.memberIds.map(id=>[id,group])));
  this.boundaryOutputs=new Map();
  for(const group of this.groupsById.values())for(const [port,bindings] of [['input',group.incoming],['output',group.outgoing]]){
   for(const {nodeId,output} of bindings){
    if(!this.boundaryOutputs.has(nodeId))this.boundaryOutputs.set(nodeId,new Map());
    this.boundaryOutputs.get(nodeId).set(output,{groupId:group.id,port});
   }
  }
  const visibleNodes=playableNodes.filter(node=>!this.groupsByMember.get(node.id)?.collapsed);
  this.libraryIndex=createLibraryIndex(project.library);
  this.definitionsById=new Map(project.library.map(definition=>[definition.id,definition]));
  if(this.pending&&!chapter.nodes.some(n=>n.id===this.pending.nodeId&&outputsForNode(project,n,this.libraryIndex).includes(this.pending.exit)))this.pending=null;
  this.root.querySelector('#nodes').innerHTML=visibleNodes.map(n=>`<article class="node ${n.type} ${!this.selectedGroupId&&this.selectedIds.has(n.id)?'selected':''} ${(n.id===active||n.id===this.activeAuto)?'active':''}" data-id="${esc(n.id)}" style="left:${this.position(n).x}px;top:${this.position(n).y}px"><div class="node-heading">${nodeIcon(n.type)}<span class="badge">${n.id===chapter.startNode?'<span class="graph-start-label">START</span> · ':''}${esc(n.name?.trim()||nodeTypeLabel(n.type))}</span>${this.overrideMarker(n.id)}</div>${n.type==='random'?`<div class="node-body">${n.routes.length} ${n.routes.length===1?'route':'routes'}</div>`:n.type.startsWith('legacy')?'<div class="node-body">Preserved legacy behaviour</div>':''}${this.cardRows(n)}</article>`).join('');
  this.nodeElements=new Map([...this.root.querySelectorAll('.node')].map(el=>[el.dataset.id,el]));
  this.renderGroups();
  this.setNodeErrors(this.nodeErrors);
  this.portElements=new Map([...this.nodeElements].map(([id,el])=>[id,new Map([...el.querySelectorAll('.port')].map(port=>[port.dataset.exit,port]))]));
  this.setActiveCard(this.activeCard);
  this.transform();this.edges();
 }
 overrideMarker(id) {
  if(!this.overrideNodeIds.has(id))return '';
  const ignored=this.project.ignoreAllOverrides===true;
  const label=ignored?'Overrides configured (ignored)':'Overrides configured';
  return `<span class="graph-override-marker${ignored?' ignored':''}" role="img" aria-label="${label}" title="${label}">*</span>`;
 }
 // Preview notifications change only these classes. Keep the graph DOM, focus,
 // viewport and in-flight gestures intact, including repeated same-node updates.
 setActive(active, auto = null) {
  if(this.active===active&&this.activeAuto===auto)return;
  const previous=new Set([this.active,this.activeAuto]);
  const next=new Set([active,auto]);
  this.active=active;
  this.activeAuto=auto;
  for(const id of previous)if(!next.has(id))this.nodeElements?.get(id)?.classList.toggle('active',false);
  for(const id of next)if(!previous.has(id))this.nodeElements?.get(id)?.classList.toggle('active',true);
  this.syncGroupStates();
 }
 // Validation and playback update errors without disturbing focus or gestures.
 // The caller supplies only errors belonging to the displayed chapter.
 setNodeErrors(errors) {
  this.nodeErrors=new Map([...errors].map(([id,messages])=>[id,[...messages]]));
  for(const [id,element] of this.nodeElements||[]){
   const message=(this.nodeErrors.get(id)||[]).join('\n');
   element.classList.toggle('has-error',!!message);
   if(message){
    element.setAttribute('aria-invalid','true');
    element.setAttribute('aria-description',message);
    element.setAttribute('data-error-message',message);
    element.setAttribute('title',message);
   }else{
    for(const name of ['aria-invalid','aria-description','data-error-message','title'])element.removeAttribute(name);
   }
  }
  this.syncGroupStates();
 }
 // Match authored placements, so equal names and shared definitions stay distinct.
 setActiveCard(target) {
  this.activeCard=target?.chapterId===this.chapter?.id?target:null;
  const node=this.activeCard&&this.nodeElements?.get(this.activeCard.nodeId);
  const row=node?[...node.querySelectorAll('.graph-card-row')].find(row=>row.dataset.cardPlacement===this.activeCard.placementId):null;
  this.syncActiveEdges();
  if(this.activeCardElement===row)return;
  this.activeCardElement?.classList.toggle('preview-active',false);
  row?.classList.toggle('preview-active',true);
  this.activeCardElement=row;
 }
 // Only authored exits belonging to this placement are relevant to playback.
 activeCardExits() {
  const target=this.activeCard,node=target&&this.nodesById?.get(target.nodeId);
  if(!node||target.chapterId!==this.chapter?.id)return [];
  if(node.type==='fork'&&node.choices?.some(card=>card.id===target.placementId))
   return outputsForNode(this.project,node,this.libraryIndex).filter(exit=>exit===target.placementId||exit===`${target.placementId}:success`||exit===`${target.placementId}:failure`);
  if(node.type==='linear'&&node.cards?.at(-1)?.id===target.placementId)return ['next'];
  if(node.type==='container'&&node.items?.some(card=>card.id===target.placementId))return ['next'];
  return [];
 }
 syncActiveEdges() {
  const exits=new Set(this.activeCardExits());
  const next=new Set((this.edgeElements||[]).filter(edge=>edge.dataset.source===this.activeCard?.nodeId&&exits.has(edge.dataset.exit)));
  for(const edge of this.activeEdges||[])if(!next.has(edge))edge.classList.toggle('preview-active',false);
  for(const edge of next)if(!this.activeEdges?.has(edge))edge.classList.toggle('preview-active',true);
  this.activeEdges=next;
 }
 target(n,exit) {return readBeatTarget(n,exit);}
 portLabel(node,exit){
  const boundary=this.boundaryOutputs?.get(node.id)?.get(exit);
  if(boundary)return `${this.groupsById.get(boundary.groupId)?.name} ${boundary.port==='input'?'In':'Out'}`;
  const target=this.target(node,exit);return target===null?'End chapter':this.nodesById.get(target)?.name||'Unlinked';}
 unlinked(node,exit){if(this.boundaryOutputs?.get(node.id)?.has(exit))return false;const target=this.target(node,exit);return target!==null&&!this.nodesById.has(target);}
 port(node,exit,label=null){
  const target=esc(this.portLabel(node,exit)),name=esc(labelForOutput(this.project,node,exit,this.libraryIndex));
  if(exit.endsWith(':success')||exit.endsWith(':failure')||node.type==='combat'&&['victory','failure'].includes(exit))label='';
  return `<button class="port ${this.unlinked(node,exit)?'unlinked':''}" data-exit="${esc(exit)}" aria-label="${name} → ${target}">${label===null?`${exit==='next'?'':name+' '}→ ${target}`:`${label?`${esc(label)} | `:'→ '}${target}`}</button>`;
 }
 cardRows(node){
  const descriptor=nodeTypeDescriptor(node.type),outputs=outputsForNode(this.project,node,this.libraryIndex),used=new Set();
  const enemy=node.type==='combat'&&this.definitionsById.get(node.enemy?.definitionId);
  let html=node.type==='combat'?`<div class="node-body">${enemy?.kind==='enemy'&&enemy.visibility!=='local'?`<button type="button" class="graph-definition-link" title="Open Enemy in Library">${esc(enemy.name||'Untitled Enemy')} ↗</button>`:'None'}</div>`:'';
  for(const slot of Object.keys(descriptor?.slots||{})){
   const placements=slot==='intro'?(node.intro&&node.introEnabled!==false?[node.intro]:[]):node[slot]||[];
   for(const placement of placements){
    const definition=this.definitionsById.get(placement.definitionId)||placement;
    const kind=canonicalCardKind(definition.kind||definition.cardKind||descriptor.defaultKinds[slot]);
    const name=this.definitionsById.has(placement.definitionId)?cardLabel(definition):'Missing card';
    const source=this.definitionsById.has(placement.definitionId)?definition.visibility==='local'?'local':'library':'missing';
    const customRules=source==='library'&&!!placement.overrides;
    const indicators=cardRuleIndicators(this.project,placement,this.libraryIndex);
    const tag=kind==='item'?(this.project.itemTags||[]).find(tag=>tag.id===definition.tagId):null;
    const indicatorText=indicators.map(([letter])=>letter==='T'?'<span data-rule-marker="T">T</span>':esc(letter)).join(' · ');
    const indicatorLabel=indicators.map(([letter,label])=>`${letter}: ${label}`).join('; ');
    const exits=slot==='choices'?outputs.filter(exit=>exit===placement.id||exit===`${placement.id}:success`||exit===`${placement.id}:failure`):[];
    for(const exit of exits)used.add(exit);
    html+=`<hr class="graph-card-divider"><div class="graph-card-row ${exits.length?'has-outputs':''}" data-card-slot="${esc(slot)}" data-card-placement="${esc(placement.id||'')}" data-card-type="${esc(kind)}" data-card-source="${source}" style="--card-editor-tint:${esc(cardEditorTint(kind))}"><div class="graph-card-label"><button type="button" class="graph-card-name">${slot==='intro'?'<small>Introduction</small>':''}${esc(name)}${customRules?' <span class="graph-card-custom-marker" role="img" aria-label="Custom rules enabled" title="Custom rules enabled">*</span>':''}</button>${tag?`<small class="graph-item-tag" title="Tag: ${esc(tag.name)}">[${esc(tag.name)}]</small>`:''}${indicatorText?`<small class="graph-card-rules" role="img" aria-label="${esc(indicatorLabel)}" title="${esc(indicatorLabel)}">${indicatorText}</small>`:''}</div>`;
    if(slot==='intro'&&node.introOnce===true)html+='<span class="graph-intro-once" role="img" aria-label="Introduction shown once" title="Show once"><svg viewBox="0 0 12 16" aria-hidden="true" focusable="false"><path d="M1 0h10v2H1zM2 3h8L6 8zm4 5 4 5H2zM1 14h10v2H1z"/></svg></span>';
    if(exits.length)html+=`<div class="graph-card-outputs">${exits.map(exit=>this.port(node,exit,'')).join('')}</div>`;
    html+='</div>';
   }
  }
  const remaining=outputs.filter(exit=>!used.has(exit));
  if(html&&remaining.length)html+='<hr class="graph-card-divider">';
  return html+remaining.map(exit=>this.port(node,exit)).join('');
 }
 position(n) {if(this.drag?.positions?.has(n.id))return this.drag.positions.get(n.id);return this.drag?.kind==='node'&&!this.drag.copy&&this.drag.id===n.id?{x:this.drag.px,y:this.drag.py}:n;}
 point(e) {const r=this.root.getBoundingClientRect(),scale=uiScale(this.root);return {x:((e.clientX-r.left)/scale-this.view.x)/this.view.z,y:((e.clientY-r.top)/scale-this.view.y)/this.view.z};}
 wire(x,y,tx,ty) {return `M${x},${y} C${x+90},${y} ${tx-90},${ty} ${tx},${ty}`;}
 outputPoint(n,exit) {
  const port=this.portElements.get(n.id)?.get(exit);
  if(port){const r=port.getBoundingClientRect();if(r.width&&r.height)return this.point({clientX:r.right,clientY:r.top+r.height/2});}
  const pos=this.position(n);return {x:pos.x+220,y:pos.y+104+outputsForNode(this.project,n,this.libraryIndex).indexOf(exit)*29};
 }
 renderGroups() {
  const layer=this.root.querySelector('#beat-groups');
  if(!layer)return;
  layer.innerHTML=[...this.groupsById.values()].map(group=>{
   const {id,name,collapsed}=group;
   return `<div class="beat-group${collapsed?' collapsed':''}" data-group-id="${esc(id)}">
    <button type="button" class="beat-group-header" aria-expanded="${!collapsed}" title="Drag to move. Alt-drag to duplicate. Double-click to ${collapsed?'expand':'collapse'}">
     <span class="beat-group-name">${esc(name)}</span>
     ${collapsed?`<span class="beat-group-count">${group.memberIds.length} ${group.memberIds.length===1?'beat':'beats'}</span>`:''}
    </button>
    <button type="button" class="beat-group-port" data-port="input" aria-label="${esc(name)} Group In" title="${collapsed?'Connect an outside outcome here':'Connect an outside outcome here, or drag from here to the entry beat'}"></button>
    <button type="button" class="beat-group-port" data-port="output" aria-label="${esc(name)} Group Out" title="${collapsed?'Drag to an outside beat or group input':'Connect a member outcome here, or drag from here to the outside destination'}"></button>
   </div>`;
  }).join('');
  this.groupElements=new Map([...layer.querySelectorAll('.beat-group')].map(el=>[el.dataset.groupId,el]));
  this.layoutGroups();
 }
 groupBounds(group) {
  const scale=this.view.z*uiScale(this.root);
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const id of group.memberIds){
   const node=this.nodesById.get(id);
   if(!node)continue;
   const {x,y}=this.position(node),el=this.nodeElements.get(id);
   const width=el?.offsetWidth||220,height=el?.offsetHeight||(el?.getBoundingClientRect().height/scale||120);
   left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+width);bottom=Math.max(bottom,y+height);
  }
  if(!Number.isFinite(left))return null;
  return {x:left-30,y:top-72,width:group.collapsed?240:Math.max(320,right-left+60),height:group.collapsed?50:bottom-top+104};
 }
 layoutGroups() {
  this.groupRects=new Map();
  for(const [id,element] of this.groupElements||[]){
   const rect=this.groupBounds(this.groupsById.get(id));
   if(!rect)continue;
   this.groupRects.set(id,rect);
   Object.assign(element.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  }
 }
 syncGroupStates() {
  for(const [id,element] of this.groupElements||[]){
   const group=this.groupsById.get(id),messages=[...(this.nodeErrors.get(id)||[]),...group.memberIds.flatMap(member=>this.nodeErrors.get(member)||[])];
   element.classList.toggle('active',group.memberIds.includes(this.active)||group.memberIds.includes(this.activeAuto));
   element.classList.toggle('selected',id===this.selectedGroupId);
   element.classList.toggle('has-error',!!messages.length);
   if(messages.length){
    const message=messages.join('\n');
    element.setAttribute('aria-invalid','true');element.setAttribute('aria-description',message);element.setAttribute('title',message);
   }else for(const name of ['aria-invalid','aria-description','title'])element.removeAttribute(name);
  }
 }
 toggleGroup(header) {
  const group=this.groupsById.get(header.closest('.beat-group').dataset.groupId);
  if(!group)return;
  if(this.selectedGroupId!==group.id)this.selectGroup(group);
  this.onGroupCommand('collapse-beat-group',{id:group.id,collapsed:!group.collapsed});
  this.root.focus({preventScroll:true});
 }
 selectGroup(group) {
  const ids=[...group.memberIds];
  this.selectedIds=new Set(ids);this.selected=ids[0];this.selectedGroupId=group.id;
  for(const element of this.nodeElements.values())element.classList.toggle('selected',false);
  this.syncGroupStates();
  this.onSelectMany(ids,group.id);
 }
 boundaryPoint({groupId,port}) {
  const rect=this.groupRects?.get(groupId);
  if(!rect)return null;
  // The same connector joins the two segments at the border.
  const portOffset=this.groupsById.get(groupId)?.collapsed?rect.height/2:72;
  return {x:rect.x+(port==='output'?rect.width:0),y:rect.y+portOffset};
 }
 connectionPoint(endpoint,source) {
  if(endpoint.groupId)return this.boundaryPoint(endpoint);
  const node=this.nodesById.get(endpoint.nodeId);
  if(!node||this.groupsByMember?.get(node.id)?.collapsed)return null;
  if(source)return this.outputPoint(node,endpoint.output);
  const to=this.position(node);return {x:to.x,y:to.y+40};
 }
 visibleWire(source,target) {
  const from=this.connectionPoint(source,true),to=this.connectionPoint(target,false);
  if(!from||!to)return '';
  const path=this.wire(from.x,from.y,to.x,to.y);
  const data=source.nodeId?`data-source="${esc(source.nodeId)}" data-exit="${esc(source.output)}"`
   :`data-group-source="${esc(source.groupId)}" data-group-port="${esc(source.port)}"`;
  return `<path class="edge-line" ${data} d="${path}"/><path class="edge-hit" ${data} d="${path}"/>`;
 }
 edges() {
  const paths=[];
  for(const node of this.chapter.nodes){
   if(this.groupsByMember?.get(node.id)?.collapsed)continue;
   for(const exit of outputsForNode(this.project,node,this.libraryIndex)){
    const target=this.boundaryOutputs?.get(node.id)?.get(exit);
    const nodeId=this.target(node,exit);
    if(target||this.nodesById.has(nodeId))paths.push(this.visibleWire({nodeId:node.id,output:exit},target||{nodeId}));
   }
  }
  for(const group of this.groupsById?.values()||[]){
   if(!group.collapsed&&group.entryId)paths.push(this.visibleWire({groupId:group.id,port:'input'},{nodeId:group.entryId}));
   if(group.destination)paths.push(this.visibleWire({groupId:group.id,port:'output'},group.destination.groupId
    ?{groupId:group.destination.groupId,port:'input'}:{nodeId:group.destination.nodeId}));
  }
  const d=this.creation||this.drag;
  if(d?.kind==='connect'&&d.moved){
   const from=this.connectionPoint(d.source||{nodeId:d.nodeId,output:d.exit},true);
   if(from)paths.push(`<path class="edge-ghost" d="${this.wire(from.x,from.y,d.px,d.py)}"/>`);
  }
  if(d?.kind==='select'&&d.moved){const r=this.selectionRect(d);paths.push(`<rect class="graph-selection-box" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`);}
  this.root.querySelector('#edges').innerHTML=paths.join('');
  this.edgeElements=[...this.root.querySelector('#edges').querySelectorAll('.edge-line')];
  this.syncActiveEdges();
 }
 transform(){
  const world=this.root.querySelector('#world');
  world.style.transform=`translate(${this.view.x}px,${this.view.y}px) scale(${this.view.z})`;
  // Compensate for graph and editor zoom so selection stays two screen pixels wide.
  world.style.setProperty('--graph-selection-width',`${2/(this.view.z*uiScale(this.root))}px`);
 }
 validTarget(id,source) {return (id!==source||this.project.allowCycles!==false)&&this.nodesById.has(id);}
 connectionDrop(e,source) {
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return null;
  const hit=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY);
  if(!hit||!this.root.contains(hit))return null;
  const port=hit.closest('.beat-group-port');
  const sourceGroup=this.groupsByMember?.get(source.nodeId)?.id;
  if(port){
   const groupId=port.closest('.beat-group').dataset.groupId,targetPort=port.dataset.port;
   if(source.nodeId&&(sourceGroup===groupId?targetPort==='output':!sourceGroup&&targetPort==='input')){
    return {groupId,port:targetPort};
   }
   if(source.port==='output'&&source.groupId!==groupId&&targetPort==='input')return {groupId,port:targetPort};
   return null;
  }
  const nodeId=hit.closest('.node')?.dataset.id;
  if(!nodeId||!this.validTarget(nodeId,source.nodeId))return null;
  const targetGroup=this.groupsByMember?.get(nodeId)?.id;
  if(source.nodeId?sourceGroup===targetGroup:source.port==='input'?targetGroup===source.groupId:!targetGroup)return {nodeId};
  return null;
 }
 hoverTarget(target) {
  for(const el of this.root.querySelectorAll('.node'))el.classList.toggle('connection-target',el.dataset.id===target?.nodeId);
  for(const [id,group] of this.groupElements||[]){
   for(const port of group.querySelectorAll('.beat-group-port'))port.classList.toggle('connection-target',id===target?.groupId&&port.dataset.port===target?.port);
  }
 }
 setDraggingCursor(active) {
  this.root.classList.toggle('graph-dragging',active);
  this.root.ownerDocument?.documentElement?.classList?.toggle('graph-dragging',active);
 }
 down(e) {
  if(e.button!==0||this.drag)return;
  this.cancelCreation();
  this.suppressSelectionClick=false;
  if(e.target.closest('.graph-definition-link')){this.cardDrag.suppressClick=false;return;}
  const groupElement=e.target.closest('.beat-group');
  if(groupElement){
   const group=this.groupsById.get(groupElement.dataset.groupId),port=e.target.closest('.beat-group-port');
   this.lastCanvasClick=null;this.lastPortClick=null;this.cardDrag.suppressClick=false;
   if(port){
    if(group.collapsed&&port.dataset.port==='input')return;
    this.beginConnection(e,{groupId:group.id,port:port.dataset.port});
   }else if(group.collapsed||e.target.closest('.beat-group-header')){
    this.selectGroup(group);
    this.drag={kind:'beat-group',groupId:group.id,copy:e.altKey,x:e.clientX,y:e.clientY,pointer:e.pointerId,dx:0,dy:0,
     origins:new Map(group.memberIds.map(id=>{const node=this.nodesById.get(id);return [id,{x:node.x,y:node.y}];}))};
    // Leave stationary presses uncaptured so the bar receives a native double-click.
   }
   return;
  }
  const el=e.target.closest('.node'),port=e.target.closest('.port'),edge=e.target.closest('.edge-hit');
  const previous=this.lastCanvasClick,time=e.timeStamp??performance.now(),pointerType=e.pointerType??'mouse';
  this.lastCanvasClick=null;
  // PointerEvent.detail is not a portable click count. Arm this gesture only
  // after a completed stationary blank click, never after a pan or node click.
  const doubleDrag=!el&&!port&&!edge&&!e.altKey&&!e.shiftKey&&pointerType!=='touch'
   &&previous&&previous.chapter===(this.chapter.id??this.chapter)&&previous.pointerType===pointerType
   &&time>=previous.time&&time-previous.time<=450&&Math.hypot(e.clientX-previous.x,e.clientY-previous.y)<=5;
  if(!port)this.lastPortClick=null;
  if(((e.metaKey||e.ctrlKey)&&!e.altKey)||doubleDrag){
   const p=this.point(e);
   this.drag={kind:'select',pointer:e.pointerId,x:e.clientX,y:e.clientY,start:p,end:p,moved:false,nodeId:el?.dataset.id,before:new Set(this.selectedIds)};
   this.suppressSelectionClick=true;this.cardDrag.suppressClick=false;
   this.setDraggingCursor(true);this.root.setPointerCapture(e.pointerId);this.root.focus({preventScroll:true});e.preventDefault();return;
  }
  const name=e.target.closest('.graph-card-name');
  if(name){if(this.cardDrag.start(e,name))this.setDraggingCursor(true);return;}
  this.cardDrag.suppressClick=false;
  if(edge)return;
  if(port){this.beginConnection(e,{nodeId:el.dataset.id,output:port.dataset.exit});return;}
  if(el){
   const copy=e.altKey&&!!e.target.closest('.node-heading');
   if(copy&&[...this.selectedIds,el.dataset.id].some(id=>this.nodesById.get(id)?.type==='death'||!this.nodeElements.has(id)))return;
   const id=el.dataset.id,group=!this.selectedGroupId&&this.selectedIds.size>1&&this.selectedIds.has(id);
   if(!group)this.onSelect(id);
   const n=this.nodesById.get(id);
   this.drag={kind:'node',id,copy,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,px:n.x,py:n.y,pointer:e.pointerId};
   if(group){this.drag.origins=new Map((copy?[id,...[...this.selectedIds].filter(other=>other!==id)]:[...this.selectedIds]).map(id=>{const n=this.nodesById.get(id);return [id,{x:n.x,y:n.y}];}));if(!copy)this.drag.positions=new Map(this.drag.origins);}
  }
  else{this.pending=null;this.drag={kind:'pan',x:e.clientX,y:e.clientY,ox:this.view.x,oy:this.view.y,pointer:e.pointerId,moved:false,pointerType,doubleEligible:!e.altKey&&!e.shiftKey&&pointerType!=='touch'};}
  this.setDraggingCursor(true);
  this.root.setPointerCapture(e.pointerId);
  this.root.focus({preventScroll:true});
 }
 beginConnection(e,source) {
  this.pending=null;const p=this.point(e);
  this.drag={kind:'connect',source,nodeId:source.nodeId,exit:source.output,fromPort:true,x:e.clientX,y:e.clientY,px:p.x,py:p.y,moved:false,pointer:e.pointerId};
  // Capture on the stable root before replacing port markup.
  this.setDraggingCursor(true);this.root.setPointerCapture(e.pointerId);this.root.focus({preventScroll:true});
  this.render(this.project,this.chapter,this.selected,this.active);e.preventDefault();
 }
 move(e,capture=true) {
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='card'){this.cardDrag.move(e);return;}
  if(d.kind==='select'){this.updateBoxSelection(e);return;}
  if(d.kind==='connect'){
   d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
   const p=this.point(e);d.px=p.x;d.py=p.y;this.hoverTarget(d.moved?this.connectionDrop(e,d.source):null);this.edges();
  }else if(d.kind==='pan'){d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;const scale=uiScale(this.root);this.view.x=d.ox+(e.clientX-d.x)/scale;this.view.y=d.oy+(e.clientY-d.y)/scale;this.transform();}
  else{
   const scale=this.view.z*uiScale(this.root),dx=(e.clientX-d.x)/scale,dy=(e.clientY-d.y)/scale;
   if(d.kind==='beat-group'){
    if(!d.moved){
     if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<=4)return;
     d.moved=true;
     if(capture)this.root.setPointerCapture(e.pointerId);
     this.setDraggingCursor(true);
    }
    d.dx=dx;d.dy=dy;
   }else{d.px=d.ox+dx;d.py=d.oy+dy;}
   if(d.copy){
    d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
    if(!d.moved)return;
    if(!d.ghosts){
     d.ghosts=new Map();
     for(const id of d.origins?.keys()||[d.id]){
      const element=this.nodeElements.get(id);
      if(!element)continue; // Members of a collapsed group are hidden.
      const ghost=element.cloneNode(true);
      ghost.removeAttribute('data-id');ghost.classList.remove('active');
      ghost.style.pointerEvents='none';ghost.style.opacity='.7';
      ghost.setAttribute('aria-hidden','true');
      this.root.querySelector('#nodes').appendChild(ghost);d.ghosts.set(id,ghost);
     }
     d.ghost=d.ghosts.get(d.id);
     if(d.kind==='beat-group'){
      const element=this.groupElements.get(d.groupId);
      const ghost=element.cloneNode(true);
      ghost.removeAttribute('data-group-id');
      ghost.classList.remove('active');
      ghost.setAttribute('aria-hidden','true');
      ghost.inert=true;
      Object.assign(ghost.style,{pointerEvents:'none',opacity:'.7',width:element.style.width,height:element.style.height});
      this.root.querySelector('#beat-groups').appendChild(ghost);
      d.groupGhost=ghost;
     }
    }
    if(d.groupGhost){
     const rect=this.groupRects.get(d.groupId);
     d.groupGhost.style.left=`${rect.x+dx}px`;
     d.groupGhost.style.top=`${rect.y+dy}px`;
    }
    for(const [id,ghost] of d.ghosts){
     const origin=d.origins?.get(id)||{x:d.ox,y:d.oy};
     ghost.style.left=`${origin.x+dx}px`;ghost.style.top=`${origin.y+dy}px`;
    }
    return;
   }
   const positions=d.origins?new Map([...d.origins].map(([id,p])=>[id,{x:p.x+dx,y:p.y+dy}])):new Map([[d.id,{x:d.px,y:d.py}]]);
   if(d.origins)d.positions=positions;
   for(const [id,p] of positions){const el=this.nodeElements.get(id);if(el){el.style.left=`${p.x}px`;el.style.top=`${p.y}px`;}}
   this.layoutGroups();this.edges();
  }
 }
 up(e){
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='pan'||d.kind==='beat-group')this.move(e,false);
  if(d.copy&&d.kind==='node')this.move(e);
  if(d.kind==='select')this.updateBoxSelection(e);
  if(d.kind==='connect')d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
  const target=d.kind==='connect'&&d.moved?this.connectionDrop(e,d.source):null;
  this.drag=null;
  this.setDraggingCursor(false);
  if(this.root.hasPointerCapture(e.pointerId))this.root.releasePointerCapture(e.pointerId);
  if(d.kind==='card'){this.cardDrag.finish(e,d);return;}
  if(d.kind==='select'){
   if(!d.moved){this.selectedIds=new Set(d.before);if(d.nodeId){if(this.selectedIds.has(d.nodeId))this.selectedIds.delete(d.nodeId);else this.selectedIds.add(d.nodeId);}else this.selectedIds.clear();}
   this.selected=[...this.selectedIds][0];this.onSelectMany([...this.selectedIds]);this.edges();return;
  }
  if(d.kind==='connect'){
   if(d.moved)this.pending=null;
   this.render(this.project,this.chapter,this.selected,this.active);
   if(target){
    if(d.nodeId&&target.nodeId)this.onConnect(d.nodeId,d.exit,target.nodeId);
    else this.onBoundaryConnect({source:d.source,target});
   }else if(d.source.groupId){
    if(d.moved&&this.blankDrop(e))this.onBoundaryConnect({source:d.source,target:false});
   }else if(d.moved&&this.blankDrop(e)){
    if(this.unlinked(this.nodesById.get(d.nodeId),d.exit)){
     if(this.groupsByMember?.has(d.nodeId))return;
     const position=this.point(e);
     this.creation={...d,px:position.x,py:position.y};this.edges();
     this.onCreateConnected({id:d.nodeId,exit:d.exit,position,clientX:e.clientX,clientY:e.clientY});
    }else this.onConnect(d.nodeId,d.exit,false);
   }
   else if(!d.moved&&d.fromPort)this.activatePort(d.nodeId,d.exit,e.timeStamp??performance.now(),e.clientX,e.clientY);
   if(d.moved)this.lastPortClick=null;
  }else if(d.kind==='beat-group'){
   if(d.copy){
    d.groupGhost?.remove();
    for(const ghost of d.ghosts?.values()||[])ghost.remove();
    if(d.moved){
     const ids=[...d.origins.keys()],origin=d.origins.get(ids[0]);
     this.onDuplicateMany(ids,{x:origin.x+d.dx,y:origin.y+d.dy});
    }
   }else if(d.moved)this.onGroupCommand('move-beat-group',{id:d.groupId,dx:d.dx,dy:d.dy});
   this.root.focus({preventScroll:true});
  }else if(d.kind==='node'){
   if(d.copy){
    for(const ghost of d.ghosts?.values()||[])ghost.remove();
    if(d.moved){
     const position={x:d.px,y:d.py};
     if(d.origins)this.onDuplicateMany([...d.origins.keys()],position);else this.onDuplicate(d.id,position);
    }
   }
   else if(d.origins)this.onMoveMany([...d.positions].map(([id,p])=>({id,...p})));
   else this.onMove(d.id,d.px,d.py);
  }else if(d.kind==='pan'&&!d.moved){
   this.view.x=d.ox;this.view.y=d.oy;this.transform();
   const chapter=this.chapter.id??this.chapter;
   this.selectedIds.clear();this.selected=undefined;
   for(const element of this.nodeElements.values())element.classList.toggle('selected',false);
   this.onSelectMany([]);
   if(d.doubleEligible&&chapter===(this.chapter.id??this.chapter))this.lastCanvasClick={chapter,pointerType:d.pointerType,time:e.timeStamp??performance.now(),x:e.clientX,y:e.clientY};
  }
 }
 selectionRect(d){return {x:Math.min(d.start.x,d.end.x),y:Math.min(d.start.y,d.end.y),width:Math.abs(d.start.x-d.end.x),height:Math.abs(d.start.y-d.end.y)};}
 updateBoxSelection(e){
  const d=this.drag;d.end=this.point(e);d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
  if(!d.moved)return;
  const r=this.selectionRect(d),scale=this.view.z*uiScale(this.root);
  this.selectedIds=new Set(this.chapter.nodes.filter(n=>{
   if(!this.nodeElements.has(n.id))return false;
   const bounds=this.nodeElements.get(n.id)?.getBoundingClientRect(),width=bounds?.width?bounds.width/scale:220,height=bounds?.height?bounds.height/scale:120;
   return n.x<=r.x+r.width&&n.x+width>=r.x&&n.y<=r.y+r.height&&n.y+height>=r.y;
  }).map(n=>n.id));
  for(const [id,rect] of this.groupRects||[]){
   const group=this.groupsById.get(id);
   if(group.collapsed&&rect.x<=r.x+r.width&&rect.x+rect.width>=r.x&&rect.y<=r.y+r.height&&rect.y+rect.height>=r.y){
    for(const member of group.memberIds)this.selectedIds.add(member);
   }
  }
  for(const [id,el] of this.nodeElements)el.classList.toggle('selected',this.selectedIds.has(id));
  this.syncGroupStates();
  this.edges();
 }
 cancelCreation(){if(!this.creation)return;this.creation=null;this.onCancelCreate();this.edges();}
 cancel(){this.drag?.groupGhost?.remove();this.lastCanvasClick=null;this.setDraggingCursor(false);for(const ghost of this.drag?.ghosts?.values()||[])ghost.remove();this.suppressSelectionClick=false;this.cardDrag.clear();this.cancelCreation();const d=this.drag,hadPending=!!this.pending;this.drag=null;this.pending=null;this.lastPortClick=null;if(d?.kind==='select')this.selectedIds=d.before;if(d?.kind==='pan'){this.view.x=d.ox;this.view.y=d.oy;}if(d&&this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);if(this.project&&(d||hadPending))this.render(this.project,this.chapter,this.selected,this.active);}
 openCard(nodeId,placementId){
  if(!this.nodesById.has(nodeId)||!placementId)return;
  this.onOpenCard(nodeId,{chapterId:this.chapter.id,nodeId,placementId});
 }
 activatePort(nodeId,exit,time,x,y){
  const previous=this.lastPortClick;
  if(previous&&previous.nodeId===nodeId&&previous.exit===exit&&time>=previous.time&&time-previous.time<=450&&Math.hypot(x-previous.x,y-previous.y)<=5){
   this.lastPortClick=null;this.centerOn(this.target(this.nodesById.get(nodeId),exit));
  }else{
   this.lastPortClick={nodeId,exit,time,x,y};
   const node=this.nodesById.get(nodeId),target=node&&this.target(node,exit);
   if(this.nodesById.has(target))this.onSelect(target);
  }
 }
 centerOn(id,{select=true}={}){
  const node=this.nodesById.get(id);if(!node)return;
  const viewport=this.root.getBoundingClientRect(),bounds=this.nodeElements.get(id)?.getBoundingClientRect();
  const scale=uiScale(this.root),group=this.groupsByMember?.get(id);
  const rect=group?.collapsed&&this.groupRects?.get(group.id);
  const {x,y,width,height}=rect||{x:node.x,y:node.y,width:bounds?.width?bounds.width/(this.view.z*scale):220,
   height:bounds?.height?bounds.height/(this.view.z*scale):120};
  this.view.x=viewport.width/(2*scale)-(x+width/2)*this.view.z;
  this.view.y=viewport.height/(2*scale)-(y+height/2)*this.view.z;
  this.transform();
  if(select)this.onSelect(id);
 }
 revealGroupHeader(id){
  const bar=this.groupElements?.get(id)?.querySelector('.beat-group-header');
  if(!bar)return;
  const {top,bottom}=bar.getBoundingClientRect(),viewport=this.root.getBoundingClientRect();
  const shift=top<viewport.top+12?viewport.top+12-top:bottom>viewport.bottom-12?viewport.bottom-12-bottom:0;
  if(shift){this.view.y+=shift/uiScale(this.root);this.transform();}
 }
 blankDrop(e){
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return false;
  const hit=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY);
  return (!hit||this.root.contains(hit))&&!hit?.closest('.node')&&!hit?.closest('.beat-group');
 }
 fit(){
  const rects=[...(this.groupRects?.values()||[]),...this.chapter.nodes.filter(node=>
   (node.type!=='death'||this.project?.showDeathBeat!==false)&&!this.groupsByMember?.get(node.id)?.collapsed)
   .map(({x,y})=>({x,y,width:220,height:220}))];
  if(!rects.length)return;
  const r=this.root.getBoundingClientRect(),scale=uiScale(this.root),minX=Math.min(...rects.map(rect=>rect.x)),minY=Math.min(...rects.map(rect=>rect.y)),
   maxX=Math.max(...rects.map(rect=>rect.x+rect.width)),maxY=Math.max(...rects.map(rect=>rect.y+rect.height));
  this.view.z=Math.max(.25,Math.min(1,(r.width/scale-80)/(maxX-minX),(r.height/scale-80)/(maxY-minY)));
  this.view.x=40-minX*this.view.z;this.view.y=40-minY*this.view.z;this.transform();
 }
}
