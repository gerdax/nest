import { isContainerLockSlot, nodeTypeDescriptor } from '../project/nodeTypes.js';
import { uiScale } from './ui-scale.js';

export function cardDropSlot(type,kind) {
 const slots=nodeTypeDescriptor(type)?.slots||{};
 return Object.keys(slots).find(slot=>slot!=='intro'&&!isContainerLockSlot(type,slot)&&slots[slot].includes(kind))||null;
}

/** Pointer-only feedback; the document changes once, on a valid drop. */
export class CardDrag {
 constructor(graph,onTransfer,onRemove=()=>{}){this.graph=graph;this.onTransfer=onTransfer;this.onRemove=onRemove;this.suppressClick=false;}
 start(e,name){
  this.suppressClick=false;
  const row=name.closest('.graph-card-row'),node=name.closest('.node');
  if(!row||!node||row.dataset.lockMethod)return false;
  const g=this.graph;
  g.root.focus({preventScroll:true});
  g.drag={kind:'card',sourceNodeId:node.dataset.id,placementId:row.dataset.cardPlacement,cardKind:row.dataset.cardType,name:name.textContent,x:e.clientX,y:e.clientY,clientX:e.clientX,clientY:e.clientY,pointer:e.pointerId,moved:false,copy:!!e.altKey};
  g.root.setPointerCapture(e.pointerId);
  // Avoid native text selection/HTML dragging; preserve ordinary click-to-edit.
  e.preventDefault();return true;
 }
 target(e,d){
  const g=this.graph,r=g.root.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>=r.right||e.clientY<r.top||e.clientY>=r.bottom)return null;
  const nodeEl=g.root.ownerDocument.elementFromPoint(e.clientX,e.clientY)?.closest('.node');
  if(!nodeEl||!g.root.contains(nodeEl))return null;
  const node=g.nodesById.get(nodeEl.dataset.id);
  const header=nodeEl.querySelector?.('.node-heading'),headerBounds=header?.getBoundingClientRect();
  if(headerBounds&&e.clientY>=headerBounds.top&&e.clientY<headerBounds.bottom){
   const compatible=nodeTypeDescriptor(node?.type)?.slots.intro?.includes(d.cardKind);
   const self=node?.id===d.sourceNodeId&&node.intro?.id===d.placementId;
   return {nodeEl,header,slot:'intro',targetNodeId:node?.id,invalid:!compatible||self};
  }
  const allRows=[...nodeEl.querySelectorAll('.graph-card-row')];
  // Row centres replace; narrow bands along their edges keep insertion available.
  const row=allRows.find(row=>{const r=row.getBoundingClientRect(),edge=Math.min(8,r.height*.2);return e.clientY>=r.top+edge&&e.clientY<r.bottom-edge;});
  if(row){
   const slot=row.dataset.cardSlot,targetPlacementId=row.dataset.cardPlacement;
   const compatible=!isContainerLockSlot(node?.type,slot)&&nodeTypeDescriptor(node?.type)?.slots[slot]?.includes(d.cardKind);
   const self=node.id===d.sourceNodeId&&targetPlacementId===d.placementId;
   return {nodeEl,row,slot,targetNodeId:node.id,targetPlacementId,invalid:!compatible||self};
  }
  const slot=cardDropSlot(node?.type,d.cardKind);
  if(!slot)return {nodeEl,invalid:true};
  const rows=allRows.filter(row=>row.dataset.cardSlot===slot);
  const index=rows.findIndex(row=>{const r=row.getBoundingClientRect();return e.clientY<r.top+r.height/2;});
  return {nodeEl,slot,index:index<0?rows.length:index,rows,targetNodeId:node.id};
 }
 move(e){
  const d=this.graph.drag;if(d?.kind!=='card')return;
  d.clientX=e.clientX;d.clientY=e.clientY;d.copy=!!e.altKey;
  d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>5;
  if(!d.moved)return;
  this.suppressClick=true;
  d.dirty=true;
  if(this.frame==null)this.tick();
 }
 paint(d){
  const g=this.graph,scale=uiScale(g.root);
  if(!this.ghost){
   const doc=g.root.ownerDocument;
   this.ghost=doc.createElement('div');this.ghost.className='card-drag-ghost';
   this.line=doc.createElement('div');this.line.className='card-drop-line';
   g.root.append(this.ghost,this.line);
  }
  const target=this.target(d,d);
  const hit=target?.header||target?.row||target?.nodeEl;
  const marker=target?.invalid?'card-drop-invalid':target?.header||target?.row?'card-drop-replace':'card-drop-target';
  this.highlight(hit,marker);
  this.ghost.textContent=`${target?.header?'Introduction'+(d.copy?' (copy)':''):target?.targetPlacementId?'Replace'+(d.copy?' with copy':''):d.copy?'+ Copy':!target&&this.graph.blankDrop(d)?'Remove':'Move'} · ${d.name}`;
  this.ghost.style.left=`${(d.clientX+14)/scale}px`;this.ghost.style.top=`${(d.clientY+14)/scale}px`;
  this.line.hidden=true;
  if(!target||target.header||target.row||target.invalid)return;
  const bounds=target.nodeEl.getBoundingClientRect(),row=target.rows[target.index],last=target.rows.at(-1);
  const anchor=target.nodeEl.querySelector('.graph-card-row[data-card-slot="intro"]')||target.nodeEl.querySelector('.node-heading');
  const y=row?row.getBoundingClientRect().top:last?last.getBoundingClientRect().bottom:anchor?.getBoundingClientRect().bottom??bounds.bottom;
  Object.assign(this.line.style,{left:`${(bounds.left+3)/scale}px`,top:`${y/scale}px`,width:`${(bounds.width-6)/scale}px`});this.line.hidden=false;
 }
 highlight(element,marker){
  if(element===this.highlighted&&marker===this.marker)return;
  this.highlighted?.classList.toggle(this.marker,false);
  element?.classList.toggle(marker,true);
  this.highlighted=element;this.marker=marker;
 }
 tick(){
  const g=this.graph,d=g.drag,win=g.root.ownerDocument.defaultView;
  this.frame=win.requestAnimationFrame(()=>{
   this.frame=null;
   if(g.drag!==d||d?.kind!=='card'||!d.moved)return;
   const panned=g.panAtDragEdge(d);
   if(d.dirty||panned)this.paint(d);
   d.dirty=false;
   if(panned)this.tick();
  });
 }
 finish(e,d){
  d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>5;
  if(d.moved){
   this.suppressClick=true;
   const target=this.target(e,d);
   const remove=!target&&!e.altKey&&this.graph.blankDrop(e);
   this.clear();
   if(remove)this.onRemove({sourceNodeId:d.sourceNodeId,placementId:d.placementId});
   else if(target&&!target.invalid)this.onTransfer({sourceNodeId:d.sourceNodeId,placementId:d.placementId,targetNodeId:target.targetNodeId,...(target.header?{targetSlot:'intro'}:target.targetPlacementId?{targetPlacementId:target.targetPlacementId}:{index:target.index}),copy:!!e.altKey});
   this.graph.root.focus({preventScroll:true});
  }else {
   this.clear();this.suppressClick=true;
   this.graph.openCard(d.sourceNodeId,d.placementId);
  }
 }
 clear(){
  if(this.frame!=null)this.graph.root.ownerDocument.defaultView.cancelAnimationFrame?.(this.frame);
  this.frame=null;this.ghost?.remove();this.line?.remove();this.ghost=null;this.line=null;
  this.highlight();
 }
 consumeClick(){const suppress=this.suppressClick;this.suppressClick=false;return suppress;}
}
