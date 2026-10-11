/** Modeless preview host. Moving the window never touches the card gesture surface. */
export function mountPreviewWindow(root,{onClose=()=>{}}={}) {
 const handle=root.querySelector('[data-preview-drag]');
 const close=root.querySelector('[data-preview-close]');
 let drag=null,placed=false;
 const position=(x,y)=>{
  const rect=root.getBoundingClientRect();
  root.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
  root.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
 };
 const show=()=>{
  root.hidden=false;
  if(!placed){position(window.innerWidth-root.getBoundingClientRect().width-24,100);placed=true;}
  else{const rect=root.getBoundingClientRect();position(rect.left,rect.top);}
 };
 const cancel=()=>{
  if(drag&&handle.hasPointerCapture(drag.id))handle.releasePointerCapture(drag.id);
  drag=null;root.classList.remove('dragging');
 };
 const hide=()=>{cancel();onClose();root.hidden=true;};
 const down=e=>{
  if(e.button!==0||e.isPrimary===false)return;
  const rect=root.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};
  handle.setPointerCapture(e.pointerId);handle.focus();root.classList.add('dragging');e.preventDefault();
 };
 const move=e=>{if(drag?.id===e.pointerId)position(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);};
 const up=e=>{if(drag?.id===e.pointerId)cancel();};
 const key=e=>{
  const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(!deltas[e.key])return;e.preventDefault();e.stopPropagation();
  const rect=root.getBoundingClientRect(),step=e.shiftKey?40:10;position(rect.left+deltas[e.key][0]*step,rect.top+deltas[e.key][1]*step);
 };
 const resize=()=>{if(!root.hidden){const rect=root.getBoundingClientRect();position(rect.left,rect.top);}};
 handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,up);
 handle.addEventListener('keydown',key);close.addEventListener('click',hide);window.addEventListener('resize',resize);
 return {show,hide,destroy(){cancel();handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(name,up);handle.removeEventListener('keydown',key);close.removeEventListener('click',hide);window.removeEventListener('resize',resize);}};
}
