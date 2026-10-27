import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createChapter,validateProject,normalizeLocalOwnership} from '../project/model.js';
import {createNode,synchronizeConnections} from '../studio/commands.js';
import {captureCardClipboard,canPasteCard,pasteCardClipboard} from '../studio/card-clipboard.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {nodeInspector} from '../studio/inspectors.js';

function fixture(type='container'){
 const p=createProject(),c=p.chapters[0],a=createNode(p,type),b=createNode(p,type);
 c.nodes.push(a,b);synchronizeConnections(p);
 return {p,c,a,b,source:(a.items||a.choices||a.cards)[0],target:(b.items||b.choices||b.cards)[0]};
}
const definition=(p,placement)=>p.library.find(d=>d.id===placement.definitionId);

test('card copy is detached; repeated local pastes replace target identity safely and preserve wiring',()=>{
 const {p,c,a,b,source,target}=fixture(),d=definition(p,source);
 d.name='Water';d.text='Line one\nLine two';d.onCollect=[{op:'add',key:'energy',value:2}];
 const payload=captureCardClipboard(p,c.id,a.id,source.id),snapshot=structuredClone(payload),targetId=target.id;
 d.text='Later source edit';const wiring=structuredClone(b.connections);
 pasteCardClipboard(p,c,b,target,payload);
 const pasted=definition(p,target);assert.equal(target.id,targetId);assert.notEqual(pasted.id,d.id);
 assert.equal(pasted.text,'Line one\nLine two');assert.equal(pasted.chapterId,c.id);assert.deepEqual(b.connections,wiring);
 const first=pasted.id;pasteCardClipboard(p,c,b,target,payload);assert.notEqual(target.definitionId,first);assert.deepEqual(payload,snapshot);
 assert.deepEqual(validateProject(p),[]);
});

test('paste is disabled for a different card type even where the destination slot accepts both',()=>{
 const {p,c,a,b,source,target}=fixture('linear');
 definition(p,source).kind='event';
 const payload=captureCardClipboard(p,c.id,a.id,source.id);
 for(const kind of ['item','caption','action']){
  definition(p,target).kind=kind;
  assert.equal(canPasteCard(p,b,target,payload),false);
  const before=structuredClone(p);assert.throws(()=>pasteCardClipboard(p,c,b,target,payload),/compatible/);assert.deepEqual(p,before);
 }
 assert.equal(canPasteCard(p,b,target,null),false);
 assert.equal(canPasteCard({...p,id:'different'},b,target,payload),false);
});

test('shared copy retains source and custom placement rules without editing the library',()=>{
 const {p,c,a,b,source,target}=fixture('fork');
 source.definitionId='explore';source.overrides={resolution:'check',check:{pool:[{sides:6,count:1}],modifier:0,target:4},effects:[{op:'add',key:'energy',value:1}]};
 const payload=captureCardClipboard(p,c.id,a.id,source.id),shared=structuredClone(definition(p,source));
 b.connections={[target.id]:'arrival'};
 pasteCardClipboard(p,c,b,target,payload);synchronizeConnections(p);
 assert.equal(target.definitionId,'explore');assert.deepEqual(target.overrides,source.overrides);
 assert.deepEqual(definition(p,target),shared);assert.equal(b.connections[`${target.id}:success`],'arrival');assert.equal(b.connections[`${target.id}:failure`],false);
 target.overrides.effects[0].value=8;assert.equal(source.overrides.effects[0].value,1);
 assert.deepEqual(validateProject(p),[]);
});

test('cross chapter paste copies item dependencies and chapter variables with destination owners',()=>{
 const {p,c,a,source}=fixture('fork');
 const item=createNode(p,'container');c.nodes.push(item);
 c.variables=[{id:'found',type:'flag',initial:false}];
 const itemId=item.items[0].definitionId;
 definition(p,source).effects=[{op:'addItem',key:itemId},{op:'set',key:'found',value:true}];
 definition(p,source).conditions=[{source:'inventory',key:itemId,op:'has'}];
 const other=createChapter('other'),targetNode=createNode(p,'fork',undefined,other.id);other.nodes.push(targetNode);other.startNode=targetNode.id;p.chapters.push(other);restoreFixtureDefaults(p);
 const target=targetNode.choices[0],payload=captureCardClipboard(p,c.id,a.id,source.id);
 pasteCardClipboard(p,other,targetNode,target,payload);synchronizeConnections(p);
 const copied=definition(p,target),copiedItem=p.library.find(d=>d.id===copied.effects[0].key);
 assert.notEqual(copiedItem.id,itemId);assert.equal(copiedItem.chapterId,other.id);assert.equal(copied.chapterId,other.id);
 assert.equal(copied.conditions[0].key,copiedItem.id);assert.equal(copied.effects[1].key,other.variables[0].id);
 assert.deepEqual(validateProject(p),[]);
});

test('intro paste works without replacing intro toggles; source canvas deletion does not invalidate a local snapshot',()=>{
 const {p,c,a,b}=fixture('container'),source=a.intro,target=b.intro;
 definition(p,source).text='Container intro';b.introEnabled=true;b.introOnce=true;
 const payload=captureCardClipboard(p,c.id,a.id,source.id),id=target.id;
 p.library=p.library.filter(d=>d.id!==source.definitionId);c.nodes=c.nodes.filter(n=>n!==a);
 pasteCardClipboard(p,c,b,target,payload);
 assert.equal(target.id,id);assert.equal(definition(p,target).text,'Container intro');assert.equal(b.introEnabled,true);assert.equal(b.introOnce,true);
});

test('paste command is one undoable transaction including copied definitions and variable changes',()=>{
 const {p,c,a,b,source,target}=fixture();normalizeLocalOwnership(p);
 const payload=captureCardClipboard(p,c.id,a.id,source.id),before=structuredClone(p),history=new DocumentHistory(p),drafts=new LocalCardDrafts();
 const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:c.id,selected:b.id},'paste-card',{placementId:target.id,clipboard:payload},drafts));
 assert.equal(result.failure,undefined);assert.notDeepEqual(result.project,before);assert.deepEqual(validateProject(result.project),[]);
 history.undo();assert.deepEqual(history.document,before);history.redo();assert.deepEqual(history.document,result.project);
});

test('both local and shared chapter card panels show right-side clipboard controls, initially disabled',()=>{
 const {p,c,a,source}=fixture();
 for(const shared of [false,true]){
  if(shared)source.definitionId='flashlight';
  const html=nodeInspector(p,c,a);
  assert.match(html,/class="card-source-clipboard"/);assert.match(html,/data-command="copy-card"/);
  assert.match(html,/<button[^>]*data-command="paste-card"[^>]*disabled/);
  assert.ok(html.indexOf('card-source-primary')<html.indexOf('card-source-clipboard'));
 }
});
