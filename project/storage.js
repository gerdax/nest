import { parseProject } from './model.js';
export const STORAGE_KEY = 'nest.project.v2';
export const LEGACY_STORAGE_KEY = 'nest.chapter.v1';
export function saveProject(project, storage) {
  try { const text = JSON.stringify(parseProject(JSON.stringify(project),{allowDraft:true})); (storage ?? globalThis.localStorage).setItem(STORAGE_KEY,text); return {ok:true}; }
  catch(error) { return {ok:false,error:error.message || String(error)}; }
}
export function loadProject(storage) {
  try { const store = storage ?? globalThis.localStorage; const text = store.getItem(STORAGE_KEY); if(text !== null) return {project:parseProject(text,{allowDraft:true})}; const old = store.getItem(LEGACY_STORAGE_KEY); return {project:old === null ? null : parseProject(old,{allowDraft:true}),migrated:old !== null}; }
  catch(error) { return {project:null,error:error.message || String(error)}; }
}
