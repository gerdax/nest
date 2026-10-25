import { errorMessage } from '../errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, exportChapter } from '../project/model.js';
import { STORAGE_KEY, RECOVERY_STORAGE_KEY, RECOVERY_NOTICE_KEY, loadProject, saveProject, readRecoveredSave } from '../project/storage.js';
import { createPersistence, travelHistory, exportProjectDraft, parseStudioImport } from '../studio/persistence.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DocumentHistory } from '../editor/DocumentHistory.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
for (const raw of ['{broken JSON', JSON.stringify({version:2,kind:'nest-project',chapters:[]})]) {
  test(`damaged v2 save is preserved byte-for-byte before autosave: ${raw}`, () => {
    const store = memoryStorage({[STORAGE_KEY]:raw});
    const loaded = loadProject(store);
    assert.equal(loaded.project,null);
    assert.ok(loaded.error);
    assert.equal(loaded.recovery.backupKey,RECOVERY_STORAGE_KEY);
    assert.equal(store.getItem(STORAGE_KEY),raw);
    assert.equal(store.getItem(RECOVERY_STORAGE_KEY),raw);
    assert.equal(saveProject(createProject(),store).ok,true);
    assert.equal(store.getItem(RECOVERY_STORAGE_KEY),raw);
    assert.equal(loadProject(store).recovery.backupKey,RECOVERY_STORAGE_KEY);
  });
}

test('save protects a damaged payload even without a preceding load and retains earlier backups', () => {
  const store = memoryStorage({[STORAGE_KEY]:'{new damage',[RECOVERY_STORAGE_KEY]:'{older damage'});
  assert.equal(saveProject(createProject(),store).ok,true);
  assert.equal(store.getItem(RECOVERY_STORAGE_KEY),'{older damage');
  assert.equal(store.getItem(`${RECOVERY_STORAGE_KEY}.1`),'{new damage');
});

for (const failedKey of [RECOVERY_STORAGE_KEY, RECOVERY_NOTICE_KEY]) {
  test(`backup write failure at ${failedKey} refuses to replace damaged save`, () => {
    const raw = '{work to recover', store = memoryStorage({[STORAGE_KEY]:raw});
    const write = store.setItem;
    store.setItem = (key,value) => {if(key===failedKey)throw Error('Quota exceeded');write(key,value);};
    const loaded = loadProject(store);
    assert.equal(loaded.project,null);
    assert.equal(loaded.recovery.error,'Quota exceeded');
    const saved = saveProject(createProject(),store);
    assert.equal(saved.ok,false);
    assert.match(saved.error,/was not replaced.*Quota exceeded/);
    assert.equal(store.getItem(STORAGE_KEY),raw);
  });
}

test('silently discarded backups also refuse to replace the original raw save', () => {
  const raw = '{unrecoverable', store = memoryStorage({[STORAGE_KEY]:raw});
  const write = store.setItem;
  store.setItem = (key,value) => {if(key!==RECOVERY_STORAGE_KEY)write(key,value);};
  assert.equal(saveProject(createProject(),store).ok,false);
  assert.equal(store.getItem(STORAGE_KEY),raw);
});

test('recovery warning survives edits, ordinary reports and reload until explicit adoption', () => {
  const store = memoryStorage({[STORAGE_KEY]:'{damaged'}), statuses = [];
  const persistence = createPersistence({loaded:loadProject(store),storage:store,onStatus:text=>statuses.push(text)});
  persistence.save(createProject());
  persistence.report('Chapter ready.');
  assert.match(statuses.at(-1),/Recovery warning.*Chapter ready/);
  const reloaded = createPersistence({loaded:loadProject(store),storage:store,onStatus:text=>statuses.push(text)});
  reloaded.report('Saved.');
  assert.match(statuses.at(-1),/Recovery warning/);
  assert.equal(reloaded.adopt().ok,true);
  reloaded.report('Project imported.');
  assert.equal(statuses.at(-1),'Project imported.');
  assert.equal(store.getItem(RECOVERY_NOTICE_KEY),null);
  assert.equal(store.getItem(RECOVERY_STORAGE_KEY),'{damaged');
  assert.equal(loadProject(store).recovery,undefined);
});

test('failure clearing recovery notice keeps its warning visible', () => {
  const store = memoryStorage({[STORAGE_KEY]:'{damaged'}), statuses = [];
  const loaded = loadProject(store);
  store.removeItem = () => {throw Error('Denied');};
  const persistence = createPersistence({loaded,storage:store,onStatus:text=>statuses.push(text)});
  assert.equal(persistence.adopt().ok,false);
  persistence.report('Ready.');
  assert.match(statuses.at(-1),/Recovery warning.*Ready/);
});

test('undo and redo preserve in-memory history and report write failure through the same persistence boundary', () => {
  const original = createProject(), history = new DocumentHistory(original), store = memoryStorage(), statuses = [];
  history.transact(project=>{project.name='Changed';});
  store.setItem = () => {throw Error('Quota exceeded');};
  const persistence = createPersistence({storage:store,onStatus:text=>statuses.push(text)});
  const undo = travelHistory(history,'undo',persistence);
  assert.equal(undo.changed,true);
  assert.equal(undo.project.name,original.name);
  assert.equal(undo.saved.ok,false);
  assert.match(statuses.at(-1),/Save failed: Quota exceeded/);
  const redo = travelHistory(history,'redo',persistence);
  assert.equal(redo.project.name,'Changed');
  assert.equal(redo.saved.ok,false);
  assert.match(statuses.at(-1),/Save failed: Quota exceeded/);
  assert.equal(travelHistory(history,'redo',persistence).changed,false);
});

