import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, validateProject} from '../project/model.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {chapterSettingsInspector} from '../studio/inspectors.js';

function session(count=3) {
 const project=createProject();
 project.chapters=Array.from({length:count},(_,index)=>({...structuredClone(project.chapters[0]),id:`chapter-${index+1}`}));
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const remove=id=>transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:id},'delete-chapter',{id},drafts));
 return {project,history,remove};
}

for(const [deleted,next] of [['chapter-1','chapter-2'],['chapter-2','chapter-3'],['chapter-3','chapter-2']]) {
 test(`deleting ${deleted} selects ${next}, preserves shared data and undoes atomically`,()=>{
  const s=session(),before=s.history.document,outcome=s.remove(deleted);
  assert.equal(outcome.failure,undefined);
  assert.equal(outcome.project.chapters.length,2);
  assert.equal(outcome.project.chapters.some(chapter=>chapter.id===deleted),false);
  assert.equal(outcome.project.activeChapterId,next);
  assert.deepEqual(outcome.result.selection,{chapterId:next,selected:before.chapters[0].startNode});
  assert.deepEqual(outcome.project.library,before.library);
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
