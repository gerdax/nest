import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model.js';
import {loadProject, saveProject, STORAGE_KEY, CONFLICT_STORAGE_KEY, readConflictingSave} from '../project/storage.js';
import {createPersistence} from '../studio/persistence.js';

function memoryStorage() {
  const values = new Map();
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function setup() {
  const storage=memoryStorage();
  saveProject(createProject(),storage);
  const a=loadProject(storage), b=loadProject(storage);
  return {storage,a,b,first:createPersistence({loaded:a,storage}),second:createPersistence({loaded:b,storage})};
}

test('independent sessions reject stale valid saves while keeping both documents intact',()=>{
  const {storage,a,b,first,second}=setup();
  a.project.name='First tab';b.project.chapters[0].name='Second tab';
  assert.equal(first.save(a.project).ok,true);
  const primary=storage.getItem(STORAGE_KEY);
  const result=second.save(b.project);
  assert.equal(result.conflict,true);
  assert.equal(result.primary,primary);
  assert.equal(storage.getItem(STORAGE_KEY),primary);
  assert.equal(b.project.chapters[0].name,'Second tab');
  assert.equal(second.hasUnsaved,true);
});

test('explicit resolution rechecks the competing payload and preserves it before replacing',async()=>{
  const {storage,a,b,first,second}=setup();
  a.project.name='First tab';first.save(a.project);second.save(b.project);
  const seen=second.conflict.primary;
  a.project.name='Even newer';first.save(a.project);
  assert.equal((await second.saveQueued(b.project,{expectedPrimary:seen,preservePrimary:true})).conflict,true);
  const newest=storage.getItem(STORAGE_KEY);
  assert.equal((await second.saveQueued(b.project,{expectedPrimary:newest,preservePrimary:true})).ok,true);
  assert.equal(storage.getItem(CONFLICT_STORAGE_KEY),newest);
  assert.equal(readConflictingSave(storage).text,newest);
  assert.equal(loadProject(storage).project.name,b.project.name);
  assert.equal(second.conflict,null);
});

test('failed competing-save backup prevents replacement and permits retry',async()=>{
  const {storage,a,b,first,second}=setup();
  a.project.name='Competing work';first.save(a.project);second.save(b.project);
  const primary=storage.getItem(STORAGE_KEY),write=storage.setItem;
  storage.setItem=(key,value)=>{if(key.startsWith(CONFLICT_STORAGE_KEY))throw Error('Quota exceeded');write(key,value);};
  assert.equal((await second.saveQueued(b.project,{expectedPrimary:primary,preservePrimary:true})).ok,false);
  assert.equal(storage.getItem(STORAGE_KEY),primary);
  storage.setItem=write;
  assert.equal((await second.saveQueued(b.project,{expectedPrimary:primary,preservePrimary:true})).ok,true);
});

test('failed writes never advance the base, and silent write loss is reported',()=>{
  const {storage,a,first}=setup(),write=storage.setItem;
  const original=storage.getItem(STORAGE_KEY);
  storage.setItem=()=>{};a.project.name='Draft';
  assert.match(first.save(a.project).error,/could not be verified/);
  assert.equal(storage.getItem(STORAGE_KEY),original);
  storage.setItem=write;
  assert.equal(first.save(a.project).ok,true);
});

test('queued immutable snapshots coalesce before work begins and pending status is honest',async()=>{
  const storage=memoryStorage(),statuses=[];
  let writes=0;const write=storage.setItem;
  storage.setItem=(...args)=>{writes++;write(...args);};
  const persistence=createPersistence({storage,onStatus:text=>statuses.push(text)}), project=createProject();
  project.name='Earlier';const first=persistence.saveQueued(project);
  project.name='Latest';const second=persistence.saveQueued(project);
  project.name='Mutation after enqueue';
  assert.equal(persistence.hasUnsaved,true);
  assert.match(statuses.at(-1),/Saving/);assert.doesNotMatch(statuses.at(-1),/Saved/);
  assert.equal((await first).ok,true);assert.equal((await second).ok,true);
  assert.equal(loadProject(storage).project.name,'Latest');
  assert.equal(writes,1);assert.equal(persistence.hasUnsaved,false);
  assert.match(statuses.at(-1),/Saved in this browser/);
});

test('a delayed Web Lock guards the eventual read/compare/write against another session',async()=>{
  const {storage,a,b,first}=setup();
  let release;const blocked=new Promise(resolve=>release=resolve),names=[];
  const locks={async request(name,callback){names.push(name);await blocked;return callback();}};
  const second=createPersistence({loaded:b,storage,locks});
  const pending=second.saveQueued(b.project);
  await Promise.resolve();
  a.project.name='Saved while waiting';first.save(a.project);
  release();
  assert.equal((await pending).conflict,true);
  assert.deepEqual(names,[STORAGE_KEY+'.write']);
  assert.equal(loadProject(storage).project.name,'Saved while waiting');
});

test('storage events notify without mutating drafts; clear and cached-page rechecks detect changes',()=>{
  const {storage,a,b,first}=setup(),events=new EventTarget(),conflicts=[];
  const second=createPersistence({loaded:b,storage,eventTarget:events,onConflict:value=>conflicts.push(value)});
  a.project.name='External';first.save(a.project);
  const emit=key=>{const event=new Event('storage');event.key=key;events.dispatchEvent(event);};
  emit('unrelated');assert.equal(conflicts.length,0);
  emit(STORAGE_KEY);assert.equal(conflicts.length,1);assert.equal(b.project.name,'First expedition');
  storage.removeItem(STORAGE_KEY);emit(null);assert.equal(second.conflict.primary,null);
  second.destroy();emit(STORAGE_KEY);assert.equal(conflicts.length,2);
});

test('already-damaged base retains exact recovery protection, but later damage is a conflict',()=>{
  const storage=memoryStorage();storage.setItem(STORAGE_KEY,'{original damage');
  const session=createPersistence({loaded:loadProject(storage),storage});
  assert.equal(session.save(createProject()).ok,true);
  storage.setItem(STORAGE_KEY,'{later damage');
  assert.equal(session.save(createProject()).conflict,true);
  assert.equal(storage.getItem(STORAGE_KEY),'{later damage');
});

test('unreadable initial storage cannot silently adopt a newer valid primary',()=>{
  const storage=memoryStorage(),get=storage.getItem;
  storage.getItem=()=>{throw Error('Denied');};
  const session=createPersistence({storage});
  storage.getItem=get;saveProject(createProject(),storage);
  assert.match(session.save(createProject()).error,/original browser save could not be read/);
});

test('a transient load failure cannot rebase the fallback document over the real save',()=>{
  const storage=memoryStorage();saveProject(createProject(),storage);
  const primary=storage.getItem(STORAGE_KEY),get=storage.getItem;
  storage.getItem=()=>{throw Error('Transient denial');};
  const loaded=loadProject(storage);
  storage.getItem=get;
  const session=createPersistence({loaded,storage});
  const draft=createProject();draft.name='Fallback starter';
  assert.equal(session.save(draft).ok,false);
  assert.equal(storage.getItem(STORAGE_KEY),primary);
});

test('deliberate reload cancels both queued and lock-waiting writes before navigation',async()=>{
  const storage=memoryStorage();saveProject(createProject(),storage);
  const primary=storage.getItem(STORAGE_KEY);
  let release;const blocked=new Promise(resolve=>release=resolve);
  const session=createPersistence({loaded:loadProject(storage),storage,locks:{async request(name,write){await blocked;return write();}}});
  const draft=createProject();draft.name='Waiting to write';
  const first=session.saveQueued(draft);
  await Promise.resolve();
  draft.name='Queued newer draft';const second=session.saveQueued(draft);
  session.cancelPending();release();
  assert.equal((await first).cancelled,true);assert.equal((await second).cancelled,true);
  assert.equal(storage.getItem(STORAGE_KEY),primary);
  assert.equal(session.hasUnsaved,false);
});
