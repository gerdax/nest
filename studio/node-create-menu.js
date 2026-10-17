import { nodeTypes } from '../project/nodeTypes.js';
import { nodeIcon } from './node-icons.js';
import { esc } from './forms.js';

/** Screen-space chooser; the request retains the original graph-space drop point. */
export function mountNodeCreateMenu({onChoose, onDismiss, returnFocus, document:doc = document}) {
 const menu=doc.createElement('div');
 menu.className='node-create-menu';menu.hidden=true;menu.tabIndex=-1;
 menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Create and connect a beat');
 menu.innerHTML='<div class="node-create-prompt">Create and connect</div><div class="node-create-types">'+Object.entries(nodeTypes)
  .filter(([,descriptor])=>descriptor.create)
  .map(([type,descriptor])=>`<button type="button" data-node-type="${esc(type)}" title="${esc(descriptor.label)}" aria-label="Create ${esc(descriptor.label)} beat">${nodeIcon(type)}<span>${esc(descriptor.label)}</span></button>`).join('')+'</div>';
 doc.body.append(menu);
 const buttons=[...menu.querySelectorAll('[data-node-type]')];
 let request=null;
 function close({restoreFocus=false}={}) {
  const wasOpen=!!request;request=null;menu.hidden=true;
  if(wasOpen&&restoreFocus)returnFocus?.focus({preventScroll:true});
 }
 function dismiss(restoreFocus=false){if(!request)return;close({restoreFocus});onDismiss();}
 menu.addEventListener('click',event=>{
  const button=event.target.closest('[data-node-type]');if(!button||!request)return;
  const context=request;close({restoreFocus:true});onChoose(button.dataset.nodeType,context);
 });
 menu.addEventListener('keydown',event=>{
  const index=buttons.indexOf(doc.activeElement);
  let next;
  if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%buttons.length;
  if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=index<0?buttons.length-1:(index+buttons.length-1)%buttons.length;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=buttons.length-1;
  if(next!==undefined){event.preventDefault();buttons[next].focus();}
 });
 const outside=event=>{if(request&&!menu.contains(event.target))dismiss();};
 const keydown=event=>{if(request&&event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss(true);}};
 const focusout=event=>{if(request&&!menu.contains(event.target))dismiss();};
 const resize=()=>dismiss();
 doc.addEventListener('pointerdown',outside,true);
 doc.addEventListener('keydown',keydown,true);
 doc.addEventListener('focusin',focusout);
 doc.defaultView.addEventListener('resize',resize);
 return {
  open(context){
   request=context;menu.hidden=false;
   const bounds=menu.getBoundingClientRect(),view=doc.defaultView;
   menu.style.left=`${Math.max(8,Math.min(context.clientX,view.innerWidth-bounds.width-8))}px`;
   menu.style.top=`${Math.max(8,Math.min(context.clientY,view.innerHeight-bounds.height-8))}px`;
   menu.focus({preventScroll:true});
  },
  close,
  destroy(){dismiss();doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',focusout);doc.defaultView.removeEventListener('resize',resize);menu.remove();}
 };
}
