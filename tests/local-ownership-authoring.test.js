import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter, validateProject } from '../project/model.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { createNode, makePlacement, replaceCard, duplicateNode, duplicatePlacement, promoteCard, synchronizeConnections } from '../studio/commands.js';
import { captureNodeClipboard, pasteNodeClipboard } from '../studio/node-clipboard.js';
import { addInventory, conditionsMet, transact } from '../project/state.js';
import { transferCard } from '../studio/card-transfer.js';

function fixture() {
 const project=createProject(), source=project.chapters[0], destination=createChapter('other');
 project.chapters.push(destination);
 const node=createNode(project,'fork',undefined,source.id);source.nodes.push(node);
 const action=project.library.find(d=>d.id===node.choices[0].definitionId);
 const first={...createDefinition('item','local-first'),visibility:'local',chapterId:source.id,inventoryKey:'first-alias'};
 const second={...createDefinition('item','local-second'),visibility:'local',chapterId:source.id};
 action.effects=[{op:'addItem',key:first.inventoryKey}];first.onCollect=[{op:'addItem',key:second.id}];second.onCollect=[{op:'removeItem',key:first.id}];
 node.choices[0].contextItemId=first.id;project.library.push(first,second);
 return {project,source,destination,node,action,first,second};
}
function assertCopiedChain(project,placement,original,chapterId) {
 const action=project.library.find(d=>d.id===placement.definitionId), first=project.library.find(d=>d.id===action.effects[0].key);
 const second=project.library.find(d=>d.id===first.onCollect[0].key);
 assert.notEqual(action.id,original.action.id);assert.notEqual(first.id,original.first.id);assert.notEqual(second.id,original.second.id);
 for(const definition of [action,first,second])assert.equal(definition.chapterId,chapterId);
 assert.equal(first.inventoryKey,undefined);assert.equal(second.onCollect[0].key,first.id);assert.equal(placement.contextItemId,first.id);
}

test('local creation accepts the owning chapter before a new chapter or node is attached',()=>{
 const project=createProject(), owner='not-yet-attached';
 const placement=makePlacement(project,'event','Opening',owner);
 assert.equal(project.library.find(d=>d.id===placement.definitionId).chapterId,owner);
 const node=createNode(project,'fork',undefined,owner);
 for(const placement of [node.intro,...node.choices].filter(Boolean))assert.equal(project.library.find(d=>d.id===placement.definitionId).chapterId,owner);
});

test('replacement and duplication retain the node owner when it differs from the active chapter',()=>{
 const f=fixture();f.project.activeChapterId=f.destination.id;
 const replacement=replaceCard(f.project,f.node.choices[1],'action');assert.equal(replacement.chapterId,f.source.id);
 const placement=duplicatePlacement(f.project,f.node,f.node.choices[0]);assertCopiedChain(f.project,placement,f,f.source.id);
 const node=duplicateNode(f.project,f.node);assertCopiedChain(f.project,node.choices[0],f,f.source.id);
});

for(const cut of [false,true])test(`cross-chapter ${cut?'cut':'copy'} clones local dependency closure without chapter variables`,()=>{
 const f=fixture(), payload=captureNodeClipboard(f.project,f.source.id,f.node.id,{cut});
 if(cut)f.source.nodes.splice(f.source.nodes.indexOf(f.node),1);
 const pasted=pasteNodeClipboard(f.project,f.destination,payload);
 assertCopiedChain(f.project,pasted.choices[0],f,f.destination.id);
 for(const definition of [f.action,f.first,f.second])assert.equal(definition.chapterId,f.source.id);
});

test('same-chapter cut retains local definition identity and owner',()=>{
 const f=fixture(), payload=captureNodeClipboard(f.project,f.source.id,f.node.id,{cut:true});f.source.nodes.splice(f.source.nodes.indexOf(f.node),1);
 const pasted=pasteNodeClipboard(f.project,f.source,payload);
 assert.equal(pasted.choices[0].definitionId,f.action.id);assert.equal(f.action.chapterId,f.source.id);
});

test('cross-chapter card move clones local inventory dependencies',()=>{
 const f=fixture(), target=createNode(f.project,'fork',undefined,f.destination.id);f.destination.nodes.push(target);
 const moved=transferCard(f.project,f.destination,{sourceChapterId:f.source.id,sourceNodeId:f.node.id,placementId:f.node.choices[0].id,targetNodeId:target.id,index:0});
 assertCopiedChain(f.project,moved,f,f.destination.id);assert.equal(f.node.choices.length,1);
});

test('promotion promotes the transitive inventory closure and removes chapter owners',()=>{
 const f=fixture();assert.equal(promoteCard(f.project,f.node.choices[0]),f.action);
 for(const definition of [f.action,f.first,f.second]){assert.equal(definition.visibility,'shared');assert.equal(Object.hasOwn(definition,'chapterId'),false);}
});

