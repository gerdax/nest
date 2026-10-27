import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, compileChapter, validateProject, parseProject } from '../project/model.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { applyDocumentCommand, documentScope } from '../studio/document-commands.js';
import { transactDocument } from '../studio/document-session.js';
import { createPersistence } from '../studio/persistence.js';

function session(project = createProject()) {
  const history = new DocumentHistory(project), localDrafts = new LocalCardDrafts();
  const selection = Object.freeze({chapterId:project.activeChapterId, selected:project.chapters[0].startNode, definitionId:'explore', mode:'chapter'});
  const run = (type, data = {}, context = selection) => transactDocument(history, localDrafts, draft => applyDocumentCommand(draft, context, type, data, localDrafts));
  return {history, localDrafts, selection, run};
}

test('studio commands resolve the current history draft by IDs and preserve the rendered snapshot', () => {
  const state = session(), rendered = state.history.document;
  const outcome = state.run('field', {scope:'definition',path:'text',value:'New action text',inputType:'text'});
  assert.equal(outcome.failure,undefined);
  assert.equal(rendered.library.find(d=>d.id==='explore').text,'Follow the corridor');
  assert.equal(outcome.project.library.find(d=>d.id==='explore').text,'New action text');
  outcome.project.library[0].text='External mutation';
  assert.notEqual(state.history.document.library[0].text,'External mutation');
  assert.equal(state.selection.definitionId,'explore');
});

test('transaction finalization migrates rules and connections before refreshing cached definitions', () => {
  const project = createProject(), choice = project.chapters[0].nodes.find(n=>n.type==='fork').choices[0];
  const state = session(project), calls=[];
  state.localDrafts.refreshChangedDefinitions=(next,previous)=>{
    const placement=next.chapters[0].nodes.find(n=>n.type==='fork').choices[0];
    assert.equal(placement.effects,undefined);
    assert.equal(placement.overrides.effects[0].value,2);
    assert.deepEqual(Object.keys(next.chapters[0].nodes.find(n=>n.type==='fork').connections),[`${choice.id}:success`,`${choice.id}:failure`]);
    assert.equal(previous.find(d=>d.id==='explore').resolution,'direct');
    calls.push('refresh');
  };
  const outcome=transactDocument(state.history,state.localDrafts,draft=>{
    const placement=draft.chapters[0].nodes.find(n=>n.type==='fork').choices[0];
    placement.effects=[{op:'add',key:'energy',value:2}];
    draft.library.find(d=>d.id==='explore').resolution='check';
  });
  assert.equal(outcome.failure,undefined);
  assert.deepEqual(calls,['refresh']);
});

test('failed finalization publishes neither document nor navigation changes and preserves redo', () => {
  const state=session();
  state.run('field',{scope:'project',path:'name',value:'Later name',inputType:'text'});
  state.history.undo();
  const before=state.history.document;
  let reset=false;
  state.localDrafts.refreshChangedDefinitions=()=>{throw Error('Cannot refresh');};
  state.localDrafts.reset=()=>{reset=true;};
  const outcome=state.run('add-chapter');
  assert.equal(outcome.failure,'Cannot refresh');
  assert.equal(outcome.result,undefined);
  assert.deepEqual(outcome.project,before);
  assert.equal(state.history.canRedo,true);
  assert.equal(reset,true);
  assert.equal(state.selection.chapterId,before.activeChapterId);
});

test('no-op commands preserve redo and refresh current definition drafts without resetting them', () => {
  const state=session();
  state.run('field',{scope:'project',path:'name',value:'Later name',inputType:'text'});
  state.history.undo();
  let refreshes=0;
  const refresh=state.localDrafts.refreshChangedDefinitions.bind(state.localDrafts);
  state.localDrafts.refreshChangedDefinitions=(...args)=>{refreshes++;refresh(...args);};
  state.localDrafts.reset=()=>{throw Error('No-op must not reset cache');};
  const result=state.run('field',{scope:'project',path:'name',value:state.history.document.name,inputType:'text'});
  assert.equal(result.failure,undefined);
  assert.equal(state.history.canRedo,true);
  assert.equal(refreshes,1);
});

test('save failure leaves committed authoring edits and undo available in memory', () => {
  const state=session(), statuses=[];
  const outcome=state.run('add-chapter');
  const persistence=createPersistence({storage:{getItem:()=>null,setItem(){throw Error('Quota exceeded');}},onStatus:text=>statuses.push(text)});
  assert.equal(persistence.save(outcome.project).ok,false);
  assert.equal(state.history.document.chapters.length,2);
  assert.equal(state.history.canUndo,true);
  assert.equal(outcome.result.selection.chapterId,outcome.project.activeChapterId);
  persistence.report('Chapter ready.');
  assert.match(statuses.at(-1),/Save failed.*Quota exceeded.*Chapter ready/);
  state.history.undo();
  assert.equal(state.history.document.chapters.length,1);
});

