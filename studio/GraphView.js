import { esc } from './forms.js';
import { outputsForNode, labelForOutput } from '../project/model.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { nodeTypeDescriptor } from '../project/nodeTypes.js';
import { nodeIcon } from './node-icons.js';
import { cardEditorTint,canonicalCardKind } from '../project/cards.js';
import { createLibraryIndex } from '../project/library-index.js';


/** Canvas interaction owns selection/pan, and emits completed document edits. */
export class GraphView {
 constructor(root,{onSelect,onConnect,onMove,onOpenCard=()=>{},onDelete=()=>{},onCreateConnected=()=>{},onCancelCreate=()=>{}}) {
  this.onCreateConnected=onCreateConnected;this.onCancelCreate=onCancelCreate;this.creation=null;
  this.root=root;this.onSelect=onSelect;this.onConnect=onConnect;this.onMove=onMove;this.onOpenCard=onOpenCard;this.lastPortClick=null;
  this.view={x:50,y:50,z:1};this.pending=null;this.drag=null;
  root.innerHTML='<div id="world"><svg id="edges"></svg><div id="nodes"></div></div>';
  root.addEventListener('pointerdown',e=>this.down(e));
  root.addEventListener('pointermove',e=>this.move(e));
  root.addEventListener('pointerup',e=>this.up(e));
  for(const event of ['pointercancel','lostpointercapture'])root.addEventListener(event,e=>{if(this.drag?.pointer===e.pointerId)this.cancel();});
  root.addEventListener('keydown',e=>{
   if(e.key==='Escape')this.cancel();
   if(!['Delete','Backspace'].includes(e.key)||e.defaultPrevented||e.repeat||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||this.drag)return;
   if(e.target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
   if(!this.nodesById?.has(this.selected))return;
   e.preventDefault();onDelete(this.selected);
   // Deletion redraws node buttons; keep subsequent keyboard input on the graph.
   root.focus({preventScroll:true});
  });
  root.addEventListener('click',e=>{
   const name=e.target.closest('.graph-card-name'),node=name?.closest('.node'),row=name?.closest('.graph-card-row');
   if(node&&row){this.lastPortClick=null;this.openCard(node.dataset.id,row.dataset.cardPlacement);}
  });
  root.addEventListener('dblclick',e=>{
   const edge=e.target.closest('.edge-hit');
   if(!edge||this.drag)return;
   e.preventDefault();this.lastPortClick=null;
   this.onConnect(edge.dataset.source,edge.dataset.exit,false);
  });
  root.addEventListener('wheel',e=>{this.cancelCreation();e.preventDefault();const r=root.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=this.view.z;this.view.z=Math.max(.25,Math.min(1.6,old*Math.exp(-e.deltaY*.001)));this.view.x=x-(x-this.view.x)*this.view.z/old;this.view.y=y-(y-this.view.y)*this.view.z/old;this.transform();},{passive:false});
 }
 render(project,chapter,selected,active) {
  this.project=project;this.chapter=chapter;this.selected=selected;this.active=active;
  this.nodesById=new Map(chapter.nodes.map(node=>[node.id,node]));
  this.libraryIndex=createLibraryIndex(project.library);
  this.definitionsById=new Map(project.library.map(definition=>[definition.id,definition]));
  if(this.pending&&!chapter.nodes.some(n=>n.id===this.pending.nodeId&&outputsForNode(project,n,this.libraryIndex).includes(this.pending.exit)))this.pending=null;
  this.root.querySelector('#nodes').innerHTML=chapter.nodes.map(n=>`<article class="node ${n.type} ${n.id===selected?'selected':''} ${n.id===active?'active':''}" data-id="${esc(n.id)}" style="left:${this.position(n).x}px;top:${this.position(n).y}px"><div class="node-heading">${nodeIcon(n.type)}<span class="badge">${n.id===chapter.startNode?'START · ':''}${esc(nodeTypeLabel(n.type))}</span>${esc(n.name)}</div>${n.type==='random'?`<div class="node-body">${n.routes.length} ${n.routes.length===1?'route':'routes'}</div>`:n.type.startsWith('legacy')?'<div class="node-body">Preserved legacy behaviour</div>':''}${this.cardRows(n)}</article>`).join('');
  this.nodeElements=new Map([...this.root.querySelectorAll('.node')].map(el=>[el.dataset.id,el]));
  this.portElements=new Map([...this.nodeElements].map(([id,el])=>[id,new Map([...el.querySelectorAll('.port')].map(port=>[port.dataset.exit,port]))]));
  this.transform();this.edges();
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
 target(n,exit) {if(n.type==='random')return exit==='fallback'?n.fallback:n.routes.find(r=>r.id===exit)?.target;return n.connections?.[exit];}
 portLabel(node,exit){const target=this.target(node,exit);return target===null?'End chapter':this.nodesById.get(target)?.name||'Unlinked';}
 unlinked(node,exit){const target=this.target(node,exit);return target!==null&&!this.nodesById.has(target);}
 port(node,exit,label=null){
  const target=esc(this.portLabel(node,exit)),name=esc(labelForOutput(this.project,node,exit,this.libraryIndex));
  return `<button class="port ${this.unlinked(node,exit)?'unlinked':''}" data-exit="${esc(exit)}" aria-label="${name} → ${target}">${label===null?`${name} → ${target}`:`${label?`${esc(label)} | `:'→ '}${target}`}</button>`;
 }
 cardRows(node){
  const descriptor=nodeTypeDescriptor(node.type),outputs=outputsForNode(this.project,node,this.libraryIndex),used=new Set();
  let html='';
  for(const slot of Object.keys(descriptor?.slots||{})){
   const placements=slot==='intro'?(node.intro&&node.introEnabled!==false?[node.intro]:[]):node[slot]||[];
   for(const placement of placements){
    const definition=this.definitionsById.get(placement.definitionId)||placement;
    const kind=canonicalCardKind(definition.kind||definition.cardKind||descriptor.defaultKinds[slot]);
    const name=definition.name||definition.label||definition.title||'Missing card';
    const exits=slot==='choices'?outputs.filter(exit=>exit===placement.id||exit===`${placement.id}:success`||exit===`${placement.id}:failure`):[];
    for(const exit of exits)used.add(exit);
    html+=`<hr class="graph-card-divider"><div class="graph-card-row ${exits.length?'has-outputs':''}" data-card-placement="${esc(placement.id||'')}" data-card-type="${esc(kind)}" style="--card-editor-tint:${esc(cardEditorTint(kind))}"><button type="button" class="graph-card-name">${slot==='intro'?'<small>Introduction</small>':''}${esc(name)}</button>`;
    if(exits.length)html+=`<div class="graph-card-outputs">${exits.map(exit=>this.port(node,exit,exit.endsWith(':success')?'Success':exit.endsWith(':failure')?'Failure':'')).join('')}</div>`;
    html+='</div>';
   }
  }
  const remaining=outputs.filter(exit=>!used.has(exit));
  if(html&&remaining.length)html+='<hr class="graph-card-divider">';
  return html+remaining.map(exit=>this.port(node,exit)).join('');
 }
 position(n) {return this.drag?.kind==='node'&&this.drag.id===n.id?{x:this.drag.px,y:this.drag.py}:n;}
 point(e) {const r=this.root.getBoundingClientRect();return {x:(e.clientX-r.left-this.view.x)/this.view.z,y:(e.clientY-r.top-this.view.y)/this.view.z};}
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
   return `<path class="edge-line" d="${path}"/><path class="edge-hit" data-source="${esc(n.id)}" data-exit="${esc(exit)}" d="${path}"/>`;
  }));
  const d=this.creation||this.drag;if(d?.kind==='connect'&&d.moved){const n=this.nodesById.get(d.nodeId);if(n){const {x,y}=this.outputPoint(n,d.exit);paths.push(`<path class="edge-ghost" d="${this.wire(x,y,d.px,d.py)}"/>`);}}
  this.root.querySelector('#edges').innerHTML=paths.join('');
 }
 transform(){this.root.querySelector('#world').style.transform=`translate(${this.view.x}px,${this.view.y}px) scale(${this.view.z})`;}
 validTarget(id,source) {return (id!==source||this.chapter.allowCycles===true)&&this.nodesById.has(id);}
 dropTarget(e,source) {
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return null;
  const el=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY)?.closest('.node');
  return el&&this.root.contains(el)&&this.validTarget(el.dataset.id,source)?el.dataset.id:null;
 }
 hoverTarget(id) {for(const el of this.root.querySelectorAll('.node'))el.classList.toggle('connection-target',el.dataset.id===id);}
 down(e) {
  if(e.button!==0||this.drag)return;
  this.cancelCreation();
  const el=e.target.closest('.node'),port=e.target.closest('.port'),edge=e.target.closest('.edge-hit');
  if(!port)this.lastPortClick=null;
  if(edge||e.target.closest('.graph-card-name'))return;
  if(port){
   const nodeId=el.dataset.id,exit=port.dataset.exit;
   this.pending=null;const p=this.point(e);
   this.drag={kind:'connect',nodeId,exit,fromPort:!!port,x:e.clientX,y:e.clientY,px:p.x,py:p.y,moved:false,pointer:e.pointerId};
   // Capture on the stable root before replacing port markup.
   this.root.setPointerCapture(e.pointerId);this.root.focus({preventScroll:true});
   this.render(this.project,this.chapter,this.selected,this.active);e.preventDefault();return;
  }
  if(el){const id=el.dataset.id;this.onSelect(id);const n=this.nodesById.get(id);this.drag={kind:'node',id,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,px:n.x,py:n.y,pointer:e.pointerId};}
  else{this.pending=null;this.drag={kind:'pan',x:e.clientX,y:e.clientY,ox:this.view.x,oy:this.view.y,pointer:e.pointerId};}
  this.root.setPointerCapture(e.pointerId);
  this.root.focus({preventScroll:true});
 }
 move(e) {
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='connect'){
   d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
   const p=this.point(e);d.px=p.x;d.py=p.y;this.hoverTarget(d.moved?this.dropTarget(e,d.nodeId):null);this.edges();
  }else if(d.kind==='pan'){this.view.x=d.ox+e.clientX-d.x;this.view.y=d.oy+e.clientY-d.y;this.transform();}
  else{d.px=d.ox+(e.clientX-d.x)/this.view.z;d.py=d.oy+(e.clientY-d.y)/this.view.z;const el=this.nodeElements.get(d.id);if(el){el.style.left=`${d.px}px`;el.style.top=`${d.py}px`;}this.edges();}
 }
 up(e){
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='connect')d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
  const target=d.kind==='connect'&&d.moved?this.dropTarget(e,d.nodeId):null;
  this.drag=null;
  if(this.root.hasPointerCapture(e.pointerId))this.root.releasePointerCapture(e.pointerId);
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
  }else if(d.kind==='node')this.onMove(d.id,d.px,d.py);
 }
 cancelCreation(){if(!this.creation)return;this.creation=null;this.onCancelCreate();this.edges();}
 cancel(){this.cancelCreation();const d=this.drag,hadPending=!!this.pending;this.drag=null;this.pending=null;this.lastPortClick=null;if(d?.kind==='pan'){this.view.x=d.ox;this.view.y=d.oy;}if(d&&this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);if(this.project&&(d||hadPending))this.render(this.project,this.chapter,this.selected,this.active);}
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
  }
 }
 centerOn(id){
  const node=this.nodesById.get(id);if(!node)return;
  const viewport=this.root.getBoundingClientRect(),bounds=this.nodeElements.get(id)?.getBoundingClientRect();
  const width=bounds?.width?bounds.width/this.view.z:220,height=bounds?.height?bounds.height/this.view.z:120;
  this.view.x=viewport.width/2-(node.x+width/2)*this.view.z;
  this.view.y=viewport.height/2-(node.y+height/2)*this.view.z;
  this.transform();
  this.onSelect(id);
 }
 blankDrop(e){
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return false;
  const hit=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY);
  return (!hit||this.root.contains(hit))&&!hit?.closest('.node');
 }
 fit(){if(!this.chapter.nodes.length)return;const nodes=this.chapter.nodes,r=this.root.getBoundingClientRect(),minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y)),maxX=Math.max(...nodes.map(n=>n.x+220)),maxY=Math.max(...nodes.map(n=>n.y+220));this.view.z=Math.max(.25,Math.min(1,(r.width-80)/(maxX-minX),(r.height-80)/(maxY-minY)));this.view.x=40-minX*this.view.z;this.view.y=40-minY*this.view.z;this.transform();}
}
