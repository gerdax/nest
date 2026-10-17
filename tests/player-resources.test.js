import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, exportChapter, parseProject, validateProject } from '../project/model.js';
import { saveProject, loadProject } from '../project/storage.js';
import { addHealthVariable } from '../studio/commands.js';
import { variableInspector } from '../studio/inspectors.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { initialValues, transact } from '../project/state.js';

test('resource definitions and chapter overrides survive save and chapter export without changing effects', () => {
 const project = createProject();
 project.variables = project.variables.filter(variable=>variable.id!=='health');
 project.variables.push({id:'health',type:'flag',initial:false});
 project.chapters[0].initialValues = {energy:7,health:true};
 project.library.find(card=>card.id==='arrival').effects = [{op:'add',key:'energy',value:20}];
 const entries = new Map(), storage = {setItem:(key,value)=>entries.set(key,value),getItem:key=>entries.get(key)??null};
 assert.deepEqual(saveProject(project,storage),{ok:true});
 const loaded = loadProject(storage).project;
 const imported = parseProject(JSON.stringify(exportChapter(loaded)));
 for (const candidate of [project,loaded,imported]) {
  assert.deepEqual(validateProject(candidate),[]);
  const compiled = compileChapter(candidate);
  assert.deepEqual(compiled.variables,project.variables.map(variable=>({...variable,initial:Object.hasOwn(project.chapters[0].initialValues,variable.id)?project.chapters[0].initialValues[variable.id]:variable.initial})));
  assert.deepEqual(initialValues(compiled.variables),{energy:7,health:true,agility:3,intelligence:3,composure:3});
  assert.deepEqual(transact(initialValues(compiled.variables),[],{effects:compiled.nodes[0].cards[0].effects},compiled.variables,compiled.library).variables,{energy:10,health:true,agility:3,intelligence:3,composure:3});
 }
});


test('adding health to an existing project is undoable and preserves its content', () => {
 const project=createProject();project.variables=project.variables.filter(v=>v.id!=='health');
 const history=new DocumentHistory(project), before=history.document;
 assert.match(variableInspector(project,project.chapters[0]),/data-command="add-health"/);
 history.transact(document=>{addHealthVariable(document);});
 const updated=history.document;
 assert.deepEqual(updated.chapters,before.chapters);assert.deepEqual(updated.library,before.library);
 assert.deepEqual(compileChapter(updated).variables.find(v=>v.id==='health'),{id:'health',name:'Health',type:'number',initial:10,min:0,max:10});
 assert.doesNotMatch(variableInspector(updated,updated.chapters[0]),/data-command="add-health"/);
 const snapshot=structuredClone(updated);assert.equal(addHealthVariable(updated),false);assert.deepEqual(updated,snapshot);
 assert.equal(history.undo(),true);assert.deepEqual(history.document,before);
 assert.equal(history.redo(),true);assert.deepEqual(history.document,updated);
 updated.variables.find(v=>v.id==='health').type='flag';
 assert.equal(addHealthVariable(updated),false);assert.equal(updated.variables.find(v=>v.id==='health').type,'flag');
});
