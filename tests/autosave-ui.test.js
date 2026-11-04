import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject,validateProject,parseProject} from '../project/model.js';
import {projectSettingsInspector} from '../studio/inspectors.js';
import {exportProjectDraft} from '../studio/persistence.js';

const editor=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
const markup=readFileSync(new URL('../editor.html',import.meta.url),'utf8');

test('Autosave is a project checkbox enabled for older projects by default',()=>{
 for(const value of [undefined,true,false]){
  const project=createProject();
  if(value!==undefined)project.autosave=value;
  const before=structuredClone(project),html=projectSettingsInspector(project);
  const checkbox=html.match(/<input type="checkbox" data-scope="project" data-path="autosave"[^>]*>/)?.[0];
  assert.ok(checkbox);
  assert.equal(/\bchecked\b/.test(checkbox),value!==false);
  assert.match(html,/Save changes automatically in this browser at this address/);
  assert.match(html,/When off, use Save/);
  assert.deepEqual(project,before);
 }
});

test('project autosave setting survives project draft export and parsing without changing absent defaults',()=>{
 for(const value of [undefined,true,false]){
  const project=createProject();
  if(value!==undefined)project.autosave=value;
  const before=structuredClone(project);
  assert.deepEqual(validateProject(project),[]);
  const exported=exportProjectDraft(project);
  const restored=parseProject(JSON.stringify(exported),{allowDraft:true});
  assert.equal(restored.autosave,value);
  assert.equal(Object.hasOwn(restored,'autosave'),value!==undefined);
  assert.deepEqual(project,before);
 }
});

test('autosave only accepts optional boolean settings including draft imports',()=>{
 for(const value of [null,0,1,'false',{},[]]){
  const project=createProject();project.autosave=value;
  for(const allowDraft of [false,true]){
   assert.ok(validateProject(project,{allowDraft}).some(issue=>issue.message==='Autosave must be a boolean'));
   assert.throws(()=>parseProject(JSON.stringify(project),{allowDraft}),/Autosave must be a boolean/);
  }
 }
});

test('Save stays available and imports force a save only for attached projects',()=>{
 const button=markup.match(/<button id="save-project"[^>]*>Save<\/button>/)?.[0];
 assert.ok(button);assert.doesNotMatch(button,/\bdisabled\b/);
 assert.match(button,/aria-keyshortcuts="Meta\+S Control\+S"/);
 assert.match(editor,/const saveProject=project=>persistence\.saveAutomatic\(project\)/);
 assert.match(editor,/const saved=type==='import'&&!localFilename\?persistence\.saveQueued\(project\):saveProject\(project\)/);
 assert.match(editor,/travelHistory\(history,method,\{save:saveProject\}\)/);
 assert.match(editor,/saveQueued\(project,\{expectedPrimary:conflict\.primary,preservePrimary:true\}\)/);
});

test('manual save commits the focused authored input before persisting; shortcut also intercepts input events',()=>{
 const source=editor.slice(editor.indexOf('function saveManually(){'),editor.indexOf("document.addEventListener('keydown',saveShortcut);"));
 const saves=[],button={},project={name:'Before'};
 const input={matches:selector=>selector==='input,textarea,select',closest:()=>true,blur(){}};
 const context={document:{activeElement:input},fileDialogOpen:false,projectSession:{fileMode:false},project,changeField:({target})=>{assert.equal(target,input);project.name='After';},persistence:{saveQueued:value=>{saves.push(value.name);return Promise.resolve({ok:true});}},$:()=>button};
 runInNewContext(source,context);
 button.onclick();assert.deepEqual(saves,['After']);
 for(const modifier of ['ctrlKey','metaKey']){
  let prevented=false;
  context.saveShortcut({key:'S',[modifier]:true,target:input,preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);
 }
 assert.equal(saves.length,3);
 for(const event of [{key:'s'},{key:'x',ctrlKey:true},{key:'s',ctrlKey:true,altKey:true}]){
  context.saveShortcut({...event,preventDefault:()=>assert.fail('unrelated shortcut intercepted')});
 }
 assert.equal(saves.length,3);
 assert.match(editor,/document\.removeEventListener\('keydown',saveShortcut\)/);
});
