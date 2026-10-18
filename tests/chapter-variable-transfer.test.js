import test from 'node:test';
import assert from 'node:assert/strict';
import {captureNodeClipboard, pasteNodeClipboard} from '../studio/node-clipboard.js';
import {transferCard} from '../studio/card-transfer.js';
import {createProject, exportChapter, importChapter} from '../project/model.js';

test('cross-chapter move allocates a placement ID when imported chapter identities overlap', () => {
  const project=importChapter(createProject(),exportChapter(createProject()));
  const target=project.chapters[0],source=project.chapters[1];
  const moved=transferCard(project,target,{sourceChapterId:source.id,sourceNodeId:'arrival',
    placementId:'arrival-card',targetNodeId:'arrival',index:1});
  assert.ok(moved);
  assert.notEqual(moved.id,'arrival-card');
  const cards=target.nodes.find(node=>node.id==='arrival').cards;
  assert.equal(new Set(cards.map(card=>card.id)).size,cards.length);
});

function fixture() {
  const number = {id:'focus', name:'Focus', type:'number', initial:3, min:0, max:10};
  const flag = {id:'found', name:'Found', type:'flag', initial:false};
  const item = {id:'item', kind:'item', visibility:'local', onCollect:[{op:'set',key:'found',value:true}]};
  const local = {id:'action', kind:'action', visibility:'local', resolution:'check',
    check:{mode:'stat', modifierVariable:'focus',difficulty:2}, effects:[{op:'addItem',key:'item'}]};
  const shared = {id:'shared',kind:'action', visibility:'shared', effects:[{op:'add',key:'global',value:1}]};
  const placement = {id:'choice',definitionId:'action',overrides:{costs:[{source:'variable',key:'focus',amount:1}]}};
  const node = {id:'source',type:'fork',choices:[placement,{id:'shared-choice',definitionId:'shared'}],
    conditions:[{source:'variable',key:'found',op:'eq',value:true}],connections:{'choice:success':null,'choice:failure':'source','shared-choice':false}};
  const source = {id:'one',variables:[number,flag,{id:'unused',type:'number',initial:0}],nodes:[node]};
  const target = {id:'two',variables:[{...number,id:'other-focus'}],nodes:[{id:'target',type:'fork',choices:[],connections:{}}]};
  const project = {id:'project',variables:[{id:'global',type:'number',initial:0}],library:[local,item,shared],chapters:[source,target]};
  return {project,source,target,node,placement,local,item,shared};
}

test('clipboard captures recursive dependencies, preserving flags and numeric constraints', () => {
  const f = fixture(), before = structuredClone(f.project);
  const payload = captureNodeClipboard(f.project,f.source.id,f.node.id);
  assert.deepEqual(payload.variables,f.source.variables.slice(0,2));
  assert.deepEqual(f.project,before);
  const snapshot = structuredClone(payload);
  const pasted = pasteNodeClipboard(f.project,f.target,payload);
  const [number,flag] = f.target.variables.slice(1);
  assert.notEqual(number.id,'focus');
  assert.notEqual(number.id,'other-focus');
  assert.deepEqual({...number,id:'focus'},f.source.variables[0]);
  assert.deepEqual({...flag,id:'found'},f.source.variables[1]);
  const action = f.project.library.find(definition => definition.id === pasted.choices[0].definitionId);
  const item = f.project.library.find(definition => definition.id === action.effects[0].key);
  assert.equal(action.check.modifierVariable,number.id);
  assert.equal(pasted.choices[0].overrides.costs[0].key,number.id);
  assert.equal(pasted.conditions[0].key,flag.id);
  assert.equal(item.onCollect[0].key,flag.id);
  assert.equal(pasted.choices[1].definitionId,f.shared.id);
  assert.equal(f.shared.effects[0].key,'global');
  assert.deepEqual(payload,snapshot);
  assert.equal(f.local.check.modifierVariable,'focus');
});

test('same-chapter paste keeps existing variable references and restores removed snapshots', () => {
  const f = fixture(), payload = captureNodeClipboard(f.project,f.source.id,f.node.id);
  const pasted = pasteNodeClipboard(f.project,f.source,payload);
  assert.equal(f.source.variables.length,3);
  assert.equal(pasted.choices[0].overrides.costs[0].key,'focus');
  f.source.variables = f.source.variables.filter(variable => variable.id !== 'focus');
  pasteNodeClipboard(f.project,f.source,payload);
  assert.deepEqual(f.source.variables.at(-1),payload.variables[0]);
});

for (const copy of [false,true]) test(`cross-chapter card ${copy ? 'copy' : 'move'} remaps local dependencies and placement rules`, () => {
  const f = fixture(), before = structuredClone([f.local,f.item]);
  const moved = transferCard(f.project,f.target,{sourceChapterId:f.source.id,sourceNodeId:f.node.id,
    placementId:f.placement.id,targetNodeId:'target',index:0,copy});
  assert.ok(moved);
  assert.equal(f.node.choices.length,copy ? 2 : 1);
  assert.equal(moved.id === f.placement.id,!copy);
  const action = f.project.library.find(definition => definition.id === moved.definitionId);
  const item = f.project.library.find(definition => definition.id === action.effects[0].key);
  assert.equal(action.check.modifierVariable,f.target.variables[1].id);
  assert.equal(moved.overrides.costs[0].key,f.target.variables[1].id);
  assert.equal(item.onCollect[0].key,f.target.variables[2].id);
  assert.deepEqual([f.local,f.item],before);
  assert.ok(Object.values(f.target.nodes[0].connections).every(value => value === false));
});

test('same-chapter card copy shares variables while copying local definitions', () => {
  const f = fixture(), target = f.target.nodes[0];
  f.source.nodes.push(target);
  const copied = transferCard(f.project,f.source,{sourceNodeId:f.node.id,placementId:f.placement.id,targetNodeId:target.id,index:0,copy:true});
  assert.notEqual(copied.definitionId,f.local.id);
  assert.equal(copied.overrides.costs[0].key,'focus');
  assert.equal(f.source.variables.length,3);
});

test('cross-chapter cuts isolate surviving source definitions and repeated pastes allocate fresh variables', () => {
  const f = fixture(), payload = captureNodeClipboard(f.project,f.source.id,f.node.id,{cut:true});
  f.source.nodes = [];
  const first = pasteNodeClipboard(f.project,f.target,payload);
  const second = pasteNodeClipboard(f.project,f.target,payload);
  const a = f.project.library.find(definition => definition.id === first.choices[0].definitionId);
  const b = f.project.library.find(definition => definition.id === second.choices[0].definitionId);
  assert.notEqual(a.id,f.local.id);
  assert.notEqual(a.check.modifierVariable,b.check.modifierVariable);
  assert.equal(f.local.check.modifierVariable,'focus');
  assert.equal(new Set(f.target.variables.map(variable => variable.id)).size,f.target.variables.length);
});

test('global references alone do not clone chapter variables', () => {
  const f = fixture();
  f.node.choices = [{id:'shared-choice',definitionId:'shared'}];
  f.node.conditions = [];
  const payload = captureNodeClipboard(f.project,f.source.id,f.node.id);
  assert.deepEqual(payload.variables,[]);
  const pasted = pasteNodeClipboard(f.project,f.target,payload);
  assert.equal(f.target.variables.length,1);
  assert.equal(pasted.choices[0].definitionId,'shared');
});
