import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFace} from '../project/presentation.js';
import {renderCardPreviews} from '../studio/card-preview.js';
import {createProject,parseProject,compileChapter,exportChapter} from '../project/model.js';
import {createDefinition,resolvePlacement} from '../project/cards.js';
import {decorateCard} from '../engine/renderer.js';
import {ProjectController} from '../project/ProjectController.js';
import {cardFields,nodeInspector} from '../studio/inspectors.js';
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


test('only item names can appear on cards, including old showName settings',()=>{
 const project=createProject();
 for(const definition of project.library){
  assert.equal(definition.showName,definition.kind==='item');
  const before=cardFace(definition,project.variables,project.library);assert.equal(before.heading,definition.kind==='item'?definition.name:'');
  definition.showName=true;assert.equal(cardFace(definition,project.variables,project.library).heading,definition.kind==='item'?definition.name:'');
  definition.showName=false;const after=cardFace(definition,project.variables,project.library);assert.equal(after.heading,'');assert.equal(after.text,before.text);assert.equal(after.summary,before.summary);
  delete definition.showName;assert.equal(cardFace(definition).heading,'');
 }
 const d=project.library[0];d.showName=true;d.heading='Custom';assert.equal(cardFace(d).heading,'');
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
   assert.equal(type==='fork'?deck.content.actions[0].heading:deck.content.heading,'');controller.destroy();
  }
 }
});

test('artwork scale and position survive export and match inline and playback faces',()=>{
 const project=createProject(),node=project.chapters[0].nodes[0],definition=project.library.find(d=>d.id===node.cards[0].definitionId);
 Object.assign(definition,{imageScale:150,imageOffsetX:-12,imageOffsetY:8,flipImage:true});
 const restored=parseProject(JSON.stringify(exportChapter(project))),compiled=compileChapter(restored),card=compiled.nodes[0].cards[0];
 assert.equal(card.imageScale,150);assert.equal(card.imageOffsetX,-12);assert.equal(card.imageOffsetY,8);
 const mount=new Element();mount.dataset.previewPlacement=node.cards[0].id;renderCardPreviews({querySelectorAll:()=>[mount]},project,node);
 assert.equal(mount.children[0].children[1].style.transform,'translate(-12%, 8%) scale(1.5) scaleX(-1)');
 assert.equal(mount.children[0].children[0].style.transform,undefined);
 const deck=new Deck(),controller=new ProjectController(deck,compileChapter(project));assert.equal(deck.content.imageScale,150);assert.equal(deck.content.imageOffsetX,-12);controller.destroy();
 definition.visibility='local';assert.match(nodeInspector(project,project.chapters[0],node),/Image scale and position/);
});


test('typed fronts separate permanent type labels from item names and hide name controls elsewhere',()=>{
 const project=createProject();
 for(const kind of ['event','caption','action','item']) {
  const definition=createDefinition(kind,kind);definition.showName=true;definition.name='Internal name';
  const face=cardFace(definition),front=new Element();
  decorateCard(null,front,'',face.heading,'',false,face);
  const label=front.children.find(e=>e.className==='nest-card-type');
  assert.equal(label?.textContent,['action','item'].includes(kind)?kind.toUpperCase():undefined);
  assert.equal(front.children[0].children[0].textContent,kind==='item'?'Internal name':'');
  const html=cardFields(project,definition);
  assert.equal(html.includes('Show name on card'),kind==='item');
  if(kind==='item') {definition.showName=false;assert.equal(cardFace(definition).heading,'');}
 }
});
