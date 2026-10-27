import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, validateProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { createNode } from '../studio/commands.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { transactDocument } from '../studio/document-session.js';
import { captureNodeClipboard } from '../studio/node-clipboard.js';
import { saveProject, STORAGE_KEY } from '../project/storage.js';

function setup() {
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'linear');
 chapter.nodes.push(node);
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 drafts.setContext(chapter.id,node.id);
 const selection={chapterId:chapter.id,selected:node.id};
 const run=(type,data={},context=selection)=>{
  const outcome=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,context,type,data,drafts));
  assert.equal(outcome.failure,undefined);
  return outcome;
 };
 return {project,chapter,node,history,drafts,selection,run};
}

test('deleting a beat cleans its local definitions in the same undoable, persisted edit',()=>{
 const s=setup(),id=s.node.cards[0].definitionId;
 const result=s.run('delete-node');
 assert.equal(result.project.library.some(d=>d.id===id),false);
 assert.ok(result.project.library.some(d=>d.id==='arrival'));
 const saved=new Map();assert.equal(saveProject(result.project,{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)}).ok,true);
 assert.equal(JSON.parse(saved.get(STORAGE_KEY)).library.some(d=>d.id===id),false);
 s.history.undo();assert.deepEqual(s.history.document,s.project);
 s.history.redo();assert.deepEqual(s.history.document,result.project);
});

test('automatic cleanup keeps all shared cards, other chapters and transitive rule dependencies',()=>{
 const s=setup();
 s.history.transact(project=>{
  const chapter=project.chapters[0],root=project.library.find(d=>d.id===s.node.cards[0].definitionId);
  const item={...createDefinition('item','retained-item'),visibility:'local',chapterId:chapter.id};
  root.effects=[{op:'addItem',key:item.id}];
  const orphan={...createDefinition('item','orphan'),visibility:'local',chapterId:chapter.id};
  const shared=createDefinition('item','unused-shared');
  const other={id:'other',name:'Other',startNode:'other-node',nodes:[],variables:[]};
  const otherNode=createNode(project,'linear',undefined,other.id);other.nodes.push(otherNode);other.startNode=otherNode.id;
  project.chapters.push(other);project.library.push(item,orphan,shared);
  restoreFixtureDefaults(project);
 });
 const before=s.history.document;
 const result=s.run('field',{scope:'project',path:'name',value:'Edited'}).project;
 assert.equal(result.library.some(d=>d.id==='orphan'),true,'preexisting unplaced drafts survive unrelated edits');
 for(const id of ['retained-item','unused-shared',before.chapters[1].nodes[0].cards[0].definitionId])assert.ok(result.library.some(d=>d.id===id));
 assert.deepEqual(validateProject(result),[]);
});

test('cached local types survive cleanup and restore their latest rules',()=>{
 const s=setup(),placement=s.node.cards[0];
 const switchTo=kind=>s.run('field',{scope:'placement',placementId:placement.id,path:'definitionId',value:`local:${kind}`});
 switchTo('item');
 s.run('field',{scope:'local-definition',placementId:placement.id,path:'permability',value:'7',inputType:'number'});
 const itemId=s.history.document.chapters[0].nodes.at(-1).cards[0].definitionId;
 switchTo('caption');
 assert.equal(s.history.document.library.some(d=>d.id===itemId),false);
 switchTo('item');
 assert.equal(s.history.document.library.find(d=>d.id===itemId).permability,7);
 assert.deepEqual(validateProject(s.history.document),[]);
});

test('clipboard restores a local card after deleting its last live placement',()=>{
 const s=setup(),copied=captureNodeClipboard(s.project,s.chapter.id,s.node.id),id=s.node.cards[0].definitionId;
 s.run('delete-node');
 assert.equal(s.history.document.library.some(d=>d.id===id),false);
 const pasted=s.run('paste-node',{clipboard:copied}).project;
 const restored=pasted.library.find(d=>d.id===pasted.chapters[0].nodes.at(-1).cards[0].definitionId);
 assert.equal(restored.name,copied.definitions.find(d=>d.id===id).name);
 assert.deepEqual(validateProject(pasted),[]);
});

