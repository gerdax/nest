import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createProject} from '../project/model.js';
import {createProjectFileBackend,validateProjectFilename} from '../studio/project-file-storage.js';
import {createPersistence} from '../studio/persistence.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const path = 'saved-projects/nest-project.json';
const hash = async text => text === null ? null : Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
const response = (status, data) => ({status,ok:status>=200&&status<300,json:async()=>data});
function server(initial = null) {
  let text=initial, posts=[], failAfterCommit=false, failRead=false, readReplacement;
  return {
    get text(){return text;}, set text(value){text=value;}, posts,
    set failAfterCommit(value){failAfterCommit=value;},set failRead(value){failRead=value;},
    set readReplacement(value){readReplacement=value;},
    async fetch(url,options={}) {
      if(options.method==='POST') {
        const body=JSON.parse(options.body);posts.push(body);
        if(body.expectedRevision!==await hash(text))return response(409,{conflict:true,text,revision:await hash(text),path});
        text=body.text;
        if(failAfterCommit)throw Error('Connection lost');
        const result=response(200,{ok:true,text,revision:await hash(text),path,backupPath:body.migrationSourceText?'saved-projects/source.json':undefined});
        if(readReplacement!==undefined)text=readReplacement;
        return result;
      }
      if(failRead)throw Error('Read failed');
      return response(200,{available:true,text,revision:await hash(text),path});
    }
  };
}
function fixture({autosave=true}={}) {
  const project=createProject();project.autosave=autosave;
  const sourceText=JSON.stringify(project), api=server(sourceText),statuses=[];
  const backend={...createProjectFileBackend({fetch:api.fetch})};
  const storage={getItem(){throw Error('Browser storage must not be read');},setItem(){throw Error('Browser storage must not be written');},removeItem(){throw Error('Browser recovery must remain');}};
  const persistence=createPersistence({loaded:{project,sourceText},backend,storage,locks:null,onStatus:status=>statuses.push(status)});
  return {project,sourceText,api,backend,persistence,statuses};
}

test('file backend probes absence only for 404/405 and rejects malformed or failed APIs',async()=>{
  for(const status of [404,405])assert.deepEqual(await createProjectFileBackend({fetch:async()=>response(status,{})}).probe(),{available:false});
  for(const status of [200,500])await assert.rejects(createProjectFileBackend({fetch:async()=>response(status,{})}).probe());
  const api=server();assert.equal((await createProjectFileBackend({fetch:api.fetch}).probe()).text,null);
});

test('file saves normalize drafts to readable JSON and send exact raw revision with explicit migration source',async()=>{
  const h=fixture();h.project.name='New file';
  const result=await h.backend.save(h.project,{expectedPrimary:h.sourceText,migrationSourceText:'original browser bytes'});
  assert.equal(result.ok,true);assert.equal(result.primary,h.api.text);
  assert.ok(h.api.text.endsWith('\n'));assert.match(h.api.text,/\n  "version"/);
  assert.equal(h.api.posts[0].expectedRevision,await hash(h.sourceText));
  assert.equal(h.api.posts[0].migrationSourceText,'original browser bytes');
  assert.equal(result.backupPath,'saved-projects/source.json');
  await h.backend.save(h.project,{expectedPrimary:h.api.text});assert.equal(Object.hasOwn(h.api.posts[1],'migrationSourceText'),false);
});

test('file conflict preserves exact competing payload and readback detects intervening writes',async()=>{
  const h=fixture();h.api.text='{ damaged competing bytes';
  const result=await h.backend.save(h.project,{expectedPrimary:h.sourceText});
  assert.equal(result.conflict,true);assert.equal(result.primary,h.api.text);
  h.api.text=h.sourceText;h.api.readReplacement='other writer';
  const changed=await h.backend.save(h.project,{expectedPrimary:h.sourceText});
  assert.equal(changed.conflict,true);assert.equal(changed.primary,'other writer');
});

test('unknown commit or failed verification returns failure and retry retains original revision',async()=>{
  const h=fixture();h.project.name='Draft';h.api.failAfterCommit=true;
  assert.equal((await h.persistence.save(h.project)).ok,false);assert.equal(h.persistence.hasUnsaved,true);
  h.api.failAfterCommit=false;
  assert.equal((await h.persistence.save(h.project)).conflict,true);
  assert.equal(h.api.posts[1].expectedRevision,await hash(h.sourceText));
  const competing=h.api.text;
  assert.equal((await h.persistence.saveQueued(h.project,{expectedPrimary:competing,preservePrimary:true})).ok,true);
  assert.equal(h.persistence.hasUnsaved,false);assert.match(h.statuses.at(-1),/Saved to saved-projects/);
  h.project.name='Next';h.api.failRead=true;
  assert.equal((await h.persistence.save(h.project)).ok,false);assert.equal(h.persistence.hasUnsaved,true);
});

