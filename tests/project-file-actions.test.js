import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model.js';
import {createProjectFileActions,activeProjectFilename,rememberProjectFile,projectFileName,projectFileUrl} from '../studio/project-file-actions.js';
import {projectSettingsInspector} from '../studio/inspectors.js';

function fixture() {
 const project=createProject(),original=JSON.stringify(project),files=new Map([['a.json',original]]),calls=[],navigated=[];
 const state={project,dirty:false,choice:'cancel',overwrite:false,saveOK:true,gate:Promise.resolve()};
 const backend=name=>Object.freeze({filename:name,async probe(){calls.push(['read',name]);return {available:true,text:files.get(name)??null};},
  forFile:backend,async save(value,{expectedPrimary}){calls.push(['write',name]);const current=files.get(name)??null;if(current!==expectedPrimary)return {ok:false,conflict:true,primary:current};const primary=JSON.stringify(value);files.set(name,primary);return {ok:true,primary};}});
 const persistence={async flush(){calls.push(['flush']);await state.gate;return {ok:true};},get hasUnsaved(){return state.dirty;},async saveQueued(value){calls.push(['save-current']);if(!state.saveOK)return {ok:false,error:'Disk full'};files.set('a.json',JSON.stringify(value));state.dirty=false;return {ok:true};}};
 const actions=createProjectFileActions({backend:backend('a.json'),getProject:()=>state.project,persistence,
  confirmOverwrite:async name=>{calls.push(['confirm',name]);return typeof state.overwrite==='function'?state.overwrite(name):state.overwrite;},
  chooseUnsaved:async()=>{calls.push(['unsaved']);return state.choice;},navigate:name=>navigated.push(name)});
 return {state,files,calls,navigated,actions,backend,original};
}

test('Save as creates a separate project and navigates only after verified save, preserving the original',async()=>{
 const h=fixture();h.state.project.name='Second project';h.state.dirty=true;
 const result=await h.actions.saveAs('b');assert.equal(result.ok,true);
 assert.equal(h.files.get('a.json'),h.original);assert.equal(JSON.parse(h.files.get('b.json')).name,'Second project');
 assert.deepEqual(h.navigated,['b.json']);assert.equal(h.calls.some(([kind])=>kind==='save-current'),false);
 assert.equal(h.state.dirty,true,'old dirty state is not falsely cleared before navigation');
 const b=h.backend('b.json'),beforeA=h.files.get('a.json');
 const next={...h.state.project,name:'Later B edit'};await b.save(next,{expectedPrimary:h.files.get('b.json')});
 assert.equal(h.files.get('a.json'),beforeA);assert.equal(JSON.parse(h.files.get('b.json')).name,'Later B edit');
});

test('Save as waits for pending old writes; immutable old backend is never retargeted',async()=>{
 const h=fixture();let release;h.state.gate=new Promise(resolve=>release=resolve);
 const saving=h.actions.saveAs('b.json');await Promise.resolve();
 assert.deepEqual(h.calls,[['flush']]);assert.equal(h.files.has('b.json'),false);
 release();await saving;assert.deepEqual(h.navigated,['b.json']);assert.equal(h.files.get('a.json'),h.original);
});

test('Save as the current filename uses its existing persistence conflict boundary',async()=>{
 const h=fixture();h.state.project.name='Current edit';h.state.saveOK=false;
 const result=await h.actions.saveAs('a.json');assert.equal(result.ok,false);assert.match(result.error,/Disk full/);
 assert.equal(h.files.get('a.json'),h.original);assert.deepEqual(h.navigated,[]);
 assert(h.calls.some(([kind])=>kind==='save-current'));assert(!h.calls.some(([kind])=>kind==='read'));
});

