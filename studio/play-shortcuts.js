/** Command/Control+Enter commits a field; Shift+Enter restarts the selected beat without editing. */
export function mountPlayShortcuts(root,{playSelected,commitField=()=>false,enabled=()=>true}) {
 const keydown=event=>{
  if(event.key!=='Enter'||event.defaultPrevented||event.repeat||event.isComposing
   ||event.altKey)return;
  const modified=event.metaKey||event.ctrlKey;
  if(modified&&!event.shiftKey){
   if(event.target?.closest?.('#preview-window'))return;
   if(commitField(event.target)===true)event.preventDefault();
   return;
  }
  if(!event.shiftKey||modified||!enabled())return;
  // Intercept before focused playback controls can act on the same Enter.
  event.preventDefault();event.stopPropagation();
  playSelected();
 };
 root.addEventListener('keydown',keydown,{capture:true});
 return ()=>root.removeEventListener('keydown',keydown,{capture:true});
}
