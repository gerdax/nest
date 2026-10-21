import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter, parseProject, compileChapter, validateProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { initialValues, transact } from '../project/state.js';
import { chapterEntryState } from '../project/chapter-entry.js';
import { definitionDestination, itemReferenceLinks } from '../studio/item-reference.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0];
 const local={...createDefinition('item','local-key'),visibility:'local',chapterId:chapter.id,name:'Local key',tagId:'tool'};
 const shared=project.library.find(card=>card.kind==='item');shared.tagId='tool';
 project.itemTags=[{id:'tool',name:'Tool'}];project.library.push(local);
 const node=chapter.nodes.find(node=>node.type==='container');node.items.push({id:'local-key-card',definitionId:local.id});
 return {project,chapter,node,local,shared};
}

test('item references show Library or exact chapter/node source without changing the document',()=>{
 const {project,chapter,node,local,shared}=fixture(),before=structuredClone(project);
 assert.equal(definitionDestination(project,shared.id).kind,'library');
 const destination=definitionDestination(project,local.id);
 assert.deepEqual(destination.target,{chapterId:chapter.id,nodeId:node.id,placementId:'local-key-card'});
 const localHtml=itemReferenceLinks(project,local.id,chapter);
 assert.match(localHtml,/Local · First expedition → Supplies → Local key/);
 assert.match(localHtml,/data-command="go-to-definition" data-definition="local-key"/);
 assert.match(itemReferenceLinks(project,shared.id,chapter),/Library · Flashlight/);
 assert.doesNotMatch(localHtml,/Edit shared/);
 assert.deepEqual(project,before);
});

test('tag references list matching shared and owned local items, never other chapters',()=>{
 const {project,chapter,shared}=fixture();
 const other=createChapter('other','Other');project.chapters.push(other);
 project.library.push({...createDefinition('item','other-key'),visibility:'local',chapterId:other.id,tagId:'tool'});
 const html=itemReferenceLinks(project,'tag:tool',chapter);
 assert.match(html,/Matching items: 2/);
 assert.match(html,/data-definition="local-key"/);assert.match(html,new RegExp(`data-definition="${shared.id}"`));
 assert.doesNotMatch(html,/other-key/);
 const library=itemReferenceLinks(project,'tag:tool');
 assert.match(library,/Matching items: 1/);assert.doesNotMatch(library,/local-key|other-key/);
 assert.match(itemReferenceLinks(project,'tag:missing',chapter),/No matching items/);
});

test('missing and out-of-scope references do not offer a misleading navigation button',()=>{
 const {project,chapter,local}=fixture();
 for(const html of [itemReferenceLinks(project,'missing',chapter),itemReferenceLinks(project,local.id)]) {
  assert.match(html,/unavailable in this scope/);assert.doesNotMatch(html,/data-command/);
 }
 assert.equal(definitionDestination(project,'missing'),null);assert.equal(itemReferenceLinks(project,''),'');
});

test('concrete IDs and legacy inventory aliases take precedence over the tag namespace',()=>{
 const {project,chapter}=fixture();
 project.library.push({...createDefinition('item','tag:legacy'),name:'Legacy concrete item'});
 const concrete=itemReferenceLinks(project,'tag:legacy',chapter);
 assert.match(concrete,/data-definition="tag:legacy"/);assert.doesNotMatch(concrete,/Matching items/);
 project.library.push({...createDefinition('item','aliased'),inventoryKey:'old-item-key'});
 assert.match(itemReferenceLinks(project,'old-item-key',chapter),/data-definition="aliased"/);
 project.library.at(-1).inventoryKey='tag:old-alias';
 assert.match(itemReferenceLinks(project,'tag:old-alias',chapter),/data-definition="aliased"/);
});

test('unplaced local items open their definition without inventing a placement',()=>{
 const {project,chapter,node,local}=fixture();node.items.pop();
 assert.equal(definitionDestination(project,local.id).kind,'unplaced');
 assert.match(itemReferenceLinks(project,local.id,chapter),/Unplaced definition/);
 assert.equal(node.items.length,1);
});

test('definition destinations preserve legacy sequence, slot and parent identities',()=>{
 const {project,chapter,local}=fixture();
 chapter.nodes=[{id:'legacy',type:'legacySequence',sequences:[{id:'seq',cards:[{id:'parent',choices:[{id:'nested',definitionId:local.id}]}]}]}];
 assert.deepEqual(definitionDestination(project,local.id).target,{chapterId:chapter.id,nodeId:'legacy',placementId:'nested',sequenceId:'seq',slot:'choices',parentCardId:'parent'});
});

test('source names and opaque definition IDs are escaped in labels and attributes',()=>{
 const {project,chapter,local}=fixture();local.name='<script>"';
 const html=itemReferenceLinks(project,local.id,chapter);
 assert.match(html,/&lt;script&gt;&quot;/);assert.doesNotMatch(html,/<script>/);
});

test('chapter-local progression rewards survive save/compile and expire at the chapter boundary',()=>{
 let {project,chapter,local,shared}=fixture();
 const arrival=project.library.find(card=>card.id==='arrival');
 Object.assign(arrival,{visibility:'local',chapterId:chapter.id,effects:[{op:'addItem',key:local.id},{op:'addItem',key:shared.id}]});
 chapter.nodes.find(node=>node.type==='container').items=[];
 const next=createChapter('next','Next');
 next.nodes=[{id:'next-story',name:'Next story',x:0,y:0,type:'linear',cards:[{id:'next-card',definitionId:'explore'}],connections:{next:null}}];next.startNode='next-story';
 project.chapters.push(next);
 project=parseProject(JSON.stringify(project));
 assert.deepEqual(validateProject(project),[]);
 assert.equal(project.library.find(card=>card.id===local.id).visibility,'local');
 const compiled=compileChapter(project,chapter.id);
 assert.ok(compiled.library.some(item=>item.id===local.id),'effect-only local dependency stays compiled');
 const result=transact(initialValues(compiled.variables),[],{effects:compiled.nodes[0].cards[0].effects},compiled.variables,compiled.library);
 assert.equal(result.inventory.length,2);
 const removed=transact(result.variables,result.inventory,{effects:[{op:'removeItem',key:local.id}]},compiled.variables,compiled.library);
 assert.equal(removed.inventory.length,1);
 const entry=chapterEntryState(project,next.id,{variables:result.variables,collectedItems:result.inventory});
 assert.deepEqual(entry.inventory.map(item=>item.definitionId??item.id),[shared.id]);
});
