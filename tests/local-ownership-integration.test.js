import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createChapter,parseProject,exportChapter,importChapter,compileChapter,validateProject,normalizeLocalOwnership} from '../project/model.js';
import {createNode} from '../studio/commands.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';
import {saveProject,loadProject} from '../project/storage.js';

function fixture(){
 const p=createProject(),chapter=p.chapters[0],node=createNode(p,'container');chapter.nodes.push(node);
 chapter.startNode=node.id;node.connections.next=null;
 chapter.variables=[{id:'found',type:'flag',initial:false}];
 const item=p.library.find(d=>d.id===node.items[0].definitionId);
 item.onCollect=[{op:'set',key:'found',value:true}];
 return {p,chapter,node,item};
}
test('legacy load/save assigns owners, exports retain them, repeated imports remap to new chapter identities',()=>{
 const {p,chapter,node,item}=fixture();
 for(const d of p.library)delete d.chapterId;
 const raw=JSON.stringify(p),loaded=parseProject(raw);
 assert.equal(loaded.library.find(d=>d.id===item.id).chapterId,chapter.id);
 const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 assert.equal(saveProject(loaded,store).ok,true);assert.deepEqual(loadProject(store).project,loaded);
 const pkg=exportChapter(loaded),before=structuredClone(pkg);
 const merged=importChapter(importChapter(createProject(),pkg),pkg);
 assert.deepEqual(pkg,before);assert.deepEqual(validateProject(merged),[]);
 const imports=merged.chapters.slice(1);
 for(const c of imports){
  const used=compileChapter(merged,c.id).nodes.find(n=>n.id===node.id).items[0];
  const local=merged.library.find(d=>d.id===used.definitionId);
  assert.equal(local.chapterId,c.id);
  assert.equal(local.onCollect[0].key,c.variables[0].id);
 }
 assert.notEqual(imports[0].id,imports[1].id);
});
test('new chapter creation assigns its owner before inserting the unattached first beat',()=>{
 const p=createProject(),drafts=new LocalCardDrafts();
 const result=applyDocumentCommand(p,{chapterId:p.activeChapterId},'add-chapter',{},drafts);
 const chapter=p.chapters.find(c=>c.id===result.selection.chapterId);
 const definition=p.library.find(d=>d.id===chapter.nodes[0].cards[0].definitionId);
 assert.equal(definition.chapterId,chapter.id);assert.deepEqual(validateProject(p,{allowDraft:true}),[]);
});
test('deleting a chapter removes its unplaced owned drafts but preserves another owner, with undo',()=>{
 const {p,chapter}=fixture();
 const other=createChapter('other');other.nodes=[{id:'end',type:'linear',name:'End',x:0,y:0,cards:[{id:'p',definitionId:'arrival'}],connections:{next:null}}];other.startNode='end';p.chapters.push(other);restoreFixtureDefaults(p);
 const draft={id:'draft',kind:'event',name:'Draft',text:'',image:'',visibility:'local',chapterId:chapter.id,effects:[]};
 const surviving={...draft,id:'surviving',chapterId:other.id};p.library.push(draft,surviving);normalizeLocalOwnership(p);
 const before=structuredClone(p),history=new DocumentHistory(p),drafts=new LocalCardDrafts();
 const out=transactDocument(history,drafts,d=>applyDocumentCommand(d,{chapterId:chapter.id},'delete-chapter',{id:chapter.id},drafts));
 assert.equal(out.failure,undefined);assert.ok(!out.project.library.some(d=>d.chapterId===chapter.id));
 assert.ok(out.project.library.some(d=>d.id==='surviving'));assert.deepEqual(validateProject(out.project),[]);
 history.undo();assert.deepEqual(history.document,before);
});
test('explicit invalid owners and authored foreign references are reported by validation',()=>{
 const {p,chapter,item}=fixture();
 item.chapterId='missing';assert.ok(validateProject(p).some(e=>e.message.includes('invalid chapter owner')));
 assert.throws(()=>parseProject(JSON.stringify(p)),/invalid chapter owner/);
 item.chapterId=chapter.id;
 const other=createChapter('other');other.nodes=[{id:'other-node',name:'Other',type:'linear',cards:[{id:'foreign',definitionId:item.id}],connections:{next:null}}];other.startNode='other-node';p.chapters.push(other);
 assert.ok(validateProject(p).some(e=>e.message.includes('belongs to chapter')));
});
test('local draft Clear retains chapterId and type switches cannot lose it',()=>{
 const {p,chapter,node,item}=fixture(),placement=node.items[0],drafts=new LocalCardDrafts();
 drafts.setContext(chapter.id,node.id);drafts.clear(p,placement);assert.equal(item.chapterId,chapter.id);
 // Different kinds are exercised in a compatible linear slot.
 node.type='linear';node.cards=node.items;delete node.items;delete node.intro;
 for(const kind of ['event','caption','action','item']){
  drafts.switchSource(p,placement,`local:${kind}`,{allowedKinds:['event','caption','action','item']});
  assert.equal(p.library.find(d=>d.id===placement.definitionId).chapterId,chapter.id);
 }
});

test('legacy migration keeps inventory aliases separate from non-Item definition identities',()=>{
 const p=createProject(),chapter=p.chapters[0];
 p.library.push({id:'alias-action',kind:'action',visibility:'local',name:'Action',text:'',image:'',resolution:'direct',conditions:[{source:'inventory',key:'alias-action',op:'has'}],effects:[{op:'addItem',key:'variant-one'},{op:'addItem',key:'variant-two'}]},
 ...['variant-one','variant-two'].map(id=>({id,kind:'item',visibility:'local',name:id,text:'',image:'',inventoryKey:'alias-action',onCollect:[]})));
 chapter.nodes[0].cards=[{id:'action-placement',definitionId:'alias-action'}];
 const other=structuredClone(chapter);other.id='other';p.chapters.push(other);restoreFixtureDefaults(p);
 assert.deepEqual(validateProject(p),[]);
 normalizeLocalOwnership(p);assert.deepEqual(validateProject(p),[]);
 for(const c of p.chapters){
  const action=p.library.find(d=>d.id===c.nodes[0].cards[0].definitionId);
  const items=action.effects.map(e=>p.library.find(d=>d.id===e.key));
  assert.ok(items.every(d=>d.chapterId===c.id));
  assert.equal(action.conditions[0].key,items[0].inventoryKey);
  assert.equal(items[0].inventoryKey,items[1].inventoryKey);
 }
 const once=structuredClone(p);normalizeLocalOwnership(p);assert.deepEqual(p,once);
});
