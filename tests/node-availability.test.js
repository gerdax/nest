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
 assert.match(html,/<div class="node-overrides"><details class="state-panel"><summary>Overrides · 0<\/summary>[\s\S]*<label class="field">Unavailable actions<select data-scope="node" data-path="unavailableActions"><option value="project" selected>Use project settings<\/option>/);
 assert.ok(html.indexOf('data-path="unavailableActions"')>html.indexOf('data-command="clear-overrides"'));
 if(type==='linear')assert.ok(html.indexOf('data-path="unavailableActions"')>html.indexOf('Keep swapped items on revisit'));
 for(const policy of ['hidden','disabled','triggers-only','disabled-triggers','project']){
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

for(const type of ['fork','linear'])test(`${type} Overrides header marks availability overrides even with zero effects`,()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,type);
 chapter.nodes.push(node);
 for(const policy of [undefined,'project','hidden','disabled','triggers-only','disabled-triggers']) {
  node.unavailableActions=policy;
  const summary=nodeInspector(project,chapter,node).match(/<summary>Overrides · ([^<]+)<\/summary>/)?.[1];
  assert.equal(summary,policy&&policy!=='project'?'0 *':'0');
 }
 node.unavailableActions='project';
 assert.match(nodeInspector(project,chapter,node,[{op:'set',key:'energy',value:2}]),/<summary>Overrides · 1 \*<\/summary>/);
});
