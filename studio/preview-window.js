import { uiScale } from './ui-scale.js';
/** Modeless preview host. Moving the window never touches the card gesture surface. */
export function mountPreviewWindow(root,{onClose=()=>{}}={}) {
 const handle=root.querySelector('[data-preview-drag]');
 const close=root.querySelector('[data-preview-close]');
 const toggle=root.querySelector('[data-preview-minimize]');
 const body=root.querySelector('.preview-window-body');
 const bar=root.querySelector('.preview-window-bar');
 const grip=root.querySelector('[data-preview-resize]');
 const reset=root.querySelector('[data-preview-reset]');
 const sizeReadout=root.querySelector('[data-preview-size]');
 const measureBar=()=>{if(bar)root.style.setProperty('--preview-bar-height',`${bar.getBoundingClientRect().height/uiScale(root)}px`);};
 const barObserver=typeof ResizeObserver==='function'&&bar?new ResizeObserver(measureBar):null;
 barObserver?.observe(bar);
 let drag=null,sizing=null,customSize=null,placed=false,minimized=false;
 const showSize=()=>{
  if(!sizeReadout||root.hidden||minimized)return;
  const rect=body.getBoundingClientRect(),scale=uiScale(root);
  sizeReadout.textContent=`${Math.round(rect.width/scale)} × ${Math.round(rect.height/scale)}`;
 };
 const sizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(showSize):null;
 sizeObserver?.observe(body);
 const position=(x,y)=>{
  const rect=root.getBoundingClientRect();
  root.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))/uiScale(root)}px`;
  root.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))/uiScale(root)}px`;
 };
 const clamp=()=>{const rect=root.getBoundingClientRect();position(rect.left,rect.top);};
 const setSize=(width,height)=>{
  const scale=uiScale(root),rect=root.getBoundingClientRect();
  const frameWidth=Math.max(0,(rect.width-body.getBoundingClientRect().width)/scale);
  const chrome=bar?bar.getBoundingClientRect().height/scale:48;
  const maxWidth=Math.max(1,(window.innerWidth-16)/scale-frameWidth);
  const maxHeight=Math.max(1,(window.innerHeight-16)/scale-chrome-2);
  customSize={width:Math.round(Math.min(maxWidth,Math.max(240,width))),height:Math.round(Math.min(maxHeight,Math.max(280,height)))};
  root.style.setProperty('--preview-custom-width',`${customSize.width+frameWidth}px`);
  root.style.setProperty('--preview-custom-height',`${customSize.height}px`);
  if(minimized)measureMinimizedBody();
  if(!root.hidden)position(rect.left,rect.top);
  showSize();
 };
 const resetSize=()=>{
  cancel();
  root.style.removeProperty('--preview-custom-width');root.style.removeProperty('--preview-custom-height');customSize=null;
  measureMinimizedBody();if(!root.hidden)clamp();showSize();
 };
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
  root.style.setProperty('--preview-body-height',`${body.getBoundingClientRect().height/uiScale(root)}px`);
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
  showSize();
 };
 const minimize=()=>{
  if(root.hidden||minimized)return;
  measureBody();minimized=true;updateState();toggle.focus();clamp();
 };
 const show=({restore:shouldRestore=false}={})=>{
  root.hidden=false;measureBar();
  if(customSize)setSize(customSize.width,customSize.height);
  if(shouldRestore)restore();
  else measureMinimizedBody();
  if(!placed){position(400*uiScale(root),100*uiScale(root));placed=true;}
  else clamp();
  showSize();
 };
 const cancel=()=>{
  // Clear first: releasing capture can synchronously dispatch lostpointercapture.
  const previous=drag;drag=null;root.classList.remove('dragging');
  if(previous&&handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);
  const previousSize=sizing;sizing=null;root.classList.remove('resizing');
  if(previousSize&&grip?.hasPointerCapture(previousSize.id))grip.releasePointerCapture(previousSize.id);
 };
 const hide=()=>{cancel();onClose();root.hidden=true;};
 const down=e=>{
  if(e.button!==0||e.isPrimary===false)return;
  const rect=root.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};
  handle.setPointerCapture(e.pointerId);handle.focus();root.classList.add('dragging');e.preventDefault();
 };
 const move=e=>{if(drag?.id===e.pointerId)position(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);};
 const up=e=>{if(drag?.id===e.pointerId)cancel();};
 const sizeDown=e=>{
  if(e.button!==0||e.isPrimary===false||minimized)return;
  cancel();const rect=body.getBoundingClientRect(),scale=uiScale(root);
  sizing={id:e.pointerId,x:e.clientX,y:e.clientY,width:rect.width/scale,height:rect.height/scale};
  grip.setPointerCapture(e.pointerId);grip.focus();root.classList.add('resizing');e.preventDefault();e.stopPropagation();
 };
 const sizeMove=e=>{if(sizing?.id===e.pointerId){const scale=uiScale(root);setSize(sizing.width+(e.clientX-sizing.x)/scale,sizing.height+(e.clientY-sizing.y)/scale);}};
 const sizeUp=e=>{if(sizing?.id===e.pointerId)cancel();};
 const sizeKey=e=>{
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(!delta||minimized)return;e.preventDefault();e.stopPropagation();
  const rect=body.getBoundingClientRect(),scale=uiScale(root),step=e.shiftKey?40:10;
  setSize(rect.width/scale+delta[0]*step,rect.height/scale+delta[1]*step);
 };
 const key=e=>{
  const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(!deltas[e.key])return;e.preventDefault();e.stopPropagation();
  const rect=root.getBoundingClientRect(),step=e.shiftKey?40:10;position(rect.left+deltas[e.key][0]*step,rect.top+deltas[e.key][1]*step);
 };
 const resize=()=>{
  if(root.hidden)return;
  if(customSize)setSize(customSize.width,customSize.height);
  measureMinimizedBody();
  clamp();
 };
 const toggleState=()=>{if(minimized)restore();else minimize();};
 updateState();
 handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,up);
 handle.addEventListener('keydown',key);close.addEventListener('click',hide);toggle.addEventListener('click',toggleState);window.addEventListener('resize',resize);
 grip?.addEventListener('pointerdown',sizeDown);grip?.addEventListener('pointermove',sizeMove);grip?.addEventListener('keydown',sizeKey);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])grip?.addEventListener(name,sizeUp);
 reset?.addEventListener('click',resetSize);
 return {show,hide,minimize,restore,resetSize,setSize,toggle:toggleState,get minimized(){return minimized;},get visible(){return !root.hidden;},destroy(){cancel();barObserver?.disconnect();sizeObserver?.disconnect();root.style.removeProperty('--preview-bar-height');handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.removeEventListener(name,up);handle.removeEventListener('keydown',key);close.removeEventListener('click',hide);toggle.removeEventListener('click',toggleState);window.removeEventListener('resize',resize);grip?.removeEventListener('pointerdown',sizeDown);grip?.removeEventListener('pointermove',sizeMove);grip?.removeEventListener('keydown',sizeKey);for(const name of ['pointerup','pointercancel','lostpointercapture'])grip?.removeEventListener(name,sizeUp);reset?.removeEventListener('click',resetSize);}};
}
