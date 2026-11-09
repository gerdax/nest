const STORAGE_KEY = 'nest.editor.autoplay';

/** Selection starts playback; document edits and playback updates never call this. */
export function mountAutoplay(checkbox,{getSelected,onPlay,storage}={}) {
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
 let enabled=true;
 try{enabled=storage?.getItem(STORAGE_KEY)!=='false';}catch{}
 checkbox.checked=enabled;
 const select=id=>{if(enabled&&id)onPlay(id);};
 const change=()=>{
  enabled=checkbox.checked;
  try{storage?.setItem(STORAGE_KEY,String(enabled));}catch{}
  if(enabled)select(getSelected());
 };
 checkbox.addEventListener('change',change);
 return {select,get enabled(){return enabled;},destroy(){checkbox.removeEventListener('change',change);}};
}
