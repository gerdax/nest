/** Editor-blocking settings window. The interaction preview remains usable above it. */
export function mountProjectSettingsWindow(overlay,{trigger,preview,onOpen=()=>{}}) {
 const doc=overlay.ownerDocument,dialog=overlay.querySelector('[role="dialog"]');
 const closeButton=overlay.querySelector('[data-close-project-settings]');
 let previousFocus,blocked=[];
 const allowed=target=>overlay.contains(target)||preview.contains(target);
 const focusables=()=>[...overlay.querySelectorAll('button,input,select,textarea,a[href],[tabindex]'),...preview.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
  .filter(el=>!el.disabled&&el.tabIndex>=0&&!el.closest('[hidden],[inert]')&&el.getClientRects().length);
 function close(){
  if(overlay.hidden)return;
  overlay.hidden=true;trigger.setAttribute('aria-expanded','false');
  for(const [element,inert] of blocked)element.inert=inert;
  blocked=[];doc.body.classList.remove('project-settings-open');
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
 }
 function open(){
  if(!overlay.hidden)return;
  previousFocus=doc.activeElement;onOpen();overlay.hidden=false;
  trigger.setAttribute('aria-expanded','true');
  blocked=[...doc.body.children].filter(el=>el!==overlay&&el!==preview&&el.tagName!=='SCRIPT').map(el=>[el,el.inert]);
  for(const [element] of blocked)element.inert=true;
  doc.body.classList.add('project-settings-open');
  closeButton.focus({preventScroll:true});
 }
 const backdrop=event=>{if(event.target===overlay)close();};
 const keydown=event=>{
  if(overlay.hidden)return;
  if(event.key==='Escape'&&!preview.contains(event.target)){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key!=='Tab')return;
  const controls=focusables(),index=controls.indexOf(doc.activeElement);
  if(!controls.length){event.preventDefault();dialog.focus();return;}
  if(event.shiftKey?(index<=0):(index===controls.length-1||index<0)){
   event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus();
  }
 };
 const focusin=event=>{if(!overlay.hidden&&!allowed(event.target))dialog.focus({preventScroll:true});};
 trigger.addEventListener('click',open);closeButton.addEventListener('click',close);
 overlay.addEventListener('click',backdrop);doc.addEventListener('keydown',keydown,true);doc.addEventListener('focusin',focusin);
 return {open,close,destroy(){close();trigger.removeEventListener('click',open);closeButton.removeEventListener('click',close);overlay.removeEventListener('click',backdrop);doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',focusin);}};
}
