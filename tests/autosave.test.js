import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model.js';
import {createPersistence,travelHistory} from '../studio/persistence.js';
import {loadProject,saveProject,STORAGE_KEY,CONFLICT_STORAGE_KEY} from '../project/storage.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';

function fixture({autosave}={}) {
 const values=new Map();let writes=0;
 const storage={getItem:key=>values.get(key)??null,setItem(key,value){values.set(key,value);if(key===STORAGE_KEY)writes++;},removeItem:key=>values.delete(key)};
 const project=createProject();if(autosave!==undefined)project.autosave=autosave;
 assert.equal(saveProject(project,storage).ok,true);
 const loaded=loadProject(storage),statuses=[];
 const persistence=createPersistence({loaded,storage,onStatus:text=>statuses.push(text)});
 return {storage,project:loaded.project,persistence,statuses,get writes(){return writes;}};
}

test('existing projects without a setting keep autosaving by default',async()=>{
 const h=fixture();h.project.name='Changed';
 assert.equal((await h.persistence.saveAutomatic(h.project)).ok,true);
 assert.equal(loadProject(h.storage).project.name,'Changed');assert.equal(h.persistence.hasUnsaved,false);
});

test('local file drafts stay detached and download only on explicit Save',async()=>{
 const project=createProject(), downloads=[];
 const storage={getItem(){assert.fail('unexpected storage read');},setItem(){assert.fail('unexpected storage write');}};
 const persistence=createPersistence({loaded:{project},storage,download:value=>downloads.push(value)});
 assert.equal(persistence.hasUnsaved,false);
 project.name='Edited local file';
 for(const autosave of [true,false,true]){
  project.autosave=autosave;
  assert.deepEqual(await persistence.saveAutomatic(project),{ok:true,deferred:true});
 }
 assert.equal(persistence.hasUnsaved,true);
 assert.deepEqual(downloads,[]);
 persistence.checkForChanges();
 assert.equal((await persistence.saveQueued(project)).ok,true);
 assert.deepEqual(downloads,[project]);
 assert.equal(persistence.hasUnsaved,false);
});

test('disabling autosave persists the choice once; later edits wait for explicit Save',async()=>{
 const h=fixture();h.project.autosave=false;
 await h.persistence.saveAutomatic(h.project);
 assert.equal(loadProject(h.storage).project.autosave,false);assert.equal(h.persistence.hasUnsaved,false);
 const writes=h.writes;h.project.name='Unsaved project';
 assert.equal((await h.persistence.saveAutomatic(h.project)).deferred,true);
 assert.equal(h.writes,writes);assert.equal(loadProject(h.storage).project.name,'First expedition');
 assert.equal(h.persistence.hasUnsaved,true);assert.match(h.statuses.at(-1),/Unsaved changes.*Autosave off/);
 h.persistence.report('Chapter ready.');assert.match(h.statuses.at(-1),/Unsaved changes.*Chapter ready/);
 await h.persistence.saveQueued(h.project);
 assert.equal(loadProject(h.storage).project.name,'Unsaved project');assert.equal(loadProject(h.storage).project.autosave,false);
 assert.equal(h.persistence.hasUnsaved,false);assert.doesNotMatch(h.statuses.at(-1),/Unsaved changes/);
});

test('loading an autosave-off project makes no writes until manual Save; re-enabling flushes all edits',async()=>{
 const h=fixture({autosave:false}),writes=h.writes;
 h.project.library[0].text='Changed Library';await h.persistence.saveAutomatic(h.project);
 assert.equal(h.writes,writes);assert.equal(h.persistence.hasUnsaved,true);
 h.project.autosave=true;await h.persistence.saveAutomatic(h.project);
 assert.equal(loadProject(h.storage).project.library[0].text,'Changed Library');
 assert.equal(loadProject(h.storage).project.autosave,true);assert.equal(h.persistence.hasUnsaved,false);
});