test('whole-project import is one detached undoable replacement while retaining view mode and library selection', () => {
  const state=session(), incoming=createProject();
  incoming.name='Imported draft';incoming.chapters[0].nodes[0].cards=[];
  const parsed=parseProject(JSON.stringify(incoming),{allowDraft:true});
  const result=state.run('import',{raw:incoming,incoming:parsed});
  assert.equal(result.project.name,'Imported draft');
  assert.deepEqual(result.result.selection,{chapterId:'chapter-1',selected:'arrival'});
  assert.equal(state.selection.mode,'chapter');
  assert.equal(state.selection.definitionId,'explore');
  parsed.name='Changed externally';
  assert.equal(state.history.document.name,'Imported draft');
  state.history.undo();assert.equal(state.history.document.name,'First expedition');
  state.history.redo();assert.deepEqual(state.history.document.chapters[0].nodes[0].cards,[]);
});

test('deleting a beat unlinks direct, weighted and fallback references in one undoable command', () => {
  const project=createProject(), chapter=project.chapters[0];
  chapter.nodes.find(n=>n.type==='random').fallback='arrival';
  chapter.nodes.find(n=>n.type==='random').routes[0].target='arrival';
  chapter.nodes.find(n=>n.id==='quiet-passage').connections.next='arrival';
  const state=session(project), result=state.run('delete-node');
  const remaining=result.project.chapters[0];
  assert.equal(remaining.startNode,'supplies');
  assert.equal(result.result.selection.selected,'supplies');
  assert.equal(remaining.nodes.find(n=>n.type==='random').routes[0].target,false);
  assert.equal(remaining.nodes.find(n=>n.type==='random').fallback,false);
  assert.equal(remaining.nodes.find(n=>n.id==='quiet-passage').connections.next,false);
  state.history.undo();assert.deepEqual(state.history.document,project);
});

test('form commands retain number, flag, optional-bound, appearance and check conversions', () => {
  const state=session();
  state.run('field',{scope:'project',path:'variables.0.type',value:'flag',inputType:'select-one'});
  let variable=state.history.document.variables[0];
  assert.equal(variable.initial,false);assert.equal(variable.min,undefined);assert.equal(variable.max,undefined);
  state.run('field',{scope:'project',path:'variables.0.initial',value:'true',inputType:'select-one'});
  assert.equal(state.history.document.variables[0].initial,true);
  state.run('field',{scope:'project',path:'variables.0.type',value:'number',inputType:'select-one'});
  state.run('field',{scope:'project',path:'variables.0.min',value:'',inputType:'number'});
  assert.equal(state.history.document.variables[0].min,undefined);
  state.run('field',{scope:'definition',path:'resolution',value:'check',inputType:'select-one'});
  assert.equal(state.history.document.library.find(d=>d.id==='explore').check.mode,'stat');
  assert.equal(state.history.document.library.find(d=>d.id==='explore').check.difficulty,1);
  assert.deepEqual(Object.keys(state.history.document.chapters[0].nodes.find(n=>n.type==='fork').connections),['explore-choice:success','explore-choice:failure']);
  state.run('image',{scope:'definition',path:'imageScale',value:999});
  assert.equal(state.history.document.library.find(d=>d.id==='explore').imageScale,400);
  state.run('field',{scope:'project',path:'cardStyles.smallColor',colorField:true,color:'#aabbcc'});
  assert.equal(state.history.document.cardStyles.smallColor,'#aabbcc');
  state.run('field',{scope:'project',path:'cardStyles.smallColor',colorField:true,color:undefined});
  assert.equal(state.history.document.cardStyles.smallColor,undefined);
});

test('new chapter and beat commands return navigation without mutating the caller selection', () => {
  const state=session();
  const added=state.run('add-chapter'), next=Object.freeze({...state.selection,...added.result.selection});
  const beat=state.run('add-node',{type:'container',position:{x:17,y:29}},next);
  const chapter=beat.project.chapters.find(c=>c.id===next.chapterId), node=chapter.nodes.find(n=>n.id===beat.result.selection.selected);
  assert.equal(node.type,'container');assert.equal(node.x,17);assert.equal(node.y,29);
  assert.equal(documentScope(beat.project,{...next,selected:node.id},{scope:'local-definition',placementId:node.items[0].id}).kind,'item');
  assert.equal(state.selection.chapterId,'chapter-1');
  assert.deepEqual(validateProject(beat.project),[]);
  assert.equal(compileChapter(beat.project).nodes.length,3,'opening beat, added container and mandatory Death');
});

