import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createProject} from '../project/model.js';
import {openProjectSession} from '../studio/project-session.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;
function fixture({file=null,browser=true}={}) {
  const project=createProject();project.name='Browser project';
  const sourceText=JSON.stringify(project),values=new Map([['nest.project.v3',sourceText]]),writes=[];
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){writes.push(key);values.set(key,value);},removeItem(){throw Error('Must retain source');}};
  const browserLoaded=browser?{project,sourceText,recovery:{backupKey:'original'}}:{project:null,sourceText:null};
  const calls=[];
  const backend={probe:async()=>({available:true,text:file}),save:async(p,options)=>{
    calls.push({p,options});return {ok:true,primary:JSON.stringify(p,null,2)+'\n'};
  }};
  return {browserLoaded,backend,storage,writes,calls,sourceText,values};
}
const noChoice=()=>{throw Error('Unexpected chooser');};

test('static hosting retains existing browser behavior; API errors retain backend and block writes',async()=>{
  const h=fixture();h.backend.probe=async()=>({available:false});
  const browser=await openProjectSession({...h,choose:noChoice});
  assert.equal(browser.loaded,h.browserLoaded);assert.equal(browser.backend,null);assert.equal(browser.fileMode,false);
  h.backend.probe=async()=>{throw Error('HTTP 500');};
  const failed=await openProjectSession({...h,choose:noChoice});
  assert.equal(failed.backend,h.backend);assert.equal(failed.loaded.project,h.browserLoaded.project);
  assert.equal(Object.hasOwn(failed.loaded,'sourceText'),false);assert.match(failed.loaded.error,/Project file.*HTTP 500/);
});

test('missing file requires explicit migration and preserves exact browser source and recovery',async()=>{
  const h=fixture();const session=await openProjectSession({...h,choose:async({browser,file,browserSourceText})=>{
    assert.equal(browser,h.browserLoaded.project);assert.equal(file,null);assert.equal(browserSourceText,h.sourceText);return 'browser';
  }});
  assert.equal(session.migrated,true);assert.equal(session.fileMode,true);
  assert.deepEqual(h.calls[0].options,{expectedPrimary:null,migrationSourceText:h.sourceText});
  assert.equal(h.values.get('nest.project.v3'),h.sourceText);assert.deepEqual(h.browserLoaded.recovery,{backupKey:'original'});
  assert.deepEqual(h.writes,['nest.project.file-source.v1']);
});

test('new file selection does not migrate or write anything',async()=>{
  const h=fixture();const session=await openProjectSession({...h,choose:async()=> 'new'});
  assert.deepEqual(session.loaded,{project:null,sourceText:null});assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});

test('readonly prefers a valid existing file and otherwise browser without writes or prompts',async()=>{
  const h=fixture();const fileProject=createProject();fileProject.name='File project';
  const raw=JSON.stringify(fileProject);h.backend.probe=async()=>({available:true,text:raw});
  const file=await openProjectSession({...h,readonly:true,choose:noChoice});
  assert.equal(file.loaded.project.name,'File project');assert.equal(file.loaded.sourceText,raw);
  h.backend.probe=async()=>({available:true,text:null});
  const browser=await openProjectSession({...h,readonly:true,choose:noChoice});
  assert.equal(browser.loaded,h.browserLoaded);assert.equal(browser.backend,null);
  assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});

test('normalized identical projects and file-only sessions need no choice',async()=>{
  const h=fixture();const raw=JSON.stringify(h.browserLoaded.project,null,2)+'\n';
  h.backend.probe=async()=>({available:true,text:raw});
  assert.equal((await openProjectSession({...h,choose:noChoice})).loaded.sourceText,raw);
  h.browserLoaded={project:null,sourceText:null};
  assert.equal((await openProjectSession({...h,choose:noChoice})).loaded.sourceText,raw);
});

