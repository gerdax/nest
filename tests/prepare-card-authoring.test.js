import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlternativeRatCombatProject,createRatCombatProject} from '../project/combat-fixture.js';
import {definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {sourceCard,revealCardEntry} from '../studio/card-navigation.js';
import {previewCardTarget} from '../studio/preview-card-target.js';

const labels={block:'Block reveal',charge:'Charge reveal',hold:'Holds ground'};
function fixture(){
 const project=createAlternativeRatCombatProject(),chapter=project.chapters[0];
 return {project,chapter,enemy:project.library.find(d=>d.id==='rat'),node:chapter.nodes.find(n=>n.type==='combat')};
}
test('alternative Enemy exposes three named presentation cards with type, text and artwork controls',()=>{
 const {project,enemy}=fixture(),html=definitionInspector(project,enemy);
 assert.match(html,/One action is declared at random each enemy turn\./);
 assert(!html.includes('Performed in order, then repeated.'));
 assert(!html.includes('Blocked attack'));
 for(const [key,label] of Object.entries(labels)){
  assert(html.includes(`<summary>${label}</summary>`));
  for(const field of ['name','kind','text'])assert(html.includes(`data-path="preparationCards.${key}.${field}"`));
  assert(html.includes(`data-preview-path="preparationCards.${key}"`));
  assert.equal(html.includes(`data-path="preparationCards.${key}.image"`),enemy.preparationCards[key].kind==='event');
 }
 for(const key of ['block','charge'])for(const field of ['imageScale','imageOffsetX','imageOffsetY','flipImage'])assert(html.includes(`data-path="preparationCards.${key}.${field}"`));
 const classic=createRatCombatProject(),classicHtml=definitionInspector(classic,classic.library.find(d=>d.id==='rat'));
 assert(classicHtml.includes('Performed in order, then repeated.'));
 assert(!classicHtml.includes('<h3>Preparation cards</h3>'));
});
test('preparation card edits use the normal document fields and caption-to-event switch enables artwork',()=>{
 const {project,chapter,enemy}=fixture(),selection={chapterId:chapter.id,definitionId:enemy.id};
 const edit=(path,value,inputType='text')=>applyDocumentCommand(project,selection,'field',{scope:'definition',path:`preparationCards.hold.${path}`,value,inputType});
 const originalId=enemy.preparationCards.hold.id;
 edit('kind','event');edit('name','Shield clash');edit('text','A custom block.');edit('image','custom-block.png');edit('imageScale','145','range');
 assert.equal(enemy.preparationCards.hold.id,originalId);
 assert.equal(enemy.preparationCards.hold.name,'Shield clash');assert.equal(enemy.preparationCards.hold.text,'A custom block.');
 assert.equal(enemy.preparationCards.hold.image,'custom-block.png');assert.equal(enemy.preparationCards.hold.imageScale,145);
 const html=definitionInspector(project,enemy);assert(html.includes('data-path="preparationCards.hold.image"'));assert(html.includes('data-path="preparationCards.hold.imageScale"'));
 assert.deepEqual(enemy.preparationCards.hold.effects,[]);
});
test('all preparation cards resolve their stable IDs and missing or classic sources do not resolve',()=>{
 const {project,chapter,enemy,node}=fixture();
 for(const key of Object.keys(labels)){
  const target={kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:enemy.id,cardId:enemy.preparationCards[key].id};
  const source=sourceCard(project,target);assert.equal(source.card,enemy.preparationCards[key]);assert.equal(source.definitionPath,`preparationCards.${key}`);
  const card=enemy.preparationCards[key];delete enemy.preparationCards[key];assert.equal(sourceCard(project,target),null);enemy.preparationCards[key]=card;
  delete enemy.mechanics;assert.equal(sourceCard(project,target),null);enemy.mechanics='opposed-preparation';
 }
});
test('visible hold feedback targets the authored preparation card; stale and rolling decks stay gated',()=>{
 const {project,chapter,enemy,node}=fixture();
 const combat={enemy,phase:'effects',sequence:{index:0,steps:[]}};
 const args={project,chapterId:chapter.id,controller:{state:{idle:true,activeNodeId:node.id},location:{node},combat},deck:{phase:'closed',content:{id:'visible'}}};
 for(const key of ['hold']){
  combat.sequence.steps=[{card:enemy.preparationCards[key],contentId:'visible'}];
  assert.deepEqual(previewCardTarget(args),{kind:'definition',chapterId:chapter.id,nodeId:node.id,definitionId:enemy.id,cardId:enemy.preparationCards[key].id,definitionPath:`preparationCards.${key}`});
 }
 combat.sequence.steps[0].contentId='stale';assert.equal(previewCardTarget(args),null);
 combat.sequence.steps[0].contentId='visible';args.controller.state.checking=true;assert.equal(previewCardTarget(args),null);
});
test('Go to card expands the exact preparation section and focuses its summary',()=>{
 const inspector={},summary={focus(options){this.options=options;}},classes=new Set();
 const entry={tagName:'DETAILS',parentElement:inspector,classList:{add:value=>classes.add(value)},scrollIntoView(){this.scrolled=true;},querySelector:()=>summary};
 const preview={dataset:{previewPath:'preparationCards.charge'},closest:()=>entry};
 inspector.querySelectorAll=selector=>selector==='[data-preview-path]'?[preview]:[];
 assert.equal(revealCardEntry(inspector,{kind:'definition',definitionPath:'preparationCards.charge'}),true);
 assert.equal(entry.open,true);assert.equal(entry.scrolled,true);assert(classes.has('card-navigation-target'));assert.deepEqual(summary.options,{preventScroll:true});
 assert.equal(revealCardEntry(inspector,{kind:'definition',definitionPath:'preparationCards.missing'}),false);
});
