import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject, validateProject} from '../project/model.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {chapterSettingsInspector} from '../studio/inspectors.js';

function session(count=3) {
 const project=createProject();
 project.chapters=Array.from({length:count},(_,index)=>({...structuredClone(project.chapters[0]),id:`chapter-${index+1}`}));
 restoreFixtureDefaults(project);
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const remove=id=>transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:id},'delete-chapter',{id},drafts));
 return {project,history,remove};
}

function deletionPrompt({answer=false,count=2,id='chapter-1',disabled=false}={}) {
 const {project}=session(count),calls=[];
 project.chapters[0].name='Opening';
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
 const start=source.indexOf('function command(event){'),end=source.indexOf('for(const root of',start);
 const context={project,mode:'chapter',confirm:message=>{calls.push(['confirm',message]);return answer;},
  preview:{stop:()=>calls.push(['stop'])},localDrafts:{reset:()=>calls.push(['reset'])},
  edit:(command,data)=>{calls.push(['edit',command,{...data}]);return {ok:true};},
  graph:{fit:()=>calls.push(['fit'])},report:message=>calls.push(['report',message])};
 runInNewContext(source.slice(start,end),context);
 context.command({target:{closest:()=>({disabled,dataset:{command:'delete-chapter',chapter:id}})}});
 return calls;
}

test('canceling chapter deletion prompts before preview, drafts or document changes',()=>{
 const calls=deletionPrompt();
 assert.deepEqual(calls.map(call=>call[0]),['confirm']);
 assert.match(calls[0][1],/Delete chapter “Opening”\?/);
 assert.match(calls[0][1],/Shared Library cards and project variables are kept/);
 assert.match(calls[0][1],/Undo restores/);
});

test('confirming chapter deletion runs the existing undoable deletion once',()=>{
 const calls=deletionPrompt({answer:true});
 assert.deepEqual(calls.map(call=>call[0]),['confirm','stop','reset','edit','fit','report']);
 assert.deepEqual(calls[3],['edit','delete-chapter',{id:'chapter-1'}]);
});

test('disabled, stale and only-chapter deletion never prompts or changes state',()=>{
 for(const options of [{disabled:true},{id:'missing'},{count:1}])assert.deepEqual(deletionPrompt(options),[]);
});

for(const [deleted,next] of [['chapter-1','chapter-2'],['chapter-2','chapter-3'],['chapter-3','chapter-2']]) {
 test(`deleting ${deleted} selects ${next}, preserves shared data and undoes atomically`,()=>{
  const s=session(),before=s.history.document,outcome=s.remove(deleted);
  assert.equal(outcome.failure,undefined);
  assert.equal(outcome.project.chapters.length,2);
  assert.equal(outcome.project.chapters.some(chapter=>chapter.id===deleted),false);
  assert.equal(outcome.project.activeChapterId,next);
  assert.deepEqual(outcome.result.selection,{chapterId:next,selected:before.chapters[0].startNode});
  assert.deepEqual(outcome.project.library,before.library.filter(definition=>definition.chapterId!==deleted),'shared definitions and other chapter defaults survive; deleted Death Caption is removed');
  assert.deepEqual(outcome.project.variables,before.variables);
  assert.deepEqual(validateProject(outcome.project),[]);
  assert.deepEqual(s.project,before);
  s.history.undo();assert.deepEqual(s.history.document,before);
  assert.equal(s.history.canUndo,false);
  s.history.redo();assert.deepEqual(s.history.document,outcome.project);
 });
}

test('last-chapter and stale deletion are rejected without changing history or redo',()=>{
 for(const [count,id] of [[1,'chapter-1'],[2,'missing']]){
  const s=session(count);
  s.history.transact(draft=>{draft.name='Later';});s.history.undo();
  const before=s.history.document,outcome=s.remove(id);
  assert.match(outcome.failure,count===1?/at least one chapter/:/no longer exists/);
  assert.deepEqual(s.history.document,before);
  assert.equal(s.history.canUndo,false);assert.equal(s.history.canRedo,true);
 }
});

test('Delete chapter is last in chapter settings, disabled only for a single chapter',()=>{
 for(const count of [1,2]){
  const {project}=session(count),html=chapterSettingsInspector(project,project.chapters[0]);
  const button=html.match(/<button[^>]*data-command="delete-chapter"[^>]*>/)?.[0];
  assert.ok(button);assert.equal(/\bdisabled\b/.test(button),count===1);
  assert.match(button,/data-chapter="chapter-1"/);
  assert.match(html,/Delete chapter<\/button><\/div><\/details>$/);
 }
});

test('chapter deletion removes only its orphaned local dependency closure and undoes atomically',()=>{
 const s=session(2),project=s.project,chapter=project.chapters[0],other=project.chapters[1];
 chapter.variables=[{id:'found',type:'flag',initial:false}];
 const local=(id,extra={})=>({id,kind:'event',visibility:'local',name:id,text:'',image:'',effects:[],...extra});
 project.library.push(
  local('deleted-story',{effects:[{op:'set',key:'found',value:true},{op:'addItem',key:'deleted-item'}]}),
  local('deleted-item',{kind:'item',onCollect:[{op:'addItem',key:'deleted-item'}]}),
  local('still-placed'),local('shared-dependency'),local('unrelated-draft'),
  local('shared-anchor',{visibility:'shared',effects:[{op:'addItem',key:'retained-item'}]}),
  local('retained-item',{kind:'item',onCollect:[]})
 );
 chapter.nodes[0].cards.push({id:'deleted-placement',definitionId:'deleted-story'},
  {id:'placed-elsewhere',definitionId:'still-placed'},
  {id:'dependency-placement',definitionId:'retained-item'});
 other.nodes[0].cards.push({id:'retained-placement',definitionId:'still-placed'});
 // Recreate history after preparing the fixture, preserving session's undo path.
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts(),before=structuredClone(project);
 const outcome=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:chapter.id},'delete-chapter',{id:chapter.id},drafts));
 assert.equal(outcome.failure,undefined);
 const ids=new Set(outcome.project.library.map(d=>d.id));
 for(const id of ['deleted-story','deleted-item'])assert.equal(ids.has(id),false,id);
 for(const id of ['still-placed','shared-dependency','unrelated-draft','shared-anchor','retained-item'])assert.equal(ids.has(id),true,id);
 assert.deepEqual(validateProject(outcome.project),[]);
 history.undo();assert.deepEqual(history.document,before);
 history.redo();assert.deepEqual(history.document,outcome.project);
});
