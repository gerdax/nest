import { nodeTypeDescriptor } from '../project/nodeTypes.js';

export function cardDropSlot(type,kind) {
 const slots=nodeTypeDescriptor(type)?.slots||{};
 return Object.keys(slots).find(slot=>slot!=='intro'&&slots[slot].includes(kind))||null;
}

/** Pointer-only feedback; the document changes once, on a valid drop. */
export class CardDrag {
 constructor(graph,onTransfer){this.graph=graph;this.onTransfer=onTransfer;this.suppressClick=false;}
 start(e,name){
  this.suppressClick=false;
  const row=name.closest('.graph-card-row'),node=name.closest('.node');
  if(!row||row.dataset.cardSlot==='intro'||!node)return false;
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
  const node=g.nodesById.get(nodeEl.dataset.id),slot=cardDropSlot(node?.type,d.cardKind);
  if(!slot)return {nodeEl,invalid:true};
  const rows=[...nodeEl.querySelectorAll('.graph-card-row')].filter(row=>row.dataset.cardSlot===slot);
  const index=rows.findIndex(row=>{const r=row.getBoundingClientRect();return e.clientY<r.top+r.height/2;});
  return {nodeEl,slot,index:index<0?rows.length:index,rows,targetNodeId:node.id};
 }
 move(e){
  const d=this.graph.drag;if(d?.kind!=='card')return;
  d.clientX=e.clientX;d.clientY=e.clientY;d.copy=!!e.altKey;
  d.moved ||= Math.hypot(e.clientX-d.x,e.clientY-d.y)>5;
  if(!d.moved)return;
  this.suppressClick=true;
  if(!this.ghost){
   const doc=this.graph.root.ownerDocument;
   this.ghost=doc.createElement('div');this.ghost.className='card-drag-ghost';
   this.line=doc.createElement('div');this.line.className='card-drop-line';
   this.graph.root.append(this.ghost,this.line);
  }
  this.paint(d);
  if(!this.frame)this.tick();
 }
 paint(d){
  const g=this.graph;
  for(const el of g.root.querySelectorAll('.node')){el.classList.toggle('card-drop-target',false);el.classList.toggle('card-drop-invalid',false);}
  const target=this.target(d,d);d.target=target;
  this.ghost.textContent=`${d.copy?'+ Copy':'Move'} · ${d.name}`;
  this.ghost.style.left=`${d.clientX+14}px`;this.ghost.style.top=`${d.clientY+14}px`;
  this.line.hidden=true;
  if(!target)return;
  target.nodeEl.classList.toggle(target.invalid?'card-drop-invalid':'card-drop-target',true);
  if(target.invalid)return;
  const bounds=target.nodeEl.getBoundingClientRect(),row=target.rows[target.index],last=target.rows.at(-1);
  const anchor=target.nodeEl.querySelector('.graph-card-row[data-card-slot="intro"]')||target.nodeEl.querySelector('.node-heading');
  const y=row?row.getBoundingClientRect().top:last?last.getBoundingClientRect().bottom:anchor?.getBoundingClientRect().bottom??bounds.bottom;
  Object.assign(this.line.style,{left:`${bounds.left+3}px`,top:`${y}px`,width:`${bounds.width-6}px`});this.line.hidden=false;
 }
 tick(){
  const win=this.graph.root.ownerDocument.defaultView;
  this.frame=win.requestAnimationFrame(()=>{
   this.frame=null;const g=this.graph,d=g.drag;if(d?.kind!=='card'||!d.moved)return;
   const r=g.root.getBoundingClientRect(),speed=(v,min,max)=>v<min+36?6:v>max-36?-6:0;
   if(d.clientX>=r.left&&d.clientX<r.right&&d.clientY>=r.top&&d.clientY<r.bottom){
    const x=speed(d.clientX,r.left,r.right),y=speed(d.clientY,r.top,r.bottom);
    if(x||y){g.view.x+=x;g.view.y+=y;g.transform();this.paint(d);}
   }
   this.tick();
  });
 }
 finish(e,d){
  if(d.moved){
   const target=this.target(e,d);
   this.clear();
   if(target&&!target.invalid)this.onTransfer({sourceNodeId:d.sourceNodeId,placementId:d.placementId,targetNodeId:target.targetNodeId,index:target.index,copy:!!e.altKey});
   this.graph.root.focus({preventScroll:true});
  }else {
   this.clear();this.suppressClick=true;
   this.graph.openCard(d.sourceNodeId,d.placementId);
  }
 }
 clear(){
  if(this.frame)this.graph.root.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
  this.frame=null;this.ghost?.remove();this.line?.remove();this.ghost=null;this.line=null;
  for(const el of this.graph.root.querySelectorAll('.node')){el.classList.toggle('card-drop-target',false);el.classList.toggle('card-drop-invalid',false);}
 }
 consumeClick(){const suppress=this.suppressClick;this.suppressClick=false;return suppress;}
}
