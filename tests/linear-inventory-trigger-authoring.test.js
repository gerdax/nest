import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject,compileChapter,parseProject,exportChapter,importChapter} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {nodeInspector} from '../studio/inspectors.js';
import {captureCardClipboard,pasteCardClipboard} from '../studio/card-clipboard.js';

function fixture(){
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 const action={...createDefinition('action','use-tool'),name:'Use tool'};
 project.library.push(action);
 node.cards.push({id:'use-tool-placement',definitionId:action.id,contextItemId:'flashlight'});
 return {project,chapter,node,placement:node.cards.at(-1)};
}

test('Linear trigger after narrative cards survives save, compilation and chapter export/import',()=>{
 const {project,chapter,node,placement}=fixture();
 const caption=createDefinition('caption','before-action');project.library.push(caption);
 node.cards.splice(1,0,{id:'caption-placement',definitionId:caption.id});
 placement.contextOverrideImage=true;
 assert.deepEqual(validateProject(project),[]);
 const parsed=parseProject(JSON.stringify(project));
 const compiled=compileChapter(parsed,chapter.id).nodes.find(n=>n.id===node.id);
 assert.deepEqual(compiled.cards.map(c=>c.kind),['event','caption','action']);
 assert.equal(compiled.cards.at(-1).contextItemId,'flashlight');
 assert.equal(compiled.cards.at(-1).contextOverrideImage,true);
 assert.equal(compiled.cards.at(-1).conditions.at(-1).key,'flashlight');
 const target=createProject(),merged=importChapter(target,exportChapter(project,chapter.id)),imported=merged.chapters.at(-1);
 assert.deepEqual(validateProject(merged),[]);
 assert.ok(compileChapter(merged,imported.id).nodes.some(n=>n.cards?.some(c=>c.kind==='action'&&c.contextItemId)));
 assert.doesNotMatch(nodeInspector(project,chapter,node),/<select[^>]*data-path="contextItemId"[^>]*disabled/);
});

test('Linear triggers accept item tags but reject invalid targets, story cards and Death beats',()=>{
 const {project,node,placement}=fixture();
 project.itemTags=[{id:'light',name:'Light'}];
 project.library.find(d=>d.id==='flashlight').tagId='light';placement.contextItemId='tag:light';
 assert.deepEqual(validateProject(project),[]);
 assert.equal(compileChapter(project).nodes.find(n=>n.id===node.id).cards.at(-1).contextInventoryKey,'tag:light');
 for(const target of ['missing','use-tool']){
  placement.contextItemId=target;assert.ok(validateProject(project).some(e=>/inventory context/.test(e.message)));
 }
 placement.contextItemId='flashlight';node.cards[0].contextItemId='flashlight';
 assert.ok(validateProject(project).some(e=>/inventory context/.test(e.message)));
 delete node.cards[0].contextItemId;node.type='death';
 assert.ok(validateProject(project).some(e=>/inventory context/.test(e.message)));
});

test('pasting a triggered Action into Linear keeps its trigger and dependency',()=>{
 const {project,chapter,node,placement}=fixture();
 const source=chapter.nodes.find(n=>n.type==='fork');source.choices[0].contextItemId='flashlight';
 const payload=captureCardClipboard(project,chapter.id,source.id,source.choices[0].id);
 pasteCardClipboard(project,chapter,node,placement,payload);
 assert.equal(placement.contextItemId,'flashlight');
 assert.deepEqual(validateProject(project),[]);
 const copied=captureCardClipboard(project,chapter.id,node.id,placement.id);
 pasteCardClipboard(project,chapter,source,source.choices[0],copied);
 assert.equal(source.choices[0].contextItemId,'flashlight');
 assert.deepEqual(validateProject(project),[]);
});