test('promotion keeps dependency chapter rules on that dependency’s chapter instance',()=>{
 const f=fixture();f.source.variables=[{id:'chapter-only',type:'number',initial:0}];
 f.second.onCollect.push({op:'set',key:'chapter-only',value:1});
 const node=createNode(f.project,'linear'),placement={id:'second-instance',definitionId:f.second.id};
 node.cards.push(placement);f.source.nodes.push(node);
 const before=structuredClone(f.second.onCollect);
 promoteCard(f.project,f.node.choices[0]);
 for(const definition of [f.action,f.first,f.second]){assert.equal(definition.visibility,'shared');assert.equal(definition.chapterId,undefined);}
 assert.deepEqual(placement.overrides.onCollect,before);
 assert.deepEqual(resolvePlacement(f.project,placement).onCollect,before);
 assert.deepEqual(f.second.onCollect,[{op:'removeItem',key:f.first.id}]);
});


test('copying shared cards reuses shared definitions without adding a chapter owner',()=>{
 const project=createProject(), source=project.chapters[0], destination=createChapter('other');project.chapters.push(destination);
 const node=source.nodes.find(n=>n.id==='arrival'), definition=project.library.find(d=>d.id===node.cards[0].definitionId);
 const pasted=pasteNodeClipboard(project,destination,captureNodeClipboard(project,source.id,node.id));
 assert.equal(pasted.cards[0].definitionId,definition.id);assert.equal(Object.hasOwn(definition,'chapterId'),false);
});

for(const aliasCase of ['arbitrary','item-id','action-id'])for(const operation of ['placement','node','copy','cut','transfer'])test(`${operation} preserves local inventory alias groups (alias=${aliasCase})`,()=>{
 const f=fixture(), alias=aliasCase==='item-id'?f.first.id:aliasCase==='action-id'?f.action.id:'local-group';
 f.first.inventoryKey=alias;f.second.inventoryKey=alias;
 f.action.effects=[{op:'addItem',key:f.first.id},{op:'addItem',key:f.second.id}];
 f.action.conditions=[{source:'inventory',key:alias,op:'has'}];
 f.first.onCollect=[{op:'removeItem',key:f.first.id}];f.second.onCollect=[{op:'removeItem',key:f.second.id}];
 f.node.choices[0].contextItemId=f.second.id;
 const destinationNode=createNode(f.project,operation==='transfer'?'fork':'linear',undefined,f.destination.id);f.destination.nodes.push(destinationNode);f.destination.startNode=destinationNode.id;
 synchronizeConnections(f.project);
 assert.deepEqual(validateProject(f.project),[]);
 const payload=captureNodeClipboard(f.project,f.source.id,f.node.id,{cut:operation==='cut'});
 const copy=()=>{
  if(operation==='placement')return duplicatePlacement(f.project,f.node,f.node.choices[0]);
  if(operation==='node'){const node=duplicateNode(f.project,f.node);f.source.nodes.push(node);return node.choices[0];}
  if(operation==='transfer')return transferCard(f.project,f.destination,{sourceChapterId:f.source.id,sourceNodeId:f.node.id,placementId:f.node.choices[0].id,targetNodeId:destinationNode.id,index:0,copy:true});
  return pasteNodeClipboard(f.project,f.destination,payload).choices[0];
 };
 const placement=copy(), action=f.project.library.find(d=>d.id===placement.definitionId);
 const first=f.project.library.find(d=>d.id===action.effects[0].key), second=f.project.library.find(d=>d.id===action.effects[1].key);
 assert.notEqual(first.id,second.id);assert.notEqual(first.inventoryKey,alias);
 assert.equal(first.inventoryKey,second.inventoryKey);
 assert.equal(action.conditions[0].key,first.inventoryKey);
 assert.equal(first.onCollect[0].key,first.id);assert.equal(second.onCollect[0].key,second.id);
 assert.equal(placement.contextItemId,second.id);
 assert.equal(resolvePlacement(f.project,placement).contextInventoryKey,first.inventoryKey);
 const inventory=addInventory(addInventory([],second),first);assert.equal(inventory.length,1);
 assert.equal(conditionsMet(action.conditions,{},inventory),true);
 assert.equal(transact({},inventory,{effects:[{op:'removeItem',key:action.conditions[0].key}]},[],f.project.library).inventory.length,0);
 const another=copy(), anotherAction=f.project.library.find(d=>d.id===another.definitionId), anotherFirst=f.project.library.find(d=>d.id===anotherAction.effects[0].key);
 assert.notEqual(anotherFirst.inventoryKey,first.inventoryKey);
 assert.equal(f.first.inventoryKey,alias);assert.equal(f.second.inventoryKey,alias);
 assert.deepEqual(validateProject(f.project),[]);
});
