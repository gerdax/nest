import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model.js';
import {saveProject, loadProject, STORAGE_KEY, RECOVERY_STORAGE_KEY} from '../project/storage.js';

function memoryStorage() {
  const values=new Map();
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
}

test('repeat saves avoid parsing the exact known primary but validate changed external text',()=>{
  const storage=memoryStorage(),project=createProject();
  assert.equal(saveProject(project,storage).ok,true);
  let primary=storage.getItem(STORAGE_KEY),reads=0;
  const parse=JSON.parse;
  JSON.parse=(text,...args)=>{if(text===primary)reads++;return parse(text,...args);};
  try {
    project.name='Second save';
    assert.equal(saveProject(project,storage).ok,true);
    assert.equal(reads,0,'known stored payload needs no repeat parse');
    primary=JSON.stringify({...project,name:'External valid edit'});
    storage.values.set(STORAGE_KEY,primary);
    project.name='Third save';
    assert.equal(saveProject(project,storage).ok,true);
    assert.equal(reads,1,'a changed primary must be validated');
  } finally {JSON.parse=parse;}
});

for(const damage of ['{broken',JSON.stringify({version:2,kind:'nest-project',chapters:[]})]) {
  test(`warm saves still preserve externally damaged data: ${damage}`,()=>{
    const storage=memoryStorage(),project=createProject();
    assert.equal(saveProject(project,storage).ok,true);
    storage.values.set(STORAGE_KEY,damage);
    project.name='Recovery replacement';
    assert.equal(saveProject(project,storage).ok,true);
    assert.equal(storage.getItem(RECOVERY_STORAGE_KEY),damage);
    assert.equal(loadProject(storage).project.name,project.name);
  });
}

test('a warm cache cannot bypass backup verification or a failed primary write',()=>{
  const storage=memoryStorage(),project=createProject(),write=storage.setItem;
  assert.equal(saveProject(project,storage).ok,true);
  storage.values.set(STORAGE_KEY,'{external damage');
  storage.setItem=(key,value)=>{if(key!==RECOVERY_STORAGE_KEY)write(key,value);};
  assert.match(saveProject(project,storage).error,/could not be verified/);
  assert.equal(storage.getItem(STORAGE_KEY),'{external damage');
  storage.setItem=write;
  assert.equal(saveProject(project,storage).ok,true);
  const primary=storage.getItem(STORAGE_KEY);
  storage.setItem=()=>{throw Error('Quota exceeded');};
  project.name='Unsaved edit';
  assert.match(saveProject(project,storage).error,/Quota exceeded/);
  assert.equal(storage.getItem(STORAGE_KEY),primary);
  storage.setItem=write;
  assert.equal(saveProject(project,storage).ok,true);
  assert.equal(loadProject(storage).project.name,'Unsaved edit');
});

test('each adapter and every outgoing edit retains its own validation boundary',()=>{
  const first=memoryStorage(),second=memoryStorage(),project=createProject();
  assert.equal(saveProject(project,first).ok,true);
  second.values.set(STORAGE_KEY,'{other adapter damage');
  assert.equal(saveProject(project,second).ok,true);
  assert.equal(second.getItem(RECOVERY_STORAGE_KEY),'{other adapter damage');
  const primary=first.getItem(STORAGE_KEY);
  project.ignoreAllOverrides='invalid';
  assert.equal(saveProject(project,first).ok,false);
  assert.equal(first.getItem(STORAGE_KEY),primary);
});

test('removing or silently discarding the primary never makes a different string trusted',()=>{
  const storage=memoryStorage(),project=createProject(),write=storage.setItem;
  assert.equal(saveProject(project,storage).ok,true);
  storage.values.delete(STORAGE_KEY);
  project.name='New primary';
  assert.equal(saveProject(project,storage).ok,true);
  storage.setItem=(key,value)=>{if(key!==STORAGE_KEY)write(key,value);};
  project.name='Silently discarded';
  assert.match(saveProject(project,storage).error,/could not be verified/);
  storage.values.set(STORAGE_KEY,'{damage after discarded write');
  storage.setItem=write;
  assert.equal(saveProject(project,storage).ok,true);
  assert.equal(storage.getItem(RECOVERY_STORAGE_KEY),'{damage after discarded write');
});
