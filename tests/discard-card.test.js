import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject,outputsForNode} from '../project/model.js';
import {createNode} from '../studio/commands.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';

for(const type of ['linear','fork','container'])for(const intro of [false,true]){
 if(type==='linear'&&intro)continue;
 test(`canvas discard removes ${type} ${intro?'introduction':'card'} in one reversible transaction`,()=>{
  const project=createProject(),chapter=project.chapters[0],node=createNode(project,type);
  chapter.nodes.push(node);
  const placement=intro?node.intro:node[type==='linear'?'cards':type==='fork'?'choices':'items'][0];
  const before=structuredClone(project),history=new DocumentHistory(project),drafts=new LocalCardDrafts();
  const result=transactDocument(history,drafts,p=>applyDocumentCommand(p,{chapterId:chapter.id,selected:chapter.nodes[0].id},'discard-card',{sourceNodeId:node.id,placementId:placement.id},drafts));
  assert.equal(result.failure,undefined);
  const changed=result.project.chapters[0].nodes.find(n=>n.id===node.id);
  assert.equal(JSON.stringify(changed).includes(placement.id),false);
  if(intro){assert.equal(changed.introEnabled,false);if(type==='container')assert.ok(changed.intro);}
  assert.equal(result.result.selection.selected,node.id);
  assert.deepEqual(validateProject(result.project,{allowDraft:true}),[]);
  for(const key of Object.keys(changed.connections||{}))assert.ok(outputsForNode(result.project,changed).includes(key));
  assert.ok(history.undo());assert.deepEqual(history.document,before);assert.equal(history.canUndo,false);
  assert.ok(history.redo());assert.deepEqual(history.document,result.project);
 });
}
