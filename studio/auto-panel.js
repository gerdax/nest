const STORAGE_KEY = 'nest.editor.autoPanel';

/** Follow the same stable visible-card notifications used by graph highlights. */
export function mountAutoPanel(checkbox,{getTarget,onReveal,storage}={}) {
 if(storage===undefined){try{storage=globalThis.localStorage;}catch{}}
 let enabled=false,lastKey=null,destroyed=false;
 try{enabled=storage?.getItem(STORAGE_KEY)==='true';}catch{}
 checkbox.checked=enabled;
 const follow=target=>{
  if(destroyed||!enabled)return;
  const key=target?JSON.stringify([target.chapterId,target.nodeId,target.sequenceId,target.slot,target.parentCardId,target.placementId]):null;
  if(key===lastKey)return;
  lastKey=key;
  if(target)onReveal(target);
 };
 const change=()=>{
  enabled=checkbox.checked;lastKey=null;
  try{storage?.setItem(STORAGE_KEY,String(enabled));}catch{}
  if(enabled)follow(getTarget());
 };
 checkbox.addEventListener('change',change);
 return {follow,get enabled(){return enabled;},destroy(){destroyed=true;checkbox.removeEventListener('change',change);}};
}
