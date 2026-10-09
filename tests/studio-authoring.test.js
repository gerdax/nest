import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, migrateChapter, parseProject, validateProject, compileChapter } from '../project/model.js';
import { createLegacyStarterChapter, validateChapter } from '../chapter/model.js';
import { field, select, checkbox } from '../studio/forms.js';
import { variableInspector } from '../studio/inspectors.js';
import { synchronizeConnections, customizeAction } from '../studio/commands.js';
import { ProjectPreview } from '../studio/ProjectPreview.js';

test('imported IDs are escaped in every field control and initial values use opaque IDs',()=>{
 const id='flag." autofocus onfocus="alert(1)';
 for(const html of [field('X','',id),select('X','',[],id),checkbox('X',false,id)]) {
  assert.ok(html.includes('&quot;'));
  assert.ok(!html.includes(' onfocus="alert(1)'));
 }
 const project=createProject();project.variables=[{id,type:'flag',initial:false}];project.chapters[0].initialValues={[id]:true};
 const html=variableInspector(project,project.chapters[0]);
 assert.ok(html.includes('data-scope="initial-value"'));
 assert.ok(!html.includes('initialValues.flag.'));
});

test('legacy linear and container custom output names keep their destinations',()=>{
 const old=createLegacyStarterChapter();
 for(const node of old.nodes.filter(n=>n.type==='static')) {
  const sequence=old.sequences.find(s=>s.id===node.sequenceId);
  if(sequence.type==='forked')continue;
  const original=sequence.exits[0];sequence.exits[0]='custom';node.connections.custom=node.connections[original];delete node.connections[original];
 }
 assert.deepEqual(validateChapter(old),[]);
 const project=parseProject(JSON.stringify(old));
 const [linear,container]=project.chapters[0].nodes;
 assert.equal(linear.connections.next,'supplies');assert.equal(container.connections.next,'encounter');
});

test('legacy pool effects migrate exactly once and malformed mechanics are rejected before import',()=>{
 const old=createLegacyStarterChapter();old.variables=[{id:'visits',type:'number',initial:0}];
 const quiet=old.sequences.find(s=>s.id==='quiet-sequence');quiet.cards[0].effects=[{op:'add',key:'visits',value:2}];
 const project=migrateChapter(old);assert.deepEqual(validateProject(project),[]);
 const compiled=compileChapter(project);const pool=compiled.nodes.find(n=>n.type==='legacyPool');
 assert.equal(pool.sequences.find(s=>s.id==='quiet-sequence').cards[0].effects.length,1);
 const raw=project.chapters[0].nodes.find(n=>n.type==='legacyPool').sequences.find(s=>s.type==='forked').cards[0].choices[0];
 raw.conditions={};assert.ok(validateProject(project).length);assert.throws(()=>parseProject(JSON.stringify(project)),/conditions|mechanics/);
});

test('switching an action to a check preserves its direct destination as success',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='fork'),placement=node.choices[0];
 const destination=node.connections[placement.id];customizeAction(project,placement);placement.overrides.resolution='check';synchronizeConnections(project);
 assert.equal(node.connections[`${placement.id}:success`],destination);assert.equal(node.connections[`${placement.id}:failure`],null);
 placement.overrides.resolution='direct';synchronizeConnections(project);assert.equal(node.connections[placement.id],destination);
});

test('a fresh blocked-node error survives the playback status update',()=>{
 const preview=Object.create(ProjectPreview.prototype);
 Object.assign(preview,{state:{activeNodeId:'before'},errorMessage:'No available choices',errorNode:'blocked',compiled:{nodes:[{id:'blocked',name:'Locked door'}],variables:[]},status:{},stateReadout:{querySelector:()=>({})},inventory:{update(){}},onChange(){}});
 preview.update({activeNodeId:'blocked',variables:{},collectedItems:[],checking:false,idle:true});
 assert.equal(preview.status.textContent,'No available choices');
 preview.update({activeNodeId:'after',variables:{},collectedItems:[],checking:false,idle:true});
 assert.equal(preview.errorMessage,null);
});
