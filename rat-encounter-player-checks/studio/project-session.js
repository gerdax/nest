import {loadProject} from '../project/storage.js';
import {parseProject} from '../project/model.js';
import {createProjectFileBackend} from './project-file-storage.js';
import {sha256} from './sha256.js';
import {activeProjectFilename,rememberProjectFile} from './project-file-actions.js';

const SOURCE_KEY = 'nest.project.file-source.v1';
const message = error => error?.message || String(error);
const normalized = project => JSON.stringify(parseProject(JSON.stringify(project), {allowDraft:true}));

export async function openProjectSession({browserLoaded = loadProject(), backend,
  storage, choose = chooseProjectSource, readonly = false} = {}) {
  if (storage === undefined) try {storage = globalThis.localStorage;} catch {} // Disk saving does not require browser storage access.
  let selectionError;
  if(!backend)try{backend=createProjectFileBackend({filename:activeProjectFilename({storage})});}
  catch(error){selectionError=error;backend=createProjectFileBackend();}
  const browser = browserLoaded.project;
  const browserSourceText = browserLoaded.sourceText ?? (browser ? JSON.stringify(browser) : null);
  const failed = error => ({loaded:{project:browser || null,error:`Project file could not be opened safely: ${message(error)}`},backend,fileMode:true});
  if(selectionError)return failed(selectionError);
  let probe;
  try {probe = await backend.probe();} catch (error) {return failed(error);}
  if (!probe.available) return {loaded:browserLoaded,backend:null,fileMode:false};
  let raw = probe.text, file;
  const parseFile = () => raw === null ? null : parseProject(raw,{allowDraft:true});
  try {file = parseFile();} catch (error) {return failed(error);}
  const fileSession = () => {
    if(!readonly&&file&&backend.filename)rememberProjectFile(backend.filename,storage);
    return {loaded:{project:file,sourceText:raw},backend,fileMode:true};
  };
  if (readonly) return raw === null ? {loaded:browserLoaded,backend:null,fileMode:false} : fileSession();
  let sourceFingerprint;
  if (browser) {
    try {sourceFingerprint = sha256(browserSourceText);} catch {} // Metadata cannot authorize a write.
  }
  const acknowledged = () => {
    try {return sourceFingerprint && storage?.getItem(SOURCE_KEY) === sourceFingerprint;} catch {return false;}
  };
  const acknowledge = () => {
    if (sourceFingerprint) try {storage?.setItem(SOURCE_KEY,sourceFingerprint);} catch {} // Existing source remains untouched.
  };
  if (file && (!browser || acknowledged())) return fileSession();
  if (file && normalized(file) === normalized(browser)) {acknowledge();return fileSession();}
  if (!file && !browser) return fileSession();
  let error;
  for (;;) {
    const choice = await choose({browser,file,browserSourceText,error});
    if (choice === 'file' && file) {acknowledge();return fileSession();}
    if (choice === 'new' && raw === null) return {loaded:{project:null,sourceText:null},backend,fileMode:true};
    if (choice !== 'browser' || !browser) {error = 'Choose an available project source.';continue;}
    let result;
    try {result = await backend.save(browser,{expectedPrimary:raw,migrationSourceText:browserSourceText});}
    catch (saveError) {result = {ok:false,error:message(saveError)};}
    if (result.ok) {
      if (typeof result.primary !== 'string') return failed('The saved project could not be verified.');
      raw = result.primary;
      try {file = parseFile();} catch (parseError) {return failed(parseError);}
      acknowledge();
      return {...fileSession(),migrated:true};
    }
    if (result.conflict) {
      raw = result.primary;
      try {file = parseFile();} catch (parseError) {return failed(parseError);}
      error = 'The project file changed. Choose which project to open.';
    } else error = `Project file save failed: ${result.error || 'Unknown error'}`;
  }
}

// Selection is intentionally separate from session policy so tests and embedded
// hosts can supply their own accessible chooser without touching persistence.
export function chooseProjectSource({browser,file,browserSourceText,error} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');overlay.className='project-settings-overlay';
    const dialog = document.createElement('section');dialog.className='project-settings-dialog';
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Choose project source');
    const heading=document.createElement('h2');heading.textContent='Choose project source';dialog.append(heading);
    const description=document.createElement('p');description.textContent='Choose the project to use with JSON file saving. Your browser project will remain available as a backup.';dialog.append(description);
    for (const [label,project] of [['Project file',file],['Browser project',browser]]) {
      if (!project) continue;
      const info=document.createElement('p');info.textContent=`${label}: ${project.name || 'Untitled'} · ${project.library?.length || 0} library entries`;dialog.append(info);
    }
    if(error){const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=error;dialog.append(notice);}
    const previousFocus=document.activeElement;
    const inertStates=Array.from(document.body.children,element=>[element,element.inert]);
    const finish=choice=>{overlay.remove();for(const [element,inert] of inertStates)element.inert=inert;previousFocus?.focus?.();resolve(choice);};
    const button=(text,action)=>{const control=document.createElement('button');control.type='button';control.textContent=text;control.addEventListener('click',action);dialog.append(control);return control;};
    if(file)button('Open project file',()=>finish('file'));
    if(browser)button('Save browser project to JSON',()=>finish('browser'));
    if(!file)button('Start new file project',()=>finish('new'));
    if(browser && typeof browserSourceText==='string')button('Download browser backup',()=>{
      const url=URL.createObjectURL(new Blob([browserSourceText],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='nest-browser-backup.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    overlay.append(dialog);for(const [element] of inertStates)element.inert=true;document.body.append(overlay);
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const controls=Array.from(dialog.querySelectorAll('button'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    });
    dialog.querySelector('button')?.focus();
  });
}