test('portable project drafts round trip unfinished connections and empty chapters; playable imports stay strict', () => {
  const project = createProject();
  project.chapters[0].nodes[0].connections.next = 'unfinished';
  project.chapters.push({id:'draft',name:'Work in progress',nodes:[],startNode:''});
  project.activeChapterId='draft';
  const exported = exportProjectDraft(project);
  assert.deepEqual(parseStudioImport(JSON.stringify(exported)).project,exported);
  assert.throws(()=>parseProject(JSON.stringify(exported)),/Start beat must exist|unknown target/);
  assert.throws(()=>parseStudioImport(JSON.stringify(exportChapter(project,project.chapters[0].id))),/unknown target/);
  assert.throws(()=>parseStudioImport('{broken'));
  assert.throws(()=>parseStudioImport('{"version":2,"kind":"nest-project"}'));
});


test('recovery downloads exact malformed text from backup and never mutates either copy', () => {
  const raw = '  {"broken": \n  ', store = memoryStorage({[STORAGE_KEY]:raw});
  loadProject(store);
  saveProject(createProject(),store);
  const before = [...store.values];
  assert.equal(readRecoveredSave(store).text,raw);
  assert.deepEqual([...store.values],before);
  store.getItem = () => {throw Error('Denied');};
  assert.deepEqual(readRecoveredSave(store),{ok:false,error:'Denied'});
  assert.deepEqual([...store.values],before);
});

test('failed backup still permits exact download of untouched damaged primary; missing backup fails safely', () => {
  const raw = '{work', store = memoryStorage({[STORAGE_KEY]:raw});
  store.setItem = () => {throw Error('Quota exceeded');};
  loadProject(store);
  assert.deepEqual(readRecoveredSave(store),{ok:true,text:raw,key:STORAGE_KEY});
  assert.equal(store.getItem(STORAGE_KEY),raw);
  const missing = memoryStorage({[STORAGE_KEY]:JSON.stringify(createProject()),[RECOVERY_NOTICE_KEY]:'missing'});
  const before = [...missing.values];
  assert.equal(readRecoveredSave(missing).ok,false);
  assert.deepEqual([...missing.values],before);
});

test('save failures stay visible across playback/status messages until the next successful save', () => {
  const store = memoryStorage(), statuses = [], write = store.setItem;
  store.setItem = () => {throw Error('Quota exceeded');};
  const persistence = createPersistence({storage:store,onStatus:text=>statuses.push(text)});
  persistence.save(createProject());
  persistence.report('Chapter ready.');
  assert.match(statuses.at(-1),/Save failed: Quota exceeded.*Chapter ready/);
  store.setItem = write;
  persistence.save(createProject());
  persistence.report('Chapter ready.');
  assert.equal(statuses.at(-1),'Chapter ready.');
});

test('editor recovery button downloads the exact raw text and reports read failures without a download', () => {
  const source = readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
  const section = source.slice(source.indexOf('let recoveryDownload;'),source.indexOf("$('#export-project').textContent"));
  const downloads = [], statuses = [], button = {}, status = {after(element){assert.equal(element,button);}};
  const context = {errorMessage,loaded:{recovery:{backupKey:RECOVERY_STORAGE_KEY}},document:{createElement:()=>button},
    $:()=>status,readRecoveredSave:()=>({ok:true,text:'{raw'}),downloadText:(...args)=>downloads.push(args),report:text=>statuses.push(text)};
  runInNewContext(section,context);
  assert.equal(button.textContent,'Download recovered save');
  button.onclick();
  assert.deepEqual(downloads,[['{raw','nest-recovered-save.txt']]);
  context.readRecoveredSave=()=>({ok:false,error:'Denied'});
  button.onclick();
  assert.equal(downloads.length,1);
  assert.match(statuses.at(-1),/Recovery download failed: Denied/);
});


test('new damaged primary takes priority over an older notice when its backup fails', () => {
  const current = '{new work', previous = '{old work';
  const store = memoryStorage({[STORAGE_KEY]:current,[RECOVERY_STORAGE_KEY]:previous,[RECOVERY_NOTICE_KEY]:RECOVERY_STORAGE_KEY});
  const write = store.setItem;
  store.setItem = () => {throw Error('Quota exceeded');};
  const loaded = loadProject(store);
  assert.equal(loaded.recovery.error,'Quota exceeded');
  const before = [...store.values];
  assert.deepEqual(readRecoveredSave(store),{ok:true,text:current,key:STORAGE_KEY});
  assert.deepEqual([...store.values],before);
  // Once the primary is a valid working document, the retained backup is again
  // the recovery download source rather than the current authoring document.
  write(STORAGE_KEY,JSON.stringify(createProject()));
  assert.deepEqual(readRecoveredSave(store),{ok:true,text:previous,key:RECOVERY_STORAGE_KEY});
});