test('Add beat resolves placement after canceling an active graph pan',async()=>{
  const {readFileSync}=await import('node:fs');
  const {runInNewContext}=await import('node:vm');
  const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
  const start=source.indexOf("for(const b of document.querySelectorAll('[data-add]'))");
  const handler=source.slice(start,source.indexOf("$('#duplicate').onclick",start));
  const button={dataset:{add:'linear'}},calls=[];
  const graph={view:{x:900,y:700,z:2},cancel(){calls.push('cancel');this.view={x:50,y:50,z:1};}};
  runInNewContext(handler,{document:{querySelectorAll:()=>[button]},graph,edit(type,data){
    assert.equal(type,'add-node');
    assert.equal(data.position.x,100);assert.equal(data.position.y,90);
    calls.push('edit');
  }});
  button.onclick();
  assert.deepEqual(calls,['cancel','edit']);
});

test('moving multiple beats is one atomic undo step and invalid batches leave no partial movement',()=>{
 const state=session(),before=state.history.document,chapter=before.chapters[0];
 const positions=chapter.nodes.slice(0,2).map(n=>({id:n.id,x:n.x+100,y:n.y+50}));
 const outcome=state.run('move-nodes',{positions});assert.equal(outcome.failure,undefined);
 for(const p of positions){const node=outcome.project.chapters[0].nodes.find(n=>n.id===p.id);assert.equal(node.x,p.x);assert.equal(node.y,p.y);}
 state.history.undo();assert.deepEqual(state.history.document,before);assert.equal(state.history.canUndo,false);
 state.history.redo();assert.deepEqual(state.history.document,outcome.project);
 const current=state.history.document;
 assert.match(state.run('move-nodes',{positions:[positions[0],{id:'missing',x:0,y:0}]}).failure,/no longer be moved/);
 assert.deepEqual(state.history.document,current);
});


test('group deletion removes incoming links, repairs the start and supports one undo/redo',()=>{
  const project=createProject(),chapter=project.chapters[0];
  const ids=chapter.nodes.filter(node=>node.type!=='random').slice(0,2).map(node=>node.id);
  const random=chapter.nodes.find(node=>node.type==='random');
  random.routes[0].target=ids[0];random.fallback=ids[1];
  const survivor=chapter.nodes.find(node=>!ids.includes(node.id)&&node.type==='linear');
  survivor.connections.next=ids[1];
  const state=session(project),outcome=state.run('delete-nodes',{ids});
  assert.equal(outcome.failure,undefined);
  const remaining=outcome.project.chapters[0];
  assert.equal(remaining.nodes.length,chapter.nodes.length-2);
  assert.ok(remaining.nodes.every(node=>!ids.includes(node.id)));
  assert.equal(remaining.startNode,remaining.nodes[0].id);
  assert.equal(outcome.result.selection.selected,remaining.startNode);
  assert.equal(remaining.nodes.find(node=>node.id===random.id).routes[0].target,false);
  assert.equal(remaining.nodes.find(node=>node.id===random.id).fallback,false);
  assert.equal(remaining.nodes.find(node=>node.id===survivor.id).connections.next,false);
  const deleted=structuredClone(state.history.document);
  state.history.undo();assert.deepEqual(state.history.document,project);
  state.history.redo();assert.deepEqual(state.history.document,deleted);
});

test('deleting every ordinary beat retains mandatory Death in a draft chapter and undo restores it',()=>{
  const project=createProject(),state=session(project);
  const outcome=state.run('delete-nodes',{ids:project.chapters[0].nodes.filter(node=>node.type!=='death').map(node=>node.id)});
  assert.equal(outcome.failure,undefined);
  assert.deepEqual(outcome.project.chapters[0].nodes,project.chapters[0].nodes.filter(node=>node.type==='death'));
  assert.equal(outcome.project.chapters[0].startNode,'');
  state.history.undo();assert.deepEqual(state.history.document,project);
});

test('group deletion validates the whole batch before changing the document',()=>{
  for(const ids of [undefined,[],['arrival','missing']]){
    const project=createProject(),before=structuredClone(project);
    assert.throws(()=>applyDocumentCommand(project,{chapterId:project.activeChapterId,selected:'arrival'},'delete-nodes',{ids}));
    assert.deepEqual(project,before);
  }
});

test('group deletion keeps the surviving start and tolerates repeated IDs',()=>{
  const project=createProject(),chapter=project.chapters[0],id=chapter.nodes[1].id,state=session(project);
  const outcome=state.run('delete-nodes',{ids:[id,id]});
  assert.equal(outcome.failure,undefined);
  assert.equal(outcome.project.chapters[0].nodes.length,chapter.nodes.length-1);
  assert.equal(outcome.project.chapters[0].startNode,chapter.startNode);
});
