/** Modeless preview host. Moving the window never touches the card gesture surface. */
export function mountPreviewWindow(root,{onClose=()=>{}}={}) {
 const handle=root.querySelector('[data-preview-drag]');
 const close=root.querySelector('[data-preview-close]');
 const toggle=root.querySelector('[data-preview-minimize]');
 const body=root.querySelector('.preview-window-body');
 const bar=root.querySelector('.preview-window-bar');
 const measureBar=()=>{if(bar)root.style.setProperty('--preview-bar-height',`${bar.getBoundingClientRect().height}px`);};
 const barObserver=typeof ResizeObserver==='function'&&bar?new ResizeObserver(measureBar):null;
 barObserver?.observe(bar);
 let drag=null,placed=false,minimized=false;
 const position=(x,y)=>{
  const rect=root.getBoundingClientRect();
  root.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
  root.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
 };
 const clamp=()=>{const rect=root.getBoundingClientRect();position(rect.left,rect.top);};
 const updateState=()=>{
  root.classList.toggle('minimized',minimized);
  body.inert=minimized;
  if(minimized)body.setAttribute('aria-hidden','true');else body.removeAttribute('aria-hidden');
  toggle.setAttribute('aria-expanded',String(!minimized));
  const label=minimized?'Restore preview':'Minimize preview';
  toggle.setAttribute('aria-label',minimized?'Restore interaction preview':'Minimize interaction preview');toggle.title=label;toggle.textContent=minimized?'□':'−';
 };
 const measureBody=()=>{
  // Preserve the expanded viewport for the still-running deck while the host collapses.
  root.style.setProperty('--preview-body-height',`${body.getBoundingClientRect().height}px`);
 };
 const measureMinimizedBody=()=>{
  if(!minimized)return;
  // Read the natural height at the current viewport without changing state or focus.
  root.classList.remove('minimized');body.style.visibility='hidden';
  measureBody();root.classList.add('minimized');body.style.removeProperty('visibility');
 };
 const restore=()=>{
  minimized=false;updateState();root.style.removeProperty('--preview-body-height');
  if(!root.hidden)clamp();
 };
 const minimize=()=>{
  if(root.hidden||minimized)return;
  measureBody();minimized=true;updateState();toggle.focus();clamp();
 };
 const show=({restore:shouldRestore=false}={})=>{
  root.hidden=false;measureBar();
  if(shouldRestore)restore();
  else measureMinimizedBody();
  if(!placed){position(400,100);placed=true;}
  else clamp();
 };
 const cancel=()=>{
  // Clear first: releasing capture can synchronously dispatch lostpointercapture.
  const previous=drag;drag=null;root.classList.remove('dragging');
  if(previous&&handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);
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
 const resize=()=>{
  if(root.hidden)return;
  measureMinimizedBody();
  clamp();
 };
 const toggleState=()=>{if(minimized)restore();else minimize();};
 updateState();
 handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,up);
 handle.addEventListener('keydown',key);close.addEventListener('click',hide);toggle.addEventListener('click',toggleState);window.addEventListener('resize',resize);
 return {show,hide,minimize,restore,toggle:toggleState,get minimized(){return minimized;},get visible(){return !root.hidden;},destroy(){cancel();barObserver?.disconnect();root.style.removeProperty('--preview-bar-height');handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(name,up);handle.removeEventListener('keydown',key);close.removeEventListener('click',hide);toggle.removeEventListener('click',toggleState);window.removeEventListener('resize',resize);}};
}
