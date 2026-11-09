import {parseCurrentProject} from '../project/model.js';
import {parseStudioImport} from './persistence.js';
import {validateProjectFilename} from './project-file-storage.js';

export function projectFileName(value) {
  const name=String(value??'').trim().replace(/\.json$/i,'.json');
  return validateProjectFilename(name.endsWith('.json')?name:`${name}.json`);
}

export function activeProjectFilename({location=globalThis.location,storage}={}) {
  const names=new URL(location?.href??'http://localhost/editor.html').searchParams.getAll('project');
  if(names.length>1)throw Error('Choose one project file in the address.');
  if(names.length)return validateProjectFilename(names[0]);
  try {const saved=storage?.getItem('nest.project.active-file.v1');if(saved)return validateProjectFilename(saved);} catch {}
  return 'nest-project.json';
}

export function rememberProjectFile(filename,storage) {
  validateProjectFilename(filename);
  try {storage?.setItem('nest.project.active-file.v1',filename);} catch {}
}

export function projectFileUrl(filename,href) {
  validateProjectFilename(filename);
  const url=new URL(href);url.searchParams.set('project',filename);return url.href;
}

/** A file switch is a navigation, so history and pending writes cannot cross
 * project boundaries. No current draft is discarded until the target is valid. */
export function createProjectFileActions({backend,getProject,persistence,confirmOverwrite,chooseUnsaved,navigate,openLocalProject,isLocal=false}) {
  const error=result=>({ok:false,error:result.error||(result.conflict?'The target file changed. Try again to review the newer version.':'The project could not be saved.')});
  async function leaveCurrent() {
    await persistence.flush();
    if(!persistence.hasUnsaved)return {ok:true};
    const choice=await chooseUnsaved();
    if(choice==='cancel')return {ok:false,cancelled:true};
    if(choice==='discard')return {ok:true};
    if(choice!=='save')return {ok:false,cancelled:true};
    const result=await persistence.saveQueued(getProject());
    return result.ok?result:error(result);
  }
  async function saveAs(value) {
    try {
      const filename=projectFileName(value);
      await persistence.flush();
      const project=getProject();
      if(filename===backend.filename&&!isLocal){
        const result=await persistence.saveQueued(project);return result.ok?result:error(result);
      }
      const target=backend.forFile(filename),state=await target.probe();
      if(!state.available)throw Error('The project file server is unavailable.');
      if(state.text!==null&&!await confirmOverwrite(filename))return {ok:false,cancelled:true};
      const result=await target.save(project,{expectedPrimary:state.text});
      if(!result.ok)return error(result);
      navigate(filename);
      return {ok:true,filename};
    } catch(cause){return {ok:false,error:cause.message};}
  }
  async function open(value) {
    try {
      const filename=projectFileName(value),target=backend.forFile(filename);
      const state=await target.probe();
      if(!state.available||state.text===null)throw Error('This project file is no longer available.');
      parseCurrentProject(state.text,{allowDraft:true});
      const permission=await leaveCurrent();if(!permission.ok)return permission;
      navigate(filename);
      return {ok:true,filename};
    } catch(cause){return {ok:false,error:cause.message};}
  }
  async function openLocal(file) {
    try {
      const {project}=parseStudioImport(await file.text(),{kind:'project'});
      const permission=await leaveCurrent();if(!permission.ok)return permission;
      openLocalProject(project,file.name);
      return {ok:true};
    } catch(cause){return {ok:false,error:cause.message};}
  }
  return {saveAs,open,openLocal};
}