test('existing destinations need confirmation and a later external change cannot be overwritten',async()=>{
 const h=fixture();h.files.set('b.json','existing');
 assert.equal((await h.actions.saveAs('b.json')).cancelled,true);assert.equal(h.files.get('b.json'),'existing');
 h.state.overwrite=()=>{h.files.set('b.json','newer competing file');return true;};
 const raced=await h.actions.saveAs('b.json');assert.equal(raced.ok,false);assert.match(raced.error,/target file changed/);
 assert.equal(h.files.get('b.json'),'newer competing file');assert.deepEqual(h.navigated,[]);
});

test('Open project reads its file without saving over either file',async()=>{
 const h=fixture();const second={...createProject(),name:'B'};h.files.set('b.json',JSON.stringify(second));
 assert.equal((await h.actions.open('b.json')).ok,true);assert.deepEqual(h.navigated,['b.json']);
 assert.equal(h.files.get('a.json'),h.original);assert.equal(JSON.parse(h.files.get('b.json')).name,'B');
 assert(!h.calls.some(([kind])=>['write','save-current'].includes(kind)));
});

for(const choice of ['cancel','discard','save'])test(`switching with unsaved changes supports ${choice}`,async()=>{
 const h=fixture();h.files.set('b.json',h.original);h.state.project.name='Edited A';h.state.dirty=true;h.state.choice=choice;
 const result=await h.actions.open('b.json');
 assert.equal(result.ok,choice!=='cancel');assert.deepEqual(h.navigated,choice==='cancel'?[]:['b.json']);
 assert.equal(JSON.parse(h.files.get('a.json')).name,choice==='save'?'Edited A':'First expedition');
 assert.equal(h.files.get('b.json'),h.original);
});

test('a failed Save before opening, or an invalid/missing target, keeps the current project open',async()=>{
 const h=fixture();h.state.dirty=true;h.state.choice='save';h.state.saveOK=false;h.files.set('b.json',h.original);
 assert.match((await h.actions.open('b.json')).error,/Disk full/);assert.deepEqual(h.navigated,[]);
 h.files.set('b.json','broken JSON');assert.equal((await h.actions.open('b.json')).ok,false);
 assert.equal((await h.actions.open('missing.json')).ok,false);assert.deepEqual(h.navigated,[]);assert.equal(h.state.dirty,true);
});

test('external imports are saved as named copies and honor unsaved-change cancellation',async()=>{
 const h=fixture(),incoming={...createProject(),name:'Imported'};h.state.dirty=true;
 assert.equal((await h.actions.saveAs('imported.json',{project:incoming})).cancelled,true);assert(!h.files.has('imported.json'));
 h.state.choice='discard';assert.equal((await h.actions.saveAs('imported.json',{project:incoming})).ok,true);
 assert.equal(JSON.parse(h.files.get('imported.json')).name,'Imported');assert.equal(h.files.get('a.json'),h.original);
});

test('file URLs pin each tab, override the last-opened metadata and retain unrelated URL settings',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 rememberProjectFile('b.json',storage);
 assert.equal(activeProjectFilename({location:{href:'http://localhost/editor.html'},storage}),'b.json');
 const a=projectFileUrl('a.json','http://localhost/editor.html?other=1#controls');
 assert.equal(activeProjectFilename({location:{href:a},storage}),'a.json');
 rememberProjectFile('c.json',storage);assert.equal(activeProjectFilename({location:{href:a},storage}),'a.json');
 assert.equal(new URL(a).searchParams.get('other'),'1');assert.equal(new URL(a).hash,'#controls');
 assert.throws(()=>activeProjectFilename({location:{href:'http://localhost/editor.html?project=a.json&project=b.json'},storage}));
 for(const name of ['../outside.json','a/b.json','.hidden.json','a.backup.123.json',''])assert.throws(()=>projectFileName(name));
 assert.equal(projectFileName(' B.JSON '),'B.json');
});

test('Project settings describe the selected autosave file',()=>{
 const html=projectSettingsInspector(createProject(),{fileMode:true,filePath:'saved-projects/b.json'});
 assert.match(html,/Save changes automatically to saved-projects\/b\.json/);
});
