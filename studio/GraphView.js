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
  for(const event of ['pointercancel','lostpointercapture'])root.addEventListener(event,()=>this.cancel());
  root.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();});
  root.addEventListener('wheel',e=>{e.preventDefault();const r=root.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=this.view.z;this.view.z=Math.max(.25,Math.min(1.6,old*Math.exp(-e.deltaY*.001)));this.view.x=x-(x-this.view.x)*this.view.z/old;this.view.y=y-(y-this.view.y)*this.view.z/old;this.transform();},{passive:false});
 }
 render(project,chapter,selected,active) {
  this.project=project;this.chapter=chapter;this.selected=selected;
  if(this.pending&&!chapter.nodes.some(n=>n.id===this.pending.nodeId&&outputsForNode(project,n).includes(this.pending.exit)))this.pending=null;
  this.root.querySelector('#nodes').innerHTML=chapter.nodes.map(n=>`<article class="node ${n.type} ${n.id===selected?'selected':''} ${n.id===active?'active':''}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px"><div class="node-heading"><span class="badge">${n.id===chapter.startNode?'START · ':''}${esc(n.type==='legacyPool'?'Legacy Random':n.type==='legacySequence'?'Legacy sequence':n.type)}</span>${esc(n.name)}</div><div class="node-body">${n.type==='random'?`${n.routes.length} routes`:n.type==='fork'?`${n.choices.length} actions`:n.type==='linear'?`${n.cards.length} cards`:n.type==='container'?`${n.items.length} items`:'Preserved legacy behaviour'}</div>${outputsForNode(project,n).map(exit=>`<button class="port ${this.pending?.nodeId===n.id&&this.pending.exit===exit?'pending':''}" data-exit="${esc(exit)}">${esc(labelForOutput(project,n,exit))} → ${esc(chapter.nodes.find(t=>t.id===this.target(n,exit))?.name||'End')}</button>`).join('')}</article>`).join('');
  this.edges();this.transform();
 }
 target(n,exit) {if(n.type==='random')return exit==='fallback'?n.fallback:n.routes.find(r=>r.id===exit)?.target;return n.connections?.[exit];}
 edges() {
  this.root.querySelector('#edges').innerHTML=this.chapter.nodes.flatMap(n=>outputsForNode(this.project,n).map((exit,i)=>{const t=this.chapter.nodes.find(t=>t.id===this.target(n,exit));if(!t)return '';const x=n.x+220,y=n.y+104+i*29;return `<path d="M${x},${y} C${x+90},${y} ${t.x-90},${t.y+40} ${t.x},${t.y+40}"/>`;})).join('');
 }
 transform(){this.root.querySelector('#world').style.transform=`translate(${this.view.x}px,${this.view.y}px) scale(${this.view.z})`;}
 down(e) {
  if(e.button!==0||this.drag)return;
  const el=e.target.closest('.node'),port=e.target.closest('[data-exit]');
  if(port){this.pending={nodeId:el.dataset.id,exit:port.dataset.exit};this.render(this.project,this.chapter,this.selected);return;}
  if(el){const id=el.dataset.id;if(this.pending){const source=this.pending;this.pending=null;this.onConnect(source.nodeId,source.exit,id);return;}this.onSelect(id);const n=this.chapter.nodes.find(n=>n.id===id);this.drag={kind:'node',id,x:e.clientX,y:e.clientY,ox:n.x,oy:n.y,px:n.x,py:n.y,pointer:e.pointerId};}
  else{this.pending=null;this.drag={kind:'pan',x:e.clientX,y:e.clientY,ox:this.view.x,oy:this.view.y,pointer:e.pointerId};}
  this.root.setPointerCapture(e.pointerId);
 }
 move(e) {
  const d=this.drag;if(!d||d.pointer!==e.pointerId)return;
  if(d.kind==='pan'){this.view.x=d.ox+e.clientX-d.x;this.view.y=d.oy+e.clientY-d.y;this.transform();}
  else{d.px=d.ox+(e.clientX-d.x)/this.view.z;d.py=d.oy+(e.clientY-d.y)/this.view.z;const el=[...this.root.querySelectorAll('.node')].find(el=>el.dataset.id===d.id);el.style.left=`${d.px}px`;el.style.top=`${d.py}px`;}
 }
 up(e){const d=this.drag;if(!d||d.pointer!==e.pointerId)return;this.drag=null;if(this.root.hasPointerCapture(e.pointerId))this.root.releasePointerCapture(e.pointerId);if(d.kind==='node')this.onMove(d.id,d.px,d.py);}
 cancel(){const d=this.drag;this.drag=null;this.pending=null;if(d?.kind==='pan'){this.view.x=d.ox;this.view.y=d.oy;}if(d&&this.root.hasPointerCapture(d.pointer))this.root.releasePointerCapture(d.pointer);if(this.project)this.render(this.project,this.chapter,this.selected);}
 fit(){if(!this.chapter.nodes.length)return;const nodes=this.chapter.nodes,r=this.root.getBoundingClientRect(),minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y)),maxX=Math.max(...nodes.map(n=>n.x+220)),maxY=Math.max(...nodes.map(n=>n.y+220));this.view.z=Math.max(.25,Math.min(1,(r.width-80)/(maxX-minX),(r.height-80)/(maxY-minY)));this.view.x=40-minX*this.view.z;this.view.y=40-minY*this.view.z;this.transform();}
}
