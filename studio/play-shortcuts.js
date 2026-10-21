import { typingControls } from './view-shortcuts.js';

/** Playback and editor commands work across panels without activating controls. */
export function mountPlayShortcuts(root,{playSelected,commitField=()=>false,enabled=()=>true,playbackDeck=()=>null}) {
 const host=root.defaultView ?? root;
 const consume=event=>{event.preventDefault();event.stopPropagation();};
 const keydown=event=>{
  if(event.defaultPrevented||event.isComposing||event.altKey)return;
  const typing=event.target?.closest?.(typingControls);
  const modified=event.metaKey||event.ctrlKey;
  const plain=!modified&&!event.shiftKey;
  if(plain&&!typing&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){
   // Sliders and the preview drag handle retain their own assigned arrow controls.
   if(event.target?.closest?.('input[type="range"],[role="slider"],[data-preview-drag],[role="menu"],[role="tree"],[role="listbox"]'))return;
   const deck=playbackDeck();
   if(deck){consume(event);deck.key(event);}
   return;
  }
  if(event.key!=='Enter')return;
  if(plain){
   if(typing)return;
   consume(event);playbackDeck()?.key(event);return;
  }
  if(modified&&!event.shiftKey){
   if(!typing)consume(event);
   if(event.repeat||event.target?.closest?.('#preview-window'))return;
   if(commitField(event.target)===true)consume(event);
   return;
  }
  if(event.shiftKey&&!modified){
   consume(event);
   if(!event.repeat&&enabled())playSelected();
  }
 };
 host.addEventListener('keydown',keydown,{capture:true});
 return ()=>host.removeEventListener('keydown',keydown,{capture:true});
}