test('file autosave-off edits stay dirty until an explicit save without browser writes',async()=>{
  const h=fixture({autosave:false});h.project.name='Unsent';
  assert.equal((await h.persistence.saveAutomatic(h.project)).deferred,true);assert.equal(h.api.posts.length,0);
  assert.equal(h.persistence.hasUnsaved,true);
  assert.equal((await h.persistence.save(h.project)).ok,true);assert.equal(h.persistence.hasUnsaved,false);
  assert.equal(h.persistence.savedMessage,`Saved to ${path}.`);
  assert.equal(h.persistence.adopt().ok,true);
  h.api.text='external raw';await h.persistence.checkForChanges();assert.equal(h.persistence.conflict.primary,'external raw');
  h.api.failRead=true;await h.persistence.checkForChanges();assert.match(h.statuses.at(-1),/Read failed/);
});

test('in-flight snapshot cannot clear newer off-mode edits',async()=>{
  const h=fixture({autosave:false});let release;
  const gate=new Promise(resolve=>release=resolve),save=h.backend.save;
  h.backend.save=async(...args)=>{await gate;return save(...args);};
  h.project.name='Snapshot';const saving=h.persistence.save(h.project);await Promise.resolve();
  h.project.name='Newer';await h.persistence.saveAutomatic(h.project);release();
  assert.equal((await saving).ok,true);assert.equal(h.persistence.hasUnsaved,true);
  assert.doesNotMatch(h.statuses.at(-1),/Saved to/);
  await h.persistence.save(h.project);assert.equal(h.persistence.hasUnsaved,false);
});

test('cancelled in-flight results do not replace the active generation base or status',async()=>{
  const h=fixture();let release;
  const gate=new Promise(resolve=>release=resolve),save=h.backend.save;
  h.backend.save=async(...args)=>{await gate;return save(...args);};
  h.project.name='Cancelled';const saving=h.persistence.save(h.project);await Promise.resolve();
  h.persistence.cancelPending();h.persistence.report('New document.');const status=h.statuses.at(-1);
  release();assert.equal((await saving).cancelled,true);assert.equal(h.statuses.at(-1),status);
  h.backend.save=save;h.project.name='Next';assert.equal((await h.persistence.save(h.project)).conflict,true);
  assert.equal(h.api.posts.at(-1).expectedRevision,await hash(h.sourceText));
});


test('invalid drafts and misleading success responses never report a save',async()=>{
  const api=server();const backend=createProjectFileBackend({fetch:api.fetch});
  assert.equal((await backend.save({version:99})).ok,false);assert.equal(api.posts.length,0);
  const malformed=createProjectFileBackend({fetch:async()=>response(200,{ok:true,text:'different bytes',revision:null,path})});
  assert.equal((await malformed.save(createProject())).ok,false);
  assert.equal((await backend.save(createProject())).ok,true);
});

test('file persistence ignores browser storage events and retains browser recovery notices on adoption',()=>{
  let listeners=0;
  const project=createProject();
  const persistence=createPersistence({loaded:{project,sourceText:null,recovery:{backupKey:'browser backup'}},
    backend:{savedMessage:'Saved to file.'},eventTarget:{addEventListener(){listeners++;},removeEventListener(){listeners++;}},
    storage:{removeItem(){throw Error('Must not clear browser notice');}}});
  assert.equal(persistence.adopt().ok,true);persistence.destroy();assert.equal(listeners,0);
});

test('file backend saves and verifies revisions when Web Crypto is unavailable on HTTP LAN',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {
    const h=fixture();h.project.name='Zażółć 🌿';
    assert.equal((await h.backend.probe()).available,true);
    assert.equal((await h.persistence.save(h.project)).ok,true);
    assert.equal(h.api.posts[0].expectedRevision,await hash(h.sourceText));
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;
  }
});

test('a delayed change check from before our own completed save cannot report a conflict',async()=>{
  const h=fixture();let release;
  h.backend.read=()=>new Promise(resolve=>release=resolve);
  const checking=h.persistence.checkForChanges();
  h.project.name='Own newer save';assert.equal((await h.persistence.save(h.project)).ok,true);
  release(h.sourceText);assert.equal(await checking,null);
  assert.equal(h.persistence.conflict,null);assert.equal(h.persistence.hasUnsaved,false);
  assert.doesNotMatch(h.statuses.at(-1),/conflict/);
});

test('change checks skip pending saves and ignore pre-save read failures',async()=>{
  const h=fixture();let rejectRead,releaseSave,reads=0;
  h.backend.read=()=>{reads++;return new Promise((resolve,reject)=>rejectRead=reject);};
  const checking=h.persistence.checkForChanges();
  const gate=new Promise(resolve=>releaseSave=resolve),save=h.backend.save;
  h.backend.save=async(...args)=>{await gate;return save(...args);};
  h.project.name='Pending save';const saving=h.persistence.save(h.project);
  assert.equal(await h.persistence.checkForChanges(),null);assert.equal(reads,1);
  rejectRead(Error('Stale read failure'));await checking;
  assert.doesNotMatch(h.statuses.at(-1),/Stale read failure/);
  releaseSave();assert.equal((await saving).ok,true);assert.equal(h.persistence.hasUnsaved,false);
});

