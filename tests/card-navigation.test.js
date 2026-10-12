import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceCard, revealCardEntry } from '../studio/card-navigation.js';
import { createProject } from '../project/model.js';
import { nodeInspector } from '../studio/inspectors.js';

test('source lookup finds exact placements including intros and handles deleted snapshot sources',()=>{
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[1];
 const target={chapterId:chapter.id,nodeId:node.id,placementId:node.intro.id};
 const source=sourceCard(project,target);assert.equal(source.placement,node.intro);assert.equal(source.node,node);
 target.placementId=node.items[0].id;assert.equal(sourceCard(project,target).placement,node.items[0]);
 assert.equal(sourceCard(project,{...target,placementId:'deleted'}),null);
 assert.equal(sourceCard(project,{...target,nodeId:'deleted'}),null);
 assert.equal(sourceCard(project,{...target,chapterId:'deleted'}),null);
});
test('legacy target lookup scopes repeated card IDs to their sequence',()=>{
 const first={id:'one',cards:[{id:'same',definitionId:'arrival',choices:[{id:'choice',definitionId:'explore'}]}]};
 const second={id:'two',cards:[{id:'same',definitionId:'explore'}],items:[{id:'item',definitionId:'flashlight'}]};
 const project=createProject(),chapter=project.chapters[0];chapter.nodes=[{id:'pool',type:'legacyPool',sequences:[first,second],connections:{next:null}}];
 const target={chapterId:chapter.id,nodeId:'pool',sequenceId:'two',placementId:'same',slot:'cards'};
 assert.equal(sourceCard(project,target).placement,second.cards[0]);
 assert.equal(sourceCard(project,{...target,sequenceId:'one',placementId:'choice',slot:'choices',parentCardId:'same'}).placement,first.cards[0].choices[0]);
 assert.equal(sourceCard(project,{...target,placementId:'item',slot:'items'}).placement,second.items[0]);
 assert.equal(sourceCard(project,{...target,sequenceId:'missing'}),null);
 const html=nodeInspector(project,chapter,chapter.nodes[0]);
 assert.match(html,/data-sequence="two"/);assert.match(html,/data-card-placement="choice"/);
});
function element(tagName,dataset={},parentElement=null) {
 const classes=new Set();
 return {tagName,dataset,parentElement,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
 scrollIntoView(options){this.scrollOptions=options;},focus(options){this.focusOptions=options;}};
}
test('reveals opaque placement IDs, expands details, focuses summary and removes prior highlight',()=>{
 const inspector=element('DIV'),summary=element('SUMMARY'),outer=element('DETAILS',{},inspector);
 const id='card.\"[opaque]';const entry=element('DETAILS',{placement:id},outer),previous=element('DETAILS');
 previous.classList.add('card-navigation-target');entry.querySelector=()=>summary;
 inspector.querySelectorAll=selector=>selector==='.card-navigation-target'?[previous]:[entry];
 assert.equal(revealCardEntry(inspector,{placementId:id}),true);
 assert.equal(entry.open,true);assert.equal(outer.open,true);assert.equal(entry.classList.contains('card-navigation-target'),true);
 assert.equal(previous.classList.contains('card-navigation-target'),false);
 assert.deepEqual(entry.scrollOptions,{block:'start',inline:'nearest',behavior:'auto'});
 assert.deepEqual(summary.focusOptions,{preventScroll:true});
 assert.equal(revealCardEntry(inspector,{placementId:'missing'}),false);
});
test('legacy reveal expands the selected sequence without clicking its shared edit button',()=>{
 const inspector=element('DIV'),sequence=element('DETAILS',{sequence:'two'},inspector),entry=element('BUTTON',{cardPlacement:'card',cardSlot:'cards'},sequence);
 sequence.querySelectorAll=()=>[entry];inspector.querySelectorAll=selector=>selector==='.card-navigation-target'?[]:[sequence];
 assert.equal(revealCardEntry(inspector,{sequenceId:'two',placementId:'card',slot:'cards'}),true);
 assert.equal(sequence.open,true);assert.deepEqual(entry.focusOptions,{preventScroll:true});
 assert.equal(revealCardEntry(inspector,{sequenceId:'one',placementId:'card',slot:'cards'}),false);
});

test('legacy choices with the same ID and definition stay scoped to their parent card',()=>{
 const project=createProject(),chapter=project.chapters[0];
 const choice=()=>({id:'repeat',definitionId:'explore'});
 const sequence={id:'sequence',cards:[{id:'one',definitionId:'arrival',choices:[choice()]},{id:'two',definitionId:'arrival',choices:[choice()]}],items:[{id:'repeat',definitionId:'flashlight'}]};
 chapter.nodes=[{id:'legacy',type:'legacySequence',sequence}];
 const target={chapterId:chapter.id,nodeId:'legacy',sequenceId:sequence.id,placementId:'repeat',slot:'choices',parentCardId:'two'};
 assert.equal(sourceCard(project,target).placement,sequence.cards[1].choices[0]);
 assert.equal(sourceCard(project,{...target,slot:'items'}).placement,sequence.items[0]);
 const inspector=element('DIV'),section=element('DETAILS',{sequence:sequence.id},inspector);
 const buttons=['one','two'].map(parent=>element('BUTTON',{cardPlacement:'repeat',cardSlot:'choices',cardParent:parent},section));
 section.querySelectorAll=()=>buttons;inspector.querySelectorAll=selector=>selector==='.card-navigation-target'?[]:[section];
 assert.equal(revealCardEntry(inspector,target),true);assert.equal(buttons[0].focusOptions,undefined);assert.deepEqual(buttons[1].focusOptions,{preventScroll:true});
});
