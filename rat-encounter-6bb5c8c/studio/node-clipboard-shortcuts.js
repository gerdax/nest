/** Beat shortcuts leave text editing, dialogs and the interaction preview alone. */
export function mountNodeClipboardShortcuts(root,{copy,cut,paste,duplicate,enabled=()=>true}) {
 const actions={c:copy,x:cut,v:paste,d:duplicate};
 const keydown=event=>{
  if(event.defaultPrevented||event.repeat||event.isComposing||event.altKey||event.shiftKey||!(event.metaKey||event.ctrlKey)||!enabled())return;
  const action=actions[event.key?.toLowerCase()];if(!action)return;
  if(event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog,[role="dialog"],#preview-window'))return;
  if(root.getSelection?.()?.toString())return;
  if(action()!==false)event.preventDefault();
 };
 root.addEventListener('keydown',keydown);
 return ()=>root.removeEventListener('keydown',keydown);
}
