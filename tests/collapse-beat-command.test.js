import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject} from '../project/model.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

test('individual beat collapse persists and participates in undo/redo without changing other beats',()=>{
 const project=createProject(),chapter=project.chapters[0],target=chapter.nodes[1];
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const edit=data=>transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:chapter.id,selected:chapter.nodes[0].id},'collapse-beat',data,drafts));
 const beat=()=>history.document.chapters[0].nodes.find(n=>n.id===target.id);
 assert.equal(edit({id:target.id,collapsed:true}).failure,undefined);
 assert.equal(beat().collapsed,true);
 assert.equal(history.document.chapters[0].nodes[0].collapsed,undefined);
 assert.equal(parseProject(JSON.stringify(history.document)).chapters[0].nodes.find(n=>n.id===target.id).collapsed,true);
 assert.ok(history.undo());assert.equal(beat().collapsed,undefined);
 assert.ok(history.redo());assert.equal(beat().collapsed,true);
 assert.equal(edit({id:target.id,collapsed:false}).failure,undefined);assert.equal(beat().collapsed,false);
 const before=history.document;
 assert.match(edit({id:'missing',collapsed:true}).failure,/no longer exists/);
 assert.deepEqual(history.document,before);
});
