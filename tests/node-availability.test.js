import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,compileChapter,exportChapter,importChapter,validateProject,parseProject} from '../project/model.js';
import {createNode,duplicateNode,synchronizeConnections} from '../studio/commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

for(const type of ['fork','linear'])test(`${type} availability defaults, editing and serialization`,()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,type);
 chapter.nodes.push(node);synchronizeConnections(project);
 const selection={chapterId:chapter.id,selected:node.id};
 const originalLibrary=structuredClone(project.library);
 let html=nodeInspector(project,chapter,node);
 assert.match(html,/<hr class="connections-divider availability-divider"><label class="field">Unavailable actions<select data-scope="node" data-path="unavailableActions"><option value="project" selected>Use project settings<\/option>/);
 if(type==='linear')assert.ok(html.indexOf('data-path="unavailableActions"')<html.indexOf('Keep inventory items on revisit'));
 for(const policy of ['hidden','disabled','project']){
  applyDocumentCommand(project,selection,'field',{scope:'node',path:'unavailableActions',value:policy,inputType:'select-one'});
  assert.equal(node.unavailableActions,policy);
  assert.deepEqual(validateProject(project),[]);
  html=nodeInspector(project,chapter,node);
  assert.match(html,new RegExp(`<option value="${policy}" selected>`));
  assert.equal(duplicateNode(project,node).unavailableActions,policy);
  const parsed=parseProject(JSON.stringify(project));
  assert.equal(compileChapter(parsed).nodes.find(n=>n.id===node.id).unavailableActions,policy);
  const imported=importChapter(createProject(),exportChapter(project));
  const restored=imported.chapters.at(-1);
  assert.equal(compileChapter(imported,restored.id).nodes.find(n=>n.name===node.name).unavailableActions,policy);
 }
 assert.deepEqual(project.library.filter(d=>originalLibrary.some(original=>original.id===d.id)),originalLibrary);
 node.unavailableActions='invalid';
 assert.ok(validateProject(project).some(e=>e.message.includes('unavailableActions')));
});

for(const type of ['random','container'])test(`${type} does not expose an action availability override`,()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,type);
 chapter.nodes.push(node);synchronizeConnections(project);
 assert.doesNotMatch(nodeInspector(project,chapter,node),/data-path="unavailableActions"/);
 node.unavailableActions='hidden';
 assert.ok(validateProject(project).some(e=>e.message.includes('unavailableActions')));
});
