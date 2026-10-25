import { CardDrag } from './card-drag.js';
import { cardLabel } from './card-label.js';
import { uiScale } from './ui-scale.js';
import { esc } from './forms.js';
import { outputsForNode, labelForOutput } from '../project/model.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { nodeIcon } from './node-icons.js';
import { cardEditorTint,canonicalCardKind } from '../project/cards.js';
import { createLibraryIndex } from '../project/library-index.js';
import { cardRuleIndicators } from './card-rule-indicators.js';


/** Canvas interaction owns selection/pan, and emits completed document edits. */
export class GraphView {
 constructor(root,{onSelect,onConnect,onMove,onDuplicate=()=>{},onDuplicateMany=()=>{},onSelectMany=()=>{},onMoveMany=()=>{},onOpenCard=()=>{},onTransferCard=()=>{},onRemoveCard=()=>{},onDelete=()=>{},onDeleteMany=()=>{},onCreateConnected=()=>{},onCancelCreate=()=>{}}) {
  this.onDuplicate=onDuplicate;this.onDuplicateMany=onDuplicateMany;this.overrideNodeIds=new Set();this.nodeErrors=new Map();
  this.selectedIds=new Set();this.onSelectMany=onSelectMany;this.onMoveMany=onMoveMany;
  this.onCreateConnected=onCreateConnected;this.onCancelCreate=onCancelCreate;this.creation=null;
  this.root=root;this.onSelect=onSelect;this.onConnect=onConnect;this.onMove=onMove;this.onOpenCard=onOpenCard;this.lastPortClick=null;
  this.cardDrag=new CardDrag(this,onTransferCard,onRemoveCard);
  this.view={x:50,y:50,z:1};this.pending=null;this.drag=null;
  root.innerHTML='<div id="world"><svg id="edges"></svg><div id="nodes"></div></div>';
  root.addEventListener('pointerdown',e=>this.down(e));
  root.addEventListener('pointermove',e=>this.move(e));
  root.addEventListener('pointerup',e=>this.up(e));
  for(const event of ['pointercancel','lostpointercapture'])root.addEventListener(event,e=>{if(this.drag?.pointer===e.pointerId)this.cancel();});
  root.addEventListener('keydown',e=>{
   if(['Enter',' '].includes(e.key)){this.cardDrag.suppressClick=false;this.suppressSelectionClick=false;}
   if(e.key==='Escape')this.cancel();
   if(!['Delete','Backspace'].includes(e.key)||e.defaultPrevented||e.repeat||e.isComposing||e.ctrlKey||(e.metaKey&&e.key!=='Backspace')||e.altKey||e.shiftKey||this.drag)return;
   if(e.target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
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
   const edge=e.target.closest('.edge-hit');
   if(!edge||this.drag)return;
   e.preventDefault();this.lastPortClick=null;
   this.onConnect(edge.dataset.source,edge.dataset.exit,false);
  });
  root.addEventListener('wheel',e=>{this.lastCanvasClick=null;if(this.drag?.kind==='select'){e.preventDefault();return;}this.cancelCreation();e.preventDefault();const r=root.getBoundingClientRect(),scale=uiScale(root),x=(e.clientX-r.left)/scale,y=(e.clientY-r.top)/scale,old=this.view.z;this.view.z=Math.max(.25,Math.min(1.6,old*Math.exp(-e.deltaY*.001)));this.view.x=x-(x-this.view.x)*this.view.z/old;this.view.y=y-(y-this.view.y)*this.view.z/old;this.transform();},{passive:false});
 }
 render(project,chapter,selected,active) {
  const chapterKey=chapter.id??chapter;
  if(this.selectionChapter!==chapterKey||selected!==this.selected)this.lastCanvasClick=null;
  if(this.selectionChapter!==chapterKey||selected!==this.selected)this.selectedIds=new Set(selected?[selected]:[]);
  this.selectionChapter=chapterKey;
  this.selectedIds=new Set([...this.selectedIds].filter(id=>chapter.nodes.some(node=>node.id===id)));
  this.project=project;this.chapter=chapter;this.selected=selected;this.active=active;
  this.nodesById=new Map(chapter.nodes.map(node=>[node.id,node]));
  this.libraryIndex=createLibraryIndex(project.library);
  this.definitionsById=new Map(project.library.map(definition=>[definition.id,definition]));
  if(this.pending&&!chapter.nodes.some(n=>n.id===this.pending.nodeId&&outputsForNode(project,n,this.libraryIndex).includes(this.pending.exit)))this.pending=null;
  this.root.querySelector('#nodes').innerHTML=chapter.nodes.map(n=>`<article class="node ${n.type} ${this.selectedIds.has(n.id)?'selected':''} ${n.id===active?'active':''}" data-id="${esc(n.id)}" style="left:${this.position(n).x}px;top:${this.position(n).y}px"><div class="node-heading">${nodeIcon(n.type)}<span class="badge">${n.id===chapter.startNode?'<span class="graph-start-label">START</span> · ':''}${esc(n.name?.trim()||nodeTypeLabel(n.type))}</span>${this.overrideMarker(n.id)}</div>${n.type==='random'?`<div class="node-body">${n.routes.length} ${n.routes.length===1?'route':'routes'}</div>`:n.type.startsWith('legacy')?'<div class="node-body">Preserved legacy behaviour</div>':''}${this.cardRows(n)}</article>`).join('');
  this.nodeElements=new Map([...this.root.querySelectorAll('.node')].map(el=>[el.dataset.id,el]));
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
 setActive(active) {
  if(this.active===active)return;
  const previous=this.active;
  this.active=active;
  this.nodeElements?.get(previous)?.classList.toggle('active',false);
  this.nodeElements?.get(active)?.classList.toggle('active',true);
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
 target(n,exit) {if(n.type==='random')return exit==='fallback'?n.fallback:n.routes.find(r=>r.id===exit)?.target;return n.connections?.[exit];}
 portLabel(node,exit){const target=this.target(node,exit);return target===null?'End chapter':this.nodesById.get(target)?.name||'Unlinked';}
 unlinked(node,exit){const target=this.target(node,exit);return target!==null&&!this.nodesById.has(target);}
 port(node,exit,label=null){
  const target=esc(this.portLabel(node,exit)),name=esc(labelForOutput(this.project,node,exit,this.libraryIndex));
  if(exit.endsWith(':success')||exit.endsWith(':failure'))label='';
  return `<button class="port ${this.unlinked(node,exit)?'unlinked':''}" data-exit="${esc(exit)}" aria-label="${name} → ${target}">${label===null?`${exit==='next'?'':name+' '}→ ${target}`:`${label?`${esc(label)} | `:'→ '}${target}`}</button>`;
 }
 cardRows(node){
  const descriptor=nodeTypeDescriptor(node.type),outputs=outputsForNode(this.project,node,this.libraryIndex),used=new Set();
  let html='';
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
 edges() {
  const paths=this.chapter.nodes.flatMap(n=>outputsForNode(this.project,n,this.libraryIndex).map(exit=>{
   const t=this.nodesById.get(this.target(n,exit));if(!t)return '';
   const {x,y}=this.outputPoint(n,exit),to=this.position(t),path=this.wire(x,y,to.x,to.y+40);
   return `<path class="edge-line" data-source="${esc(n.id)}" data-exit="${esc(exit)}" d="${path}"/><path class="edge-hit" data-source="${esc(n.id)}" data-exit="${esc(exit)}" d="${path}"/>`;
  }));
  const d=this.creation||this.drag;if(d?.kind==='connect'&&d.moved){const n=this.nodesById.get(d.nodeId);if(n){const {x,y}=this.outputPoint(n,d.exit);paths.push(`<path class="edge-ghost" d="${this.wire(x,y,d.px,d.py)}"/>`);}}
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
 dropTarget(e,source) {
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return null;
  const el=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY)?.closest('.node');
  return el&&this.root.contains(el)&&this.validTarget(el.dataset.id,source)?el.dataset.id:null;
 }
 hoverTarget(id) {for(const el of this.root.querySelectorAll('.node'))el.classList.toggle('connection-target',el.dataset.id===id);}
 setDraggingCursor(active) {
  this.root.classList.toggle('graph-dragging',active);
  this.root.ownerDocument?.documentElement?.classList?.toggle('graph-dragging',active);
 }
 down(e) {
  if(e.button!==0||this.drag)return;
  this.cancelCreation();
  this.suppressSelectionClick=false;
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
  if(port){
   const nodeId=el.dataset.id,exit=port.dataset.exit;
   this.pending=null;const p=this.point(e);
   this.drag={kind:'connect',nodeId,exit,fromPort:!!port,x:e.clientX,y:e.clientY,px:p.x,py:p.y,moved:false,pointer:e.pointerId};
   // Capture on the stable root before replacing port markup.
   this.setDraggingCursor(true);this.root.setPointerCapture(e.pointerId);this.root.focus({preventScroll:true});
   this.render(this.project,this.chapter,this.selected,this.active);e.preventDefault();return;
  }
  if(el){
   const copy=e.altKey&&!!e.target.closest('.node-heading');
   const id=el.dataset.id,group=this.selectedIds.size>1&&this.selectedIds.has(id);
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
 move(e) {
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='card'){this.cardDrag.move(e);return;}
  if(d.kind==='select'){this.updateBoxSelection(e);return;}
  if(d.kind==='connect'){
   d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
   const p=this.point(e);d.px=p.x;d.py=p.y;this.hoverTarget(d.moved?this.dropTarget(e,d.nodeId):null);this.edges();
  }else if(d.kind==='pan'){d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;const scale=uiScale(this.root);this.view.x=d.ox+(e.clientX-d.x)/scale;this.view.y=d.oy+(e.clientY-d.y)/scale;this.transform();}
  else{
   const scale=this.view.z*uiScale(this.root),dx=(e.clientX-d.x)/scale,dy=(e.clientY-d.y)/scale;
   d.px=d.ox+dx;d.py=d.oy+dy;
   if(d.copy){
    d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
    if(!d.moved)return;
    if(!d.ghosts){
     d.ghosts=new Map();
     for(const id of d.origins?.keys()||[d.id]){
      const ghost=this.nodeElements.get(id).cloneNode(true);
      ghost.removeAttribute('data-id');ghost.classList.remove('active');
      ghost.style.pointerEvents='none';ghost.style.opacity='.7';
      ghost.setAttribute('aria-hidden','true');
      this.root.querySelector('#nodes').appendChild(ghost);d.ghosts.set(id,ghost);
     }
     d.ghost=d.ghosts.get(d.id);
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
   this.edges();
  }
 }
 up(e){
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='pan')this.move(e);
  if(d.copy)this.move(e);
  if(d.kind==='select')this.updateBoxSelection(e);
  if(d.kind==='connect')d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
  const target=d.kind==='connect'&&d.moved?this.dropTarget(e,d.nodeId):null;
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
   if(target)this.onConnect(d.nodeId,d.exit,target);
   else if(d.moved&&this.blankDrop(e)){
    if(this.unlinked(this.nodesById.get(d.nodeId),d.exit)){
     const position=this.point(e);
     this.creation={...d,px:position.x,py:position.y};this.edges();
     this.onCreateConnected({id:d.nodeId,exit:d.exit,position,clientX:e.clientX,clientY:e.clientY});
    }else this.onConnect(d.nodeId,d.exit,false);
   }
   else if(!d.moved&&d.fromPort)this.activatePort(d.nodeId,d.exit,e.timeStamp??performance.now(),e.clientX,e.clientY);
   if(d.moved)this.lastPortClick=null;
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
   const bounds=this.nodeElements.get(n.id)?.getBoundingClientRect(),width=bounds?.width?bounds.width/scale:220,height=bounds?.height?bounds.height/scale:120;
   return n.x<=r.x+r.width&&n.x+width>=r.x&&n.y<=r.y+r.height&&n.y+height>=r.y;
  }).map(n=>n.id));
  for(const [id,el] of this.nodeElements)el.classList.toggle('selected',this.selectedIds.has(id));
  this.edges();
 }
 cancelCreation(){if(!this.creation)return;this.creation=null;this.onCancelCreate();this.edges();}
 cancel(){this.lastCanvasClick=null;this.setDraggingCursor(false);for(const ghost of this.drag?.ghosts?.values()||[])ghost.remove();this.suppressSelectionClick=false;this.cardDrag.clear();this.cancelCreation();const d=this.drag,hadPending=!!this.pending;this.drag=null;this.pending=null;this.lastPortClick=null;if(d?.kind==='select')this.selectedIds=d.before;if(d?.kind==='pan'){this.view.x=d.ox;this.view.y=d.oy;}if(d&&this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);if(this.project&&(d||hadPending))this.render(this.project,this.chapter,this.selected,this.active);}
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
  const scale=uiScale(this.root),width=bounds?.width?bounds.width/(this.view.z*scale):220,height=bounds?.height?bounds.height/(this.view.z*scale):120;
  this.view.x=viewport.width/(2*scale)-(node.x+width/2)*this.view.z;
  this.view.y=viewport.height/(2*scale)-(node.y+height/2)*this.view.z;
  this.transform();
  if(select)this.onSelect(id);
 }
 blankDrop(e){
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return false;
  const hit=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY);
  return (!hit||this.root.contains(hit))&&!hit?.closest('.node');
 }
 fit(){if(!this.chapter.nodes.length)return;const nodes=this.chapter.nodes,r=this.root.getBoundingClientRect(),scale=uiScale(this.root),minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y)),maxX=Math.max(...nodes.map(n=>n.x+220)),maxY=Math.max(...nodes.map(n=>n.y+220));this.view.z=Math.max(.25,Math.min(1,(r.width/scale-80)/(maxX-minX),(r.height/scale-80)/(maxY-minY)));this.view.x=40-minX*this.view.z;this.view.y=40-minY*this.view.z;this.transform();}
}
