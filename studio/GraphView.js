import { esc } from './forms.js';
import { outputsForNode, labelForOutput } from '../project/model.js';

/** Canvas interaction owns selection/pan, and emits completed document edits. */
export class GraphView {
 constructor(root,{onSelect,onConnect,onMove}) {
  this.root=root;this.onSelect=onSelect;this.onConnect=onConnect;this.onMove=onMove;
  this.view={x:50,y:50,z:1};this.pending=null;this.drag=null;
  root.innerHTML='<div id="world"><svg id="edges"></svg><div id="nodes"></div></div>';
  root.addEventListener('pointerdown',e=>this.down(e));
  root.addEventListener('pointermove',e=>this.move(e));
  root.addEventListener('pointerup',e=>this.up(e));
  for(const event of ['pointercancel','lostpointercapture'])root.addEventListener(event,e=>{if(this.drag?.pointer===e.pointerId)this.cancel();});
  root.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();});
  root.addEventListener('wheel',e=>{e.preventDefault();const r=root.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=this.view.z;this.view.z=Math.max(.25,Math.min(1.6,old*Math.exp(-e.deltaY*.001)));this.view.x=x-(x-this.view.x)*this.view.z/old;this.view.y=y-(y-this.view.y)*this.view.z/old;this.transform();},{passive:false});
 }
 render(project,chapter,selected,active) {
  this.project=project;this.chapter=chapter;this.selected=selected;this.active=active;
  if(this.pending&&!chapter.nodes.some(n=>n.id===this.pending.nodeId&&outputsForNode(project,n).includes(this.pending.exit)))this.pending=null;
  this.root.querySelector('#nodes').innerHTML=chapter.nodes.map(n=>`<article class="node ${n.type} ${n.id===selected?'selected':''} ${n.id===active?'active':''}" data-id="${esc(n.id)}" style="left:${this.position(n).x}px;top:${this.position(n).y}px"><div class="node-heading"><span class="badge">${n.id===chapter.startNode?'START · ':''}${esc(n.type==='legacyPool'?'Legacy Random':n.type==='legacySequence'?'Legacy sequence':n.type)}</span>${esc(n.name)}</div><div class="node-body">${n.type==='random'?`${n.routes.length} routes`:n.type==='fork'?`${n.choices.length} actions`:n.type==='linear'?`${n.cards.length} cards`:n.type==='container'?`${n.items.length} items`:'Preserved legacy behaviour'}</div>${outputsForNode(project,n).map(exit=>`<button class="port ${this.pending?.nodeId===n.id&&this.pending.exit===exit?'pending':''}" data-exit="${esc(exit)}">${esc(labelForOutput(project,n,exit))} → ${esc(chapter.nodes.find(t=>t.id===this.target(n,exit))?.name||'End')}</button>`).join('')}</article>`).join('');
  this.transform();this.edges();
 }
 target(n,exit) {if(n.type==='random')return exit==='fallback'?n.fallback:n.routes.find(r=>r.id===exit)?.target;return n.connections?.[exit];}
 position(n) {return this.drag?.kind==='node'&&this.drag.id===n.id?{x:this.drag.px,y:this.drag.py}:n;}
 point(e) {const r=this.root.getBoundingClientRect();return {x:(e.clientX-r.left-this.view.x)/this.view.z,y:(e.clientY-r.top-this.view.y)/this.view.z};}
 wire(x,y,tx,ty) {return `M${x},${y} C${x+90},${y} ${tx-90},${ty} ${tx},${ty}`;}
 outputPoint(n,exit) {
  const el=[...this.root.querySelectorAll('.node')].find(el=>el.dataset.id===n.id);
  const port=el&&[...el.querySelectorAll('.port')].find(el=>el.dataset.exit===exit);
  if(port){const r=port.getBoundingClientRect();if(r.width&&r.height)return this.point({clientX:r.right,clientY:r.top+r.height/2});}
  const pos=this.position(n);return {x:pos.x+220,y:pos.y+104+outputsForNode(this.project,n).indexOf(exit)*29};
 }
 edges() {
  const paths=this.chapter.nodes.flatMap(n=>outputsForNode(this.project,n).map(exit=>{
   const t=this.chapter.nodes.find(t=>t.id===this.target(n,exit));if(!t)return '';
   const {x,y}=this.outputPoint(n,exit),to=this.position(t),path=this.wire(x,y,to.x,to.y+40);
   return `<path class="edge-line" d="${path}"/><path class="edge-hit" data-source="${esc(n.id)}" data-exit="${esc(exit)}" d="${path}"/>`;
  }));
  const d=this.drag;if(d?.kind==='connect'&&d.moved){const n=this.chapter.nodes.find(n=>n.id===d.nodeId);if(n){const {x,y}=this.outputPoint(n,d.exit);paths.push(`<path class="edge-ghost" d="${this.wire(x,y,d.px,d.py)}"/>`);}}
  this.root.querySelector('#edges').innerHTML=paths.join('');
 }
 transform(){this.root.querySelector('#world').style.transform=`translate(${this.view.x}px,${this.view.y}px) scale(${this.view.z})`;}
 validTarget(id,source) {return (id!==source||this.chapter.allowCycles===true)&&this.chapter.nodes.some(n=>n.id===id);}
 dropTarget(e,source) {
  const r=this.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return null;
  const el=this.root.ownerDocument.elementFromPoint(e.clientX,e.clientY)?.closest('.node');
  return el&&this.root.contains(el)&&this.validTarget(el.dataset.id,source)?el.dataset.id:null;
 }
 hoverTarget(id) {for(const el of this.root.querySelectorAll('.node'))el.classList.toggle('connection-target',el.dataset.id===id);}
 down(e) {
  if(e.button!==0||this.drag)return;
  const el=e.target.closest('.node'),port=e.target.closest('.port'),edge=e.target.closest('.edge-hit');
  if(port||edge){
   const nodeId=port?el.dataset.id:edge.dataset.source,exit=(port||edge).dataset.exit;
   this.pending={nodeId,exit};const p=this.point(e);
   this.drag={kind:'connect',nodeId,exit,x:e.clientX,y:e.clientY,px:p.x,py:p.y,moved:false,pointer:e.pointerId};
   // Capture on the stable root before replacing port/edge markup.
   this.root.setPointerCapture(e.pointerId);this.root.focus({preventScroll:true});
   this.render(this.project,this.chapter,this.selected,this.active);e.preventDefault();return;
  }
  if(el){const id=el.dataset.id;if(this.pending){const source=this.pending;this.pending=null;this.render(this.project,this.chapter,this.selected,this.active);if(this.validTarget(id,source.nodeId))this.onConnect(source.nodeId,source.exit,id);return;}this.onSelect(id);const n=this.chapter.nodes.find(n=>n.id===id);this.drag={kind:'node',id,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,px:n.x,py:n.y,pointer:e.pointerId};}
  else{this.pending=null;this.drag={kind:'pan',x:e.clientX,y:e.clientY,ox:this.view.x,oy:this.view.y,pointer:e.pointerId};}
  this.root.setPointerCapture(e.pointerId);
 }
 move(e) {
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='connect'){
   d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>4;
   const p=this.point(e);d.px=p.x;d.py=p.y;this.hoverTarget(d.moved?this.dropTarget(e,d.nodeId):null);this.edges();
  }else if(d.kind==='pan'){this.view.x=d.ox+e.clientX-d.x;this.view.y=d.oy+e.clientY-d.y;this.transform();}
  else{d.px=d.ox+(e.clientX-d.x)/this.view.z;d.py=d.oy+(e.clientY-d.y)/this.view.z;const el=[...this.root.querySelectorAll('.node')].find(el=>el.dataset.id===d.id);if(el){el.style.left=`${d.px}px`;el.style.top=`${d.py}px`;}this.edges();}
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
  }else if(d.kind==='node')this.onMove(d.id,d.px,d.py);
 }
 cancel(){const d=this.drag;this.drag=null;this.pending=null;if(d?.kind==='pan'){this.view.x=d.ox;this.view.y=d.oy;}if(d&&this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);if(this.project)this.render(this.project,this.chapter,this.selected,this.active);}
 fit(){if(!this.chapter.nodes.length)return;const nodes=this.chapter.nodes,r=this.root.getBoundingClientRect(),minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y)),maxX=Math.max(...nodes.map(n=>n.x+220)),maxY=Math.max(...nodes.map(n=>n.y+220));this.view.z=Math.max(.25,Math.min(1,(r.width-80)/(maxX-minX),(r.height-80)/(maxY-minY)));this.view.x=40-minX*this.view.z;this.view.y=40-minY*this.view.z;this.transform();}
}
