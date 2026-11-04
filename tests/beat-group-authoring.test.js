import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, createChapter, compileChapter, validateProject} from '../project/model.js';
import {beatGroups, readBeatTarget} from '../project/beat-groups.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {captureNodesClipboard, pasteNodesClipboard} from '../studio/node-clipboard.js';
import {beatGroupInspector, nodeInspector} from '../studio/inspectors.js';

function fixture() {
  const project=createProject(), chapter=project.chapters[0];
  const linear=(id,next,x)=>({id,name:id,type:'linear',x,y:120,cards:[{id:id+'-card',definitionId:'arrival'}],connections:{next}});
  chapter.nodes.push(linear('before-group','group-first',100),linear('group-first','group-last',400),
    {id:'group-last',name:'Final route',type:'random',x:700,y:120,
      routes:[{id:'leave',name:'Leave',target:'after-group',weight:1,conditions:[]}],fallback:'after-group'},
    linear('after-group','second-tail',1000),linear('second-tail',null,1300));
  chapter.startNode='before-group';
  const history=new DocumentHistory(project), drafts=new LocalCardDrafts();
  const edit=(type,data,selected='before-group')=>transactDocument(history,drafts,draft=>
    applyDocumentCommand(draft,{chapterId:chapter.id,selected},type,data,drafts));
  const group=()=>edit('group-beats',{ids:['group-first','group-last']});
  return {project,chapter,history,edit,group};
}

test('group edits, moves and collapse participate in undo/redo and reject boundary bypasses',()=>{
  const {chapter,history,edit,group}=fixture();
  const original=compileChapter(history.document).nodes;
  const grouped=group();
  assert.equal(grouped.failure,undefined);
  const id=grouped.result.value;
  assert.deepEqual(compileChapter(grouped.project).nodes,original);
  const getGroup=()=>beatGroups(history.document.chapters[0])[0];
  assert.equal(edit('rename-beat-group',{id,name:'  Encounter  '}).failure,undefined);
  assert.equal(edit('move-beat-group',{id,dx:25,dy:-10}).failure,undefined);
  assert.equal(history.document.chapters[0].nodes.find(node=>node.id==='group-last').x,725);
  assert.equal(edit('collapse-beat-group',{id,collapsed:true}).failure,undefined);
  assert.equal(getGroup().collapsed,true);
  assert.ok(history.undo());
  assert.equal(getGroup().collapsed,false);
  assert.ok(history.redo());
  assert.equal(getGroup().name,'Encounter');
  const before=history.document;
  assert.match(edit('connect',{id:'before-group',exit:'next',target:'group-last'}).failure,/boundary/i);
  assert.deepEqual(history.document,before);
  const current=before.chapters.find(candidate=>candidate.id===chapter.id);
  assert.match(nodeInspector(before,current,current.nodes.find(node=>node.id==='before-group')),/Encounter · Input/);
  assert.match(nodeInspector(before,current,current.nodes.find(node=>node.id==='group-last')),/Encounter · Output/);
  const panel=beatGroupInspector(current,beatGroups(current)[0]);
  assert.match(panel,/Group name[\s\S]*value="Encounter"/);
  assert.match(panel,/2 beats · Collapsed/);
  assert.match(panel,/value="beat:group-first" selected/);
  assert.match(panel,/value="beat:after-group" selected/);
});

test('copying a complete group remaps its members, Random outcomes and group-to-group bindings',()=>{
  const {history,edit,group}=fixture();
  const first=group();
  assert.equal(first.failure,undefined);
  const next=edit('group-beats',{ids:['after-group','second-tail']});
  assert.equal(next.failure,undefined);
  const source=history.document, chapter=source.chapters[0];
  const payload=captureNodesClipboard(source,chapter.id,['group-first','group-last','after-group','second-tail']);
  const target=createChapter('new-chapter');
  source.chapters.push(target);
  const added=pasteNodesClipboard(source,target,payload);
  const [a,b]=beatGroups(target);
  assert.notEqual(a.id,first.result.value);
  assert.deepEqual(a.memberIds,added.slice(0,2).map(node=>node.id));
  assert.deepEqual(a.destination,{groupId:b.id});
  assert.equal(a.outgoing[0].output,added[1].routes[0].id);
  assert.equal(a.outgoing[1].output,'fallback');
  const compiled=compileChapter(source,target.id);
  const random=compiled.nodes.find(node=>node.id===added[1].id);
  assert.equal(readBeatTarget(random,random.routes[0].id),added[2].id);
  assert.equal(readBeatTarget(random,'fallback'),added[2].id);
});

test('partial copies become ordinary beats and deletions clear affected boundary bindings',()=>{
  const {history,edit,group}=fixture();
  assert.equal(group().failure,undefined);
  const source=history.document, chapter=source.chapters[0];
  const payload=captureNodesClipboard(source,chapter.id,['group-last','after-group']);
  assert.deepEqual(payload.beatGroups,[]);
  const [random,end]=pasteNodesClipboard(source,chapter,payload);
  assert.equal(random.routes[0].target,end.id);
  assert.equal(random.fallback,end.id);
  assert.equal(edit('inspector',{command:'remove-route',index:'0'},'group-last').failure,undefined);
  assert.deepEqual(beatGroups(history.document.chapters[0])[0].outgoing,[{nodeId:'group-last',output:'fallback'}]);
  assert.equal(edit('delete-node',{},'group-first').failure,undefined);
  assert.equal(beatGroups(history.document.chapters[0])[0].entryId,false);
  assert.equal(edit('delete-node',{},'group-last').failure,undefined);
  assert.deepEqual(beatGroups(history.document.chapters[0]),[]);
  assert.deepEqual(validateProject(history.document,{allowDraft:true}),[]);
});