test('named file backends validate safe names and remain immutable per target',async()=>{
  for(const name of ['../project.json','.hidden.json','a..b.json','a/b.json','a\\b.json','a.BACKUP.1.json','a.migration.1.json','a-pre-migration.json','nest-before-file-autosave-2026.json','a.txt','é.json','a'.repeat(121)+'.json']) {
    assert.throws(()=>validateProjectFilename(name));assert.throws(()=>createProjectFileBackend({filename:name}));
  }
  assert.equal(validateProjectFilename('My project-2.v1.json'),'My project-2.v1.json');
  const stores=new Map(),requests=[];let release;
  const gate=new Promise(resolve=>release=resolve);
  const fetch=async(url,options={})=>{
    requests.push(url);const name=new URL(url,'http://localhost').searchParams.get('file')||'nest-project.json';
    const filePath=`saved-projects/${name}`;
    if(options.method==='POST') {
      const body=JSON.parse(options.body);if(name==='Old project.json')await gate;
      stores.set(name,body.text);return response(200,{ok:true,text:body.text,revision:await hash(body.text),path:filePath});
    }
    const text=stores.get(name)??null;return response(200,{available:true,text,revision:await hash(text),path:filePath});
  };
  const old=createProjectFileBackend({fetch,filename:'Old project.json'}),next=old.forFile('Next.json');
  assert.equal(Object.isFrozen(old),true);assert.throws(()=>{old.filename='Next.json';});
  const project=createProject(),saving=old.save(project);await Promise.resolve();
  project.name='Next';assert.equal((await next.save(project)).ok,true);release();assert.equal((await saving).ok,true);
  assert.equal(JSON.parse(stores.get('Old project.json')).name,'First expedition');assert.equal(JSON.parse(stores.get('Next.json')).name,'Next');
  assert.equal(old.path,'saved-projects/Old project.json');assert.equal(next.filename,'Next.json');
  assert.equal(next.savedMessage,'Saved to saved-projects/Next.json.');assert.ok(requests.includes('/api/project?file=Old%20project.json'));
});

test('file listing validates every filename and path and static hosting remains unavailable',async()=>{
  let payload={available:true,files:[{name:'Other.json',path:'saved-projects/Other.json'}]},status=200;
  const backend=createProjectFileBackend({fetch:async url=>{assert.equal(url,'/api/projects');return response(status,payload);}});
  assert.deepEqual(await backend.list(),payload);
  for(const files of [[{name:'../escape.json',path:'saved-projects/../escape.json'}],[{name:'Other.json',path:'/wrong/path'}],[payload.files[0],payload.files[0]]]) {
    payload={available:true,files};await assert.rejects(backend.list());
  }
  for(status of [404,405])assert.deepEqual(await backend.list(),{available:false});
  status=500;await assert.rejects(backend.list());
});

test('flush waits for both lock and network completion without force-saving off-mode draft',async()=>{
  const project=createProject();project.autosave=false;const sourceText=JSON.stringify(project);
  let releaseLock,releaseSave,calls=0;
  const lock=new Promise(resolve=>releaseLock=resolve),network=new Promise(resolve=>releaseSave=resolve);
  const backend={savedMessage:'Saved file.',async save(p){calls++;await network;return {ok:true,primary:JSON.stringify(p)};}};
  const p=createPersistence({loaded:{project,sourceText},backend,locks:{async request(name,write){await lock;return write();}}});
  project.name='Snapshot';const saving=p.save(project),flushing=p.flush();let flushed=false;flushing.then(()=>flushed=true);
  await Promise.resolve();assert.equal(flushed,false);assert.equal(calls,0);
  releaseLock();await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.equal(flushed,false);
  project.name='Off-mode draft';await p.saveAutomatic(project);releaseSave();assert.equal((await saving).ok,true);
  assert.equal((await flushing).ok,true);assert.equal(p.hasUnsaved,true);assert.equal(calls,1);
  assert.equal((await p.flush()).ok,true);assert.equal(calls,1);
});

test('flush reports failures and settles when queued saves are cancelled or persistence is destroyed',async()=>{
  const h=fixture();h.api.failAfterCommit=true;h.project.name='Failed';h.persistence.save(h.project);
  assert.equal((await h.persistence.flush()).ok,false);assert.equal(h.persistence.lastSaveResult.ok,false);
  const other=fixture();other.project.name='Cancelled';const saving=other.persistence.save(other.project),flushing=other.persistence.flush();
  other.persistence.cancelPending();assert.equal((await saving).cancelled,true);assert.equal((await flushing).cancelled,true);assert.equal(other.api.posts.length,0);
  let release;const gate=new Promise(resolve=>release=resolve),save=other.backend.save;
  other.backend.save=async(...args)=>{await gate;return save(...args);};
  const active=other.persistence.save(other.project);await Promise.resolve();const finishing=other.persistence.flush();other.persistence.destroy();
  const lastStatus=other.statuses.at(-1);release();assert.equal((await active).cancelled,true);assert.equal((await finishing).cancelled,true);
  assert.equal(other.statuses.at(-1),lastStatus);assert.equal((await other.persistence.save(other.project)).cancelled,true);
});