test('Library no longer exposes the internal cleanup command',()=>{
 const html=readFileSync(new URL('../editor.html',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
 assert.doesNotMatch(html,/cleanup-local|Clean unused local cards/);
 assert.doesNotMatch(editor,/cleanup-local/);
});


test('newly generated unreachable definitions are discarded without pruning existing drafts',()=>{
 const s=setup();
 const result=transactDocument(s.history,s.drafts,project=>{
  project.library.push({...createDefinition('item','temporary-orphan'),visibility:'local',chapterId:s.chapter.id});
  project.name='Edited project';
 });
 assert.equal(result.failure,undefined);
 assert.equal(result.project.library.some(d=>d.id==='temporary-orphan'),false);
});

test('cleanup indexes the finalized cache-refresh revision and remains undoable',()=>{
 const s=setup(),rootId=s.node.cards[0].definitionId;
 s.history.transact(project=>{
  project.library.push({...createDefinition('item','old-dependency'),visibility:'local',chapterId:s.chapter.id});
  project.library.find(card=>card.id===rootId).effects=[{op:'addItem',key:'old-dependency'}];
 });
 const before=s.history.document;
 s.drafts.refreshChangedDefinitions=project=>{
  // Cache refresh is allowed to update the final document. Its references must
  // be visible to both cleanup queries, never indexed before this callback.
  project.library.push({...createDefinition('item','new-dependency'),visibility:'local',chapterId:s.chapter.id});
  project.library.find(card=>card.id===rootId).effects=[{op:'addItem',key:'new-dependency'}];
 };
 const outcome=transactDocument(s.history,s.drafts,project=>{project.name='Refresh revision';});
 assert.equal(outcome.failure,undefined);
 assert.ok(outcome.project.library.some(card=>card.id==='new-dependency'));
 assert.equal(outcome.project.library.some(card=>card.id==='old-dependency'),false);
 assert.deepEqual(validateProject(outcome.project),[]);
 s.history.undo();assert.deepEqual(s.history.document,before);
 s.history.redo();assert.deepEqual(s.history.document,outcome.project);
});

test('preserved unplaced drafts lose direct references when the local item source node is deleted',()=>{
 const s=setup();let itemId,containerId;
 s.history.transact(project=>{
  const chapter=project.chapters[0],container=createNode(project,'container');chapter.nodes.push(container);
  itemId=container.items[0].definitionId;containerId=container.id;
  project.library.push({...createDefinition('action','saved-action-draft'),visibility:'local',chapterId:chapter.id,effects:[{op:'addItem',key:itemId}]});
 });
 const result=s.run('delete-node',{}, {...s.selection,selected:containerId});
 assert.ok(result.project.library.some(d=>d.id==='saved-action-draft'));
 assert.equal(result.project.library.some(d=>d.id===itemId),false);
 assert.deepEqual(result.project.library.find(d=>d.id==='saved-action-draft').effects,[]);
 assert.deepEqual(validateProject(result.project),[]);
});

test('switching back to a cached local Action cannot resurrect a deleted Item or its rules',()=>{
 const s=setup(),placement=s.node.cards[0];let itemId,containerId;
 s.history.transact(project=>{
  const container=createNode(project,'container');project.chapters[0].nodes.push(container);
  itemId=container.items[0].definitionId;containerId=container.id;
 });
 const switchTo=kind=>s.run('field',{scope:'placement',placementId:placement.id,path:'definitionId',value:`local:${kind}`});
 switchTo('action');
 s.run('field',{scope:'local-definition',placementId:placement.id,path:'effects',value:[{op:'addItem',key:itemId}]});
 switchTo('caption');
 const before=s.history.document;
 const removed=s.run('delete-node',{}, {...s.selection,selected:containerId});
 assert.equal(removed.project.library.some(d=>d.id===itemId),false);
 s.history.undo();assert.deepEqual(s.history.document,before);
 s.history.redo();assert.deepEqual(s.history.document,removed.project);
 s.run('field',{scope:'project',path:'name',value:'Unrelated edit'});
 assert.equal(s.history.document.library.some(d=>d.id===itemId),false);
 const restored=switchTo('action').project;
 const action=restored.library.find(d=>d.id===restored.chapters[0].nodes.find(n=>n.id===s.node.id).cards[0].definitionId);
 assert.deepEqual(action.effects,[]);
 assert.equal(restored.library.some(d=>d.id===itemId),false);
 assert.deepEqual(validateProject(restored),[]);
});