test('explicit file selection acknowledges original browser bytes across later file edits',async()=>{
  const h=fixture();const file=createProject();file.name='File';let raw=JSON.stringify(file);
  h.backend.probe=async()=>({available:true,text:raw});
  assert.equal((await openProjectSession({...h,choose:async()=> 'file'})).loaded.project.name,'File');
  file.name='Later file work';raw=JSON.stringify(file);
  assert.equal((await openProjectSession({...h,choose:noChoice})).loaded.project.name,'Later file work');
  h.browserLoaded={project:{...h.browserLoaded.project,name:'New browser work'},sourceText:'changed original bytes'};
  let prompted=false;await openProjectSession({...h,choose:async()=>{prompted=true;return 'file';}});assert.equal(prompted,true);
});

test('browser selection over existing file sends its exact competing raw text',async()=>{
  const file=createProject();file.name='File';const raw=JSON.stringify(file,null,3);
  const h=fixture({file:raw});await openProjectSession({...h,choose:async()=> 'browser'});
  assert.deepEqual(h.calls[0].options,{expectedPrimary:raw,migrationSourceText:h.sourceText});
});

test('save failures reprompt and conflicts update visible file and overwrite revision',async()=>{
  const h=fixture();const competing=createProject();competing.name='Competing';const raw=JSON.stringify(competing);let attempts=0,choices=0;
  h.backend.save=async(p,options)=>{
    attempts++;if(attempts===1)return {ok:false,error:'Disk full'};
    if(attempts===2)return {ok:false,conflict:true,primary:raw};
    assert.equal(options.expectedPrimary,raw);return {ok:true,primary:JSON.stringify(p)};
  };
  const session=await openProjectSession({...h,choose:async({error,file})=>{
    choices++;if(choices===2)assert.match(error,/Disk full/);
    if(choices===3){assert.match(error,/changed/);assert.equal(file.name,'Competing');}return 'browser';
  }});
  assert.equal(session.migrated,true);assert.equal(choices,3);assert.equal(h.values.get('nest.project.v3'),h.sourceText);
});

test('invalid existing or conflicting file blocks writes and never offers replacement',async()=>{
  const h=fixture({file:'broken raw JSON'});
  const failed=await openProjectSession({...h,choose:noChoice});assert.equal(Object.hasOwn(failed.loaded,'sourceText'),false);
  assert.match(failed.loaded.error,/Project file/);assert.equal(h.calls.length,0);
  h.backend.probe=async()=>({available:true,text:null});h.backend.save=async()=>({ok:false,conflict:true,primary:'damaged concurrent JSON'});
  let choices=0;const conflict=await openProjectSession({...h,choose:async()=>{choices++;return 'browser';}});
  assert.equal(choices,1);assert.equal(Object.hasOwn(conflict.loaded,'sourceText'),false);
});

test('empty sessions open new file drafts without writes and denied metadata cannot lose migration',async()=>{
  const h=fixture({browser:false});const empty=await openProjectSession({...h,choose:noChoice});
  assert.deepEqual(empty.loaded,{project:null,sourceText:null});assert.equal(h.calls.length,0);
  const m=fixture();m.storage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  assert.equal((await openProjectSession({...m,choose:async()=> 'browser'})).migrated,true);
});

test('HTTP LAN sessions acknowledge browser source without Web Crypto',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {
    const h=fixture();
    assert.equal((await openProjectSession({...h,choose:async()=> 'browser'})).migrated,true);
    assert.match(h.values.get('nest.project.file-source.v1'),/^[a-f0-9]{64}$/);
    const file=createProject();file.name='Later file edits';
    h.backend.probe=async()=>({available:true,text:JSON.stringify(file)});
    assert.equal((await openProjectSession({...h,choose:noChoice})).loaded.project.name,'Later file edits');
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});

test('disk loading remains usable when accessing browser storage itself is denied',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{get(){throw Error('Browser storage denied');},configurable:true});
  try {
    const h=fixture({browser:false,file:JSON.stringify(createProject())});
    const {storage,...options}=h;
    const session=await openProjectSession({...options,choose:noChoice});
    assert.equal(session.fileMode,true);assert.equal(session.loaded.project.name,'First expedition');
    assert.equal(h.calls.length,0);
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;
  }
});
