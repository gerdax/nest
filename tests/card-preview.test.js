import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFace} from '../project/presentation.js';
import {renderCardPreviews} from '../studio/card-preview.js';
import {createProject,parseProject,compileChapter,exportChapter} from '../project/model.js';
import {resolvePlacement} from '../project/cards.js';
import {ProjectController} from '../project/ProjectController.js';
import {nodeInspector} from '../studio/inspectors.js';
class Element {
 constructor(){this.style={};this.children=[];this.dataset={};this.attrs={};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attrs[k]=v;}
}
globalThis.document={createElement:()=>new Element()};
class Deck extends EventTarget {reset(){}replaceContent(content){this.content=content;}endContent(){}}

test('inspector preview and player use identical narrative heading/body/artwork, without context',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='container');project.chapters[0].startNode=node.id;
 const d=project.library.find(d=>d.id===node.intro.definitionId);d.heading='Box heading';d.showName=true;d.text='Desc';d.flipImage=true;node.intro.context='Discard me';
 const mount=new Element();mount.dataset.previewPlacement=node.intro.id;
 renderCardPreviews({querySelectorAll:()=>[mount]},project,node);
 const front=mount.children[0],copy=front.children[0],art=front.children[1];
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));
 assert.equal(copy.children[0].textContent,deck.content.heading);assert.equal(copy.children[1].textContent,deck.content.text);assert.equal(deck.content.text,'Desc');
 assert.equal(art.style.backgroundImage,`url(${JSON.stringify(deck.content.image)})`);assert.equal(art.style.transform,'scaleX(-1)');assert.equal(front.className,'nest-card nest-situation');
 assert.doesNotMatch(nodeInspector(project,project.chapters[0],node),/data-path="context"|mini-card/);controller.destroy();
});

test('item and action preview faces match gameplay headings, summaries and placement mechanics',()=>{
 const project=createProject();
 for(const type of ['container','fork']){
  const node=project.chapters[0].nodes.find(n=>n.type===type),p=(node.items||node.choices)[0],d=project.library.find(d=>d.id===p.definitionId);
  d.text='Description';p.context='Discard';if(type==='fork')p.overrides={resolution:'check',check:{pool:[{sides:20,count:1}],modifier:2,target:12}};
  const resolved=resolvePlacement(project,p),face=cardFace(resolved,project.variables,project.library);
  const deck=new Deck(),compiled=compileChapter(project);compiled.startNode=node.id;const controller=new ProjectController(deck,compiled);
  const live=deck.content.actions[0];for(const key of ['heading','text','summary','image','flipImage','cardKind'])assert.equal(face[key],live[key]);controller.destroy();
 }
});

test('old placement context is discarded on load and export without changing definition text',()=>{
 const project=createProject();project.chapters[0].nodes[0].cards[0].context='Old extra text';
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.chapters[0].nodes[0].cards[0].context,undefined);assert.equal(loaded.library[0].text,project.library[0].text);
 assert.equal(exportChapter(project).chapter.nodes[0].cards[0].context,undefined);
});


test('all card kinds hide names by default and opt in without hiding body or mechanics',()=>{
 const project=createProject();
 for(const definition of project.library){
  assert.equal(definition.showName,false);
  const before=cardFace(definition,project.variables,project.library);assert.equal(before.heading,'');
  definition.showName=true;assert.equal(cardFace(definition,project.variables,project.library).heading,definition.name);
  definition.showName=false;const after=cardFace(definition,project.variables,project.library);assert.equal(after.heading,'');assert.equal(after.text,before.text);assert.equal(after.summary,before.summary);
  delete definition.showName;assert.equal(cardFace(definition).heading,'');
 }
 const d=project.library[0];d.showName=true;d.heading='Custom';assert.equal(cardFace(d).heading,'Custom');
 const loaded=parseProject(JSON.stringify(project));assert.equal(loaded.library[0].showName,true);
 d.showName='yes';assert.throws(()=>parseProject(JSON.stringify(project)),/invalid content/);
});

test('name visibility reaches both narrative cover and action/item fronts during playback',()=>{
 const project=createProject();
 for(const type of ['linear','container','fork']){
  const node=project.chapters[0].nodes.find(n=>n.type===type),p=type==='linear'?node.cards[0]:type==='container'?node.intro:node.choices[0];
  const d=project.library.find(d=>d.id===p.definitionId);
  for(const show of [false,true]){
   d.showName=show;const compiled=compileChapter(project);compiled.startNode=node.id;const deck=new Deck(),controller=new ProjectController(deck,compiled);
   assert.equal(type==='fork'?deck.content.actions[0].heading:deck.content.heading,show?d.heading||d.name:'');controller.destroy();
  }
 }
});
