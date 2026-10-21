import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, migrateChapter, parseProject, validateProject, compileChapter } from '../project/model.js';
import { createLegacyStarterChapter, validateChapter } from '../chapter/model.js';
import { field, select, checkbox, rules } from '../studio/forms.js';
import { variableInspector } from '../studio/inspectors.js';
import { synchronizeConnections, customizeAction, newRule, normalizeRule } from '../studio/commands.js';
import { transact, conditionsMet } from '../project/state.js';
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
 assert.equal(node.connections[`${placement.id}:success`],destination);assert.equal(node.connections[`${placement.id}:failure`],false);
 placement.overrides.resolution='direct';synchronizeConnections(project);assert.equal(node.connections[placement.id],destination);
});

test('a fresh blocked-node error survives the playback status update',()=>{
 const preview=Object.create(ProjectPreview.prototype);
 Object.assign(preview,{state:{activeNodeId:'before'},errorMessage:'No available choices',errorNode:'blocked',compiled:{nodes:[{id:'blocked',name:'Locked door'}],variables:[]},root:{querySelector:()=>({setAttribute(){}})},resources:{},healthValue:{},energyValue:{},checkDetails:{},checkChance:{},checkFormula:{},checkRules:{},status:{},stateReadout:{querySelector:()=>({})},inventory:{update(){}},onChange(){},onCardChange(){}});
 preview.nextChapterButton={};
 preview.update({activeNodeId:'blocked',variables:{},collectedItems:[],checking:false,idle:true});
 assert.equal(preview.status.textContent,'No available choices');
 preview.update({activeNodeId:'after',variables:{},collectedItems:[],checking:false,idle:true});
 assert.equal(preview.errorMessage,null);
});

test('selecting a flag for an Add effect authors a valid Set effect and conditions keep comparison operators',()=>{
 const project=createProject();project.variables.push({id:'flag',type:'flag',initial:false});
 const effect=newRule(project,'effects');effect.op='add';effect.value=3;effect.key='flag';
 normalizeRule(project,effect,'key');
 assert.deepEqual(effect,{op:'set',key:'flag',value:false});
 effect.value=true;
 const condition=newRule(project,'conditions');condition.op='gte';condition.key='flag';
 normalizeRule(project,condition,'key');
 assert.deepEqual(condition,{source:'variable',key:'flag',op:'eq',value:false});
 const vignette=project.library.find(d=>d.id==='arrival');vignette.effects=[effect];vignette.conditions=[condition];
 assert.deepEqual(validateProject(project),[]);
 const compiled=compileChapter(project),card=compiled.nodes[0].cards[0],variables={energy:3,flag:false};
 assert.equal(conditionsMet(card.conditions,variables),true);
 assert.equal(transact(variables,[],{effects:card.effects},compiled.variables,compiled.library).variables.flag,true);
});

test('rule key normalization preserves inventory effect and condition operators',()=>{
 const project=createProject(),itemId=project.library.find(d=>d.kind==='item').id;
 const effects=['addItem','removeItem'].map(op=>({op,key:itemId}));
 const conditions=['has','missing'].map(op=>({source:'inventory',key:itemId,op}));
 for(const rule of [...effects,...conditions]){
  const before=structuredClone(rule);normalizeRule(project,rule,'key');assert.deepEqual(rule,before);
 }
 const vignette=project.library.find(d=>d.id==='arrival');vignette.effects=effects;vignette.conditions=conditions;
 assert.deepEqual(validateProject(project),[]);
});

test('cost key switches preserve source and amount without adding operators or values',()=>{
 const project=createProject();project.variables.push({id:'flag',type:'flag',initial:false},{id:'coins',type:'number',initial:5});
 const cost=newRule(project,'costs');cost.amount=2;
 for(const key of ['coins','flag','energy']){
  cost.key=key;normalizeRule(project,cost,'key');
  assert.deepEqual(cost,{source:'variable',key,amount:2});
 }
 const action=project.library.find(d=>d.kind==='action');action.costs=[cost];
 assert.deepEqual(validateProject(project),[]);
 assert.equal(transact({energy:3,flag:false,coins:5},[],{costs:[cost]},project.variables).variables.energy,1);
});

test('resource cost picker offers numeric variables and item costs offer item definitions',()=>{
 const project=createProject();project.variables.push({id:'flag',type:'flag',initial:false});
 const cost=newRule(project,'costs');
 const resourceForm=rules(project,[cost],'costs','definition','costs');
 assert.match(resourceForm,/value="energy"/);assert.doesNotMatch(resourceForm,/value="flag"/);
 const itemId=project.library.find(d=>d.kind==='item').id;
 const itemForm=rules(project,[{source:'inventory',key:itemId,amount:1}],'costs','definition','costs');
 assert.ok(itemForm.includes(`value="${itemId}"`));assert.doesNotMatch(itemForm,/value="energy"/);
});

test('condition and effect key switches reset typed values and preserve valid operators',()=>{
 const project=createProject();project.variables.push({id:'flag',type:'flag',initial:false});
 for(const rule of [{source:'variable',key:'energy',op:'neq',value:3},{key:'energy',op:'set',value:3}]){
  const op=rule.op;rule.key='flag';normalizeRule(project,rule,'key');
  assert.equal(rule.op,op);assert.equal(rule.value,false);
  rule.value=true;rule.key='energy';normalizeRule(project,rule,'key');
  assert.equal(rule.op,op);assert.equal(rule.value,0);
 }
});
