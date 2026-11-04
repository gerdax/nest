import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createProjectChapter,parseProject,compileChapter,validateProject,importChapter} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createNode} from '../studio/commands.js';
import {PreviewOverrides} from '../studio/preview-overrides.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {exportStudioChapter} from '../studio/persistence.js';
import {captureNodeClipboard,pasteNodeClipboard} from '../studio/node-clipboard.js';
import {definitionUsage} from '../studio/definition-usage.js';

test('Combat beat entry overrides persist through save/reload, exports and compiled gameplay',()=>{
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'combat');chapter.nodes.push(node);
 node.entryEffects=[{op:'set',key:'energy',value:7},{op:'addItem',key:'flashlight'}];
 const restored=parseProject(JSON.stringify(project));
 assert.deepEqual(restored.chapters[0].nodes.find(n=>n.id===node.id).entryEffects,node.entryEffects);
 assert.deepEqual(validateProject(restored),[]);
 const exported=parseProject(JSON.stringify(exportStudioChapter(project,chapter.id)));
 assert.deepEqual(exported.chapters[0].nodes.find(n=>n.id===node.id).entryEffects,node.entryEffects);
 assert.deepEqual(compileChapter(exported).nodes.find(n=>n.id===node.id).entryEffects,node.entryEffects);
 assert.equal(new PreviewOverrides().effects(restored,restored.chapters[0],restored.chapters[0].nodes.find(n=>n.id===node.id))[0].value,7);
 project.ignoreAllOverrides=true;
 assert.equal(compileChapter(project).nodes.find(n=>n.id===node.id).entryEffects,undefined);
 assert.equal(node.entryEffects.length,2);
});

test('entry override edits and Clear participate in document Undo/Redo',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 node.entryEffects=[{op:'set',key:'energy',value:7}];
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts(),selection={chapterId:chapter.id,selected:node.id};
 const edit=data=>transactDocument(history,drafts,draft=>applyDocumentCommand(draft,selection,'beat-overrides',data,drafts));
 assert.equal(edit({path:'effects.0.value',value:'4',inputType:'number'}).failure,undefined);
 assert.equal(history.document.chapters[0].nodes[0].entryEffects[0].value,4);
 history.undo();assert.equal(history.document.chapters[0].nodes[0].entryEffects[0].value,7);
 history.redo();assert.equal(history.document.chapters[0].nodes[0].entryEffects[0].value,4);
 edit({command:'clear-overrides'});assert.equal(history.document.chapters[0].nodes[0].entryEffects,undefined);
 history.undo();assert.equal(history.document.chapters[0].nodes[0].entryEffects[0].value,4);
});

test('saved entry item dependencies survive export/import and appear in usage',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 const item={...createDefinition('item','entry-local'),visibility:'local',chapterId:chapter.id};project.library.push(item);
 node.entryEffects=[{op:'addItem',key:item.id}];
 assert(compileChapter(project).library.some(d=>d.id===item.id));
 assert(definitionUsage(project,item.id).references.some(ref=>ref.nodeId===node.id));
 const pkg=exportStudioChapter(project,chapter.id),destination=createProject();
 destination.library.push({...createDefinition('item',item.id),name:'Different item'});
 const merged=importChapter(destination,pkg),imported=merged.chapters.at(-1),effect=imported.nodes.find(n=>n.id===imported.startNode).entryEffects[0];
 assert.notEqual(effect.key,item.id);
 assert(merged.library.some(d=>d.id===effect.key&&d.chapterId===imported.id));
 assert.deepEqual(validateProject(merged),[]);
});

test('copying a beat into another chapter remaps its entry variables and local items',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 chapter.variables.push({id:'entry-count',name:'Entry count',type:'number',initial:0});
 const item={...createDefinition('item','entry-item'),visibility:'local',chapterId:chapter.id};project.library.push(item);
 node.entryEffects=[{op:'add',key:'entry-count',value:1},{op:'addItem',key:item.id}];
 const destination=createProjectChapter(project,'destination','Destination');project.chapters.push(destination);
 const copied=pasteNodeClipboard(project,destination,captureNodeClipboard(project,chapter.id,node.id));
 assert(destination.variables.some(v=>v.id===copied.entryEffects[0].key));
 const copiedItem=project.library.find(d=>d.id===copied.entryEffects[1].key);
 assert.notEqual(copiedItem.id,item.id);assert.equal(copiedItem.chapterId,destination.id);
});

test('invalid entry overrides point to the beat, including unsupported Death overrides',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 node.entryEffects=[{op:'set',key:'missing',value:1}];
 const issue=validateProject(project).find(i=>i.message.includes('Overrides'));
 assert.equal(issue.chapterId,chapter.id);assert.equal(issue.nodeId,node.id);
 const death=chapter.nodes.find(n=>n.type==='death');death.entryEffects=[{op:'set',key:'energy',value:3}];
 assert(validateProject(project).some(i=>i.nodeId===death.id&&i.message.includes('Death does not support')));
});
