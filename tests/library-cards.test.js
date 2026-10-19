import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createNode, synchronizeConnections} from '../studio/commands.js';
import {libraryCardSlot, appendLibraryCard, mountLibraryCardActions} from '../studio/library-cards.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';

for (const [type, slot, kinds] of [
 ['linear','cards',['event','caption','action','item','health','energy']],
 ['fork','choices',['event','caption','action']],
 ['container','items',['item']],
 ['random',null,[]], ['legacySequence',null,[]], ['legacyPool',null,[]],
]) test(`Library compatibility for ${type} matches appendable slots`,()=>{
 const node={type,cards:[],choices:[],items:[],intro:{id:'intro'}};
 for(const kind of ['event','caption','action','item','health','energy']) {
  assert.equal(libraryCardSlot(node,{kind}),kinds.includes(kind)?slot:null);
 }
 assert.equal(libraryCardSlot(node,{kind:'narrative'}),kinds.includes('event')?slot:null);
 assert.equal(libraryCardSlot(node,{kind:'item',visibility:'local'}),null);
});

test('no selection, missing cards, and malformed slots cannot accept a Library card',()=>{
 assert.equal(libraryCardSlot(null,{kind:'event'}),null);
 assert.equal(libraryCardSlot({type:'linear',cards:[]},undefined),null);
 assert.equal(libraryCardSlot({type:'linear'},{kind:'event'}),null);
});

for(const type of ['linear','fork','container'])test(`adding from Library appends a fresh shared placement to ${type} with one undo step`,()=>{
 const project=createProject(),chapter=project.chapters[0];
 const node=createNode(project,type,undefined,chapter.id);chapter.nodes.push(node);
 const card={...createDefinition(type==='container'?'item':'action','shared-addition'),visibility:'shared'};
 if(card.kind==='action')card.resolution='check';
 project.library.push(card);synchronizeConnections(project);
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const before=history.document,selection={chapterId:chapter.id,selected:node.id,mode:'library',definitionId:card.id};
 const slot=libraryCardSlot(node,card);
 const run=()=>transactDocument(history,drafts,draft=>applyDocumentCommand(draft,selection,'add-library-card',{definitionId:card.id},drafts));
 const {result,failure}=run();assert.equal(failure,undefined);assert.ok(result.value);assert.equal(result.selection,undefined);
 const after=history.document,target=after.chapters[0].nodes.find(n=>n.id===node.id),added=target[slot].at(-1);
 assert.equal(target[slot].length,node[slot].length+1);
 assert.equal(added.definitionId,card.id);assert.equal(added.id,result.value);
 assert.equal(after.library.length,project.library.length);
 assert.deepEqual(target.intro,node.intro);
 if(type==='fork'){
  assert.equal(target.connections[`${added.id}:success`],false);
  assert.equal(target.connections[`${added.id}:failure`],false);
 }
 assert.deepEqual(validateProject(after,{allowDraft:true}),[]);
 assert.equal(history.undo(),true);assert.deepEqual(history.document,before);
 assert.equal(history.redo(),true);assert.deepEqual(history.document,after);
 const next=run().result;assert.notEqual(next.value,added.id);
});

test('invalid Library additions leave document and undo history unchanged',()=>{
 const project=createProject(),chapter=project.chapters[0],container=chapter.nodes.find(n=>n.type==='container');
 const card={...createDefinition('caption','caption-only'),visibility:'shared'};project.library.push(card);
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 for(const selected of [null,'missing',container.id]){
  const before=history.document;
  const {result,failure}=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:chapter.id,selected,mode:'library'},'add-library-card',{definitionId:card.id},drafts));
  assert.equal(failure,undefined);assert.deepEqual(result,{});assert.deepEqual(history.document,before);assert.equal(history.canUndo,false);
 }
 const before=structuredClone(project);
 assert.equal(appendLibraryCard(project,chapter,{type:'linear',cards:[]},card.id),null);
 assert.equal(appendLibraryCard(project,chapter,container,'missing'),null);
 assert.deepEqual(project,before);
});

test('single clicks open cards and a double click adds exactly once; nested card content works',()=>{
 const listeners={},calls=[],button={dataset:{definition:'shared'}};
 const root={contains:el=>el===button,addEventListener:(type,fn)=>listeners[type]=fn,removeEventListener:(type,fn)=>{assert.equal(listeners[type],fn);delete listeners[type];}};
 const destroy=mountLibraryCardActions(root,{onOpen:id=>calls.push(['open',id]),onAdd:id=>calls.push(['add',id])});
 const event={target:{closest:()=>button}};
 listeners.click(event);assert.deepEqual(calls,[['open','shared']]);
 listeners.click(event);listeners.dblclick(event);
 assert.deepEqual(calls,[['open','shared'],['open','shared'],['add','shared']]);
 const foreign={target:{closest:()=>({dataset:{definition:'foreign'}})}};
 listeners.click(foreign);listeners.dblclick(foreign);assert.equal(calls.length,3);
 destroy();assert.deepEqual(listeners,{});
});