test('Undo/Redo with autosave off updates dirty state without saving and can return to the saved snapshot',async()=>{
 const h=fixture({autosave:false}),history=new DocumentHistory(h.project),writes=h.writes;
 // Use the public history transaction API through a detached changed document.
 history.transact(draft=>{draft.name='Later';});
 await h.persistence.saveAutomatic(history.document);assert.equal(h.persistence.hasUnsaved,true);
 travelHistory(history,'undo',{save:project=>h.persistence.saveAutomatic(project)});
 assert.equal(h.persistence.hasUnsaved,false);assert.equal(h.writes,writes);
 travelHistory(history,'redo',{save:project=>h.persistence.saveAutomatic(project)});
 assert.equal(h.persistence.hasUnsaved,true);assert.equal(h.writes,writes);
});

test('an older lock-waiting Save cannot mark newer off-mode edits as saved',async()=>{
 const h=fixture({autosave:false});let release;
 const gate=new Promise(resolve=>release=resolve);
 const loaded=loadProject(h.storage),statuses=[];
 const p=createPersistence({loaded,storage:h.storage,onStatus:text=>statuses.push(text),locks:{async request(name,write){await gate;return write();}}});
 loaded.project.name='Snapshot being saved';const saving=p.saveQueued(loaded.project);await Promise.resolve();
 loaded.project.name='Newer work';await p.saveAutomatic(loaded.project);
 release();assert.equal((await saving).ok,true);
 assert.equal(loadProject(h.storage).project.name,'Snapshot being saved');assert.equal(p.hasUnsaved,true);
 assert.match(statuses.at(-1),/Unsaved changes/);assert.doesNotMatch(statuses.at(-1),/Saved in this browser/);
 await p.saveQueued(loaded.project);assert.equal(p.hasUnsaved,false);assert.equal(loadProject(h.storage).project.name,'Newer work');
});

test('rapid on/off toggles coalesce safely while later off-mode work stays dirty',async()=>{
 const h=fixture();h.project.name='Autosave queued';const first=h.persistence.saveAutomatic(h.project);
 h.project.autosave=false;const off=h.persistence.saveAutomatic(h.project);
 h.project.name='Not queued';await h.persistence.saveAutomatic(h.project);
 await first;await off;
 const saved=loadProject(h.storage).project;
 assert.equal(saved.autosave,false);assert.equal(saved.name,'Autosave queued');assert.equal(h.persistence.hasUnsaved,true);
});

test('manual Save with autosave off retains conflict detection and competing-save backup',async()=>{
 const h=fixture({autosave:false});h.project.name='Local draft';await h.persistence.saveAutomatic(h.project);
 const other=loadProject(h.storage);other.project.name='Other tab';saveProject(other.project,h.storage);
 const competing=h.storage.getItem(STORAGE_KEY);
 assert.equal((await h.persistence.saveQueued(h.project)).conflict,true);assert.equal(h.persistence.hasUnsaved,true);
 assert.equal(h.storage.getItem(STORAGE_KEY),competing);
 assert.equal((await h.persistence.saveQueued(h.project,{expectedPrimary:competing,preservePrimary:true})).ok,true);
 assert.equal(h.storage.getItem(CONFLICT_STORAGE_KEY),competing);assert.equal(h.persistence.hasUnsaved,false);
});

test('failed manual Save keeps the draft dirty and allows retry without losing off mode',async()=>{
 const h=fixture({autosave:false});h.project.name='Draft';await h.persistence.saveAutomatic(h.project);
 const write=h.storage.setItem;h.storage.setItem=()=>{throw Error('Quota exceeded');};
 assert.equal((await h.persistence.saveQueued(h.project)).ok,false);assert.equal(h.persistence.hasUnsaved,true);
 h.storage.setItem=write;assert.equal((await h.persistence.saveQueued(h.project)).ok,true);
 assert.equal(h.persistence.hasUnsaved,false);assert.equal(loadProject(h.storage).project.autosave,false);
});
